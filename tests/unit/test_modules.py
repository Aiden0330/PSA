import pytest
from psaengine.model.pdag import PDAG, Op
from psaengine.preprocess.modules import find_modules, modular_probability
from psaengine.ordering.heuristics import dflm
from psaengine.bdd.kernel import BddManager, build_from_pdag
from psaengine.quantify.probability import exact_probability

def _tree():
    g = PDAG()
    for b in ["A","B","X"]: g.basic(b)
    g.gate("M", Op.OR, ["A","B"])          # 独立模块(A,B 仅属 M)
    g.gate("TOP", Op.AND, ["M","X"]); g.top="TOP"
    return g

def test_find_independent_module():
    g = _tree()
    assert "M" in find_modules(g, "TOP")

def test_shared_event_not_module():
    g = PDAG()
    for b in ["A","B"]: g.basic(b)
    g.gate("M", Op.OR, ["A","B"]); g.gate("TOP", Op.AND, ["M","A"]); g.top="TOP"  # A 共享
    assert "M" not in find_modules(g, "TOP")

def test_modular_probability_equals_direct():
    g = _tree(); q = {"A":0.1,"B":0.2,"X":0.3}
    m = BddManager(dflm(g)); root = build_from_pdag(m, g, "TOP")
    direct = exact_probability(m, root, q)
    assert modular_probability(g, "TOP", q) == pytest.approx(direct)
