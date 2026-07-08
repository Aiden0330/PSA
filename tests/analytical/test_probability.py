import pytest
from psaengine.model.pdag import PDAG, Op
from psaengine.ordering.heuristics import dflm
from psaengine.bdd.kernel import BddManager, build_from_pdag
from psaengine.quantify.probability import exact_probability, rea, mcub

def _probs_and():
    g = PDAG(); g.basic("A"); g.basic("B"); g.gate("TOP", Op.AND, ["A","B"]); g.top="TOP"
    return g, {"A":0.1, "B":0.2}

def test_exact_and():
    g, q = _probs_and()
    m = BddManager(dflm(g)); root = build_from_pdag(m, g, "TOP")
    assert exact_probability(m, root, q) == pytest.approx(0.1*0.2)

def test_exact_or():
    g = PDAG(); g.basic("A"); g.basic("B"); g.gate("TOP", Op.OR, ["A","B"]); g.top="TOP"
    q = {"A":0.1, "B":0.2}
    m = BddManager(dflm(g)); root = build_from_pdag(m, g, "TOP")
    assert exact_probability(m, root, q) == pytest.approx(1 - 0.9*0.8)

def test_2oo3_exact_vs_mcub_vs_rea_gap():
    # 非稀有屏障概率 q=0.3, 2-out-of-3, MCS={AB,AC,BC}
    g = PDAG()
    for b in "ABC": g.basic(b)
    g.gate("TOP", Op.ATLEAST, ["A","B","C"], k=2); g.top="TOP"
    q = {"A":0.3, "B":0.3, "C":0.3}
    m = BddManager(dflm(g)); root = build_from_pdag(m, g, "TOP")
    exact = exact_probability(m, root, q)
    # 解析精确: P(>=2 of 3, p=0.3) = 3·0.3²·0.7 + 0.3³ = 0.189 + 0.027 = 0.216
    assert exact == pytest.approx(0.216)
    mc = mcub([0.09, 0.09, 0.09])     # 三个二阶割集概率
    re = rea([0.09, 0.09, 0.09])
    assert exact < mc < re             # SOTA: 精确 < MCUB < REA
    assert re == pytest.approx(0.27)

def test_invariant_exact_le_mcub_le_rea():
    cs = [0.05, 0.04, 0.03]
    assert rea(cs) >= mcub(cs)
