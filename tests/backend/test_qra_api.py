from fastapi.testclient import TestClient
from backend.app import app

client = TestClient(app)


def _req():
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


def test_uncertainty_endpoint():
    r = client.post("/api/event-tree/uncertainty", json={**_req(), "samples": 200, "seed": 1})
    assert r.status_code == 200
    d = r.json()
    assert "bands" in d and "point" in d
    assert d["bands"]["C3"]["p05"] <= d["bands"]["C3"]["p95"]


def test_importance_endpoint():
    r = client.post("/api/event-tree/importance", json=_req())
    assert r.status_code == 200
    imp = r.json()["importance"]
    # C3 = 双失效, 两屏障都必需 → FV=1
    assert all(abs(row["fv"] - 1.0) < 1e-9 for row in imp["C3"])
