from backend.et_builder import build_model_from_request
from psaengine.eta.sequence import quantify_event_tree


def _req():
    return {
        "init_event": "X", "init_frequency": 1.0,
        "functional_events": [
            {"id": "FE1", "pfd": 0.1},
            {"id": "FE2", "pfd": 0.2},
            {"id": "FE3", "pfd": 0.3},
        ],
        "fault_trees": {}, "parameters": {},
        "sequences": [
            {"path": {"FE1": "success", "FE3": "failure"}, "end_state": "L0"},  # 跳过 FE2
            {"path": {"FE1": "success", "FE3": "success"}, "end_state": "L1"},  # 跳过 FE2
            {"path": {"FE1": "failure"}, "end_state": "L2"},                    # 跳过 FE2,FE3
        ],
        "consequence_bins": {"L0": "C2", "L1": "C1", "L2": "C3"},
    }


def test_sequence_skipping_middle_fe_multiplies_tested_only():
    model = build_model_from_request(_req())
    seq = quantify_event_tree(model, "TR")["sequences"]
    assert abs(seq["L0"] - (1.0 * (1 - 0.1) * 0.3)) < 1e-12        # FE2 不参与
    assert abs(seq["L1"] - (1.0 * (1 - 0.1) * (1 - 0.3))) < 1e-12
    assert abs(seq["L2"] - (1.0 * 0.1)) < 1e-12


def test_skip_consequences_aggregate():
    model = build_model_from_request(_req())
    cons = quantify_event_tree(model, "TR")["consequences"]
    assert abs(cons["C1"] - (1.0 * (1 - 0.1) * (1 - 0.3))) < 1e-12
    assert abs(cons["C2"] - (1.0 * (1 - 0.1) * 0.3)) < 1e-12
    assert abs(cons["C3"] - (1.0 * 0.1)) < 1e-12
