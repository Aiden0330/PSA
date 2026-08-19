"""ADR-3 AI 生成管线:接地工具 → 生成 → 确定性校验(schema→lint→引擎试运行)→ 修复环。

模型分层与常量遵循 docs/design/ai-model-strategy.md:
草案 = claude-fable-5(服务端回退 opus-4.8),工具接地,最多 3 轮修复;
所有响应带 provenance(model_id/prompt_version/served_by/rounds/tool_trace)。
测试经 client 注入(FakeClient)离线运行 —— 管线全部确定性环节可单测。
"""
from __future__ import annotations

import json
import os
from typing import Any, Protocol

# ── 常量(评测门与提示词变更时必须 bump;记入 ai_drafts 溯源)──
PROMPT_VERSION = "2026-08-17-p2"   # p2:截图转录附则(带图请求)
DRAFT_MODEL = "claude-fable-5"
FALLBACK_MODELS = ["claude-opus-4-8"]
FALLBACK_BETAS = ["server-side-fallback-2026-06-01"]
MAX_REPAIR_ROUNDS = 3
MAX_TOOL_ITERATIONS = 6


class AiTurn:
    """一轮模型输出:content(最终文本)或 tool_calls([{id,name,arguments}])。"""
    def __init__(self, content: str | None = None, tool_calls: list[dict] | None = None,
                 served_by: str | None = None):
        self.content = content
        self.tool_calls = tool_calls or []
        self.served_by = served_by


class AiClient(Protocol):
    model_id: str
    supports_tools: bool
    supports_repair: bool
    def complete(self, messages: list[dict], tools: list[dict] | None = None) -> AiTurn: ...


# ── 接地工具(检索真实参考库;模型数值必须可溯源或显式 ungrounded)──

def _library_index() -> list[dict]:
    from bess.library import load_library
    lib = load_library()
    out: list[dict] = []
    for c in lib.get("component_failure_rates", []):
        out.append({"id": c["id"], "name": c.get("name", ""), "kind": "component_failure_rate",
                    "value": c.get("rate"), "unit": c.get("unit", ""), "grade": c.get("grade"),
                    "citation": (c.get("source") or {}).get("citation", "")})
    for b in lib.get("barrier_effectiveness", []):
        out.append({"id": b["id"], "name": b.get("name", ""), "kind": "barrier_effectiveness",
                    "value": b.get("pfd"), "unit": "PFD", "grade": b.get("grade"),
                    "citation": (b.get("source") or {}).get("citation", "")})
    for ie in lib.get("initiating_events", []):
        out.append({"id": ie["id"], "name": ie.get("label", ""), "kind": "initiating_event",
                    "value": ie.get("freq_prior"), "unit": ie.get("unit", "/yr"), "grade": ie.get("grade"),
                    "citation": (ie.get("source") or {}).get("citation", "")})
    return out


def library_id_set() -> set[str]:
    return {e["id"] for e in _library_index()}


def tool_search_reference_library(query: str, category: str | None = None, limit: int = 8) -> list[dict]:
    q = (query or "").lower()
    hits = []
    for e in _library_index():
        if category and e["kind"] != category:
            continue
        hay = f"{e['id']} {e['name']}".lower()
        if all(tok in hay for tok in q.split() if tok):
            hits.append(e)
    return hits[:limit]


TOOLS_SPEC = [{
    "name": "search_reference_library",
    "description": "检索项目参考库(器件失效率/屏障PFD/初因频率)。返回条目含 id、数值、单位、置信分级、来源引用。"
                   "草案中的每个数值都应引用检索到的条目 id(填入 library_ref),否则会被标记为 ungrounded。",
    "input_schema": {"type": "object", "properties": {
        "query": {"type": "string", "description": "关键词(中文或 id 片段)"},
        "category": {"type": "string", "enum": ["component_failure_rate", "barrier_effectiveness", "initiating_event"]},
    }, "required": ["query"]},
}]


def execute_tool(name: str, arguments: dict) -> Any:
    if name == "search_reference_library":
        return tool_search_reference_library(arguments.get("query", ""), arguments.get("category"))
    raise ValueError(f"unknown tool {name}")


# ── 客户端实现 ──

class AnthropicClient:
    """Anthropic Messages API(httpx 直连,零 SDK 依赖)。
    按策略文档启用服务端回退 beta;served_by 取响应 model 字段。"""
    supports_tools = True
    supports_repair = True

    def __init__(self, model: str | None = None, api_key: str | None = None):
        from backend import ai_config
        # 优先级(2026-08-17):显式实参 > 用户配置 > 环境变量 > 默认
        self.model_id = model or ai_config.model() or os.getenv("PSA_LLM_MODEL") or DRAFT_MODEL
        self.api_key = api_key or ai_config.api_key()
        self.base = os.getenv("PSA_ANTHROPIC_BASE_URL", "https://api.anthropic.com").rstrip("/")

    def complete(self, messages: list[dict], tools: list[dict] | None = None) -> AiTurn:
        import httpx
        system = "\n".join(m["content"] for m in messages if m["role"] == "system")
        body: dict[str, Any] = {
            "model": self.model_id,
            "max_tokens": 8192,
            "system": system,
            "messages": [m for m in messages if m["role"] != "system"],
            "fallbacks": [{"model": m} for m in FALLBACK_MODELS],
        }
        if tools:
            body["tools"] = tools
        headers = {"x-api-key": self.api_key, "anthropic-version": "2023-06-01",
                   "anthropic-beta": ",".join(FALLBACK_BETAS), "content-type": "application/json"}
        r = httpx.post(f"{self.base}/v1/messages", headers=headers, json=body, timeout=120)
        r.raise_for_status()
        data = r.json()
        served = data.get("model")
        calls = [{"id": b.get("id"), "name": b.get("name"), "arguments": b.get("input", {})}
                 for b in data.get("content", []) if b.get("type") == "tool_use"]
        text = "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")
        return AiTurn(content=text or None, tool_calls=calls, served_by=served)


class LegacySingleShotClient:
    """包装既有 call_provider(example/cloud/local 单发路径):无工具、无修复环。"""
    supports_tools = False
    supports_repair = False

    def __init__(self, req: Any):
        self._req = req
        self.model_id = os.getenv("PSA_LLM_MODEL", "example")

    def complete(self, messages: list[dict], tools: list[dict] | None = None) -> AiTurn:
        from backend.ai_draft import call_provider
        raw = call_provider(self._req)
        return AiTurn(content=raw if isinstance(raw, str) else json.dumps(raw, ensure_ascii=False),
                      served_by=self.model_id)


def resolve_client(req: Any) -> AiClient:
    from backend import ai_config
    provider = ai_config.provider() or os.getenv("PSA_LLM_PROVIDER", "cloud")
    if provider == "anthropic":
        return AnthropicClient()
    return LegacySingleShotClient(req)


# ── 引擎试运行(草案必须真的可量化)──

def _eta_engine_request(model: dict, fts: dict | None) -> dict:
    """镜像前端 toEngineRequest:DFS 成功优先 L0..,pfd 或 link_ft。"""
    sequences: list[dict] = []
    bins: dict[str, str] = {}
    leaf = [0]

    def walk(node: dict, path: dict[str, str]) -> None:
        if node.get("kind") == "leaf":
            es = f"L{leaf[0]}"; leaf[0] += 1
            sequences.append({"path": dict(path), "end_state": es})
            bins[es] = str(node.get("consequence", "C1"))
            return
        walk(node["success"], {**path, node["feId"]: "success"})
        walk(node["failure"], {**path, node["feId"]: "failure"})

    walk(model["root"], {})
    trees = {f["name"]: f for f in (fts or {}).get("fault_trees", []) if isinstance(f, dict)}
    fes, req_trees, params = [], {}, {}
    for fe in model.get("functionalEvents", []):
        fid = fe["id"]
        link = fe.get("linkFt")
        if link and link in trees and len(trees[link].get("nodes", [])) > 2:
            fes.append({"id": fid, "link_ft": fid})
            req_trees[fid] = trees[link]
        else:
            fes.append({"id": fid, "pfd": float(fe.get("failProb", 0.0))})
    for p in ((fts or {}).get("model_data") or {}).get("parameters", []) or []:
        if isinstance(p, dict) and p.get("id") is not None:
            params[p["id"]] = {"value": p.get("value")}
    return {"init_event": model.get("initEvent", "IE"), "init_frequency": float(model.get("initFreq", 0.0)),
            "functional_events": fes, "fault_trees": req_trees, "parameters": params,
            "sequences": sequences, "consequence_bins": bins}


def dry_run_draft(draft: dict) -> list[str]:
    """把草案喂给真实引擎:每棵独立 FT 量化一次,每个 ETA 走序列定量。返回错误列表。"""
    errors: list[str] = []
    fts = draft.get("fts") if isinstance(draft.get("fts"), dict) else None
    if fts and fts.get("fault_trees"):
        try:
            from psaengine import Analysis
            from psaengine.model.json_io import load_model_from_dict
            m = load_model_from_dict({"model_data": fts.get("model_data", {"parameters": []}),
                                      "fault_trees": fts["fault_trees"], "event_trees": [], "ccf_groups": []})
            for name in list(m.fault_trees):
                Analysis(m, fault_tree=name).probability()
        except Exception as e:
            errors.append(f"独立 FTA 引擎试运行失败: {e}")
    for i, eta in enumerate(draft.get("etas", []) if isinstance(draft.get("etas"), list) else []):
        model = eta.get("model") if isinstance(eta, dict) else None
        if not isinstance(model, dict) or not isinstance(model.get("root"), dict):
            continue
        try:
            from backend.et_builder import build_model_from_request
            from psaengine.eta.sequence import quantify_event_tree
            req = _eta_engine_request(model, eta.get("fts") if isinstance(eta.get("fts"), dict) else None)
            quantify_event_tree(build_model_from_request(req), "TR")
        except Exception as e:
            errors.append(f"etas[{i}] 引擎试运行失败: {e}")
    return errors


# ── 生成 + 修复环 ──

def _draft_system_prompt() -> str:
    from backend.ai_draft import _system_prompt
    return (_system_prompt()
            + "数值应先用 search_reference_library 检索参考库,并把命中条目 id 填入对应元素的"
              " library_ref 字段;检索不到时保留数值但在 warnings 声明 ungrounded。")


def generate_draft(req_payload: dict, client: AiClient) -> tuple[dict | None, dict]:
    """返回 (草案 dict 或 None, 溯源 provenance)。
    支持工具的客户端先走接地循环;支持修复的客户端按校验错误迭代 ≤MAX_REPAIR_ROUNDS。"""
    from backend.ai_draft import _coerce_payload, validate_draft
    from backend.canonical.lint import lint_draft

    tool_trace: list[dict] = []
    served_by = None
    # 截图转录(2026-08-17):带图请求 → 用户消息为内容块列表(图像块在前,文本载荷
    # 剥离 base64——否则 JSON 文本里再嵌一份是 token 炸弹);无图请求逐字节不变(锁)。
    images = req_payload.get("images") or []
    payload_wo_images = {k: v for k, v in req_payload.items() if k != "images"}
    system_prompt = _draft_system_prompt()
    if images:
        system_prompt += (
            "用户附带了事件树/故障树截图(可能来自其它工具):请把截图**转录**为等价模型——"
            "分支结构、屏障/事件名称、概率/频率数值逐一照抄;看不清或被截断的内容一律留空"
            "并写入 warnings,**绝不编造**;照抄的数值仍按参考库检索规则标注,检索不到即 ungrounded。")
    user_content: Any
    if images:
        user_content = [
            *({"type": "image", "source": {"type": "base64",
               "media_type": im["media_type"], "data": im["data"]}} for im in images),
            {"type": "text", "text": json.dumps(payload_wo_images, ensure_ascii=False)},
        ]
    else:
        user_content = json.dumps(req_payload, ensure_ascii=False)
    messages: list[dict] = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_content},
    ]

    def one_turn() -> str | None:
        nonlocal served_by
        tools = TOOLS_SPEC if client.supports_tools else None
        for _ in range(MAX_TOOL_ITERATIONS):
            turn = client.complete(messages, tools)
            served_by = turn.served_by or served_by
            if not turn.tool_calls:
                return turn.content
            results = []
            for call in turn.tool_calls:
                try:
                    out = execute_tool(call["name"], call.get("arguments") or {})
                except Exception as e:
                    out = {"error": str(e)}
                tool_trace.append({"name": call["name"], "arguments": call.get("arguments"), "result_size": len(json.dumps(out, ensure_ascii=False))})
                results.append({"tool_use_id": call.get("id"), "content": out})
            messages.append({"role": "assistant", "content": [
                {"type": "tool_use", "id": c.get("id"), "name": c["name"], "input": c.get("arguments") or {}}
                for c in turn.tool_calls]})
            messages.append({"role": "user", "content": [
                {"type": "tool_result", "tool_use_id": r["tool_use_id"],
                 "content": json.dumps(r["content"], ensure_ascii=False)} for r in results]})
        return None

    repair_trace: list[dict] = []
    draft: dict | None = None
    lib_ids = library_id_set()
    rounds = 0
    for rounds in range(1, MAX_REPAIR_ROUNDS + 1):
        content = one_turn()
        draft, coerce_errors = _coerce_payload(content)
        if draft is None:
            errors = coerce_errors
        else:
            v = validate_draft(draft)
            lint = lint_draft(draft, lib_ids)
            errors = v["errors"] + lint["errors"]
            if not errors:
                errors = dry_run_draft(draft)
        repair_trace.append({"round": rounds, "errors": list(errors)})
        if not errors or not client.supports_repair:
            break
        messages.append({"role": "assistant", "content": content or ""})
        messages.append({"role": "user", "content":
                         "上述草案未通过确定性校验,请修复以下错误并返回完整修正 JSON(只返回 JSON):\n"
                         + json.dumps(errors, ensure_ascii=False)})

    provenance = {
        "model_id": client.model_id,
        "served_by": served_by or client.model_id,
        "prompt_version": PROMPT_VERSION,
        "rounds": rounds,
        "tool_trace": tool_trace,
        "repair_trace": repair_trace,
    }
    return draft, provenance
