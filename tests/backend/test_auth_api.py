"""Phase 5 auth B2 — login/logout/me 端点 + 会话身份贯通(规格 §4.3/§4.4)。

关键场景:server 模式下,带会话 cookie 的请求所产生的审计行 actor = 认证身份
(证据链的"谁");off 模式一切照旧(约束 #0)。
"""
import getpass

from fastapi.testclient import TestClient

from backend import store
from backend.app import app
from backend.canonical import to_canonical

PUUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301"


def _client() -> TestClient:
    return TestClient(app)         # 每测试新建:cookie 不跨测试泄漏


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


# ── off 模式(默认):认证端点不干扰,单用户即全权 ──

def test_off_mode_login_501_me_reports_os_user(monkeypatch):
    monkeypatch.delenv("PSA_AUTH", raising=False)
    c = _client()
    assert c.post("/api/auth/login", json={"username": "x", "password": "y"}).status_code == 501
    assert c.post("/api/auth/logout").status_code == 501
    me = c.get("/api/auth/me")
    assert me.status_code == 200
    body = me.json()
    assert body["mode"] == "off" and body["role"] == "admin"
    assert body["username"] == getpass.getuser()


def test_off_mode_actor_is_os_user(monkeypatch):
    """约束 #0 回归:off 模式审计 actor 逐位保持 OS 用户格式。"""
    monkeypatch.delenv("PSA_AUTH", raising=False)
    store.ensure_project(PUUID, "P")
    entry = store.list_audit(PUUID)[-1]
    assert entry["actor"] == f"{getpass.getuser()}@bess-psa/{store.engine_version()}"


# ── local 模式:登录墙 + 会话 ──

def test_login_success_sets_httponly_lax_cookie(monkeypatch):
    monkeypatch.setenv("PSA_AUTH", "local")
    store.create_account("wang", "review-pw-1", "reviewer", display_name="王雪梅")
    c = _client()
    r = c.post("/api/auth/login", json={"username": "wang", "password": "review-pw-1"})
    assert r.status_code == 200
    assert r.json() == {"mode": "local", "username": "wang", "role": "reviewer",
                        "display_name": "王雪梅"}
    sc = r.headers["set-cookie"]
    assert "psa_session=" in sc and "HttpOnly" in sc and "SameSite=lax" in sc.replace("Lax", "lax")
    me = c.get("/api/auth/me")
    assert me.status_code == 200 and me.json()["username"] == "wang"


def test_login_failures_uniform_401_and_audited(monkeypatch):
    monkeypatch.setenv("PSA_AUTH", "local")
    store.create_account("wang", "review-pw-1", "reviewer")
    store.create_account("gone", "leaver-pw-1", "analyst")
    store.set_account_disabled("gone", True)
    c = _client()
    for u, p in (("wang", "wrong"), ("ghost", "x"), ("gone", "leaver-pw-1")):
        r = c.post("/api/auth/login", json={"username": u, "password": p})
        assert r.status_code == 401
        assert r.json()["detail"] == "用户名或口令错误"          # 三种失败不可区分
    with store._conn() as cx:
        n = cx.execute("SELECT COUNT(*) c FROM audit_log WHERE action='auth.login_failed'"
                       ).fetchone()["c"]
    assert n == 3


def test_me_unauthenticated_401_and_logout_invalidates(monkeypatch):
    monkeypatch.setenv("PSA_AUTH", "local")
    store.create_account("wang", "review-pw-1", "reviewer")
    c = _client()
    assert c.get("/api/auth/me").status_code == 401
    c.post("/api/auth/login", json={"username": "wang", "password": "review-pw-1"})
    assert c.get("/api/auth/me").status_code == 200
    c.post("/api/auth/logout")
    assert c.get("/api/auth/me").status_code == 401
    with store._conn() as cx:
        acts = [r["action"] for r in cx.execute("SELECT action FROM audit_log").fetchall()]
    assert "auth.login" in acts and "auth.logout" in acts


def test_session_identity_flows_into_audit_actor(monkeypatch):
    """证据链核心:带会话 cookie 的评审动作,审计 actor = 认证身份而非 OS 用户。
    用 admin(兼具送审+签发权,B3 后 submit=analyst+ / sign=reviewer+)以单一身份贯穿。"""
    monkeypatch.setenv("PSA_AUTH", "local")
    store.create_account("wang", "review-pw-1", "admin", display_name="王雪梅")
    store.ensure_project(PUUID, "P")
    v = store.create_version(PUUID, *to_canonical(_payload(), PUUID))
    c = _client()
    c.post("/api/auth/login", json={"username": "wang", "password": "review-pw-1"})
    assert c.post(f"/api/projects/{PUUID}/reviews",
                  json={"version_id": v["id"], "note": "送审"}).status_code == 200
    # server 模式签发需口令复核(B3)
    assert c.post(f"/api/projects/{PUUID}/reviews/{v['id']}/sign",
                  json={"note": "同意", "password": "review-pw-1"}).status_code == 200
    audit = {e["action"]: e["actor"] for e in store.list_audit(PUUID)}
    expected = f"wang@bess-psa/{store.engine_version()}"
    assert audit["review.submit"] == expected
    assert audit["review.sign"] == expected                     # 签发人身份进只增审计
    # 签发状态本身也带身份(报告页脚同源)
    assert store.review_for_version(PUUID, v["id"])["decided_by"] == expected


def test_forged_or_stale_cookie_is_anonymous(monkeypatch):
    monkeypatch.setenv("PSA_AUTH", "local")
    c = _client()
    c.cookies.set("psa_session", "forged-token-value")
    assert c.get("/api/auth/me").status_code == 401


def test_audit_rows_carry_auth_mode_marker(monkeypatch):
    """domain-review finding-1:同一追踪链里 OS 用户行与认证账户行必须可区分 ——
    每行审计 details 携带 auth: off|local 标记(增量注入,off 模式 actor 逐位不变)。"""
    import json
    monkeypatch.delenv("PSA_AUTH", raising=False)
    store.ensure_project(PUUID, "P")
    off_row = store.list_audit(PUUID)[-1]
    assert json.loads(off_row["details_json"])["auth"] == "off"

    monkeypatch.setenv("PSA_AUTH", "local")
    store.create_account("wang", "review-pw-1", "analyst")     # 送审 = analyst+
    v = store.create_version(PUUID, *to_canonical(_payload(), PUUID))
    c = _client()
    c.post("/api/auth/login", json={"username": "wang", "password": "review-pw-1"})
    c.post(f"/api/projects/{PUUID}/reviews", json={"version_id": v["id"]})
    submit_row = next(e for e in store.list_audit(PUUID) if e["action"] == "review.submit")
    assert json.loads(submit_row["details_json"])["auth"] == "local"


def test_signed_review_row_cannot_be_deleted(monkeypatch):
    """domain-review finding-7:签发行禁删(对称硬化)—— 审计行本就只增,评审行补齐。"""
    import sqlite3 as _sq
    import pytest as _pytest
    store.ensure_project(PUUID, "P")
    v = store.create_version(PUUID, *to_canonical(_payload(), PUUID))
    store.submit_review(PUUID, v["id"])
    store.sign_review(PUUID, v["id"])
    with store._conn() as cx, _pytest.raises(_sq.DatabaseError, match="final"):
        cx.execute("DELETE FROM reviews WHERE project_uuid=?", (PUUID,))


def test_disabled_account_sessions_revoked(monkeypatch):
    monkeypatch.setenv("PSA_AUTH", "local")
    store.create_account("wang", "review-pw-1", "reviewer")
    c = _client()
    c.post("/api/auth/login", json={"username": "wang", "password": "review-pw-1"})
    assert c.get("/api/auth/me").status_code == 200
    store.set_account_disabled("wang", True)                    # 停用即撤销在途会话
    assert c.get("/api/auth/me").status_code == 401
