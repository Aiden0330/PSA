from __future__ import annotations
from psaengine.bdd.kernel import BddManager
from psaengine.quantify.cutsets import minimal_cutsets
from psaengine.quantify.probability import mcub

def truncation_study(m: BddManager, root: int, q: dict[str, float],
                     cutoffs: list[float]) -> list[dict]:
    """对一组(降序)截断限算截断概率与相邻差 ΔP_k(Jung 收敛监控)。"""
    rows = []
    prev = 0.0
    for c in sorted(cutoffs, reverse=True):
        cs = minimal_cutsets(m, root, q=q, cutoff=c)
        p = mcub([x.probability for x in cs])
        rows.append({"cutoff": c, "n_cutsets": len(cs), "probability": p,
                     "delta": abs(p - prev)})
        prev = p
    return rows
