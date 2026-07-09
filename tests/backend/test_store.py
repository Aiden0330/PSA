"""ADR-2 acceptance: version idempotency, append-only audit, legacy import."""
import copy
import json
import sqlite3

import pytest

from backend import store
from backend.canonical import content_hash, to_canonical, to_v2

PUUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301"


def _mini_payload(fail=0.1):
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


def test_version_idempotent_and_parent_chain():
    store.ensure_project(PUUID, "P")
    doc, sc = to_canonical(_mini_payload(), PUUID)
    v1 = store.create_version(PUUID, doc, sc)
    v1b = store.create_version(PUUID, doc, sc)
    assert v1["created"] and not v1b["created"]
    assert v1["id"] == v1b["id"] and v1["content_hash"] == v1b["content_hash"]

    doc2, sc2 = to_canonical(_mini_payload(fail=0.2), PUUID)
    v2 = store.create_version(PUUID, doc2, sc2)
    assert v2["created"] and v2["content_hash"] != v1["content_hash"]
    versions = store.list_versions(PUUID)
    assert len(versions) == 2
    assert versions[1]["parent_version_id"] == v1["id"]      # 父链成历史


def test_stored_pair_roundtrips_to_original_payload():
    payload = _mini_payload()
    store.ensure_project(PUUID, "P")
    doc, sc = to_canonical(copy.deepcopy(payload), PUUID)
    v = store.create_version(PUUID, doc, sc)
    raw = store.get_version_raw(PUUID, v["id"])
    assert raw is not None
    from backend.canonical.models import ProjectDocument
    stored_doc, stored_sc = ProjectDocument.model_validate(raw[0]), raw[1]
    assert to_v2(stored_doc, stored_sc) == payload           # 经库往返逐字段无损
    assert content_hash(stored_doc) == v["content_hash"]


def test_audit_log_is_append_only():
    store.ensure_project(PUUID, "P")                          # 产生 project.create 审计
    entries = store.list_audit(PUUID)
    assert entries and entries[-1]["action"] == "project.create"
    with store._conn() as cx:
        with pytest.raises(sqlite3.DatabaseError):
            cx.execute("UPDATE audit_log SET action='tampered' WHERE id=?", (entries[0]["id"],))
        with pytest.raises(sqlite3.DatabaseError):
            cx.execute("DELETE FROM audit_log WHERE id=?", (entries[0]["id"],))


def test_rename_is_audited():
    store.ensure_project(PUUID, "旧名")
    store.ensure_project(PUUID, "新名")
    actions = [a["action"] for a in store.list_audit(PUUID)]
    assert "project.rename" in actions
    assert store.get_project(PUUID)["name"] == "新名"


def test_import_legacy_v2_and_prev2(tmp_path, monkeypatch):
    from backend import storage
    from backend.import_legacy import import_saved_dir
    monkeypatch.setattr(storage, "_DIR", str(tmp_path / "saved"))
    payload = _mini_payload()
    storage.save_workspace("V2 项目", payload, sid="aaaa0001")
    storage.save_workspace("旧单树", {"etModel": {"initEvent": "老", "initFreq": 1e-3,
                                                  "functionalEvents": [],
                                                  "root": {"kind": "leaf", "consequence": "C1"}},
                                     "fts": {"model_data": {"parameters": []}, "fault_trees": []}},
                           sid="bbbb0002")
    results = import_saved_dir()
    assert all(r["ok"] for r in results) and len(results) == 2

    # v2 档:经库往返 == 原 payload(验收 #2)
    pu = store.legacy_project_uuid("aaaa0001")
    v = store.list_versions(pu)
    assert len(v) == 1 and v[0]["origin"] == "import"
    raw = store.get_version_raw(pu, v[0]["id"])
    from backend.canonical.models import ProjectDocument
    assert to_v2(ProjectDocument.model_validate(raw[0]), raw[1]) == payload

    # 幂等:重跑不新增
    again = import_saved_dir()
    assert all(not r["created"] for r in again if r["ok"])
    assert len(store.list_versions(pu)) == 1
