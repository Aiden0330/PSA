from bess.scenarios import build_scenario_model
from psaengine.eta.sequence import quantify_event_tree


def test_override_none_matches_default():
    m = build_scenario_model("SC_OVERCHARGE")
    a = quantify_event_tree(m, "TR")
    b = quantify_event_tree(m, "TR", fe_overrides=None)
    assert a == b


def test_force_work_zeroes_failure_dependent_consequence():
    m = build_scenario_model("SC_OVERCHARGE")  # 4 屏障级联, C5=全部失效
    first = m.event_trees["TR"].functional_events[0].id
    base = quantify_event_tree(m, "TR")["consequences"]
    forced = quantify_event_tree(m, "TR", {first: "work"})["consequences"]
    assert base.get("C5", 0) > 0
    assert forced.get("C5", 0.0) == 0.0   # 首屏障必有效 → 不可能全失效


def test_force_fail_zeroes_success_consequence():
    m = build_scenario_model("SC_OVERCHARGE")
    first = m.event_trees["TR"].functional_events[0].id
    forced = quantify_event_tree(m, "TR", {first: "fail"})["consequences"]
    assert forced.get("C1", 0.0) == 0.0   # C1=首屏障成功; 强制失效 → C1=0
