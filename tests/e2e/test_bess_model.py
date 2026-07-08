import pytest
from bess.tr_model import build_thermal_runaway_model
from psaengine import Analysis

def test_thermal_runaway_event_tree_runs():
    model = build_thermal_runaway_model(scenario="grid_container")
    res = Analysis(model).event_tree("TR")
    # 所有后果类频率非负, 且 C5(爆燃) < C1(单体排气)
    cons = res["consequences"]
    assert all(v >= 0 for v in cons.values())
    assert cons.get("C5", 0) < cons.get("C1", 1e9)

def test_barriers_present():
    model = build_thermal_runaway_model(scenario="grid_container")
    fe_ids = [fe.id for fe in model.event_trees["TR"].functional_events]
    assert "B_OFFGAS" in fe_ids and "B_RESPONSE" in fe_ids

def test_sequence_probabilities_sum_to_one():
    # 级联序列互斥穷尽: Σ 序列频率 = IE 频率
    model = build_thermal_runaway_model(scenario="grid_container")
    res = Analysis(model).event_tree("TR")
    ie_freq = model.event_trees["TR"].init_frequency
    assert sum(res["sequences"].values()) == pytest.approx(ie_freq)
