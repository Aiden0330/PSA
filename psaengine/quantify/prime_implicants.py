from __future__ import annotations
from psaengine.bdd.kernel import BddManager

def prime_implicants(m: BddManager, root: int) -> list[dict[str, bool]]:
    """Coudert-Madre/Morreale 递归素蕴涵:
       PI(f) = PI(f0·f1) ∪ {x·c : c∈PI(f1)\\Pc} ∪ {¬x·c : c∈PI(f0)\\Pc}。
       返回 [{var: True/False}], True=正文字, False=负文字。"""
    memo: dict[int, list[frozenset]] = {}
    def pi(h: int) -> list[frozenset]:
        if h == m.ZERO: return []
        if h == m.ONE: return [frozenset()]
        if h in memo: return memo[h]
        v, hi, lo = m._nodes[h]; name = m.var_order[v]
        cons = m.apply_and(hi, lo)               # f0 ∧ f1: 不依赖 x 的部分
        Pc = pi(cons); Pc_set = set(Pc)
        result = list(Pc)
        for c in pi(hi):
            if c not in Pc_set: result.append(c | {(name, True)})
        for c in pi(lo):
            if c not in Pc_set: result.append(c | {(name, False)})
        memo[h] = result; return result
    return [dict(s) for s in pi(root)]
