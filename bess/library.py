from __future__ import annotations
import json, os

_DATA = os.path.join(os.path.dirname(__file__), "reference_data.json")


def load_library(path: str = _DATA) -> dict:
    """加载带来源引用的预置参考库(器件失效率 / 屏障有效性 / 初因频率)。"""
    with open(path, encoding="utf-8") as f:
        return json.load(f)
