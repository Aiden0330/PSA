from __future__ import annotations
from dataclasses import dataclass
from math import prod
from psaengine.bdd.kernel import BddManager

@dataclass
class CutSet:
    events: list[str]
    order: int
    probability: float = 0.0

def _paths_to_one(m: BddManager, root: int) -> list[set[str]]:
    """枚举 BDD 中使函数为真的正文字路径(相干树: 只取置 1 的变量)。"""
    out: list[set[str]] = []
    def rec(h: int, chosen: set[str]):
        if h == m.ZERO:
            return
        if h == m.ONE:
            out.append(set(chosen)); return
        v, hi, lo = m._nodes[h]
        name = m.var_order[v]
        rec(hi, chosen | {name})     # 该变量取 1 → 入割集
        rec(lo, chosen)              # 该变量取 0 → 不入割集
    rec(root, set())
    return out

def minimal_cutsets(m: BddManager, root: int, q: dict[str, float] | None = None,
                    cutoff: float = 0.0, limit_order: int | None = None) -> list[CutSet]:
    from psaengine.bdd.zbdd import ZbddManager
    raw = _paths_to_one(m, root)                 # BDD 路径 → 候选割集(含非最小)
    z = ZbddManager(m.var_order)                 # 用 ZBDD 做因子化最小化(吸收律)
    minimal = z.to_sets(z.minimize(z.set_of(raw)))
    cuts: list[CutSet] = []
    for s in minimal:
        order = len(s)
        if limit_order is not None and order > limit_order:
            continue
        p = prod(q[e] for e in s) if q else 0.0
        if q and p < cutoff:
            continue
        cuts.append(CutSet(sorted(s), order, p))
    cuts.sort(key=lambda c: (-c.probability, c.order, c.events))
    return cuts
