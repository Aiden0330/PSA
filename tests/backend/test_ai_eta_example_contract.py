import json
from pathlib import Path

from fastapi.testclient import TestClient

from backend.ai_draft import validate_draft
from backend.app import app


ROOT = Path(__file__).resolve().parents[2]
REQUEST_PATH = ROOT / "examples" / "ai_eta_coolant_leak_request.json"
RESPONSE_PATH = ROOT / "examples" / "ai_eta_coolant_leak_response.json"


def _load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def test_ai_eta_example_files_define_clear_contract():
    req = _load_json(REQUEST_PATH)
    res = _load_json(RESPONSE_PATH)

    assert req["goal"] == "电池舱液冷泄漏导致外短"
    assert req["target"] == "eta"
    assert req["user_context"]["mode"] == "new_eta"
    assert "explicit_values" in req["user_context"]

    assert res["draft_id"] == "ai-example-coolant-leak-eta"
    assert res["summary"]
    assert len(res["etas"]) == 1
    assert res["etas"][0]["model"]["initEvent"] == req["goal"]
    assert res["validation"]["ok"] is True


def test_ai_eta_example_output_passes_deterministic_validation():
    res = _load_json(RESPONSE_PATH)

    validation = validate_draft(res)

    assert validation["ok"] is True
    assert validation["errors"] == []


def test_ai_eta_example_can_be_quantified_by_existing_eta_engine():
    res = _load_json(RESPONSE_PATH)
    eta = res["etas"][0]["model"]
    client = TestClient(app)

    r = client.post(
        "/api/event-tree/quantify",
        json={
            "init_event": eta["initEvent"],
            "init_frequency": eta["initFreq"],
            "functional_events": [
                {"id": "B_LEAK_DETECT", "pfd": 0.05},
                {"id": "B_BMS_ISO", "pfd": 0.1},
                {"id": "B_FUSE", "pfd": 0.02},
            ],
            "fault_trees": {},
            "parameters": {},
            "sequences": [
                {"path": {"B_LEAK_DETECT": "success"}, "end_state": "L0"},
                {"path": {"B_LEAK_DETECT": "failure", "B_BMS_ISO": "success"}, "end_state": "L1"},
                {"path": {"B_LEAK_DETECT": "failure", "B_BMS_ISO": "failure", "B_FUSE": "success"}, "end_state": "L2"},
                {"path": {"B_LEAK_DETECT": "failure", "B_BMS_ISO": "failure", "B_FUSE": "failure"}, "end_state": "L3"},
            ],
            "consequence_bins": {"L0": "C1", "L1": "C2", "L2": "C3", "L3": "C4"},
        },
    )

    assert r.status_code == 200
    seq = r.json()["sequences"]
    assert abs(seq["L0"] - 0.00095) < 1e-12
    assert abs(seq["L1"] - 0.000045) < 1e-12
    assert abs(seq["L2"] - 0.0000049) < 1e-12
    assert abs(seq["L3"] - 0.0000001) < 1e-12
