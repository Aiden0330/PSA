"""C1–C5 后果分级与标签(来自 bess-tr-event-tree 技能 tr_model.json)。"""
from __future__ import annotations
import json, os

_DATA = os.path.join(os.path.dirname(__file__), "tr_model_data.json")
ESCALATION_ORDER = ["C1", "C2", "C3", "C4", "C5"]

def consequence_labels(path: str = _DATA) -> dict:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    return {c["code"]: c["label"] for c in data["consequences"]}

CONSEQUENCE_LABELS = consequence_labels()
