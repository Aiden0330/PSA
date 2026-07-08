import pytest
from psaengine.model.pdag import PDAG, Op
from psaengine.preprocess.normalize import normalize, CyclicLogicError

def test_cycle_detected():
    g = PDAG()
    g.gate("A", Op.OR, ["B"]); g.gate("B", Op.OR, ["A"])
    g.top = "A"
    with pytest.raises(CyclicLogicError):
        normalize(g)

def test_house_true_in_or_makes_constant_true():
    g = PDAG()
    g.basic("X"); g.house("H", state=True)
    g.gate("TOP", Op.OR, ["X", "H"]); g.top = "TOP"
    ng = normalize(g)
    assert ng.node(ng.top).op is Op.NULL and ng.node(ng.top).state is True

def test_house_false_dropped_from_or():
    g = PDAG()
    g.basic("X"); g.house("H", state=False)
    g.gate("TOP", Op.OR, ["X", "H"]); g.top = "TOP"
    ng = normalize(g)
    assert set(ng.node(ng.top).args) == {"X"}

def test_coalescing_nested_or():
    g = PDAG()
    for b in "ABC": g.basic(b)
    g.gate("SUB", Op.OR, ["B", "C"])
    g.gate("TOP", Op.OR, ["A", "SUB"]); g.top = "TOP"
    ng = normalize(g)
    assert set(ng.node(ng.top).args) == {"A", "B", "C"}

def test_idempotent():
    g = PDAG()
    for b in "ABC": g.basic(b)
    g.gate("SUB", Op.OR, ["B", "C"]); g.gate("TOP", Op.OR, ["A", "SUB"]); g.top = "TOP"
    once = normalize(g); twice = normalize(once)
    assert {i: (n.op, tuple(n.args)) for i, n in twice.nodes.items() if n.op} == \
           {i: (n.op, tuple(n.args)) for i, n in once.nodes.items() if n.op}
