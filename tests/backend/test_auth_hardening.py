"""B1 认证加固补测(2026-07-22)—— 冒烟覆盖度批评家清单 A–G 的系统性收口。

冒烟(2026-07-21,隔离实例五维度)验证了主干;本模块补齐批评家点名的漏测面:
A reviewer 拒绝轴 · B admin 语义 · C 账户停用生命周期(含新增的末位 admin 锁死防护)·
D 评审状态机未走转移 · E 评论面 · F 建账户校验 · G off 模式 501 / 401 扫掠 /
会话 TTL·滑动续期·token 哈希 · H 导出钉扎一致性 409。

设计裁决记录(非缺陷,断言现状 + 留痕):
- B1 自审自批:admin ∈ ANALYST ∩ REVIEWER,可对同一版本自行送审+签发。规格未做
  职责分离约束;是否需要「送审人 ≠ 签发人」属监管口径决策,留给用户裁定(见对应测试注释)。
- 多会话并存:create_session 每登录插新行、不清旧会话 —— 同账户多端并行是设计。
- 无 base 覆盖:省略 base_version_hash 即显式覆盖语义(前端冲突对话「确认覆盖」按钮
  即走此路),CAS 仅保护"带基线"的乐观保存 —— 设计如此,非绕过漏洞。
"""
from __future__ import annotations

import hashlib

import pytest
from fastapi.testclient import TestClient

from backend import store
from backend.app import app
from backend.auth.passwords import MIN_PASSWORD_LEN
from backend.canonical import to_canonical

PW = "hardening-pw-1"
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


@pytest.fixture()
def local(monkeypatch):
    """local 模式 + 三角色种子账户;返回按角色登录好的 TestClient 工厂。"""
    monkeypatch.setenv("PSA_AUTH", "local")
    store.create_account("ann", PW, "analyst", display_name="安分析")
    store.create_account("rex", PW, "reviewer", display_name="任评审")
    store.create_account("adm", PW, "admin")

    def login(user: str) -> TestClient:
        c = TestClient(app)
        r = c.post("/api/auth/login", json={"username": user, "password": PW})
        assert r.status_code == 200, r.text
        return c
    return login


def _version(fail=0.1):
    store.ensure_project(PUUID, "P")
    return store.create_version(PUUID, *to_canonical(_payload(fail), PUUID))


# ══ A. reviewer 拒绝轴(ANALYST 集不含 reviewer)══

def test_reviewer_rejected_on_analyst_endpoints(local):
    ann, rex = local("ann"), local("rex")
    r = ann.post("/api/saved", json={"name": "冒烟SMK-A", "payload": _payload()})
    assert r.status_code == 200
    sid = r.json()["id"]

    assert rex.post("/api/saved", json={"name": "x", "payload": _payload()}).status_code == 403
    assert rex.delete(f"/api/saved/{sid}").status_code == 403
    v = _version()
    assert rex.post(f"/api/projects/{PUUID}/reviews",
                    json={"version_id": v["id"]}).status_code == 403
    assert rex.post("/api/report?format=csv", json={
        "init_event": "IE", "init_frequency": 0.001,
        "functional_events": [{"id": "FE1", "pfd": 0.1}],
        "fault_trees": {}, "parameters": {},
        "sequences": [{"path": {"FE1": "success"}, "end_state": "L0"},
                      {"path": {"FE1": "failure"}, "end_state": "L1"}],
        "consequence_bins": {"L0": "C1", "L1": "C2"}, "samples": 40,
    }).status_code == 403
    assert rex.post("/api/quantify", json={"model": {}, "fault_tree": "T"}).status_code == 403


def test_delete_saved_full_matrix(local):
    ann = local("ann")
    sid = ann.post("/api/saved", json={"name": "冒烟SMK-del", "payload": _payload()}).json()["id"]
    assert TestClient(app).delete(f"/api/saved/{sid}").status_code == 401   # 未登录
    assert ann.delete(f"/api/saved/{sid}").status_code == 200              # 属权者角色实删
    assert all(s["id"] != sid for s in ann.get("/api/saved").json())


# ══ B. admin 语义 ══

def test_admin_sign_password_recheck_and_self_review(local):
    adm = local("adm")
    v = _version()
    assert adm.post(f"/api/projects/{PUUID}/reviews",
                    json={"version_id": v["id"]}).status_code == 200
    # B2:admin 签发同样强制口令复核
    assert adm.post(f"/api/projects/{PUUID}/reviews/{v['id']}/sign",
                    json={"note": "x"}).status_code == 403
    assert adm.post(f"/api/projects/{PUUID}/reviews/{v['id']}/sign",
                    json={"note": "x", "password": "wrong-pw-123"}).status_code == 403
    # B1(设计裁决记录):admin 自审自批当前被允许 —— 若监管口径要求送审人≠签发人,
    # 需另立规格加职责分离约束;此断言锁定现状,改动时必须显式过此测试。
    assert adm.post(f"/api/projects/{PUUID}/reviews/{v['id']}/sign",
                    json={"note": "x", "password": PW}).status_code == 200


# ══ C. 账户停用生命周期 ══

def test_disable_revokes_live_session_immediately(local):
    ann, adm = local("ann"), local("adm")
    assert ann.get("/api/saved").status_code == 200
    assert adm.post("/api/admin/accounts/ann/disable").status_code == 200
    assert ann.get("/api/saved").status_code == 401       # 在途会话立刻失效(停用即撤)


def test_disabled_login_indistinguishable_and_reenable(local):
    adm = local("adm")
    adm.post("/api/admin/accounts/ann/disable")
    c = TestClient(app)
    r_disabled = c.post("/api/auth/login", json={"username": "ann", "password": PW})
    r_wrongpw = c.post("/api/auth/login", json={"username": "rex", "password": "bad-pw-123"})
    assert r_disabled.status_code == r_wrongpw.status_code == 401
    assert r_disabled.json() == r_wrongpw.json()          # 停用与错口令响应逐字节相同(枚举防御)
    assert adm.post("/api/admin/accounts/ann/disable?disabled=false").status_code == 200
    assert c.post("/api/auth/login",
                  json={"username": "ann", "password": PW}).status_code == 200


def test_cannot_disable_last_enabled_admin(local):
    """C5(本轮新增防护):停用最后一个启用的 admin = 系统锁死(无人能再管账户)。"""
    adm = local("adm")
    r = adm.post("/api/admin/accounts/adm/disable")
    assert r.status_code == 409
    assert "最后一个" in r.json()["detail"]
    # 有第二个 admin 后,停用第一个合法;此后停用仅剩者再被拒
    adm.post("/api/admin/accounts",
             json={"username": "adm2", "password": PW, "role": "admin"})
    assert adm.post("/api/admin/accounts/adm2/disable").status_code == 200   # 非末位可停
    assert adm.post("/api/admin/accounts/adm/disable").status_code == 409    # 又成末位
    assert adm.post("/api/admin/accounts/{u}/disable".format(u="ghost")).status_code == 404


# ══ D. 评审状态机未走转移 ══

def test_returned_resubmit_roundtrip(local):
    ann, rex = local("ann"), local("rex")
    v = _version()
    assert ann.post(f"/api/projects/{PUUID}/reviews",
                    json={"version_id": v["id"]}).status_code == 200
    assert rex.post(f"/api/projects/{PUUID}/reviews/{v['id']}/return",
                    json={"note": "补引用"}).status_code == 200
    # D1:returned → 重新送审回转同一行
    assert ann.post(f"/api/projects/{PUUID}/reviews",
                    json={"version_id": v["id"]}).status_code == 200
    rows = ann.get(f"/api/projects/{PUUID}/reviews").json()
    assert len(rows) == 1 and rows[0]["state"] == "in_review"


def test_illegal_transitions_all_rejected(local):
    ann, rex = local("ann"), local("rex")
    v1 = _version(0.1)
    # D5:草稿(无评审行)直接签发/退回 → 409
    assert rex.post(f"/api/projects/{PUUID}/reviews/{v1['id']}/sign",
                    json={"password": PW}).status_code == 409
    assert rex.post(f"/api/projects/{PUUID}/reviews/{v1['id']}/return",
                    json={"note": "x"}).status_code == 409
    assert ann.post(f"/api/projects/{PUUID}/reviews",
                    json={"version_id": v1["id"]}).status_code == 200
    # D3:重复送审 → 409
    assert ann.post(f"/api/projects/{PUUID}/reviews",
                    json={"version_id": v1["id"]}).status_code == 409
    # D4:单项目至多一个 in_review(部分唯一索引)
    v2 = _version(0.2)
    assert ann.post(f"/api/projects/{PUUID}/reviews",
                    json={"version_id": v2["id"]}).status_code == 409
    # D6:退回必须填理由
    assert rex.post(f"/api/projects/{PUUID}/reviews/{v1['id']}/return",
                    json={"note": ""}).status_code == 422
    # D2:签发后重新送审 → 409
    assert rex.post(f"/api/projects/{PUUID}/reviews/{v1['id']}/sign",
                    json={"password": PW}).status_code == 200
    assert ann.post(f"/api/projects/{PUUID}/reviews",
                    json={"version_id": v1["id"]}).status_code == 409
    # D7:不存在的 version_id → 400
    assert ann.post(f"/api/projects/{PUUID}/reviews",
                    json={"version_id": 99999}).status_code == 400


# ══ E. 评论面 ══

def test_version_comments_surface(local):
    ann, rex = local("ann"), local("rex")
    v = _version()
    assert TestClient(app).post(f"/api/projects/{PUUID}/versions/{v['id']}/comments",
                                json={"body": "x"}).status_code == 401
    assert rex.post(f"/api/projects/{PUUID}/versions/{v['id']}/comments",
                    json={"body": "口径请补充"}).status_code == 200   # ANY_ROLE:评审人可评
    assert ann.post(f"/api/projects/{PUUID}/versions/{v['id']}/comments",
                    json={"body": "  "}).status_code == 422           # 空评论
    assert ann.post(f"/api/projects/{PUUID}/versions/99999/comments",
                    json={"body": "x"}).status_code == 400            # 版本不存在
    rows = ann.get(f"/api/projects/{PUUID}/versions/{v['id']}/comments").json()
    assert len(rows) == 1 and "rex" in rows[0]["author"]              # author = actor


# ══ F. 建账户校验 ══

def test_account_create_validation(local):
    adm = local("adm")
    short = "x" * (MIN_PASSWORD_LEN - 1)
    assert adm.post("/api/admin/accounts",
                    json={"username": "weak", "password": short, "role": "analyst"}).status_code == 422
    assert adm.post("/api/admin/accounts",
                    json={"username": "badrole", "password": PW, "role": "root"}).status_code == 422
    assert adm.post("/api/admin/accounts",
                    json={"username": "ann", "password": PW, "role": "analyst"}).status_code == 409


# ══ G. off 模式 / 401 扫掠 / 会话内核 ══

def test_off_mode_login_logout_501(monkeypatch):
    monkeypatch.delenv("PSA_AUTH", raising=False)
    c = TestClient(app)
    assert c.post("/api/auth/login", json={"username": "x", "password": "y"}).status_code == 501
    assert c.post("/api/auth/logout").status_code == 501
    me = c.get("/api/auth/me")
    assert me.status_code == 200 and me.json()["mode"] == "off"


def test_unauthenticated_401_sweep(local):
    c = TestClient(app)
    for path in ("/api/saved", "/api/projects", "/api/portfolio",
                 f"/api/projects/{PUUID}/versions", f"/api/projects/{PUUID}/cases",
                 f"/api/projects/{PUUID}/reviews", f"/api/projects/{PUUID}/audit"):
        assert c.get(path).status_code == 401, path


def test_session_token_hashed_ttl_and_sliding_renewal(local, monkeypatch):
    monkeypatch.setenv("PSA_AUTH", "local")
    c = TestClient(app)
    r = c.post("/api/auth/login", json={"username": "ann", "password": PW})
    raw = r.cookies.get("psa_session") or next(iter(c.cookies.jar)).value
    with store._conn() as cx:
        rows = cx.execute("SELECT token, expires_at FROM sessions").fetchall()
    assert len(rows) == 1
    assert rows[0]["token"] != raw                                    # 库中绝无明文 token
    assert rows[0]["token"] == hashlib.sha256(raw.encode()).hexdigest()

    # 滑动续期:剩余 < TTL/2 → 请求后 expires_at 前移
    near = "2026-07-22T00:00:10"
    with store._conn() as cx:
        cx.execute("UPDATE sessions SET expires_at=?", (near,))
    monkeypatch.setattr(store, "_now", lambda: "2026-07-22T00:00:00")
    assert c.get("/api/saved").status_code == 200
    with store._conn() as cx:
        renewed = cx.execute("SELECT expires_at FROM sessions").fetchone()["expires_at"]
    assert renewed > near

    # TTL 过期:懒清理删行 + 401
    with store._conn() as cx:
        cx.execute("UPDATE sessions SET expires_at=?", ("2026-07-21T00:00:00",))
    assert c.get("/api/saved").status_code == 401
    with store._conn() as cx:
        assert cx.execute("SELECT COUNT(*) AS n FROM sessions").fetchone()["n"] == 0


def test_multi_session_same_account_is_by_design(local):
    a1, a2 = local("ann"), local("ann")
    assert a1.get("/api/saved").status_code == 200
    assert a2.get("/api/saved").status_code == 200        # 两端并行有效(多会话为设计)
    a1.post("/api/auth/logout")
    assert a1.get("/api/saved").status_code == 401
    assert a2.get("/api/saved").status_code == 200        # 登出只撤本会话


# ══ H. 导出钉扎一致性(EB-02)══

def test_export_pin_refuses_mismatched_request(local):
    """报告请求的引擎参数与 project_payload 不可反构一致 → 409,绝不半钉扎。"""
    ann = local("ann")
    r = ann.post("/api/saved", json={"name": "冒烟SMK-eb02", "payload": _payload()})
    puuid = r.json()["version"]["project_uuid"]
    req = {"init_event": "IE", "init_frequency": 1.0,     # 载荷里是 0.001 → 不一致
           "functional_events": [{"id": "FE1", "pfd": 0.1}],
           "fault_trees": {}, "parameters": {},
           "sequences": [{"path": {"FE1": "success"}, "end_state": "L0"},
                         {"path": {"FE1": "failure"}, "end_state": "L1"}],
           "consequence_bins": {"L0": "C1", "L1": "C2"}, "samples": 40,
           "project_uuid": puuid, "project_payload": _payload()}
    assert ann.post("/api/report?format=csv", json=req).status_code == 409
