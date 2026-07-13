"""Phase 5 auth B3 — 三角色路由守卫 + 签发口令复核 + 乐观并发 409(规格 §5)。

约束 #0:off 模式守卫全放行(现有 py 测试即证)。本文件全部在 local 模式跑角色矩阵。
"""
import json

from fastapi.testclient import TestClient

from backend import store
from backend.app import app
from backend.canonical import to_canonical

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


def _seed_roles():
    store.create_account("ann", "analyst-pw-1", "analyst", display_name="安分析")
    store.create_account("rex", "review-pw-1", "reviewer", display_name="任评审")
    store.create_account("adm", "admin-pw-11", "admin")


def _login(c, user, pw):
    assert c.post("/api/auth/login", json={"username": user, "password": pw}).status_code == 200


def _version():
    store.ensure_project(PUUID, "P")
    return store.create_version(PUUID, *to_canonical(_payload(), PUUID))


# ── off 模式:守卫透明放行(约束 #0)──

def test_off_mode_all_endpoints_open(monkeypatch):
    monkeypatch.delenv("PSA_AUTH", raising=False)
    c = TestClient(app)
    v = _version()
    assert c.post(f"/api/projects/{PUUID}/reviews", json={"version_id": v["id"]}).status_code == 200
    # off 模式签发无需口令
    assert c.post(f"/api/projects/{PUUID}/reviews/{v['id']}/sign", json={}).status_code == 200


# ── local 模式角色矩阵 ──

def test_analyst_cannot_sign_reviewer_can(monkeypatch):
    monkeypatch.setenv("PSA_AUTH", "local")
    _seed_roles()
    v = _version()
    ca = TestClient(app); _login(ca, "ann", "analyst-pw-1")
    assert ca.post(f"/api/projects/{PUUID}/reviews", json={"version_id": v["id"]}).status_code == 200
    # analyst 送审 OK,但签发 → 403
    assert ca.post(f"/api/projects/{PUUID}/reviews/{v['id']}/sign",
                   json={"password": "analyst-pw-1"}).status_code == 403
    cr = TestClient(app); _login(cr, "rex", "review-pw-1")
    assert cr.post(f"/api/projects/{PUUID}/reviews/{v['id']}/sign",
                   json={"password": "review-pw-1"}).status_code == 200


def test_reviewer_cannot_run_analysis(monkeypatch):
    monkeypatch.setenv("PSA_AUTH", "local")
    _seed_roles()
    cr = TestClient(app); _login(cr, "rex", "review-pw-1")
    # 评审人不可建模/量化/导报告/存档
    assert cr.post("/api/quantify", json={"model": {}, "fault_tree": None}).status_code == 403
    assert cr.post("/api/saved", json={"name": "x", "payload": {}}).status_code == 403
    ca = TestClient(app); _login(ca, "ann", "analyst-pw-1")
    assert ca.post("/api/saved", json={"name": "x", "payload": {"v": 2}}).status_code == 200


def test_reviewer_can_comment(monkeypatch):
    monkeypatch.setenv("PSA_AUTH", "local")
    _seed_roles()
    v = _version()
    cr = TestClient(app); _login(cr, "rex", "review-pw-1")
    assert cr.post(f"/api/projects/{PUUID}/versions/{v['id']}/comments",
                   json={"body": "依据请补充测试温度范围"}).status_code == 200


def test_account_management_admin_only(monkeypatch):
    monkeypatch.setenv("PSA_AUTH", "local")
    _seed_roles()
    ca = TestClient(app); _login(ca, "ann", "analyst-pw-1")
    assert ca.get("/api/admin/accounts").status_code == 403
    cadm = TestClient(app); _login(cadm, "adm", "admin-pw-11")
    assert cadm.get("/api/admin/accounts").status_code == 200
    r = cadm.post("/api/admin/accounts",
                  json={"username": "newbie", "password": "newpw-123", "role": "analyst"})
    assert r.status_code == 200 and r.json()["username"] == "newbie"
    assert cadm.post("/api/admin/accounts/newbie/disable").status_code == 200


def test_unauthenticated_gets_401(monkeypatch):
    monkeypatch.setenv("PSA_AUTH", "local")
    _seed_roles()
    c = TestClient(app)                            # 无登录
    v = _version()
    assert c.post(f"/api/projects/{PUUID}/reviews", json={"version_id": v["id"]}).status_code == 401
    assert c.post("/api/saved", json={"name": "x", "payload": {}}).status_code == 401
    assert c.get("/api/admin/accounts").status_code == 401


def test_sign_password_recheck(monkeypatch):
    monkeypatch.setenv("PSA_AUTH", "local")
    _seed_roles()
    v = _version()
    ca = TestClient(app); _login(ca, "ann", "analyst-pw-1")
    ca.post(f"/api/projects/{PUUID}/reviews", json={"version_id": v["id"]})
    cr = TestClient(app); _login(cr, "rex", "review-pw-1")
    # 缺口令 → 403;错口令 → 403;对口令 → 200
    assert cr.post(f"/api/projects/{PUUID}/reviews/{v['id']}/sign", json={}).status_code == 403
    assert cr.post(f"/api/projects/{PUUID}/reviews/{v['id']}/sign",
                   json={"password": "wrong"}).status_code == 403
    assert cr.post(f"/api/projects/{PUUID}/reviews/{v['id']}/sign",
                   json={"password": "review-pw-1"}).status_code == 200


def test_sign_audit_snapshots_role(monkeypatch):
    """domain-review finding-3:签发审计快照角色(授权依据不依赖可变 accounts 表)。"""
    monkeypatch.setenv("PSA_AUTH", "local")
    _seed_roles()
    v = _version()
    ca = TestClient(app); _login(ca, "ann", "analyst-pw-1")
    ca.post(f"/api/projects/{PUUID}/reviews", json={"version_id": v["id"]})
    cr = TestClient(app); _login(cr, "rex", "review-pw-1")
    cr.post(f"/api/projects/{PUUID}/reviews/{v['id']}/sign", json={"password": "review-pw-1"})
    sign_row = next(e for e in store.list_audit(PUUID) if e["action"] == "review.sign")
    assert json.loads(sign_row["details_json"])["role"] == "reviewer"


# ── 乐观并发 409(D-P5-4)──

def test_optimistic_conflict_409(monkeypatch, tmp_path):
    monkeypatch.delenv("PSA_AUTH", raising=False)     # off 模式也走冲突检测(与认证解耦)
    import backend.storage as storage
    monkeypatch.setattr(storage, "_DIR", str(tmp_path / "saved"))
    c = TestClient(app)
    # 首存(无 base)→ 建版本
    r1 = c.post("/api/saved", json={"name": "P", "payload": _payload(0.1)}).json()
    sid = r1["id"]
    h1 = r1["version"]["content_hash"]
    # 另一客户端改内容保存(推进版本)
    c.post("/api/saved", json={"id": sid, "name": "P", "payload": _payload(0.2)})
    # 原客户端带旧 base 保存 → 409
    r3 = c.post("/api/saved", json={"id": sid, "name": "P", "payload": _payload(0.15),
                                    "base_version_hash": h1})
    assert r3.status_code == 409
    detail = r3.json()["detail"]
    assert detail["base_hash"] == h1 and detail["server_hash"] != h1
    # 不带 base → 正常(现行为,约束 #0)
    assert c.post("/api/saved", json={"id": sid, "name": "P", "payload": _payload(0.3)}).status_code == 200
