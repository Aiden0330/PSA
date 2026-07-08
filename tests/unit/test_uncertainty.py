import pytest
from psaengine.model.pdag import PDAG, Op
from psaengine.model.parameters import Parameter, Distribution
from psaengine.ordering.heuristics import dflm
from psaengine.bdd.kernel import BddManager, build_from_pdag
from psaengine.uncertainty.montecarlo import propagate

def test_reproducible_with_seed():
    g = PDAG(); g.basic("A"); g.basic("B"); g.gate("TOP", Op.OR, ["A","B"]); g.top="TOP"
    m = BddManager(dflm(g)); root = build_from_pdag(m, g, "TOP")
    params = {
        "A": Parameter("A","probability",0.1, distribution=Distribution("lognormal",{"median":0.1,"error_factor":3})),
        "B": Parameter("B","probability",0.2, distribution=Distribution("lognormal",{"median":0.2,"error_factor":2})),
    }
    r1 = propagate(m, root, params, samples=2000, seed=42)
    r2 = propagate(m, root, params, samples=2000, seed=42)
    assert r1["mean"] == pytest.approx(r2["mean"])
    assert r1["p05"] <= r1["p50"] <= r1["p95"]

def test_tornado_ranks_by_swing():
    g = PDAG(); g.basic("A"); g.basic("B"); g.gate("TOP", Op.OR, ["A","B"]); g.top="TOP"
    m = BddManager(dflm(g)); root = build_from_pdag(m, g, "TOP")
    params = {
        "A": Parameter("A","probability",0.1, distribution=Distribution("lognormal",{"median":0.1,"error_factor":10})),
        "B": Parameter("B","probability",0.2, distribution=Distribution("lognormal",{"median":0.2,"error_factor":1.2})),
    }
    r = propagate(m, root, params, samples=1000, seed=1, tornado=True)
    # A 的误差因子更大 → 摆幅更大 → 排前
    assert r["tornado"][0][0] == "A"
