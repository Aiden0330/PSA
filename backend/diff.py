"""4a5 模型版本 diff(parity #5,仿 RiskSpectrum Model Compare)。

对两份 canonical ProjectDocument JSON 做结构化对比:
- 列表按身份键对齐(uuid > ref > id > name > key),而非按下标 —— 插入/删除不会
  把后续条目全部误报为"改动";
- 易变字段(created_at/modified_at)不参与对比(与 content_hash 的剥离口径一致);
- 输出扁平变更单 [{op: added|removed|changed, path, from?, to?}],路径为
  JSON-pointer 风格、列表段用身份键(如 /event_trees/eta-1/functional_events/FE2/pfd)。
"""
from __future__ import annotations
from typing import Any

_VOLATILE = {"created_at", "modified_at"}
# 人读键优先(ref/id):路径可读是评审用途的核心;uuid 兜底保证对齐仍然成立
_ID_KEYS = ("ref", "id", "key", "name", "uuid")


def _identity(item: Any) -> str | None:
    if isinstance(item, dict):
        for k in _ID_KEYS:
            v = item.get(k)
            if isinstance(v, str) and v:
                return v
    return None


def _keyed(items: list) -> dict[str, Any] | None:
    """全员可识别且键唯一时返回 {key: item},否则 None(退回值对比)。"""
    out: dict[str, Any] = {}
    for it in items:
        k = _identity(it)
        if k is None or k in out:
            return None
        out[k] = it
    return out


def diff_json(a: Any, b: Any, path: str = "") -> list[dict]:
    if a == b:
        return []
    if isinstance(a, dict) and isinstance(b, dict):
        changes: list[dict] = []
        for k in sorted(set(a) | set(b)):
            if k in _VOLATILE:
                continue
            p = f"{path}/{k}"
            if k not in a:
                changes.append({"op": "added", "path": p, "to": b[k]})
            elif k not in b:
                changes.append({"op": "removed", "path": p, "from": a[k]})
            else:
                changes.extend(diff_json(a[k], b[k], p))
        return changes
    if isinstance(a, list) and isinstance(b, list):
        ka, kb = _keyed(a), _keyed(b)
        if ka is not None and kb is not None:
            changes = []
            for k in sorted(set(ka) | set(kb)):
                p = f"{path}/{k}"
                if k not in ka:
                    changes.append({"op": "added", "path": p, "to": kb[k]})
                elif k not in kb:
                    changes.append({"op": "removed", "path": p, "from": ka[k]})
                else:
                    changes.extend(diff_json(ka[k], kb[k], p))
            return changes
        return [{"op": "changed", "path": path, "from": a, "to": b}]
    return [{"op": "changed", "path": path, "from": a, "to": b}]


def diff_documents(doc_a: dict, doc_b: dict) -> dict:
    """结构化 diff + 汇总。输入为 canonical ProjectDocument 的 dict 形。"""
    changes = diff_json(doc_a, doc_b)
    summary = {"added": 0, "removed": 0, "changed": 0}
    for c in changes:
        summary[c["op"]] += 1
    return {"changes": changes, "summary": summary}
