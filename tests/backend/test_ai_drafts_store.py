"""4b2 ai_drafts 溯源表:生成落库、应用回执、审计、查询面。"""
import json

import pytest
from fastapi.testclient import TestClient

from backend import store
from backend.app import app

client = TestClient(app)

PUUID = "5a3f0a90-0000-5000-8000-1234567890aa"


def _resp(draft_id="d-1", ok=True):
    return {"draft_id": draft_id, "summary": "s", "etas": [], "fts": {},
            "validation": {"ok": ok, "errors": [], "warnings": []},
            "provenance": {"model_id": "claude-fable-5", "served_by": "claude-opus-4-8",
                           "prompt_version": "2026-07-09-p1", "rounds": 2,
                           "tool_trace": [{"name": "search_reference_library"}],
                           "repair_trace": [{"round": 1, "errors": ["x"]}, {"round": 2, "errors": []}]}}


def test_record_and_apply_with_audit():
    store.ensure_project(PUUID, "P")
    rid = store.record_ai_draft(_resp(), {"goal": "目标", "target": "eta", "user_context": {"mode": "new_eta"}},
                                project_uuid=PUUID)
    rows = store.list_ai_drafts(PUUID)
    assert rows and rows[0]["id"] == rid
    assert rows[0]["model_id"] == "claude-fable-5"
    assert rows[0]["served_by"] == "claude-opus-4-8"      # 服务端回退可见
    assert rows[0]["prompt_version"] == "2026-07-09-p1"
    assert rows[0]["status"] == "generated"

    ok = store.mark_ai_draft_applied(rid, accepted={"etas": ["e1"], "barriers": ["B1"]}, project_uuid=PUUID)
    assert ok
    assert store.list_ai_drafts(PUUID)[0]["status"] == "applied"
    actions = {a["action"] for a in store.list_audit(PUUID)}
    assert {"ai.draft", "ai.apply"} <= actions


def test_apply_receipt_api_and_404():
    store.ensure_project(PUUID, "P")
    rid = store.record_ai_draft(_resp("d-2"), {"goal": "g", "target": "fta"}, project_uuid=PUUID)
    r = client.post(f"/api/ai/drafts/{rid}/applied",
                    json={"status": "applied", "accepted": {"fts": ["T1"]}, "project_uuid": PUUID})
    assert r.status_code == 200 and r.json()["ok"] is True
    assert client.post("/api/ai/drafts/999999/applied", json={"status": "applied"}).status_code == 404
    lst = client.get("/api/ai/drafts", params={"project_uuid": PUUID}).json()
    assert any(x["id"] == rid and x["status"] == "applied" for x in lst)


def test_draft_endpoint_records_row(monkeypatch):
    monkeypatch.setenv("PSA_AI_ENABLED", "1")
    monkeypatch.setenv("PSA_LLM_PROVIDER", "example")
    req = {"goal": "液冷泄漏", "target": "fta", "current_project": {}, "project_uuid": PUUID,
           "user_context": {"mode": "fta_for_barrier", "target_fe_id": "B_X"}}
    store.ensure_project(PUUID, "P")
    r = client.post("/api/ai/draft-model", json=req)
    assert r.status_code == 200
    body = r.json()
    assert body["ai_draft_id"] is not None
    assert body["provenance"]["prompt_version"]
    row = next(x for x in store.list_ai_drafts(PUUID) if x["id"] == body["ai_draft_id"])
    assert row["target"] == "fta" and row["mode"] == "fta_for_barrier"
