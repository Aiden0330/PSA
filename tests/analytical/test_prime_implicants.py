from psaengine.model.pdag import PDAG, Op
from psaengine.ordering.heuristics import dflm
from psaengine.bdd.kernel import BddManager, build_from_pdag
from psaengine.quantify.prime_implicants import prime_implicants

def _pi_set(m, root):
    return {frozenset(pi.items()) for pi in prime_implicants(m, root)}

def test_and_not():
    # f = A AND NOT B  →  唯一素蕴涵 {+A, -B}
    g = PDAG(); g.basic("A"); g.basic("B")
    g.gate("nB", Op.NOT, ["B"]); g.gate("TOP", Op.AND, ["A","nB"]); g.top="TOP"
    m = BddManager(dflm(g)); root = build_from_pdag(m, g, "TOP")
    assert _pi_set(m, root) == {frozenset({("A",True),("B",False)})}

def test_consensus_term():
    # f = (A AND NOT B) OR (NOT A AND C); 素蕴涵含 consensus {-B,+C}
    g = PDAG()
    for b in "ABC": g.basic(b)
    g.gate("nB", Op.NOT, ["B"]); g.gate("nA", Op.NOT, ["A"])
    g.gate("L", Op.AND, ["A","nB"]); g.gate("R", Op.AND, ["nA","C"])
    g.gate("TOP", Op.OR, ["L","R"]); g.top="TOP"
    m = BddManager(dflm(g)); root = build_from_pdag(m, g, "TOP")
    pis = _pi_set(m, root)
    assert frozenset({("A",True),("B",False)}) in pis
    assert frozenset({("A",False),("C",True)}) in pis
    assert frozenset({("B",False),("C",True)}) in pis   # consensus
