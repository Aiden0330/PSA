import pytest
from psaengine.model.pdag import PDAG, Op
from psaengine.ordering.heuristics import dflm
from psaengine.bdd.kernel import BddManager, build_from_pdag
from psaengine.quantify.cutsets import minimal_cutsets

def test_2oo3_cutsets():
    g = PDAG()
    for b in "ABC": g.basic(b)
    g.gate("TOP", Op.ATLEAST, ["A","B","C"], k=2); g.top="TOP"
    m = BddManager(dflm(g)); root = build_from_pdag(m, g, "TOP")
    cs = minimal_cutsets(m, root)
    got = sorted([sorted(c.events) for c in cs])
    assert got == [["A","B"], ["A","C"], ["B","C"]]

def test_cutoff_filters_low_prob():
    g = PDAG()
    for b in "ABC": g.basic(b)
    g.gate("TOP", Op.OR, ["A","B","C"]); g.top="TOP"
    q = {"A":0.1, "B":1e-6, "C":1e-8}
    m = BddManager(dflm(g)); root = build_from_pdag(m, g, "TOP")
    cs = minimal_cutsets(m, root, q=q, cutoff=1e-7)
    events = sorted(e for c in cs for e in c.events)
    assert "C" not in events and "A" in events

def test_limit_order():
    g = PDAG()
    for b in "ABCD": g.basic(b)
    g.gate("TOP", Op.AND, ["A","B","C","D"]); g.top="TOP"
    m = BddManager(dflm(g)); root = build_from_pdag(m, g, "TOP")
    cs = minimal_cutsets(m, root, limit_order=3)
    assert cs == []                    # 唯一割集阶数 4 > 3, 被滤掉
