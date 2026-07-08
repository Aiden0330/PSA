from __future__ import annotations

import json
import math
import os
import uuid
from pathlib import Path
from typing import Any

from backend import schemas


class ProviderError(RuntimeError):
    pass


EMPTY_FTS = {"model_data": {"parameters": []}, "fault_trees": []}
EXAMPLE_DRAFT_PATH = Path(__file__).resolve().parents[1] / "examples" / "ai_eta_coolant_leak_response.json"


def is_enabled() -> bool:
    return os.getenv("PSA_AI_ENABLED") == "1"


def _request_payload(req: schemas.AiDraftRequest | dict[str, Any]) -> dict[str, Any]:
    return req.model_dump() if hasattr(req, "model_dump") else dict(req)


def _system_prompt() -> str:
    return (
        "你是 PSA/QRA 建模助手。只返回 JSON,不要 Markdown。"
        "生成 ETA/FTA 草案,不得编造数值来源;缺少数据时写入 warnings/questions。"
        "ETA 使用前端 EventTreeModel: initEvent, initFreq, functionalEvents, root。"
        "FTA 使用 ModelJson: model_data.parameters, fault_trees。"
        "所有 AI 生成的节点 source/evidence 必须标注 'AI 草案,待人工审核'。"
    )


def _example_fta_draft(req: dict[str, Any]) -> dict[str, Any]:
    user_context = req.get("user_context") if isinstance(req.get("user_context"), dict) else {}
    target_fe_id = str(user_context.get("target_fe_id") or "B_AI_BARRIER")
    target_fe_label = str(user_context.get("target_fe_label") or target_fe_id)
    return {
        "draft_id": "ai-example-bms-isolation-fta",
        "summary": f"为屏障「{target_fe_label}」生成 BMS 隔离拒动 FTA 草案。",
        "assumptions": [
            "示例 FTA 结构复用内置 bms_ft 示例的传感、逻辑和接触器拒动模式。",
            "所有基本事件概率均为演示量级,应用后仍需人工用项目数据替换。",
            "FTA 顶事件表示该屏障按需动作失败,可挂载为 ETA 屏障 PFD。",
        ],
        "questions": [
            "请补充 BMS 通道冗余架构、接触器配置和现场失效率/拒动率数据。",
        ],
        "etas": [],
        "fts": {
            "model_data": {
                "parameters": [
                    {"id": "V_SENSOR_FAIL", "kind": "probability", "value": 0.02, "source": "AI 草案,待人工审核; 内置 bms_ft 示例"},
                    {"id": "T_SENSOR_FAIL", "kind": "probability", "value": 0.02, "source": "AI 草案,待人工审核; 内置 bms_ft 示例"},
                    {"id": "I_SENSOR_FAIL", "kind": "probability", "value": 0.02, "source": "AI 草案,待人工审核; 内置 bms_ft 示例"},
                    {"id": "MAIN_CONTACTOR_FAIL", "kind": "probability", "value": 0.05, "source": "AI 草案,待人工审核; 内置 bms_ft 示例"},
                    {"id": "BACKUP_CONTACTOR_FAIL", "kind": "probability", "value": 0.05, "source": "AI 草案,待人工审核; 内置 bms_ft 示例"},
                    {"id": "BMS_LOGIC_FAIL", "kind": "probability", "value": 0.01, "source": "AI 草案,待人工审核; 内置 bms_ft 示例"},
                ]
            },
            "fault_trees": [
                {
                    "name": target_fe_id,
                    "top": f"{target_fe_id}_TOP",
                    "nodes": [
                        {"id": "V_SENSOR_FAIL", "basic": True, "param_ref": "V_SENSOR_FAIL"},
                        {"id": "T_SENSOR_FAIL", "basic": True, "param_ref": "T_SENSOR_FAIL"},
                        {"id": "I_SENSOR_FAIL", "basic": True, "param_ref": "I_SENSOR_FAIL"},
                        {"id": "MAIN_CONTACTOR_FAIL", "basic": True, "param_ref": "MAIN_CONTACTOR_FAIL"},
                        {"id": "BACKUP_CONTACTOR_FAIL", "basic": True, "param_ref": "BACKUP_CONTACTOR_FAIL"},
                        {"id": "BMS_LOGIC_FAIL", "basic": True, "param_ref": "BMS_LOGIC_FAIL"},
                        {"id": "SENSOR_2OO3_FAIL", "op": "atleast", "k": 2, "args": ["V_SENSOR_FAIL", "T_SENSOR_FAIL", "I_SENSOR_FAIL"]},
                        {"id": "CONTACTOR_PATH_FAIL", "op": "and", "args": ["MAIN_CONTACTOR_FAIL", "BACKUP_CONTACTOR_FAIL"]},
                        {"id": f"{target_fe_id}_TOP", "op": "or", "args": ["SENSOR_2OO3_FAIL", "CONTACTOR_PATH_FAIL", "BMS_LOGIC_FAIL"]},
                    ],
                }
            ],
        },
        "traceability": [
            {"item": target_fe_id, "source": "内置 bms_ft 示例模型; AI 草案,待人工审核"},
            {"item": "SENSOR_2OO3_FAIL", "source": "2oo3 传感通道拒动结构示例"},
            {"item": "CONTACTOR_PATH_FAIL", "source": "主/备接触器共同拒动结构示例"},
        ],
        "warnings": [
            "该 FTA 为可量化起步草案,不代表最终工程结论。",
            "演示参数需要用项目实测、厂商或参考库数据替换。",
        ],
    }


def call_provider(req: schemas.AiDraftRequest | dict[str, Any]) -> Any:
    provider = os.getenv("PSA_LLM_PROVIDER", "cloud")
    if provider == "example":
        payload = _request_payload(req)
        if payload.get("target") == "fta":
            return _example_fta_draft(payload)
        try:
            return json.loads(EXAMPLE_DRAFT_PATH.read_text(encoding="utf-8"))
        except Exception as e:  # pragma: no cover - repository fixture should exist
            raise ProviderError(f"example AI draft fixture is unavailable: {e}") from e
    if provider not in {"cloud", "local"}:
        raise ProviderError("PSA_LLM_PROVIDER must be cloud, local, or example")
    base_url = os.getenv("PSA_LLM_BASE_URL", "").rstrip("/")
    model = os.getenv("PSA_LLM_MODEL", "")
    api_key = os.getenv("PSA_LLM_API_KEY")
    if not base_url or not model:
        raise ProviderError("PSA_LLM_BASE_URL and PSA_LLM_MODEL are required when AI is enabled")

    import httpx

    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    payload = {
        "model": model,
        "temperature": 0.2,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": _system_prompt()},
            {"role": "user", "content": json.dumps(_request_payload(req), ensure_ascii=False)},
        ],
    }
    try:
        r = httpx.post(f"{base_url}/chat/completions", headers=headers, json=payload, timeout=60)
        r.raise_for_status()
        data = r.json()
        return data["choices"][0]["message"]["content"]
    except Exception as e:  # pragma: no cover - provider/network dependent
        raise ProviderError(f"LLM provider call failed: {e}") from e


def _is_num(x: Any) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(float(x))


def _empty_response(errors: list[str], raw: Any = None) -> dict[str, Any]:
    warnings = []
    if raw is not None:
        warnings.append("保留 provider 原始返回供排查,未应用到项目。")
    return {
        "draft_id": "",
        "summary": "AI 草案无法解析",
        "assumptions": [],
        "questions": [],
        "etas": [],
        "fts": EMPTY_FTS,
        "traceability": [],
        "warnings": warnings,
        "validation": {"ok": False, "errors": errors, "warnings": warnings},
    }


def _coerce_payload(raw: Any) -> tuple[dict[str, Any] | None, list[str]]:
    if isinstance(raw, dict):
        return raw, []
    if isinstance(raw, str):
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as e:
            return None, [f"LLM returned invalid JSON: {e.msg}"]
        return (data, []) if isinstance(data, dict) else (None, ["LLM JSON root must be an object"])
    return None, [f"LLM provider returned unsupported payload type: {type(raw).__name__}"]


def _validate_eta_model(model: Any, where: str, errors: list[str], warnings: list[str]) -> None:
    if not isinstance(model, dict):
        errors.append(f"{where}: model must be object")
        return
    if not isinstance(model.get("initEvent"), str) or not model.get("initEvent", "").strip():
        errors.append(f"{where}: initEvent is required")
    if not _is_num(model.get("initFreq")) or float(model.get("initFreq", -1)) < 0:
        errors.append(f"{where}: initFreq must be finite and >= 0")

    fes = model.get("functionalEvents")
    if not isinstance(fes, list):
        errors.append(f"{where}: functionalEvents must be array")
        fes = []
    ids: list[str] = []
    for i, fe in enumerate(fes):
        if not isinstance(fe, dict):
            errors.append(f"{where}.functionalEvents[{i}]: must be object")
            continue
        fe_id = fe.get("id")
        if not isinstance(fe_id, str) or not fe_id:
            errors.append(f"{where}.functionalEvents[{i}]: id is required")
            continue
        if fe_id in ids:
            errors.append(f"{where}: duplicate functional event id {fe_id}")
        ids.append(fe_id)
        pfd = fe.get("failProb")
        if not _is_num(pfd) or not 0 <= float(pfd) <= 1:
            errors.append(f"{where}.{fe_id}: failProb must be in [0,1]")
        src = str(fe.get("source") or fe.get("evidence") or "")
        if "AI 草案" not in src:
            warnings.append(f"{where}.{fe_id}: source/evidence should mark AI 草案,待人工审核")

    id_to_idx = {fe_id: i for i, fe_id in enumerate(ids)}

    def walk(node: Any, min_idx: int, path: str) -> None:
        if not isinstance(node, dict):
            errors.append(f"{where}.{path}: node must be object")
            return
        kind = node.get("kind")
        if kind == "leaf":
            if not isinstance(node.get("consequence"), str) or not node.get("consequence"):
                errors.append(f"{where}.{path}: leaf consequence is required")
            return
        if kind != "branch":
            errors.append(f"{where}.{path}: node kind must be branch or leaf")
            return
        fe_id = node.get("feId")
        if fe_id not in id_to_idx:
            errors.append(f"{where}.{path}: branch references unknown feId {fe_id}")
            return
        idx = id_to_idx[fe_id]
        if idx <= min_idx:
            errors.append(f"{where}.{path}: branch feId order must be strictly increasing")
        walk(node.get("success"), idx, f"{path}.success")
        walk(node.get("failure"), idx, f"{path}.failure")

    walk(model.get("root"), -1, "root")


def _validate_fts(fts: Any, where: str, errors: list[str]) -> None:
    if fts in (None, {}):
        return
    if not isinstance(fts, dict):
        errors.append(f"{where}: fts must be object")
        return
    model_data = fts.get("model_data") if isinstance(fts.get("model_data"), dict) else {}
    params = model_data.get("parameters", [])
    if not isinstance(params, list):
        errors.append(f"{where}: model_data.parameters must be array")
        params = []
    param_ids: set[str] = set()
    for i, p in enumerate(params):
        if not isinstance(p, dict):
            errors.append(f"{where}.parameters[{i}]: must be object")
            continue
        pid = p.get("id")
        if not isinstance(pid, str) or not pid:
            errors.append(f"{where}.parameters[{i}]: id is required")
            continue
        if pid in param_ids:
            errors.append(f"{where}: duplicate parameter id {pid}")
        param_ids.add(pid)
        value = p.get("value")
        if not _is_num(value) or not 0 <= float(value) <= 1:
            errors.append(f"{where}.{pid}: parameter value must be in [0,1]")

    trees = fts.get("fault_trees", [])
    if not isinstance(trees, list):
        errors.append(f"{where}: fault_trees must be array")
        return
    names: set[str] = set()
    for ti, ft in enumerate(trees):
        if not isinstance(ft, dict):
            errors.append(f"{where}.fault_trees[{ti}]: must be object")
            continue
        name = ft.get("name")
        if not isinstance(name, str) or not name:
            errors.append(f"{where}.fault_trees[{ti}]: name is required")
        elif name in names:
            errors.append(f"{where}: duplicate fault tree name {name}")
        names.add(str(name))
        nodes = ft.get("nodes", [])
        if not isinstance(nodes, list):
            errors.append(f"{where}.{name}: nodes must be array")
            continue
        node_ids: set[str] = set()
        for ni, node in enumerate(nodes):
            if not isinstance(node, dict):
                errors.append(f"{where}.{name}.nodes[{ni}]: must be object")
                continue
            nid = node.get("id")
            if not isinstance(nid, str) or not nid:
                errors.append(f"{where}.{name}.nodes[{ni}]: id is required")
                continue
            if nid in node_ids:
                errors.append(f"{where}.{name}: duplicate node id {nid}")
            node_ids.add(nid)
        top = ft.get("top")
        if top not in node_ids:
            errors.append(f"{where}.{name}: top must reference an existing node")
        for node in nodes:
            if not isinstance(node, dict):
                continue
            nid = node.get("id")
            if node.get("basic"):
                pref = node.get("param_ref")
                if pref not in param_ids:
                    errors.append(f"{where}.{name}.{nid}: basic param_ref must reference a parameter")
                continue
            op = node.get("op")
            if op not in {"or", "and", "atleast"}:
                errors.append(f"{where}.{name}.{nid}: op must be or, and, or atleast")
                continue
            args = node.get("args", [])
            if not isinstance(args, list) or not args:
                errors.append(f"{where}.{name}.{nid}: gate args must be a non-empty array")
                continue
            for arg in args:
                if arg not in node_ids:
                    errors.append(f"{where}.{name}.{nid}: arg {arg} must reference an existing node")
            if op == "atleast":
                k = node.get("k")
                if not isinstance(k, int) or k < 1 or k > len(args):
                    errors.append(f"{where}.{name}.{nid}: atleast k must be between 1 and args length")


def validate_draft(draft: dict[str, Any]) -> dict[str, Any]:
    errors: list[str] = []
    warnings: list[str] = []
    etas = draft.get("etas", [])
    if not isinstance(etas, list):
        errors.append("etas must be an array")
        etas = []
    for i, eta in enumerate(etas):
        if not isinstance(eta, dict):
            errors.append(f"etas[{i}]: must be object")
            continue
        _validate_eta_model(eta.get("model"), f"etas[{i}].model", errors, warnings)
        _validate_fts(eta.get("fts"), f"etas[{i}].fts", errors)
    _validate_fts(draft.get("fts"), "fts", errors)
    return {"ok": not errors, "errors": errors, "warnings": warnings}


def create_draft(req: schemas.AiDraftRequest) -> dict[str, Any]:
    raw = call_provider(req)
    draft, errors = _coerce_payload(raw)
    if errors or draft is None:
        return _empty_response(errors, raw)

    response = {
        "draft_id": str(draft.get("draft_id") or f"ai-{uuid.uuid4().hex[:8]}"),
        "summary": str(draft.get("summary") or ""),
        "assumptions": [str(x) for x in draft.get("assumptions", []) if isinstance(x, (str, int, float))],
        "questions": [str(x) for x in draft.get("questions", []) if isinstance(x, (str, int, float))],
        "etas": draft.get("etas") if isinstance(draft.get("etas"), list) else [],
        "fts": draft.get("fts") if isinstance(draft.get("fts"), dict) else EMPTY_FTS,
        "traceability": draft.get("traceability") if isinstance(draft.get("traceability"), list) else [],
        "warnings": [str(x) for x in draft.get("warnings", []) if isinstance(x, (str, int, float))],
    }
    validation = validate_draft(response)
    response["validation"] = validation
    if validation["warnings"]:
        response["warnings"] = response["warnings"] + validation["warnings"]
    return response
