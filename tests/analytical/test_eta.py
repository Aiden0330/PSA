import pytest
from psaengine.model.pdag import PDAG, Op
from psaengine.model.parameters import Parameter, ParameterLibrary
from psaengine.model.fault_tree import FaultTree
from psaengine.model.event_tree import EventTree, FunctionalEvent
from psaengine.model.model import Model
from psaengine.eta.sequence import quantify_event_tree

def _barrier_ft(name, ev, q):
    g = PDAG(); g.basic(ev, param_ref=ev); g.gate(name, Op.NULL, [ev]); g.top=name
    return FaultTree(name, g)

def test_two_barriers_success_branch_exact():
    lib = ParameterLibrary()
    lib.add(Parameter("D","probability",0.1))   # 探测失败概率
    lib.add(Parameter("S","probability",0.2))   # 抑制失败概率
    model = Model(
        parameters=lib,
        fault_trees={"DET": _barrier_ft("DET","D",0.1), "SUP": _barrier_ft("SUP","S",0.2)},
        event_trees={"ET": EventTree(
            init_event="IE", init_frequency=2.0,
            functional_events=[FunctionalEvent("DET", link_ft="DET"),
                               FunctionalEvent("SUP", link_ft="SUP")],
            sequences=[
                {"path":{"DET":"success","SUP":"success"}, "end_state":"OK"},
                {"path":{"DET":"success","SUP":"failure"}, "end_state":"FIRE"},
                {"path":{"DET":"failure","SUP":"failure"}, "end_state":"BLOWUP"},
            ],
            consequence_bins={"OK":"C1","FIRE":"C3","BLOWUP":"C5"})},
        ccf_groups=[])
    res = quantify_event_tree(model, "ET")
    # 频率 = IE_freq × Pr(序列布尔式)
    # OK: ¬D·¬S = 0.9·0.8=0.72 → 1.44
    # FIRE: ¬D·S = 0.9·0.2=0.18 → 0.36
    # BLOWUP: D·S = 0.1·0.2=0.02 → 0.04  (¬D 不在此序列)
    assert res["sequences"]["OK"] == pytest.approx(1.44)
    assert res["sequences"]["FIRE"] == pytest.approx(0.36)
    assert res["sequences"]["BLOWUP"] == pytest.approx(0.04)
    # 后果汇总
    assert res["consequences"]["C5"] == pytest.approx(0.04)
    assert res["consequences"]["C3"] == pytest.approx(0.36)
