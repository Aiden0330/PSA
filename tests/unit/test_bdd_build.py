from psaengine.model.pdag import PDAG, Op
from psaengine.ordering.heuristics import dflm
from psaengine.bdd.kernel import BddManager, build_from_pdag

def test_build_and():
    g = PDAG(); g.basic("A"); g.basic("B"); g.gate("TOP", Op.AND, ["A","B"]); g.top="TOP"
    m = BddManager(dflm(g)); root = build_from_pdag(m, g, "TOP")
    assert m.eval(root, {"A":1,"B":1}) == 1
    assert m.eval(root, {"A":1,"B":0}) == 0

def test_build_2oo3():
    g = PDAG()
    for b in "ABC": g.basic(b)
    g.gate("TOP", Op.ATLEAST, ["A","B","C"], k=2); g.top="TOP"
    m = BddManager(dflm(g)); root = build_from_pdag(m, g, "TOP")
    assert m.eval(root, {"A":1,"B":1,"C":0}) == 1   # 2 个真
    assert m.eval(root, {"A":1,"B":0,"C":0}) == 0   # 1 个真
    assert m.eval(root, {"A":1,"B":1,"C":1}) == 1   # 3 个真

def test_build_not_and_xor():
    g = PDAG(); g.basic("A"); g.basic("B")
    g.gate("X", Op.XOR, ["A","B"]); g.top="X"
    m = BddManager(dflm(g)); root = build_from_pdag(m, g, "X")
    assert m.eval(root, {"A":1,"B":0}) == 1
    assert m.eval(root, {"A":1,"B":1}) == 0
