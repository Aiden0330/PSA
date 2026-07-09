"""4a4:不确定性/重要度运行随项目上下文自动钉扎为分析案例。"""
import backend.storage as storage
from fastapi.testclient import TestClient

from backend.app import app
from backend.canonical import content_hash, to_canonical

client = TestClient(app)

PUUID = "7d3f0a90-0000-5000-8000-1234567890cd"


def _payload():
    return {"v": 2,
            "etas": [{"key": "t", "name": "T",
                      "model": {"initEvent": "IE", "initFreq": 0.001,
                                "functionalEvents": [{"id": "FE1", "failProb": 0.1}],
                                "root": {"kind": "branch", "feId": "FE1",
                                         "success": {"kind": "leaf", "consequence": "C1"},
                                         "failure": {"kind": "leaf", "consequence": "C2"}}},
                      "fts": {"model_data": {"parameters": []}, "fault_trees": []},
                      "pfds": {}}],
            "activeKey": "t", "checkedKeys": {"t": True}}


def _et_req():
    return {
        "init_event": "IE", "init_frequency": 1.0,
        "functional_events": [{"id": "FE1", "pfd": 0.1}],
        "fault_trees": {}, "parameters": {},
        "sequences": [{"path": {"FE1": "failure"}, "end_state": "L1"},
                      {"path": {"FE1": "success"}, "end_state": "L0"}],
        "consequence_bins": {"L0": "C1", "L1": "C2"},
    }


def test_importance_and_uncertainty_pin_cases(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "_DIR", str(tmp_path / "saved"))
    ctx = {"project_uuid": PUUID, "project_payload": _payload(), "scenario_name": "IE"}

    imp = client.post("/api/event-tree/importance", json={**_et_req(), **ctx}).json()
    assert imp["case"]["version_hash"] == content_hash(to_canonical(_payload(), PUUID)[0])

    unc = client.post("/api/event-tree/uncertainty",
                      json={**_et_req(), "samples": 50, "seed": 1, **ctx}).json()
    assert unc["case"]["case_id"] != imp["case"]["case_id"]
    assert unc["case"]["version_hash"] == imp["case"]["version_hash"]   # 同内容 → 幂等同版本

    cases = client.get(f"/api/projects/{PUUID}/cases").json()
    kinds = sorted(c["kind"] for c in cases)
    assert kinds == ["importance", "uncertainty"]
    audit = {a["action"] for a in client.get(f"/api/projects/{PUUID}/audit").json()}
    assert {"analysis.importance", "analysis.uncertainty"} <= audit


def test_without_context_unchanged(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "_DIR", str(tmp_path / "saved"))
    imp = client.post("/api/event-tree/importance", json=_et_req()).json()
    assert "case" not in imp
    unc = client.post("/api/event-tree/uncertainty", json={**_et_req(), "samples": 50}).json()
    assert "case" not in unc
