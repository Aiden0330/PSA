from psaengine.model.pdag import PDAG, Op
from psaengine.ordering.heuristics import dflm

def test_dflm_left_first():
    g = PDAG()
    for b in ["A", "B", "C"]: g.basic(b)
    g.gate("L", Op.OR, ["A", "B"]); g.gate("TOP", Op.AND, ["L", "C"]); g.top = "TOP"
    order = dflm(g)
    # 深度优先最左: 先 A,B(经 L), 再 C
    assert order.index("A") < order.index("B") < order.index("C")

def test_dflm_covers_all_basics():
    g = PDAG()
    for b in ["A", "B", "C"]: g.basic(b)
    g.gate("TOP", Op.OR, ["A", "B", "C"]); g.top = "TOP"
    assert set(dflm(g)) == {"A", "B", "C"}
