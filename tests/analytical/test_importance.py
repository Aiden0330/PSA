import pytest
from psaengine.model.pdag import PDAG, Op
from psaengine.ordering.heuristics import dflm
from psaengine.bdd.kernel import BddManager, build_from_pdag
from psaengine.importance.measures import importance

def _or_model():
    g = PDAG(); g.basic("A"); g.basic("B"); g.gate("TOP", Op.OR, ["A","B"]); g.top="TOP"
    q = {"A":0.1, "B":0.2}
    m = BddManager(dflm(g)); root = build_from_pdag(m, g, "TOP")
    return m, root, q

def test_birnbaum_or_gate():
    m, root, q = _or_model()
    imp = importance(m, root, q, measures=["birnbaum"])
    # Birnbaum_A = h(1_A) - h(0_A) = 1 - (q_B) = 1 - 0.2 = 0.8
    assert imp["A"]["birnbaum"] == pytest.approx(0.8)

def test_fv_and_raw():
    m, root, q = _or_model()
    imp = importance(m, root, q, measures=["fv","raw"])
    h = 1 - 0.9*0.8                     # 0.28
    # FV_A = (h - h(0_A))/h ; h(0_A)=q_B=0.2
    assert imp["A"]["fv"] == pytest.approx((h - 0.2)/h)
    # RAW_A = h(1_A)/h = 1/h
    assert imp["A"]["raw"] == pytest.approx(1.0/h)

def test_birnbaum_equals_numeric_derivative():
    m, root, q = _or_model()
    imp = importance(m, root, q, measures=["birnbaum"])
    from psaengine.quantify.probability import exact_probability
    eps = 1e-7
    qp = dict(q); qp["A"] += eps; qm = dict(q); qm["A"] -= eps
    num = (exact_probability(m, root, qp) - exact_probability(m, root, qm)) / (2*eps)
    assert imp["A"]["birnbaum"] == pytest.approx(num, rel=1e-5)
