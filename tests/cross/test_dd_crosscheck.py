import pytest
dd_autoref = pytest.importorskip("dd.autoref")
from psaengine.model.pdag import PDAG, Op
from psaengine.ordering.heuristics import dflm
from psaengine.bdd.kernel import BddManager, build_from_pdag
from psaengine.quantify.probability import exact_probability

def test_crosscheck_2oo3_probability():
    g = PDAG()
    for b in "ABC": g.basic(b)
    g.gate("TOP", Op.ATLEAST, ["A","B","C"], k=2); g.top="TOP"
    q = {"A":0.3,"B":0.2,"C":0.1}
    # 自研引擎
    m = BddManager(dflm(g)); root = build_from_pdag(m, g, "TOP")
    mine = exact_probability(m, root, q)
    # dd 作独立预言机
    bdd = dd_autoref.BDD(); bdd.declare("A","B","C")
    expr = bdd.add_expr("(A & B) | (A & C) | (B & C)")
    def ddprob(u):
        # 用公共 API bdd.let 做 cofactor(内部自动处理补边), 避免触碰 .high/.low/.negated
        if u == bdd.true: return 1.0
        if u == bdd.false: return 0.0
        x = u.var
        hi = bdd.let({x: True}, u); lo = bdd.let({x: False}, u)
        return q[x]*ddprob(hi) + (1-q[x])*ddprob(lo)
    assert mine == pytest.approx(ddprob(expr), rel=1e-12)
