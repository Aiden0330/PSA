from bess.scenarios import load_scenarios, build_scenario_model
from psaengine.eta.sequence import quantify_event_tree


def test_five_scenarios_listed():
    ids = {s["id"] for s in load_scenarios()}
    assert {"SC_ISC", "SC_OVERCHARGE", "SC_COOLANT", "SC_EXT_FIRE", "SC_MECH_WATER"} <= ids


def test_each_scenario_conserves_frequency():
    for s in load_scenarios():
        model = build_scenario_model(s["id"])
        et = model.event_trees["TR"]
        total = sum(quantify_event_tree(model, "TR")["sequences"].values())
        assert abs(total - et.init_frequency) <= 1e-9 * et.init_frequency, s["id"]


def test_consequences_nonneg_and_capped_c5():
    model = build_scenario_model("SC_ISC")
    cons = quantify_event_tree(model, "TR")["consequences"]
    assert all(v >= 0 for v in cons.values())
    assert set(cons) <= {"C1", "C2", "C3", "C4", "C5"}


def test_scenario_init_event_and_first_barrier():
    model = build_scenario_model("SC_OVERCHARGE")
    et = model.event_trees["TR"]
    assert et.init_event == "IE_OVERCHARGE"
    assert et.functional_events[0].id == "B_BMS"
