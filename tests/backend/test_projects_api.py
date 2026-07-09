"""ADR-2 API surface: /api/saved dual-write, read endpoints, report auto-pin + footer."""
import json

import backend.storage as storage
from fastapi.testclient import TestClient

from backend import store
from backend.app import app
from backend.canonical import content_hash, to_canonical

client = TestClient(app)


def _payload(fail=0.1):
    return {"v": 2,
            "etas": [{"key": "t", "name": "T",
                      "model": {"initEvent": "IE", "initFreq": 0.001,
                                "functionalEvents": [{"id": "FE1", "failProb": fail},
                                                     {"id": "FE2", "failProb": 0.2}],
                                "root": {"kind": "branch", "feId": "FE1",
                                         "success": {"kind": "leaf", "consequence": "C1"},
                                         "failure": {"kind": "branch", "feId": "FE2",
                                                     "success": {"kind": "leaf", "consequence": "C2"},
                                                     "failure": {"kind": "leaf", "consequence": "C3"}}}},
                      "fts": {"model_data": {"parameters": []}, "fault_trees": []},
                      "pfds": {}}],
            "activeKey": "t", "checkedKeys": {"t": True}}


def test_saved_dual_write_creates_idempotent_versions(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "_DIR", str(tmp_path / "saved"))
    r1 = client.post("/api/saved", json={"name": "P", "payload": _payload()}).json()
    assert r1["version"]["created"] is True
    sid = r1["id"]
    r2 = client.post("/api/saved", json={"id": sid, "name": "P", "payload": _payload()}).json()
    assert r2["version"]["created"] is False                       # 同内容幂等
    assert r2["version"]["content_hash"] == r1["version"]["content_hash"]
    r3 = client.post("/api/saved", json={"id": sid, "name": "P", "payload": _payload(0.15)}).json()
    assert r3["version"]["created"] is True                        # 内容变 → 新版本

    pu = r1["version"]["project_uuid"]
    assert pu == store.legacy_project_uuid(sid)
    projs = client.get("/api/projects").json()
    assert any(p["uuid"] == pu and p["versions"] == 2 for p in projs)
    vs = client.get(f"/api/projects/{pu}/versions").json()
    assert [v["origin"] for v in vs] == ["save", "save"]
    one = client.get(f"/api/projects/{pu}/versions/{vs[0]['id']}?include_doc=true").json()
    assert one["document"]["schema_version"] == "1.0"
    audit = client.get(f"/api/projects/{pu}/audit").json()
    assert {"project.create", "version.create"} <= {a["action"] for a in audit}


def test_saved_get_carries_stable_project_uuid(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "_DIR", str(tmp_path / "saved"))
    r = client.post("/api/saved", json={"name": "P", "payload": _payload()}).json()
    rec = client.get(f"/api/saved/{r['id']}").json()
    # 前端报告钉扎/案例查询依赖:读档响应附带与双写一致的项目 UUID
    assert rec["project_uuid"] == store.legacy_project_uuid(r["id"])
    assert rec["project_uuid"] == r["version"]["project_uuid"]


def test_saved_non_v2_payload_keeps_legacy_behavior(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "_DIR", str(tmp_path / "saved"))
    r = client.post("/api/saved", json={"name": "旧", "payload": {"etModel": {"a": 1}, "fts": {}}})
    assert r.status_code == 200
    assert "version" not in r.json()                               # 双写静默跳过,旧契约不变


def _report_req():
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
        "samples": 50, "seed": 1,
    }


def test_report_auto_pin_case_and_footer(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "_DIR", str(tmp_path / "saved"))
    puuid = "5d3f0a90-0000-5000-8000-1234567890ab"
    payload = _payload()
    req = {**_report_req(), "project_uuid": puuid, "project_payload": payload}
    r = client.post("/api/report?format=csv", json=req)
    assert r.status_code == 200
    body = r.content.decode("utf-8")

    cases = client.get(f"/api/projects/{puuid}/cases").json()
    assert len(cases) == 1 and cases[0]["kind"] == "report"
    case = cases[0]
    # 验收:case 钉扎的版本哈希 == 当前文档哈希
    doc, _ = to_canonical(payload, puuid)
    vs = client.get(f"/api/projects/{puuid}/versions").json()
    v = next(x for x in vs if x["id"] == case["version_id"])
    assert v["origin"] == "auto_pin"
    assert v["content_hash"] == content_hash(doc)
    # 页脚证据链:案例 # + 版本短哈希 + 引擎版本
    assert f"分析案例 #{case['id']}" in body
    assert v["content_hash"][:8] in body
    assert store.engine_version() in body
    # 事后 artifacts:格式 + 文件名 + 报告体哈希
    arts = json.loads(case["artifacts_json"]) if isinstance(case["artifacts_json"], str) else case["artifacts_json"]
    assert arts == {} or arts.get("format") == "csv"               # 列表读取的是创建时快照
    one = client.get(f"/api/projects/{puuid}/cases").json()[0]
    arts2 = json.loads(one["artifacts_json"])
    assert arts2["format"] == "csv" and len(arts2["sha256"]) == 64
    # 审计含 report.export
    audit = client.get(f"/api/projects/{puuid}/audit").json()
    assert "report.export" in {a["action"] for a in audit}


def test_report_without_project_context_unchanged(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "_DIR", str(tmp_path / "saved"))
    r = client.post("/api/report?format=csv", json=_report_req())
    assert r.status_code == 200
    assert "分析案例" not in r.content.decode("utf-8")             # 无钉扎无页脚
