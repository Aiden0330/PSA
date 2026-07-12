"""ADR-2 storage layer: projects / immutable versions / append-only audit /
analysis cases, in a single stdlib-sqlite3 file (D5).

Version semantics (D6): explicit saves create versions idempotently (same
content hash => the existing version is returned); for-the-record analyses
auto-pin a version first, so every reportable number binds to a hash.

The audit log is append-only twice over: no update/delete code path exists
here, and SQLite triggers RAISE(ABORT) on any attempt (property-tested).

Strangler notes: the legacy /api/saved endpoints keep files as their
authoritative store; this layer dual-writes canonical versions alongside
(`save_workspace_version`). Legacy archive ids map to stable project uuids
via uuid5, so re-saves and re-imports converge on the same project.
"""
from __future__ import annotations

import getpass
import json
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from backend.canonical import content_hash, canonical_json, to_canonical
from backend.canonical.models import ProjectDocument

_DB_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "projects.db")

# Stable namespace for deriving project uuids from legacy saved-archive ids.
_NS = uuid.uuid5(uuid.NAMESPACE_URL, "bess-psa://project")

_DDL = """
CREATE TABLE IF NOT EXISTS projects(
  uuid TEXT PRIMARY KEY, name TEXT NOT NULL,
  created_at TEXT NOT NULL, modified_at TEXT NOT NULL, meta_json TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS versions(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_uuid TEXT NOT NULL REFERENCES projects(uuid),
  content_hash TEXT NOT NULL, parent_version_id INTEGER,
  canonical_json TEXT NOT NULL, sidecar_json TEXT,
  created_at TEXT NOT NULL, actor TEXT NOT NULL,
  origin TEXT NOT NULL CHECK(origin IN ('save','auto_pin','import')),
  message TEXT, UNIQUE(project_uuid, content_hash));
CREATE TABLE IF NOT EXISTS audit_log(
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, actor TEXT NOT NULL,
  action TEXT NOT NULL, project_uuid TEXT, version_id INTEGER, entity_uuid TEXT,
  details_json TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS analysis_cases(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_uuid TEXT NOT NULL REFERENCES projects(uuid),
  version_id INTEGER NOT NULL REFERENCES versions(id),
  kind TEXT NOT NULL, engine_version TEXT NOT NULL,
  settings_json TEXT NOT NULL DEFAULT '{}', results_json TEXT NOT NULL DEFAULT '{}',
  artifacts_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL, actor TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ai_drafts(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id TEXT NOT NULL,
  project_uuid TEXT,
  goal TEXT, mode TEXT, target TEXT,
  model_id TEXT, served_by TEXT, prompt_version TEXT,
  rounds INTEGER, tool_trace_json TEXT NOT NULL DEFAULT '[]',
  repair_trace_json TEXT NOT NULL DEFAULT '[]',
  draft_json TEXT NOT NULL, validation_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'generated' CHECK(status IN ('generated','applied','rejected')),
  applied_json TEXT, created_at TEXT NOT NULL, applied_at TEXT, actor TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reviews(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_uuid TEXT NOT NULL REFERENCES projects(uuid),
  version_id INTEGER NOT NULL REFERENCES versions(id),
  state TEXT NOT NULL CHECK(state IN ('in_review','signed','returned')),
  submitted_by TEXT NOT NULL, submitted_at TEXT NOT NULL,
  decided_by TEXT, decided_at TEXT, note TEXT,
  UNIQUE(project_uuid, version_id));
CREATE UNIQUE INDEX IF NOT EXISTS reviews_one_in_review
  ON reviews(project_uuid) WHERE state='in_review';
CREATE TABLE IF NOT EXISTS review_comments(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_uuid TEXT NOT NULL REFERENCES projects(uuid),
  version_id INTEGER NOT NULL REFERENCES versions(id),
  author TEXT NOT NULL, created_at TEXT NOT NULL, body TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_log
  BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_log
  BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS reviews_signed_final BEFORE UPDATE ON reviews
  WHEN OLD.state='signed'
  BEGIN SELECT RAISE(ABORT, 'signed review is final'); END;
"""


def configure(path: str) -> None:
    """Point the store at a different db file (tests)."""
    global _DB_PATH
    _DB_PATH = path


def _conn() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(os.path.abspath(_DB_PATH)), exist_ok=True)
    cx = sqlite3.connect(_DB_PATH)
    cx.row_factory = sqlite3.Row
    cx.execute("PRAGMA journal_mode=WAL")
    cx.execute("PRAGMA foreign_keys=ON")
    cx.executescript(_DDL)
    return cx


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def engine_version() -> str:
    try:
        from importlib.metadata import version
        return version("bess-psa")
    except Exception:
        return "0.0.0"


def actor() -> str:
    try:
        user = getpass.getuser()
    except Exception:
        user = "unknown"
    return f"{user}@bess-psa/{engine_version()}"


def legacy_project_uuid(sid: str) -> str:
    return str(uuid.uuid5(_NS, f"legacy-saved:{sid}"))


def record_audit(cx: sqlite3.Connection, action: str, *, project_uuid: str | None = None,
                 version_id: int | None = None, entity_uuid: str | None = None,
                 details: dict | None = None) -> None:
    cx.execute("INSERT INTO audit_log(ts,actor,action,project_uuid,version_id,entity_uuid,details_json)"
               " VALUES(?,?,?,?,?,?,?)",
               (_now(), actor(), action, project_uuid, version_id, entity_uuid,
                json.dumps(details or {}, ensure_ascii=False)))


def ensure_project(puuid: str, name: str) -> bool:
    """Create the project if missing; audit renames. Returns True if created."""
    with _conn() as cx:
        row = cx.execute("SELECT name FROM projects WHERE uuid=?", (puuid,)).fetchone()
        if row is None:
            cx.execute("INSERT INTO projects(uuid,name,created_at,modified_at) VALUES(?,?,?,?)",
                       (puuid, name, _now(), _now()))
            record_audit(cx, "project.create", project_uuid=puuid, details={"name": name})
            return True
        if row["name"] != name:
            cx.execute("UPDATE projects SET name=?, modified_at=? WHERE uuid=?", (name, _now(), puuid))
            record_audit(cx, "project.rename", project_uuid=puuid,
                         details={"from": row["name"], "to": name})
        return False


def create_version(puuid: str, doc: ProjectDocument, sidecar: dict | None = None, *,
                   origin: str = "save", message: str | None = None) -> dict:
    """Idempotent by content hash (D6): same content => the existing version."""
    h = content_hash(doc)
    with _conn() as cx:
        row = cx.execute("SELECT id FROM versions WHERE project_uuid=? AND content_hash=?",
                         (puuid, h)).fetchone()
        if row is not None:
            return {"id": row["id"], "content_hash": h, "created": False}
        parent = cx.execute("SELECT id FROM versions WHERE project_uuid=? ORDER BY id DESC LIMIT 1",
                            (puuid,)).fetchone()
        cur = cx.execute(
            "INSERT INTO versions(project_uuid,content_hash,parent_version_id,canonical_json,"
            "sidecar_json,created_at,actor,origin,message) VALUES(?,?,?,?,?,?,?,?,?)",
            (puuid, h, parent["id"] if parent else None, canonical_json(doc),
             json.dumps(sidecar, ensure_ascii=False) if sidecar is not None else None,
             _now(), actor(), origin, message))
        vid = cur.lastrowid
        cx.execute("UPDATE projects SET modified_at=? WHERE uuid=?", (_now(), puuid))
        record_audit(cx, "version.auto_pin" if origin == "auto_pin" else "version.create",
                     project_uuid=puuid, version_id=vid,
                     details={"content_hash": h, "origin": origin, "message": message})
        return {"id": vid, "content_hash": h, "created": True}


def create_case(puuid: str, version_id: int, kind: str, *, settings: dict | None = None,
                results: dict | None = None, artifacts: dict | None = None,
                audit_action: str = "analysis.run") -> int:
    with _conn() as cx:
        cur = cx.execute(
            "INSERT INTO analysis_cases(project_uuid,version_id,kind,engine_version,"
            "settings_json,results_json,artifacts_json,created_at,actor) VALUES(?,?,?,?,?,?,?,?,?)",
            (puuid, version_id, kind, engine_version(),
             json.dumps(settings or {}, ensure_ascii=False),
             json.dumps(results or {}, ensure_ascii=False),
             json.dumps(artifacts or {}, ensure_ascii=False), _now(), actor()))
        cid = cur.lastrowid
        record_audit(cx, audit_action, project_uuid=puuid, version_id=version_id,
                     details={"case_id": cid, "kind": kind})
        return cid


def update_case_artifacts(case_id: int, artifacts: dict) -> None:
    with _conn() as cx:
        cx.execute("UPDATE analysis_cases SET artifacts_json=? WHERE id=?",
                   (json.dumps(artifacts, ensure_ascii=False), case_id))


def save_workspace_version(sid: str, name: str, payload: dict) -> dict:
    """Dual-write glue for legacy /api/saved: v2 payload -> canonical version.
    Raises ValueError for non-v2 payloads (caller preserves legacy behavior)."""
    puuid = legacy_project_uuid(sid)
    doc, sidecar = to_canonical(payload, puuid, project_name=name)
    ensure_project(puuid, name)
    ver = create_version(puuid, doc, sidecar, origin="save", message=f"saved:{sid}")
    return {"project_uuid": puuid, **ver}


# ---- read surface -----------------------------------------------------------

def list_projects() -> list[dict]:
    with _conn() as cx:
        rows = cx.execute(
            "SELECT p.uuid,p.name,p.created_at,p.modified_at,"
            " (SELECT COUNT(*) FROM versions v WHERE v.project_uuid=p.uuid) AS versions,"
            " (SELECT content_hash FROM versions v WHERE v.project_uuid=p.uuid"
            "  ORDER BY id DESC LIMIT 1) AS latest_hash"
            " FROM projects p ORDER BY p.modified_at DESC").fetchall()
        return [dict(r) for r in rows]


def get_project(puuid: str) -> Optional[dict]:
    with _conn() as cx:
        r = cx.execute("SELECT * FROM projects WHERE uuid=?", (puuid,)).fetchone()
        return dict(r) if r else None


def list_versions(puuid: str) -> list[dict]:
    with _conn() as cx:
        rows = cx.execute(
            "SELECT id,content_hash,parent_version_id,created_at,actor,origin,message"
            " FROM versions WHERE project_uuid=? ORDER BY id", (puuid,)).fetchall()
        return [dict(r) for r in rows]


def get_version(puuid: str, vid: int, include_doc: bool = False) -> Optional[dict]:
    with _conn() as cx:
        r = cx.execute("SELECT * FROM versions WHERE project_uuid=? AND id=?",
                       (puuid, vid)).fetchone()
        if r is None:
            return None
        out = dict(r)
        if include_doc:
            out["document"] = json.loads(out["canonical_json"])
        del out["canonical_json"]
        out.pop("sidecar_json", None)
        return out


def get_version_raw(puuid: str, vid: int) -> Optional[tuple[dict, Optional[dict]]]:
    """(document_dict, sidecar_dict) — the lossless pair, for serving/converting."""
    with _conn() as cx:
        r = cx.execute("SELECT canonical_json, sidecar_json FROM versions"
                       " WHERE project_uuid=? AND id=?", (puuid, vid)).fetchone()
        if r is None:
            return None
        return (json.loads(r["canonical_json"]),
                json.loads(r["sidecar_json"]) if r["sidecar_json"] else None)


def list_audit(puuid: str, limit: int = 200) -> list[dict]:
    with _conn() as cx:
        rows = cx.execute("SELECT * FROM audit_log WHERE project_uuid=?"
                          " ORDER BY id DESC LIMIT ?", (puuid, limit)).fetchall()
        return [dict(r) for r in rows]


def list_cases(puuid: str) -> list[dict]:
    with _conn() as cx:
        rows = cx.execute("SELECT * FROM analysis_cases WHERE project_uuid=?"
                          " ORDER BY id DESC", (puuid,)).fetchall()
        return [dict(r) for r in rows]


# ── Phase 5 reviews:评审/签发状态机(D-P5-5 方向 A)──
# 草稿 = 无行;in_review → signed(终态,触发器护住)| returned → 重新送审回转同一行。
# 单项目至多一个 in_review 由部分唯一索引保证(违反 → IntegrityError,API 层转 409)。
# 异常约定:LookupError=版本不存在(400)· ReviewStateError=状态冲突(409)·
# 裸 ValueError=输入校验(422)。


class ReviewStateError(ValueError):
    """Transition not allowed from the version's current review state."""

_REVIEW_SELECT = ("SELECT r.id, r.version_id, v.content_hash, r.state, r.submitted_by,"
                  " r.submitted_at, r.decided_by, r.decided_at, r.note"
                  " FROM reviews r JOIN versions v ON v.id = r.version_id"
                  " WHERE r.project_uuid=?")


def _require_version_hash(cx: sqlite3.Connection, puuid: str, version_id: int) -> str:
    r = cx.execute("SELECT content_hash FROM versions WHERE project_uuid=? AND id=?",
                   (puuid, version_id)).fetchone()
    if r is None:
        raise LookupError(f"version {version_id} not found in project")
    return r["content_hash"]


def _review_row(cx: sqlite3.Connection, puuid: str, version_id: int) -> Optional[sqlite3.Row]:
    return cx.execute("SELECT * FROM reviews WHERE project_uuid=? AND version_id=?",
                      (puuid, version_id)).fetchone()


def _review_joined(cx: sqlite3.Connection, puuid: str, version_id: int) -> Optional[dict]:
    r = cx.execute(_REVIEW_SELECT + " AND r.version_id=?", (puuid, version_id)).fetchone()
    return dict(r) if r else None


def submit_review(puuid: str, version_id: int, note: str | None = None) -> dict:
    """草稿/退回 → 送审中。已签发不可再送审;已送审重复提交报错;
    另一版本在审 → 部分唯一索引 IntegrityError 上抛。"""
    with _conn() as cx:
        h = _require_version_hash(cx, puuid, version_id)
        row = _review_row(cx, puuid, version_id)
        if row is not None and row["state"] == "signed":
            raise ReviewStateError("signed version cannot be resubmitted")
        if row is not None and row["state"] == "in_review":
            raise ReviewStateError("version is already in review")
        if row is None:
            cx.execute("INSERT INTO reviews(project_uuid,version_id,state,submitted_by,"
                       "submitted_at,note) VALUES(?,?,'in_review',?,?,?)",
                       (puuid, version_id, actor(), _now(), note))
        else:                                                  # returned → 回转
            cx.execute("UPDATE reviews SET state='in_review', submitted_by=?, submitted_at=?,"
                       " decided_by=NULL, decided_at=NULL, note=? WHERE id=?",
                       (actor(), _now(), note, row["id"]))
        record_audit(cx, "review.submit", project_uuid=puuid, version_id=version_id,
                     details={"content_hash": h, "note": note})
        return _review_joined(cx, puuid, version_id)  # type: ignore[return-value]


def sign_review(puuid: str, version_id: int, note: str | None = None) -> dict:
    """送审中 → 已签发(终态)。签发人身份/时间/版本哈希入只增审计(报告页脚同源)。"""
    with _conn() as cx:
        h = _require_version_hash(cx, puuid, version_id)
        row = _review_row(cx, puuid, version_id)
        if row is None or row["state"] != "in_review":
            raise ReviewStateError("only an in-review version can be signed")
        cx.execute("UPDATE reviews SET state='signed', decided_by=?, decided_at=?, note=?"
                   " WHERE id=?", (actor(), _now(), note, row["id"]))
        record_audit(cx, "review.sign", project_uuid=puuid, version_id=version_id,
                     details={"content_hash": h, "note": note})
        return _review_joined(cx, puuid, version_id)  # type: ignore[return-value]


def return_review(puuid: str, version_id: int, note: str) -> dict:
    """送审中 → 退回(note 必填 —— 退回理由是证据链的一部分)。"""
    if not note or not str(note).strip():
        raise ValueError("return requires a note")
    with _conn() as cx:
        h = _require_version_hash(cx, puuid, version_id)
        row = _review_row(cx, puuid, version_id)
        if row is None or row["state"] != "in_review":
            raise ReviewStateError("only an in-review version can be returned")
        cx.execute("UPDATE reviews SET state='returned', decided_by=?, decided_at=?, note=?"
                   " WHERE id=?", (actor(), _now(), note, row["id"]))
        record_audit(cx, "review.return", project_uuid=puuid, version_id=version_id,
                     details={"content_hash": h, "note": note})
        return _review_joined(cx, puuid, version_id)  # type: ignore[return-value]


def list_reviews(puuid: str) -> list[dict]:
    with _conn() as cx:
        rows = cx.execute(_REVIEW_SELECT + " ORDER BY r.id", (puuid,)).fetchall()
        return [dict(r) for r in rows]


def review_for_version(puuid: str, version_id: int) -> Optional[dict]:
    """导出门/页脚的查询点:该版本的评审状态(无行 = 草稿 → None)。"""
    with _conn() as cx:
        return _review_joined(cx, puuid, version_id)


def add_review_comment(puuid: str, version_id: int, body: str) -> int:
    if not body or not str(body).strip():
        raise ValueError("comment body required")
    with _conn() as cx:
        _require_version_hash(cx, puuid, version_id)
        cur = cx.execute("INSERT INTO review_comments(project_uuid,version_id,author,"
                         "created_at,body) VALUES(?,?,?,?,?)",
                         (puuid, version_id, actor(), _now(), body))
        cid = int(cur.lastrowid)
        record_audit(cx, "review.comment", project_uuid=puuid, version_id=version_id,
                     details={"comment_id": cid})
        return cid


def list_review_comments(puuid: str, version_id: int) -> list[dict]:
    with _conn() as cx:
        rows = cx.execute("SELECT id,author,created_at,body FROM review_comments"
                          " WHERE project_uuid=? AND version_id=? ORDER BY id",
                          (puuid, version_id)).fetchall()
        return [dict(r) for r in rows]


# ── ADR-3 ai_drafts:AI 生成溯源(4b2)──

def record_ai_draft(response: dict, req: dict, project_uuid: str | None = None) -> int:
    """落库一次生成:草案全文 + 校验结果 + 模型/提示词/工具/修复轨迹。返回行 id。
    有项目上下文时记 ai.draft 审计。"""
    prov = response.get("provenance") or {}
    with _conn() as cx:
        cur = cx.execute(
            "INSERT INTO ai_drafts(draft_id, project_uuid, goal, mode, target, model_id, served_by,"
            " prompt_version, rounds, tool_trace_json, repair_trace_json, draft_json, validation_json,"
            " created_at, actor) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (response.get("draft_id", ""), project_uuid, req.get("goal"),
             (req.get("user_context") or {}).get("mode"), req.get("target"),
             prov.get("model_id"), prov.get("served_by"), prov.get("prompt_version"),
             prov.get("rounds"), json.dumps(prov.get("tool_trace", []), ensure_ascii=False),
             json.dumps(prov.get("repair_trace", []), ensure_ascii=False),
             json.dumps(response, ensure_ascii=False),
             json.dumps(response.get("validation", {}), ensure_ascii=False),
             _now(), actor()))
        rid = int(cur.lastrowid)
        if project_uuid:
            record_audit(cx, "ai.draft", project_uuid=project_uuid,
                         details={"ai_draft_row": rid, "draft_id": response.get("draft_id", ""),
                                  "model_id": prov.get("model_id"), "served_by": prov.get("served_by"),
                                  "prompt_version": prov.get("prompt_version")})
        cx.commit()
        return rid


def mark_ai_draft_applied(row_id: int, accepted: dict | None = None,
                          project_uuid: str | None = None, status: str = "applied") -> bool:
    """记录应用/拒绝结果(逐元素接受清单入 applied_json);有项目上下文时记 ai.apply 审计。"""
    if status not in ("applied", "rejected"):
        raise ValueError("status must be applied|rejected")
    with _conn() as cx:
        cur = cx.execute(
            "UPDATE ai_drafts SET status=?, applied_json=?, applied_at=?,"
            " project_uuid=COALESCE(?, project_uuid) WHERE id=?",
            (status, json.dumps(accepted or {}, ensure_ascii=False), _now(), project_uuid, row_id))
        if cur.rowcount == 0:
            return False
        pu = project_uuid or (cx.execute("SELECT project_uuid FROM ai_drafts WHERE id=?",
                                         (row_id,)).fetchone() or {"project_uuid": None})["project_uuid"]
        if pu:
            record_audit(cx, "ai.apply" if status == "applied" else "ai.reject",
                         project_uuid=pu, details={"ai_draft_row": row_id, "accepted": accepted or {}})
        cx.commit()
        return True


def list_ai_drafts(project_uuid: str | None = None, limit: int = 50) -> list[dict]:
    with _conn() as cx:
        if project_uuid:
            rows = cx.execute("SELECT id, draft_id, project_uuid, goal, mode, target, model_id,"
                              " served_by, prompt_version, rounds, status, created_at, applied_at"
                              " FROM ai_drafts WHERE project_uuid=? ORDER BY id DESC LIMIT ?",
                              (project_uuid, limit)).fetchall()
        else:
            rows = cx.execute("SELECT id, draft_id, project_uuid, goal, mode, target, model_id,"
                              " served_by, prompt_version, rounds, status, created_at, applied_at"
                              " FROM ai_drafts ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
        return [dict(r) for r in rows]
