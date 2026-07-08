from __future__ import annotations
from itertools import combinations
from psaengine.model.pdag import PDAG, Op

def mocus_cutsets(g: PDAG, root: str, limit_order: int | None = None) -> list[set[str]]:
    """自顶向下 MOCUS: OR 增行, AND 扩列; 展开至全为基本事件后吸收最小化。"""
    rows: list[set[str]] = [{root}]
    changed = True
    while changed:
        changed = False
        new_rows: list[set[str]] = []
        for row in rows:
            gate = next((x for x in row if _expandable(g, x)), None)
            if gate is None:
                new_rows.append(row); continue
            changed = True
            rest = row - {gate}
            for expansion in _expand(g, gate):
                nr = rest | expansion
                if limit_order is None or len(nr) <= limit_order:
                    new_rows.append(nr)
        rows = new_rows
    uniq = {frozenset(r) for r in rows}
    minimal: list[frozenset] = []
    for s in sorted(uniq, key=len):
        if not any(m <= s for m in minimal):
            minimal.append(s)
    return [set(s) for s in minimal]

def _expandable(g: PDAG, x: str) -> bool:
    n = g.nodes[x]
    if n.is_basic or n.is_house: return False
    if n.op is Op.NULL: return n.state is None       # 透传 NULL 可展开
    return True

def _expand(g: PDAG, gate: str) -> list[set[str]]:
    """OR → 多个单元素方案;AND → 一个合并方案;ATLEAST → 各 k 组合。"""
    n = g.nodes[gate]
    if n.op is Op.NULL:
        return [{n.args[0]}]
    if n.op is Op.OR:
        return [{a} for a in n.args]
    if n.op is Op.AND:
        return [set(n.args)]
    if n.op is Op.ATLEAST:
        return [set(c) for c in combinations(n.args, n.k)]
    raise ValueError(f"MOCUS 不支持(非相干请用 prime_implicants): {n.op}")
