"""对比案例组 CRUD + 审计锁测(规格 2026-07-26-product-comparison §3)。

组保存**引用**(puuid+case_id)不复制数字——重开走 assemble 现装;成员案例被删时
assemble 响亮点名(既有 404 语义,此处锁"组不因引用失效而静默瘦身")。
跨项目实体:审计行 project_uuid 为空、details 携带组语义。
"""
import pytest
from fastapi.testclient import TestClient

from backend import store
from backend.app import app
from backend.canonical import to_canonical
from tests.backend.test_compare_assemble import PA, PB, _payload, _pin

client = TestClient(app)


def _mk_members():
    ca = _pin(PA, "供应商A", _payload(0.10))
    cb = _pin(PB, "供应商B", _payload(0.036))
    return [{"project_uuid": PA, "case_id": ca}, {"project_uuid": PB, "case_id": cb}]


def test_crud_roundtrip_and_audit():
    members = _mk_members()
    r = client.post("/api/compare/groups", json={"name": "A vs B 选型", "members": members, "base_index": 1})
    assert r.status_code == 200, r.text
    gid = r.json()["id"]
    # list + get
    lst = client.get("/api/compare/groups").json()
    assert any(g["id"] == gid and g["name"] == "A vs B 选型" for g in lst)
    g = client.get(f"/api/compare/groups/{gid}").json()
    assert g["members"] == members and g["base_index"] == 1
    assert g["created_by"]
    # update(改名 + 换基准)
    r = client.put(f"/api/compare/groups/{gid}", json={"name": "选型 v2", "base_index": 0})
    assert r.status_code == 200
    assert client.get(f"/api/compare/groups/{gid}").json()["name"] == "选型 v2"
    # delete
    assert client.delete(f"/api/compare/groups/{gid}").status_code == 200
    assert client.get(f"/api/compare/groups/{gid}").status_code == 404
    # 审计:三个动作都留痕(跨项目实体 → project_uuid 空,details 带 group_id)
    with store._conn() as cx:
        rows = [dict(r) for r in cx.execute(
            "SELECT action,project_uuid,details_json FROM audit_log WHERE action LIKE 'compare.%' ORDER BY id").fetchall()]
    acts = [r["action"] for r in rows]
    assert acts == ["compare.group.create", "compare.group.update", "compare.group.delete"]
    assert all(r["project_uuid"] is None and str(gid) in r["details_json"] for r in rows)


def test_create_validates_members():
    members = _mk_members()
    # 成员数 <2
    assert client.post("/api/compare/groups", json={"name": "x", "members": members[:1]}).status_code == 422
    # 引用不存在的案例 → 404 点名
    bad = [members[0], {"project_uuid": PB, "case_id": 99999}]
    r = client.post("/api/compare/groups", json={"name": "x", "members": bad})
    assert r.status_code == 404 and "99999" in r.text
    # kind 非 report → 422
    vid = store.list_versions(PA)[-1]["id"]
    imp = store.create_case(PA, vid, "importance", results={})
    r = client.post("/api/compare/groups", json={"name": "x", "members": [members[0], {"project_uuid": PA, "case_id": imp}]})
    assert r.status_code == 422


def test_group_reopen_via_assemble_and_dangling_reference_is_loud():
    members = _mk_members()
    gid = client.post("/api/compare/groups", json={"name": "重开", "members": members}).json()["id"]
    g = client.get(f"/api/compare/groups/{gid}").json()
    q = ",".join(f"{m['project_uuid']}:{m['case_id']}" for m in g["members"])
    assert client.get(f"/api/compare/assemble?members={q}&base={g['base_index']}").status_code == 200
    # 成员案例被删 → 重开响亮 404,组本身不静默瘦身
    with store._conn() as cx:
        cx.execute("DELETE FROM analysis_cases WHERE id=?", (members[1]["case_id"],))
    r = client.get(f"/api/compare/assemble?members={q}&base=0")
    assert r.status_code == 404 and str(members[1]["case_id"]) in r.text
    assert len(client.get(f"/api/compare/groups/{gid}").json()["members"]) == 2
