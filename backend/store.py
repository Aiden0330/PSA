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
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_log
  BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_log
  BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
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
