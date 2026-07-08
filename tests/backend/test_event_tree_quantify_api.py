from fastapi.testclient import TestClient
from backend.app import app

client = TestClient(app)


def _pfd_only_request():
    # 两屏障级联, 纯 PFD, 无共享 → 引擎=独立积式
    return {
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


def test_pfd_only_matches_product():
    r = client.post("/api/event-tree/quantify", json=_pfd_only_request())
    assert r.status_code == 200
    seq = r.json()["sequences"]
    assert abs(seq["L0"] - 0.9) < 1e-12
    assert abs(seq["L1"] - 0.1 * 0.8) < 1e-12
    assert abs(seq["L2"] - 0.1 * 0.2) < 1e-12


def test_shared_event_via_linked_ft_differs_from_product():
    # FE1, FE2 共享基本事件 X → 引擎精确否定 ≠ 朴素积式
    req = {
        "init_event": "IE", "init_frequency": 1.0,
        "functional_events": [{"id": "FE1", "link_ft": "FT1"}, {"id": "FE2", "link_ft": "FT2"}],
        "fault_trees": {
            "FT1": {"name": "FT1", "top": "FE1", "nodes": [
                {"id": "X", "basic": True, "param_ref": "X"},
                {"id": "A", "basic": True, "param_ref": "A"},
                {"id": "FE1", "op": "or", "args": ["X", "A"]}]},
            "FT2": {"name": "FT2", "top": "FE2", "nodes": [
                {"id": "X", "basic": True, "param_ref": "X"},
                {"id": "B", "basic": True, "param_ref": "B"},
                {"id": "FE2", "op": "or", "args": ["X", "B"]}]},
        },
        "parameters": {"X": {"value": 0.1}, "A": {"value": 0.1}, "B": {"value": 0.1}},
        "sequences": [
            {"path": {"FE1": "failure", "FE2": "failure"}, "end_state": "LL"},
            {"path": {"FE1": "success"}, "end_state": "S"},
            {"path": {"FE1": "failure", "FE2": "success"}, "end_state": "FS"},
        ],
        "consequence_bins": {"LL": "C3", "FS": "C2", "S": "C1"},
    }
    seq = client.post("/api/event-tree/quantify", json=req).json()["sequences"]
    # P(FE1)=P(X∪A)=0.19; 独立积式 LL≈0.19*0.19=0.0361
    # 精确: P(FE1∧FE2)=P(X∪(A∧B))=0.109 因共享 X 而 >0.0361
    assert seq["LL"] > 0.0361 + 1e-6
    assert abs(seq["LL"] - 0.109) < 1e-9
