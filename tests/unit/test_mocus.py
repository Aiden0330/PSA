from psaengine.model.pdag import PDAG, Op
from psaengine.quantify.mocus import mocus_cutsets
from psaengine.bdd.kernel import BddManager, build_from_pdag
from psaengine.ordering.heuristics import dflm
from psaengine.quantify.cutsets import minimal_cutsets

def test_mocus_2oo3_matches_bdd():
    g = PDAG()
    for b in "ABC": g.basic(b)
    g.gate("TOP", Op.ATLEAST, ["A","B","C"], k=2); g.top="TOP"
    mc = sorted(sorted(c) for c in mocus_cutsets(g, "TOP"))
    m = BddManager(dflm(g)); root = build_from_pdag(m, g, "TOP")
    bd = sorted(sorted(c.events) for c in minimal_cutsets(m, root))
    assert mc == bd == [["A","B"],["A","C"],["B","C"]]

def test_mocus_and_of_or():
    g = PDAG()
    for b in "ABCD": g.basic(b)
    g.gate("L", Op.OR, ["A","B"]); g.gate("R", Op.OR, ["C","D"])
    g.gate("TOP", Op.AND, ["L","R"]); g.top="TOP"
    mc = sorted(sorted(c) for c in mocus_cutsets(g, "TOP"))
    assert mc == [["A","C"],["A","D"],["B","C"],["B","D"]]

def test_mocus_absorption():
    g = PDAG()
    for b in "AB": g.basic(b)
    g.gate("SUB", Op.AND, ["A","B"]); g.gate("TOP", Op.OR, ["A","SUB"]); g.top="TOP"
    # A + A·B = A
    assert sorted(sorted(c) for c in mocus_cutsets(g, "TOP")) == [["A"]]
