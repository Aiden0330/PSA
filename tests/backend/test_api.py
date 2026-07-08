from fastapi.testclient import TestClient
from backend.app import app

client = TestClient(app)

def test_examples():
    r = client.get("/api/examples")
    assert r.status_code == 200
    assert "bms_ft" in [e["id"] for e in r.json()]

def test_get_model():
    r = client.get("/api/model/bms_ft")
    assert r.status_code == 200
    d = r.json()
    assert d["fault_tree"] == "BMS"
    nodes = d["model"]["fault_trees"][0]["nodes"]
    assert any(n["id"] == "BMS_PROTECTION_FAILURE" for n in nodes)

def test_unknown_model_404():
    assert client.get("/api/model/nope").status_code == 404

def test_quantify_matches_engine():
    model = client.get("/api/model/bms_ft").json()
    r = client.post("/api/quantify", json={"model": model["model"],
                                           "fault_tree": "BMS", "method": "exact"})
    assert r.status_code == 200
    body = r.json()
    assert abs(body["probability"] - 0.013644) < 1e-5
    assert len(body["cutsets"]) >= 4
    assert "LOGIC_FAIL" in body["importance"]

def test_bess_thermal_runaway():
    r = client.get("/api/bess/thermal-runaway")
    assert r.status_code == 200
    body = r.json()
    assert set(body["consequences"]).issubset({"C1","C2","C3","C4","C5"})
    assert "barrier_importance" in body

def test_bess_event_tree_structure():
    r = client.get("/api/bess/event-tree")
    assert r.status_code == 200
    b = r.json()
    assert len(b["functional_events"]) == 6
    assert b["functional_events"][0] == "B_OFFGAS"
    assert len(b["sequences"]) == 7                       # D0..D6 级联
    s0 = b["sequences"][0]
    assert {"end_state", "path", "consequence", "frequency"} <= set(s0)
    # 序列频率和 ≈ 初始事件频率(互斥穷尽)
    assert abs(sum(s["frequency"] for s in b["sequences"]) - b["init_frequency"]) < 1e-9
    assert b["labels"]["B_OFFGAS"]
    assert b["fe_prob"]["B_OFFGAS"] == 0.01
