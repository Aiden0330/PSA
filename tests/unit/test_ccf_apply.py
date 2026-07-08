import copy, pytest
from psaengine.model.pdag import PDAG, Op
from psaengine.model.parameters import Parameter, ParameterLibrary
from psaengine.model.fault_tree import FaultTree
from psaengine.model.ccf import CCFGroup
from psaengine.model.model import Model
from psaengine import Analysis

def _lib():
    lib = ParameterLibrary()
    lib.add(Parameter("A", "probability", 0.1))
    lib.add(Parameter("B", "probability", 0.1))
    return lib

def _ft():
    g = PDAG(); g.basic("A"); g.basic("B"); g.gate("TOP", Op.AND, ["A", "B"]); g.top = "TOP"
    return FaultTree("TOP", g)

def test_ccf_increases_joint_failure():
    # AND(A,B), A=B=0.1
    p_indep = Analysis(Model(parameters=_lib(), fault_trees={"T": _ft()})).probability()
    assert p_indep == pytest.approx(0.01)
    # 加 beta=0.1 共因组:P(C) + P(¬C)·P(A_I·B_I) = 0.01 + 0.99·0.09² = 0.018019
    m = Model(parameters=_lib(), fault_trees={"T": _ft()},
              ccf_groups=[CCFGroup("AB", ["A", "B"], "beta", {"beta": 0.1})])
    p_ccf = Analysis(m).probability()
    assert p_ccf > p_indep
    assert p_ccf == pytest.approx(0.018019, rel=1e-3)

def test_ccf_creates_common_cause_cutset():
    m = Model(parameters=_lib(), fault_trees={"T": _ft()},
              ccf_groups=[CCFGroup("AB", ["A", "B"], "beta", {"beta": 0.1})])
    cs = Analysis(m).cutsets()
    # 应出现一阶共因割集 {CCF_AB} 以及二阶独立割集 {A__I, B__I}
    sets = [set(c.events) for c in cs]
    assert {"CCF_AB"} in sets
    assert any(s == {"A__I", "B__I"} for s in sets)
