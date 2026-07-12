"""Phase 5 D-P5-5 (direction A) review/sign-off state machine — store layer.

Spec: docs/superpowers/specs/2026-07-12-phase5-review-signoff-spec.md §1-2.
Invariants under test: signed is final (trigger), one in_review per project
(partial unique index), every transition appends audit, note required on return.
"""
import sqlite3

import pytest

from backend import store
from backend.canonical import to_canonical

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


def _two_versions():
    store.ensure_project(PUUID, "P")
    v1 = store.create_version(PUUID, *to_canonical(_mini_payload(0.1), PUUID))
    v2 = store.create_version(PUUID, *to_canonical(_mini_payload(0.2), PUUID))
    return v1, v2


def _audit_actions():
    return [e["action"] for e in reversed(store.list_audit(PUUID))]


def test_submit_then_sign_happy_path():
    v1, _ = _two_versions()
    r = store.submit_review(PUUID, v1["id"], note="Rev 12 送审")
    assert r["state"] == "in_review" and r["submitted_by"] == store.actor()
    assert r["content_hash"] == v1["content_hash"]            # join versions 取哈希
    s = store.sign_review(PUUID, v1["id"], note="同意签发")
    assert s["state"] == "signed" and s["decided_by"] == store.actor()
    assert s["decided_at"] is not None
    assert store.review_for_version(PUUID, v1["id"])["state"] == "signed"
    assert store.review_for_version(PUUID, v1["id"] + 999) is None
    acts = _audit_actions()
    assert "review.submit" in acts and "review.sign" in acts


def test_signed_is_final_trigger():
    v1, _ = _two_versions()
    store.submit_review(PUUID, v1["id"])
    store.sign_review(PUUID, v1["id"])
    with store._conn() as cx, pytest.raises(sqlite3.DatabaseError, match="final"):
        cx.execute("UPDATE reviews SET state='returned' WHERE project_uuid=? AND version_id=?",
                   (PUUID, v1["id"]))


def test_one_in_review_per_project():
    v1, v2 = _two_versions()
    store.submit_review(PUUID, v1["id"])
    with pytest.raises(sqlite3.IntegrityError):
        store.submit_review(PUUID, v2["id"])                  # API 层转 409


def test_returned_then_resubmit_reuses_row_and_clears_decision():
    v1, _ = _two_versions()
    r0 = store.submit_review(PUUID, v1["id"])
    r1 = store.return_review(PUUID, v1["id"], note="B_OFFGAS 依据不足")
    assert r1["state"] == "returned" and r1["decided_by"] == store.actor()
    assert r1["note"] == "B_OFFGAS 依据不足"
    r2 = store.submit_review(PUUID, v1["id"], note="已补依据")
    assert r2["id"] == r0["id"]                               # 同一行状态回转
    assert r2["state"] == "in_review"
    assert r2["decided_by"] is None and r2["decided_at"] is None
    acts = _audit_actions()
    assert acts.count("review.submit") == 2 and acts.count("review.return") == 1


def test_sign_and_return_require_in_review():
    v1, v2 = _two_versions()
    with pytest.raises(ValueError):
        store.sign_review(PUUID, v1["id"])                    # 草稿不可直接签发
    with pytest.raises(ValueError):
        store.return_review(PUUID, v1["id"], note="n")
    store.submit_review(PUUID, v2["id"])
    with pytest.raises(ValueError):
        store.sign_review(PUUID, v1["id"])                    # 送审的是 v2,不是 v1


def test_signed_version_cannot_resubmit():
    v1, _ = _two_versions()
    store.submit_review(PUUID, v1["id"])
    store.sign_review(PUUID, v1["id"])
    with pytest.raises(ValueError):
        store.submit_review(PUUID, v1["id"])


def test_return_requires_note():
    v1, _ = _two_versions()
    store.submit_review(PUUID, v1["id"])
    with pytest.raises(ValueError):
        store.return_review(PUUID, v1["id"], note="  ")


def test_submit_ghost_version_raises():
    store.ensure_project(PUUID, "P")
    with pytest.raises(LookupError):                          # API 层转 400
        store.submit_review(PUUID, 12345)


def test_audit_details_carry_hash_and_note():
    v1, _ = _two_versions()
    store.submit_review(PUUID, v1["id"], note="送审")
    import json
    entry = next(e for e in store.list_audit(PUUID) if e["action"] == "review.submit")
    d = json.loads(entry["details_json"])
    assert d["content_hash"] == v1["content_hash"] and d["note"] == "送审"
    assert entry["version_id"] == v1["id"]


def test_comments_roundtrip_and_audit():
    v1, _ = _two_versions()
    cid = store.add_review_comment(PUUID, v1["id"], "α₂ 上调的检验记录编号?")
    assert isinstance(cid, int)
    rows = store.list_review_comments(PUUID, v1["id"])
    assert len(rows) == 1 and rows[0]["body"].startswith("α₂")
    assert rows[0]["author"] == store.actor()
    assert store.list_review_comments(PUUID, v1["id"] + 999) == []
    assert "review.comment" in _audit_actions()
    with pytest.raises(ValueError):
        store.add_review_comment(PUUID, v1["id"], "   ")
    with pytest.raises(LookupError):
        store.add_review_comment(PUUID, 12345, "ghost")
