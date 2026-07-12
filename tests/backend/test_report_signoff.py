"""Phase 5 export gate — spec §4.

The gate IS content-address idempotency: exporting the exact signed content
auto-pins onto the same version (signed → sign-off footer line); any edit
produces a new hash/version with no review row (→ working-copy mark).
"""
import json

from fastapi.testclient import TestClient

from backend.app import app

client = TestClient(app)

PUUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301"


def _v2_payload(fail=0.1):
    return {"v": 2,
            "etas": [{"key": "t", "name": "T",
                      "model": {"initEvent": "IE", "initFreq": 0.001,
                                "functionalEvents": [{"id": "FE1", "failProb": fail}],
                                "root": {"kind": "branch", "feId": "FE1",
                                         "success": {"kind": "leaf", "consequence": "C1"},
                                         "failure": {"kind": "leaf", "consequence": "C2"}}},
                      "fts": {"model_data": {"parameters": []}, "fault_trees": []},
                      "pfds": {}}],
            "activeKey": "t", "checkedKeys": {"t": True}}


def _report_req(fail=0.1):
    return {
        "init_event": "IE", "init_frequency": 0.001,
        "functional_events": [{"id": "FE1", "pfd": fail}],
        "fault_trees": {}, "parameters": {},
        "sequences": [
            {"path": {"FE1": "success"}, "end_state": "L0"},
            {"path": {"FE1": "failure"}, "end_state": "L1"},
        ],
        "consequence_bins": {"L0": "C1", "L1": "C2"},
        "scenario_name": "签发门测试", "samples": 40,
        "project_uuid": PUUID, "project_payload": _v2_payload(fail),
    }


def _csv(fail=0.1) -> str:
    r = client.post("/api/report?format=csv", json=_report_req(fail))
    assert r.status_code == 200
    return r.content.decode("utf-8")


def test_gate_working_copy_then_signed_then_edited():
    # ① 未签发导出 → 首行工作稿标识 + 页脚「工作稿(未经签发)」
    body1 = _csv(0.1)
    assert body1.splitlines()[0].lstrip("﻿").startswith("# 工作稿")
    assert "工作稿(未经签发)" in body1 and "· 签发 " not in body1

    # ② 签发 auto-pin 产生的版本
    vid = client.get(f"/api/projects/{PUUID}/versions").json()[-1]["id"]
    assert client.post(f"/api/projects/{PUUID}/reviews",
                       json={"version_id": vid}).status_code == 200
    assert client.post(f"/api/projects/{PUUID}/reviews/{vid}/sign",
                       json={"note": "同意签发"}).status_code == 200

    # ③ 同内容再导出 → 幂等命中签发版 → 签发行,无任何工作稿标识
    body2 = _csv(0.1)
    assert "· 签发 " in body2 and "工作稿" not in body2
    cases = client.get(f"/api/projects/{PUUID}/cases").json()
    assert json.loads(cases[0]["artifacts_json"])["signed"] is True

    # ④ 改一个 PFD → 新哈希新版本 → 回到工作稿(门 = 内容寻址,零冻结机制)
    body3 = _csv(0.15)
    assert "工作稿(未经签发)" in body3 and "· 签发 " not in body3
    cases = client.get(f"/api/projects/{PUUID}/cases").json()
    assert json.loads(cases[0]["artifacts_json"])["signed"] is False
    # 签发版本台账仍在:两个版本,签发状态只挂在旧哈希上
    assert len(client.get(f"/api/projects/{PUUID}/versions").json()) == 2
    reviews = client.get(f"/api/projects/{PUUID}/reviews").json()
    assert len(reviews) == 1 and reviews[0]["state"] == "signed"


def test_docx_pdf_render_with_and_without_signoff():
    for fmt, magic in (("docx", b"PK\x03\x04"), ("pdf", b"%PDF")):
        r = client.post(f"/api/report?format={fmt}", json=_report_req(0.1))
        assert r.status_code == 200 and r.content[:4] == magic
    vid = client.get(f"/api/projects/{PUUID}/versions").json()[-1]["id"]
    client.post(f"/api/projects/{PUUID}/reviews", json={"version_id": vid})
    client.post(f"/api/projects/{PUUID}/reviews/{vid}/sign", json={})
    for fmt, magic in (("docx", b"PK\x03\x04"), ("pdf", b"%PDF")):
        r = client.post(f"/api/report?format={fmt}", json=_report_req(0.1))
        assert r.status_code == 200 and r.content[:4] == magic
