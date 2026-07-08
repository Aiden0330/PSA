from __future__ import annotations
import json, os

_EX_DIR = os.path.join(os.path.dirname(__file__), "..", "examples")

_REGISTRY = {
    "bms_ft": {"name": "BESS BMS 保护失效故障树", "file": "bess_bms_ft.json", "fault_tree": "BMS"},
    "tiny_and": {"name": "Tiny AND (示例)", "file": "tiny_and.json", "fault_tree": "TOP"},
}

def list_examples() -> list[dict]:
    return [{"id": k, "name": v["name"]} for k, v in _REGISTRY.items()]

def get_model(eid: str) -> dict:
    if eid not in _REGISTRY:
        raise KeyError(eid)
    spec = _REGISTRY[eid]
    with open(os.path.join(_EX_DIR, spec["file"]), encoding="utf-8") as f:
        model = json.load(f)
    return {"model": model, "fault_tree": spec["fault_tree"]}
