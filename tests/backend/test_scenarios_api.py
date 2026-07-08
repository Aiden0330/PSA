from fastapi.testclient import TestClient
from backend.app import app

client = TestClient(app)


def test_scenarios_list():
    r = client.get("/api/bess/scenarios")
    assert r.status_code == 200
    assert any(s["id"] == "SC_ISC" for s in r.json())


def test_event_tree_for_scenario():
    r = client.get("/api/bess/event-tree", params={"scenario": "SC_OVERCHARGE"})
    assert r.status_code == 200
    d = r.json()
    assert d["functional_events"][0] == "B_BMS"
    assert d["init_event"] == "IE_OVERCHARGE"
    assert abs(sum(s["frequency"] for s in d["sequences"]) - d["init_frequency"]) < 1e-9


def test_event_tree_scenario_includes_serialized_fts():
    r = client.get("/api/bess/event-tree", params={"scenario": "SC_ISC"})
    d = r.json()
    assert "fault_trees" in d and "parameters" in d
    assert len(d["fault_trees"]["B_BMS"]["nodes"]) > 2     # 真故障树(非平凡)
    pids = {p["id"] for p in d["parameters"]}
    assert "BMS_CONTACTOR_FAIL" in pids


def test_event_tree_default_unchanged():
    r = client.get("/api/bess/event-tree")          # 无 scenario = 原行为
    assert r.status_code == 200
    b = r.json()
    assert b["init_event"] == "IE_TR"
    assert len(b["functional_events"]) == 6
    assert b["functional_events"][0] == "B_OFFGAS"
