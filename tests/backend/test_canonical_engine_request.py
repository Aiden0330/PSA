"""ADR-1 acceptance #2: canonical engine requests equal the hand-written
requests of the existing API tests, and quantify bit-identically."""
import copy

from backend.canonical import to_canonical, build_engine_request
from backend.et_builder import build_model_from_request
from psaengine.eta.sequence import quantify_event_tree

PUUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301"


def _wrap(model: dict, fts: dict) -> dict:
    return {"v": 2, "etas": [{"key": "t", "name": "t", "model": model, "fts": fts,
                              "pfds": {}}],
            "activeKey": "t", "checkedKeys": {"t": True}}


def _chain(feids, consequences):
    node = {"kind": "leaf", "consequence": consequences[-1]}
    for i in range(len(feids) - 1, -1, -1):
        node = {"kind": "branch", "feId": feids[i],
                "success": {"kind": "leaf", "consequence": consequences[i]},
                "failure": node}
    return node


EXPECTED_PFD_ONLY = {
    "init_event": "IE", "init_frequency": 1.0,
    "functional_events": [{"id": "FE1", "pfd": 0.1}, {"id": "FE2", "pfd": 0.2}],
    "fault_trees": {}, "parameters": {},
    "sequences": [
        {"path": {"FE1": "success"}, "end_state": "L0"},
        {"path": {"FE1": "failure", "FE2": "success"}, "end_state": "L1"},
        {"path": {"FE1": "failure", "FE2": "failure"}, "end_state": "L2"},
    ],
    "consequence_bins": {"L0": "C1", "L1": "C2", "L2": "C3"},
}


def test_pfd_only_request_matches_handwritten():
    model = {"initEvent": "IE", "initFreq": 1.0,
             "functionalEvents": [{"id": "FE1", "failProb": 0.1},
                                  {"id": "FE2", "failProb": 0.2}],
             "root": _chain(["FE1", "FE2"], ["C1", "C2", "C3"])}
    doc, _ = to_canonical(_wrap(model, {"model_data": {"parameters": []},
                                        "fault_trees": []}), PUUID)
    assert build_engine_request(doc, "t") == EXPECTED_PFD_ONLY


def test_shared_event_request_quantifies_bit_identical():
    # mirrors tests/backend/test_event_tree_quantify_api.py (exact LL = 0.109)
    fts = {"model_data": {"parameters": [
                {"id": "X", "kind": "probability", "value": 0.1},
                {"id": "A", "kind": "probability", "value": 0.1},
                {"id": "B", "kind": "probability", "value": 0.1}]},
           "fault_trees": [
               {"name": "FT1", "top": "FE1", "nodes": [
                   {"id": "X", "basic": True, "param_ref": "X"},
                   {"id": "A", "basic": True, "param_ref": "A"},
                   {"id": "FE1", "op": "or", "args": ["X", "A"]}]},
               {"name": "FT2", "top": "FE2", "nodes": [
                   {"id": "X", "basic": True, "param_ref": "X"},
                   {"id": "B", "basic": True, "param_ref": "B"},
                   {"id": "FE2", "op": "or", "args": ["X", "B"]}]}]}
    model = {"initEvent": "IE", "initFreq": 1.0,
             "functionalEvents": [{"id": "FE1", "failProb": 0.19, "linkFt": "FT1"},
                                  {"id": "FE2", "failProb": 0.19, "linkFt": "FT2"}],
             "root": _chain(["FE1", "FE2"], ["C1", "C2", "C3"])}
    doc, _ = to_canonical(_wrap(model, fts), PUUID)
    req = build_engine_request(doc, "t")

    handwritten = {
        "init_event": "IE", "init_frequency": 1.0,
        # Frontend parity (EB-08): link_ft = the functional-event id, and the
        # fault tree is keyed by that id (fault_trees[fe.id]) with the tree's
        # own ref kept as inner `name` — mirrors toEngineRequest exactly.
        "functional_events": [{"id": "FE1", "link_ft": "FE1"},
                              {"id": "FE2", "link_ft": "FE2"}],
        "fault_trees": {"FE1": copy.deepcopy(fts["fault_trees"][0]),
                        "FE2": copy.deepcopy(fts["fault_trees"][1])},
        "parameters": {"X": {"value": 0.1}, "A": {"value": 0.1}, "B": {"value": 0.1}},
        "sequences": [
            {"path": {"FE1": "success"}, "end_state": "L0"},
            {"path": {"FE1": "failure", "FE2": "success"}, "end_state": "L1"},
            {"path": {"FE1": "failure", "FE2": "failure"}, "end_state": "L2"},
        ],
        "consequence_bins": {"L0": "C1", "L1": "C2", "L2": "C3"},
    }
    assert req == handwritten

    res_c = quantify_event_tree(build_model_from_request(req), "TR")
    res_h = quantify_event_tree(build_model_from_request(handwritten), "TR")
    assert res_c["sequences"] == res_h["sequences"]          # bit-identical
    assert res_c["consequences"] == res_h["consequences"]
    assert abs(res_c["sequences"]["L2"] - 0.109) < 1e-9      # shared-event anchor
