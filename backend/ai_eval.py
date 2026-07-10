"""ADR-3 金例评测门(4b4):确定性 rubric + Batch API 运行器。

- rubric 检查是纯函数(check_case):对 AiDraftResponse 断言结构/可量化性/接地/溯源。
- 本地模式:run_cases(client) 经 create_draft 全管线(lint+试运行)后过 rubric。
- Batch 模式(网络,50% 折扣,夜跑/升级门):
    python -m backend.ai_eval submit   # 构建请求并提交 message batch
    python -m backend.ai_eval status <batch_id>
    python -m backend.ai_eval fetch  <batch_id>   # 取回结果 → rubric → 通过/失败
  模型/提示词版本升级必须全过金例(docs/design/ai-model-strategy.md 升级门)。
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

from backend.ai_pipeline import DRAFT_MODEL, PROMPT_VERSION

GOLDEN_PATH = Path(__file__).resolve().parents[1] / "tests" / "ai_eval" / "golden_cases.json"


def load_cases() -> list[dict]:
    return json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))["cases"]


# ── rubric(全部确定性;失败信息可读)──

def _all_params(resp: dict) -> list[dict]:
    out = []
    for eta in resp.get("etas", []) or []:
        out.extend(((eta.get("fts") or {}).get("model_data") or {}).get("parameters", []) or [])
    out.extend(((resp.get("fts") or {}).get("model_data") or {}).get("parameters", []) or [])
    return [p for p in out if isinstance(p, dict)]


def _all_fes(resp: dict) -> list[dict]:
    out = []
    for eta in resp.get("etas", []) or []:
        m = eta.get("model") if isinstance(eta, dict) else None
        out.extend((m or {}).get("functionalEvents", []) or [])
    return [f for f in out if isinstance(f, dict)]


def check_case(case: dict, resp: dict) -> dict:
    r = case.get("rubric", {})
    fails: list[str] = []

    def need(cond: bool, msg: str) -> None:
        if not cond:
            fails.append(msg)

    if r.get("kind") == "eta":
        need(len(resp.get("etas", []) or []) >= 1, "未返回 ETA")
    if r.get("kind") == "fta":
        trees = (resp.get("fts") or {}).get("fault_trees", []) or []
        need(len(trees) >= int(r.get("min_trees", 1)), f"故障树数 < {r.get('min_trees', 1)}")
    if "min_barriers" in r:
        fes = _all_fes(resp)
        need(len(fes) >= int(r["min_barriers"]), f"屏障数 {len(fes)} < {r['min_barriers']}")
    if r.get("quantifiable"):
        v = resp.get("validation") or {}
        need(bool(v.get("ok")), f"校验未通过: {(v.get('errors') or [])[:3]}")
    if r.get("consequences_valid"):
        v = resp.get("validation") or {}
        need(not any("后果" in e for e in v.get("errors", [])), "后果等级不合法")
    if r.get("provenance_marks"):
        marked = [p for p in _all_params(resp) if "AI 草案" in str(p.get("source", ""))]
        need(not _all_params(resp) or len(marked) >= max(1, len(_all_params(resp)) // 2),
             "参数缺少「AI 草案,待人工审核」标注")
    if r.get("params_in_range"):
        bad = [p.get("id") for p in _all_params(resp)
               if not isinstance(p.get("value"), (int, float)) or not 0 <= float(p["value"]) <= 1]
        need(not bad, f"参数越界: {bad}")
    if r.get("requires_atleast_gate"):
        trees = (resp.get("fts") or {}).get("fault_trees", []) or []
        has = any(n.get("op") == "atleast" for t in trees for n in (t.get("nodes") or []) if isinstance(n, dict))
        need(has, "缺少表决门(atleast)结构")
    if r.get("grounded_or_declared"):
        params = _all_params(resp)
        grounded = any(p.get("library_ref") for p in params)
        declared = any("ungrounded" in str(w) or "未引用参考库" in str(w)
                       for w in (resp.get("warnings") or []) + ((resp.get("validation") or {}).get("warnings") or []))
        need(grounded or declared, "数值既未引用参考库也未声明 ungrounded")
    if r.get("label_keywords_any"):
        hay = " ".join(str(f.get("label", "")) + str(f.get("id", "")) for f in _all_fes(resp)).lower()
        need(any(k.lower() in hay for k in r["label_keywords_any"]),
             f"屏障未覆盖关键词 {r['label_keywords_any']}")
    if r.get("asks_questions"):
        need(len(resp.get("questions", []) or []) >= 1, "目标含糊时应提出问题而非直接编造")
    return {"id": case["id"], "passed": not fails, "failures": fails}


def run_cases(client: Any, cases: list[dict] | None = None) -> dict:
    """经 create_draft 全管线(lint+引擎试运行)后过 rubric。返回汇总。"""
    from backend.ai_draft import create_draft
    results = []
    for case in cases or load_cases():
        resp = create_draft(case["request"], client=client)
        results.append(check_case(case, resp))
    return {"prompt_version": PROMPT_VERSION, "model": getattr(client, "model_id", "?"),
            "passed": all(r["passed"] for r in results), "results": results}


# ── Batch API 运行器(网络;夜跑与升级门)──

def build_batch_requests(cases: list[dict] | None = None) -> list[dict]:
    """构建 message-batch 请求体(每金例一条,custom_id=金例 id)。"""
    from backend.ai_pipeline import TOOLS_SPEC, _draft_system_prompt
    out = []
    for case in cases or load_cases():
        out.append({
            "custom_id": f"{case['id']}::{PROMPT_VERSION}",
            "params": {
                "model": DRAFT_MODEL,
                "max_tokens": 8192,
                "system": _draft_system_prompt(),
                "tools": TOOLS_SPEC,
                "messages": [{"role": "user", "content": json.dumps(case["request"], ensure_ascii=False)}],
            },
        })
    return out


def _api_headers() -> dict:
    key = os.getenv("ANTHROPIC_API_KEY") or os.getenv("PSA_LLM_API_KEY", "")
    return {"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"}


def _cli() -> int:                                    # pragma: no cover - 网络路径
    import httpx
    base = os.getenv("PSA_ANTHROPIC_BASE_URL", "https://api.anthropic.com").rstrip("/")
    cmd = sys.argv[1] if len(sys.argv) > 1 else "submit"
    if cmd == "submit":
        body = {"requests": build_batch_requests()}
        r = httpx.post(f"{base}/v1/messages/batches", headers=_api_headers(), json=body, timeout=60)
        r.raise_for_status()
        print(json.dumps({"batch_id": r.json().get("id")}, ensure_ascii=False))
        return 0
    if cmd == "status":
        r = httpx.get(f"{base}/v1/messages/batches/{sys.argv[2]}", headers=_api_headers(), timeout=60)
        r.raise_for_status()
        print(json.dumps(r.json(), ensure_ascii=False, indent=2))
        return 0
    if cmd == "fetch":
        r = httpx.get(f"{base}/v1/messages/batches/{sys.argv[2]}/results", headers=_api_headers(), timeout=120)
        r.raise_for_status()
        cases = {c["id"]: c for c in load_cases()}
        results = []
        for line in r.text.splitlines():
            row = json.loads(line)
            cid = row["custom_id"].split("::")[0]
            text = "".join(b.get("text", "") for b in row["result"]["message"]["content"]
                           if b.get("type") == "text")
            from backend.ai_draft import _coerce_payload, validate_draft
            draft, errs = _coerce_payload(text)
            resp = draft or {}
            resp["validation"] = validate_draft(resp) if draft else {"ok": False, "errors": errs, "warnings": []}
            results.append(check_case(cases[cid], resp))
        passed = all(x["passed"] for x in results)
        print(json.dumps({"passed": passed, "results": results}, ensure_ascii=False, indent=2))
        return 0 if passed else 1
    print("usage: python -m backend.ai_eval submit|status <id>|fetch <id>")
    return 2


if __name__ == "__main__":                            # pragma: no cover
    raise SystemExit(_cli())
