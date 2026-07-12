"""Phase 5 review/sign-off API — spec §3 status-code matrix + charset."""
from fastapi.testclient import TestClient

from backend import store
from backend.app import app
from backend.canonical import to_canonical

client = TestClient(app)

PUUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301"


def _payload(fail=0.1):
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


def _two_versions():
    store.ensure_project(PUUID, "P")
    v1 = store.create_version(PUUID, *to_canonical(_payload(0.1), PUUID))
    v2 = store.create_version(PUUID, *to_canonical(_payload(0.2), PUUID))
    return v1, v2


def test_review_lifecycle_over_http():
    v1, _ = _two_versions()
    r = client.post(f"/api/projects/{PUUID}/reviews",
                    json={"version_id": v1["id"], "note": "Rev 12 送审"})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/json")
    assert "charset=utf-8" in r.headers["content-type"]
    body = r.json()
    assert body["state"] == "in_review" and body["content_hash"] == v1["content_hash"]

    lst = client.get(f"/api/projects/{PUUID}/reviews").json()
    assert len(lst) == 1 and lst[0]["version_id"] == v1["id"]

    s = client.post(f"/api/projects/{PUUID}/reviews/{v1['id']}/sign", json={"note": "同意"})
    assert s.status_code == 200 and s.json()["state"] == "signed"
    assert s.json()["decided_by"]


def test_conflict_and_validation_codes():
    v1, v2 = _two_versions()
    assert client.post(f"/api/projects/{PUUID}/reviews", json={"version_id": v1["id"]}).status_code == 200
    # 双送审 → 409(单项目一个在审)
    r = client.post(f"/api/projects/{PUUID}/reviews", json={"version_id": v2["id"]})
    assert r.status_code == 409 and "送审" in r.json()["detail"]
    # 重复送审同版本 → 409
    assert client.post(f"/api/projects/{PUUID}/reviews", json={"version_id": v1["id"]}).status_code == 409
    # 幽灵版本 → 400
    assert client.post(f"/api/projects/{PUUID}/reviews", json={"version_id": 99999}).status_code == 400
    # 非送审中签发/退回 → 409
    assert client.post(f"/api/projects/{PUUID}/reviews/{v2['id']}/sign", json={}).status_code == 409
    assert client.post(f"/api/projects/{PUUID}/reviews/{v2['id']}/return",
                       json={"note": "n"}).status_code == 409
    # 退回缺 note → 422
    assert client.post(f"/api/projects/{PUUID}/reviews/{v1['id']}/return",
                       json={"note": "  "}).status_code == 422
    # 退回 → 200;签发已签发版 → 409;已签发再送审 → 409
    assert client.post(f"/api/projects/{PUUID}/reviews/{v1['id']}/return",
                       json={"note": "补依据"}).status_code == 200
    assert client.post(f"/api/projects/{PUUID}/reviews", json={"version_id": v1["id"]}).status_code == 200
    assert client.post(f"/api/projects/{PUUID}/reviews/{v1['id']}/sign", json={}).status_code == 200
    assert client.post(f"/api/projects/{PUUID}/reviews", json={"version_id": v1["id"]}).status_code == 409


def test_version_comments_endpoints():
    v1, _ = _two_versions()
    r = client.post(f"/api/projects/{PUUID}/versions/{v1['id']}/comments",
                    json={"body": "α₂ 上调的检验记录编号?"})
    assert r.status_code == 200 and r.json()["body"].startswith("α₂")
    lst = client.get(f"/api/projects/{PUUID}/versions/{v1['id']}/comments")
    assert lst.status_code == 200 and len(lst.json()) == 1
    assert lst.json()[0]["author"]
    # 空评论 → 422;幽灵版本 → 400
    assert client.post(f"/api/projects/{PUUID}/versions/{v1['id']}/comments",
                       json={"body": " "}).status_code == 422
    assert client.post(f"/api/projects/{PUUID}/versions/99999/comments",
                       json={"body": "x"}).status_code == 400
