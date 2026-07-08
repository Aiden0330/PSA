import pytest
from psaengine.model.pdag import PDAG, Op
from psaengine.ordering.heuristics import dflm
from psaengine.bdd.kernel import BddManager, build_from_pdag
from psaengine.quantify.truncation import truncation_study

def test_truncation_converges():
    # OR(A,B,C) q 递减, 越小割集贡献越小
    g = PDAG()
    for b in "ABC": g.basic(b)
    g.gate("TOP", Op.OR, ["A","B","C"]); g.top="TOP"
    q = {"A":0.1, "B":1e-3, "C":1e-6}
    m = BddManager(dflm(g)); root = build_from_pdag(m, g, "TOP")
    rows = truncation_study(m, root, q, cutoffs=[1e-2, 1e-4, 1e-7])
    # cutoff 越小, 截断概率单调不减, 趋于收敛
    probs = [r["probability"] for r in rows]
    assert probs[0] <= probs[1] <= probs[2]
    assert rows[-1]["delta"] < rows[0]["delta"]      # 误差缩小
