"""EB-06 / 修复包 O2:local 模式私有读接口守卫 + 删除角色门;off 模式零摩擦不回退。

裁定见 docs/reviews/2026-07-16-3rd-party-review-adjudication.md §3 O2。

威胁模型(TD-001 §5.1 亦述):
- off 模式 = 离线单机零信任边界(单用户即全权,约束 #0)——守卫透明放行,CORS 维持 "*"。
- local 模式 = 认证边界:未登录不得读私有项目/存档/组合总览/AI 草案;删除需 analyst+。
  修前(review 复现):local 模式未认证 GET /api/projects|/api/portfolio|/api/saved|
  /api/ai/drafts 均 200;本机恶意页可读删。本文件锁上该缺口,并锁 off 模式不回退。
"""
from fastapi.testclient import TestClient

from backend import store
from backend.app import app

# local 模式认证矩阵复用 auth_guards 同款种子/登录法
PRIVATE_READS = [
    "/api/saved",
    "/api/projects",
    "/api/portfolio",
    "/api/ai/drafts",
]


def _seed_roles():
    store.create_account("ann", "analyst-pw-1", "analyst", display_name="安分析")
    store.create_account("rex", "review-pw-1", "reviewer", display_name="任评审")


def _login(c, user, pw):
    assert c.post("/api/auth/login", json={"username": user, "password": pw}).status_code == 200


# ── off 模式:私有读放行(约束 #0 不回退)──────────────────────────────────────
def test_off_mode_private_reads_open(monkeypatch):
    monkeypatch.delenv("PSA_AUTH", raising=False)
    c = TestClient(app)
    for path in PRIVATE_READS:
        assert c.get(path).status_code == 200, path


def test_off_mode_delete_open(monkeypatch, tmp_path):
    monkeypatch.delenv("PSA_AUTH", raising=False)
    import backend.storage as storage
    monkeypatch.setattr(storage, "_DIR", str(tmp_path / "saved"))
    c = TestClient(app)
    rec = c.post("/api/saved", json={"name": "P", "payload": {"v": 2, "etas": []}}).json()
    assert c.delete(f"/api/saved/{rec['id']}").status_code == 200


# ── local 模式:未认证读私有 → 401 ────────────────────────────────────────────
def test_local_mode_unauthenticated_private_reads_401(monkeypatch):
    monkeypatch.setenv("PSA_AUTH", "local")
    _seed_roles()
    c = TestClient(app)                                # 无登录
    for path in PRIVATE_READS:
        assert c.get(path).status_code == 401, path


# ── local 模式:认证后读私有 → 200 ────────────────────────────────────────────
def test_local_mode_authenticated_private_reads_200(monkeypatch):
    monkeypatch.setenv("PSA_AUTH", "local")
    _seed_roles()
    c = TestClient(app); _login(c, "ann", "analyst-pw-1")
    for path in PRIVATE_READS:
        assert c.get(path).status_code == 200, path


# ── local 模式:公共参考读仍放行(不误伤演示/参考面)──────────────────────────
def test_local_mode_public_reads_still_open(monkeypatch):
    monkeypatch.setenv("PSA_AUTH", "local")
    _seed_roles()
    c = TestClient(app)                                # 无登录
    for path in ("/api/examples", "/api/bess/scenarios", "/api/bess/library"):
        assert c.get(path).status_code == 200, path


# ── local 模式:未认证删除 → 401;越权(reviewer)删除 → 403;analyst → 200 ──────
def test_local_mode_delete_requires_analyst(monkeypatch, tmp_path):
    monkeypatch.setenv("PSA_AUTH", "local")
    import backend.storage as storage
    monkeypatch.setattr(storage, "_DIR", str(tmp_path / "saved"))
    _seed_roles()
    # analyst 建一个存档(供删除用)
    ca = TestClient(app); _login(ca, "ann", "analyst-pw-1")
    rec = ca.post("/api/saved", json={"name": "P", "payload": {"v": 2, "etas": []}}).json()
    sid = rec["id"]
    # 未认证删除 → 401
    assert TestClient(app).delete(f"/api/saved/{sid}").status_code == 401
    # reviewer 越权删除 → 403
    cr = TestClient(app); _login(cr, "rex", "review-pw-1")
    assert cr.delete(f"/api/saved/{sid}").status_code == 403
    # analyst 删除 → 200
    assert ca.delete(f"/api/saved/{sid}").status_code == 200


# ── off 模式 CORS 维持 "*"(约束 #0):跨源预检反射 ────────────────────────────
def test_off_mode_cors_wildcard_preserved(monkeypatch):
    monkeypatch.delenv("PSA_AUTH", raising=False)
    c = TestClient(app)
    r = c.options("/api/saved", headers={"Origin": "https://evil.example",
                                         "Access-Control-Request-Method": "GET"})
    # off 模式 allow_origins=["*"];预检应带 ACAO(不因守卫改动而变)
    assert "access-control-allow-origin" in {k.lower() for k in r.headers}
