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
CREATE TABLE IF NOT EXISTS accounts(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  pw_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','analyst','reviewer')),
  display_name TEXT, created_at TEXT NOT NULL,
  disabled INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS sessions(
  token TEXT PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_log
  BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_log
  BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS reviews_signed_final BEFORE UPDATE ON reviews
  WHEN OLD.state='signed'
  BEGIN SELECT RAISE(ABORT, 'signed review is final'); END;
CREATE TRIGGER IF NOT EXISTS reviews_signed_no_delete BEFORE DELETE ON reviews
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
    # review F2/EB-03(2026-07-16):写者互斥时等待而非立刻 SQLITE_BUSY——
    # 并发转换的仲裁交给条件 UPDATE 的 rowcount,不靠碰运气的锁失败。
    cx.execute("PRAGMA busy_timeout=5000")
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


# 修复项 ②(ADR-4):server 模式下审计/版本/案例的"谁"= 会话身份。
# 请求中间件解析 cookie 后 set;actor() 优先读它,空则回退 OS 用户(off 模式逐位不变)。
from contextvars import ContextVar

_current_actor: ContextVar[Optional[str]] = ContextVar("psa_current_actor", default=None)


def set_current_actor(username: str):
    """进入请求上下文:此后本请求内的 actor() 以该认证身份记。返回 reset 用 token。"""
    return _current_actor.set(username)


def reset_current_actor(token) -> None:
    _current_actor.reset(token)


def actor() -> str:
    ident = _current_actor.get()
    if ident:
        return f"{ident}@bess-psa/{engine_version()}"
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
    # domain-review 2026-07-12 finding-1:每行审计携带认证模式标记 —— OS 用户行(off/
    # 迁移前历史)与认证账户行在同一追踪链里必须可区分,否则监管读 provenance 会误判。
    from backend.auth.mode import auth_mode
    d = dict(details or {})
    d.setdefault("auth", auth_mode())
    cx.execute("INSERT INTO audit_log(ts,actor,action,project_uuid,version_id,entity_uuid,details_json)"
               " VALUES(?,?,?,?,?,?,?)",
               (_now(), actor(), action, project_uuid, version_id, entity_uuid,
                json.dumps(d, ensure_ascii=False)))


def _ensure_project_in(cx: sqlite3.Connection, puuid: str, name: str, *,
                       rename: bool = False) -> bool:
    row = cx.execute("SELECT name FROM projects WHERE uuid=?", (puuid,)).fetchone()
    if row is None:
        cx.execute("INSERT INTO projects(uuid,name,created_at,modified_at) VALUES(?,?,?,?)",
                   (puuid, name, _now(), _now()))
        record_audit(cx, "project.create", project_uuid=puuid, details={"name": name})
        return True
    if rename and row["name"] != name:
        cx.execute("UPDATE projects SET name=?, modified_at=? WHERE uuid=?", (name, _now(), puuid))
        record_audit(cx, "project.rename", project_uuid=puuid,
                     details={"from": row["name"], "to": name})
    return False


def ensure_project(puuid: str, name: str, *, rename: bool = False) -> bool:
    """Create the project if missing. 既有项目**默认不改名**(task_75694c92:_pin_case 曾以
    scenario_name 作 hint 调本函数,导致每次报告导出把存档项目改名成场景名——名字是用户
    资产,分析动作不得改写)。显式保存路径(用户给名)传 rename=True;改名进审计。
    Returns True if created."""
    with _conn() as cx:
        return _ensure_project_in(cx, puuid, name, rename=rename)


def create_version(puuid: str, doc: ProjectDocument, sidecar: dict | None = None, *,
                   origin: str = "save", message: str | None = None) -> dict:
    """Idempotent by content hash (D6): same content => the existing version.

    P3 concurrency probe (2026-07-12) surfaced a check-then-insert race here:
    two threads can both miss the SELECT and both attempt the INSERT, and the
    loser previously crashed with IntegrityError instead of returning the
    winner's row. Caught and folded into the idempotent-hit path — concurrent
    identical saves must be safe, not just sequential ones."""
    h = content_hash(doc)
    with _conn() as cx:
        return _create_version_in(cx, puuid, doc, sidecar, origin=origin,
                                  message=message, h=h)


def _create_version_in(cx: sqlite3.Connection, puuid: str, doc: ProjectDocument,
                       sidecar: dict | None = None, *, origin: str = "save",
                       message: str | None = None, h: str | None = None) -> dict:
    h = h or content_hash(doc)
    row = cx.execute("SELECT id FROM versions WHERE project_uuid=? AND content_hash=?",
                     (puuid, h)).fetchone()
    if row is not None:
        return {"id": row["id"], "content_hash": h, "created": False}
    parent = cx.execute("SELECT id FROM versions WHERE project_uuid=? ORDER BY id DESC LIMIT 1",
                        (puuid,)).fetchone()
    try:
        cur = cx.execute(
            "INSERT INTO versions(project_uuid,content_hash,parent_version_id,canonical_json,"
            "sidecar_json,created_at,actor,origin,message) VALUES(?,?,?,?,?,?,?,?,?)",
            (puuid, h, parent["id"] if parent else None, canonical_json(doc),
             json.dumps(sidecar, ensure_ascii=False) if sidecar is not None else None,
             _now(), actor(), origin, message))
    except sqlite3.IntegrityError:
        row = cx.execute("SELECT id FROM versions WHERE project_uuid=? AND content_hash=?",
                         (puuid, h)).fetchone()
        return {"id": row["id"], "content_hash": h, "created": False}
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
    ensure_project(puuid, name, rename=True)   # 用户显式给名的保存路径,改名合法且入审计
    ver = create_version(puuid, doc, sidecar, origin="save", message=f"saved:{sid}")
    return {"project_uuid": puuid, **ver}


class VersionConflictError(ValueError):
    """乐观并发:base_version_hash 已过期(review F2/EB-07)。"""
    def __init__(self, server_hash: str):
        super().__init__(f"base version is stale; server latest = {server_hash}")
        self.server_hash = server_hash


def save_workspace_version_cas(sid: str, name: str, payload: dict,
                               base_version_hash: str | None = None) -> dict:
    """CAS 检查与版本创建同一事务(review F2/EB-07):此前 base 检查(只读)、
    legacy 文件写、canonical 写三段分离——两个携带同一 base 的过期保存可同时通过
    检查并都返回 200。BEGIN IMMEDIATE 串行化写者:后到者在事务内重读最新哈希,
    不一致即 VersionConflictError(携带 server_hash 供 409 响应)。

    规范化(to_canonical)在事务外完成——纯计算,失败不留半事务;
    非 v2 载荷在此抛 ValueError,由调用方显式分型(不再静默吞)。"""
    puuid = legacy_project_uuid(sid)
    try:
        doc, sidecar = to_canonical(payload, puuid, project_name=name)
    except ValueError:
        raise
    except Exception as e:
        # v2 形载荷的深层规范化失败(如 KeyError 'model')同属校验错误——
        # 统一为 ValueError 供端点映射 422(convert.py 类型化报错记 F3/canonical v2)
        raise ValueError(f"canonicalization failed: {type(e).__name__}: {e}") from e
    os.makedirs(os.path.dirname(os.path.abspath(_DB_PATH)), exist_ok=True)
    cx = sqlite3.connect(_DB_PATH)
    cx.row_factory = sqlite3.Row
    cx.isolation_level = None                      # 显式事务控制
    try:
        cx.execute("PRAGMA journal_mode=WAL")
        cx.execute("PRAGMA foreign_keys=ON")
        cx.execute("PRAGMA busy_timeout=5000")
        cx.executescript(_DDL)
        cx.execute("BEGIN IMMEDIATE")
        if base_version_hash:
            row = cx.execute(
                "SELECT content_hash FROM versions WHERE project_uuid=?"
                " ORDER BY id DESC LIMIT 1", (puuid,)).fetchone()
            if row is not None and row["content_hash"] != base_version_hash:
                raise VersionConflictError(row["content_hash"])
        _ensure_project_in(cx, puuid, name, rename=True)
        ver = _create_version_in(cx, puuid, doc, sidecar,
                                 origin="save", message=f"saved:{sid}")
        cx.execute("COMMIT")
        return {"project_uuid": puuid, **ver}
    except BaseException:
        try:
            cx.execute("ROLLBACK")
        except sqlite3.Error:
            pass
        raise
    finally:
        cx.close()


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


def portfolio() -> list[dict]:
    """R5 组合总览数据源:每项目一行。数字取自**已钉扎案例**,绝不现算(证据链正确性)——
    无案例项目 latest_case=None,前端显示"未量化"。
      review_state:锚定**最新版本**的评审行状态(草稿=无行=None)。回答"当前模型是否已签发",
        而非"是否曾有某版本签发过"——后者会把旧签发误读为现状(监管工具须防的误导)。
      latest_case:最新 report/uncertainty 案例的 results_json.consequences({C1..C5:频率/yr}),
        携带其 version_hash/created_at —— 案例可能钉在比 latest_hash 更旧的版本上,该哈希即溯源锚点。"""
    from backend import report_export
    # uuid → savedId 反查(legacy_project_uuid 确定性映射):供前端从组合总览直达/打开项目。
    # 仅存档过的项目有 savedId;纯 auto_pin/import 项目为 None(前端降级为"需先打开")。
    saved_by_uuid: dict[str, str] = {}
    try:
        from backend import storage
        for w in storage.list_workspaces():
            saved_by_uuid[legacy_project_uuid(w["id"])] = w["id"]
    except Exception:
        pass
    with _conn() as cx:
        projs = cx.execute(
            "SELECT p.uuid,p.name,p.modified_at,"
            " (SELECT COUNT(*) FROM versions v WHERE v.project_uuid=p.uuid) AS versions,"
            " (SELECT id FROM versions v WHERE v.project_uuid=p.uuid ORDER BY id DESC LIMIT 1) AS latest_vid,"
            " (SELECT content_hash FROM versions v WHERE v.project_uuid=p.uuid ORDER BY id DESC LIMIT 1) AS latest_hash"
            " FROM projects p ORDER BY p.modified_at DESC").fetchall()
        out: list[dict] = []
        for p in projs:
            uuid = p["uuid"]
            review_state = None
            if p["latest_vid"] is not None:
                rv = cx.execute("SELECT state FROM reviews WHERE project_uuid=? AND version_id=?",
                                (uuid, p["latest_vid"])).fetchone()
                review_state = rv["state"] if rv else None
            # 域评审裁决 2:挂起评审独立字段。部分唯一索引保证每项目至多一行 in_review,但该行
            # 可能钉在旧版本上(送审后又存新版)——若只按最新版本锚定,挂起的评审会从队列消失
            # ("看不见还能签")。open_review 让队列不漏,is_latest=False 由前端标"已有更新版本"。
            orow = cx.execute(
                "SELECT r.version_id, v.content_hash FROM reviews r"
                " JOIN versions v ON v.id = r.version_id"
                " WHERE r.project_uuid=? AND r.state='in_review'", (uuid,)).fetchone()
            open_review = None
            if orow is not None:
                open_review = {"version_id": orow["version_id"], "version_hash": orow["content_hash"],
                               "is_latest": orow["version_id"] == p["latest_vid"]}
            cr = cx.execute(
                "SELECT c.id,c.kind,c.results_json,c.settings_json,c.created_at,v.content_hash"
                " FROM analysis_cases c JOIN versions v ON v.id=c.version_id"
                " WHERE c.project_uuid=? AND c.kind IN ('report','uncertainty')"
                " ORDER BY c.id DESC LIMIT 1", (uuid,)).fetchone()
            latest_case = None
            if cr is not None:
                res = json.loads(cr["results_json"])
                # 域评审 F1:report 案例钉 {"consequences",...};uncertainty 案例钉 {"point","bands"}
                # (point = quantify_event_tree(...)["consequences"],同一确定性频率口径)。
                # 只读 "consequences" 会把真实不确定性运行显示成"未量化"——反保守,必须双读。
                cons = res.get("consequences") or res.get("point")
                if isinstance(cons, dict):
                    settings = json.loads(cr["settings_json"] or "{}")
                    consequences = {k: float(cons.get(k, 0.0)) for k in ("C1", "C2", "C3", "C4", "C5")}
                    # spec A §2.4:scope 标识全表面。旧案例无 scope 键 → 语义 = single(零迁移);
                    # checked_set 时 tree_count = 勾选场景数,前端徽章「聚合 n 树」替代场景名。
                    scope = settings.get("scope", "single")
                    latest_case = {
                        "id": cr["id"], "kind": cr["kind"], "consequences": consequences,
                        "version_hash": cr["content_hash"], "created_at": cr["created_at"],
                        # 域评审 F2:数字口径 = 该案例覆盖的事件树(场景),非项目全部 ETA 之和。
                        # 场景名透传供前端披露;聚合案例(checked_set)以徽章披露口径。
                        "scenario": settings.get("scenario_name"),
                        "scope": scope,
                        "tree_count": (len(settings.get("scenarios") or [])
                                       if scope == "checked_set" else None),
                        "risk": report_export.risk_placement(consequences),
                    }
            out.append({"uuid": uuid, "name": p["name"], "versions": p["versions"],
                        "latest_hash": p["latest_hash"], "review_state": review_state,
                        "open_review": open_review,
                        "latest_case": latest_case, "saved_id": saved_by_uuid.get(uuid)})
        return out


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


# ── Phase 5 auth:accounts(argon2id)+ sessions(规格 §4.1,B2)──
# 安全钉定:sessions.token 列存 sha256(原始 token)—— 备份=库文件拷贝(ADR-4),
# 库泄露不得等于会话劫持;原始 token(secrets.token_urlsafe(32),256 bit)只发给客户端。
# verify_credentials 对 未知用户/错口令/停用 一律 None(枚举防御,未知用户走 dummy_verify
# 等时垫片);真实原因只进审计。TTL 12h,消耗过半即滑动续期(写库有界)。

_SESSION_TTL_HOURS = 12
_ROLES = ("admin", "analyst", "reviewer")


def _token_hash(token: str) -> str:
    import hashlib
    return hashlib.sha256(token.encode()).hexdigest()


def create_account(username: str, password: str, role: str,
                   display_name: str | None = None) -> dict:
    """建账户(argon2id 哈希)。重名 → IntegrityError;弱口令/坏角色 → ValueError。"""
    from backend.auth import passwords
    if role not in _ROLES:
        raise ValueError(f"role must be one of {_ROLES}")
    if not username or not username.strip():
        raise ValueError("username required")
    pw_hash = passwords.hash_password(password)          # 长度门在哈希层(单点)
    with _conn() as cx:
        cx.execute("INSERT INTO accounts(username,pw_hash,role,display_name,created_at)"
                   " VALUES(?,?,?,?,?)", (username, pw_hash, role, display_name, _now()))
        record_audit(cx, "account.create",
                     details={"username": username, "role": role})
    return {"username": username, "role": role, "display_name": display_name}


def verify_credentials(username: str, password: str) -> Optional[dict]:
    """成功 → 身份 dict;未知用户/错口令/停用账户一律 None(响应时间同为 argon2 主导)。"""
    from backend.auth import passwords
    with _conn() as cx:
        row = cx.execute("SELECT * FROM accounts WHERE username=?", (username,)).fetchone()
    if row is None:
        passwords.dummy_verify()                          # 等时垫片:防用户名枚举
        return None
    if not passwords.verify_password(row["pw_hash"], password):
        return None
    if row["disabled"]:
        return None                                       # 校验后才拒绝 → 耗时与错口令同级
    if passwords.needs_rehash(row["pw_hash"]):            # 参数演进时透明升级
        with _conn() as cx:
            cx.execute("UPDATE accounts SET pw_hash=? WHERE id=?",
                       (passwords.hash_password(password), row["id"]))
    return {"account_id": row["id"], "username": row["username"], "role": row["role"],
            "display_name": row["display_name"]}


def set_password(username: str, new_password: str) -> None:
    from backend.auth import passwords
    pw_hash = passwords.hash_password(new_password)
    with _conn() as cx:
        cur = cx.execute("UPDATE accounts SET pw_hash=? WHERE username=?", (pw_hash, username))
        if cur.rowcount == 0:
            raise LookupError(f"no account {username}")
        record_audit(cx, "account.set_password", details={"username": username})


def set_account_disabled(username: str, disabled: bool) -> None:
    with _conn() as cx:
        cur = cx.execute("UPDATE accounts SET disabled=? WHERE username=?",
                         (1 if disabled else 0, username))
        if cur.rowcount == 0:
            raise LookupError(f"no account {username}")
        record_audit(cx, "account.disable" if disabled else "account.enable",
                     details={"username": username})
        if disabled:                                      # 停用即撤销全部在途会话
            cx.execute("DELETE FROM sessions WHERE account_id="
                       "(SELECT id FROM accounts WHERE username=?)", (username,))


def list_accounts() -> list[dict]:
    with _conn() as cx:
        rows = cx.execute("SELECT id,username,role,display_name,created_at,disabled"
                          " FROM accounts ORDER BY id").fetchall()
        return [dict(r) for r in rows]


def create_session(username: str) -> str:
    """开会话,返回原始 token(唯一一次出现;库里只有它的 sha256)。"""
    import secrets
    from datetime import timedelta
    token = secrets.token_urlsafe(32)
    with _conn() as cx:
        acc = cx.execute("SELECT id FROM accounts WHERE username=? AND disabled=0",
                         (username,)).fetchone()
        if acc is None:
            raise LookupError(f"no active account {username}")
        now = datetime.fromisoformat(_now())
        cx.execute("INSERT INTO sessions(token,account_id,created_at,expires_at)"
                   " VALUES(?,?,?,?)",
                   (_token_hash(token), acc["id"], _now(),
                    (now + timedelta(hours=_SESSION_TTL_HOURS)).isoformat(timespec="seconds")))
    return token


def get_session(token: str) -> Optional[dict]:
    """token → 身份;过期即删(懒清理);剩余寿命 < TTL/2 → 滑动续期。"""
    from datetime import timedelta
    th = _token_hash(token)
    with _conn() as cx:
        row = cx.execute(
            "SELECT s.token AS th, s.expires_at, a.id AS account_id, a.username, a.role,"
            " a.display_name, a.disabled FROM sessions s JOIN accounts a ON a.id=s.account_id"
            " WHERE s.token=?", (th,)).fetchone()
        if row is None:
            return None
        now = datetime.fromisoformat(_now())
        if datetime.fromisoformat(row["expires_at"]) <= now or row["disabled"]:
            cx.execute("DELETE FROM sessions WHERE token=?", (th,))
            return None
        remaining = datetime.fromisoformat(row["expires_at"]) - now
        if remaining < timedelta(hours=_SESSION_TTL_HOURS / 2):
            cx.execute("UPDATE sessions SET expires_at=? WHERE token=?",
                       ((now + timedelta(hours=_SESSION_TTL_HOURS)).isoformat(timespec="seconds"), th))
        return {"account_id": row["account_id"], "username": row["username"],
                "role": row["role"], "display_name": row["display_name"]}


def delete_session(token: str) -> None:
    with _conn() as cx:
        cx.execute("DELETE FROM sessions WHERE token=?", (_token_hash(token),))


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


def sign_review(puuid: str, version_id: int, note: str | None = None,
                actor_role: str | None = None) -> dict:
    """送审中 → 已签发(终态)。签发人身份/时间/版本哈希入只增审计(报告页脚同源)。
    actor_role(domain-review finding-3):签发时角色快照进审计 —— 授权依据不得依赖
    可变的 accounts 表,须可从只增链重建。"""
    with _conn() as cx:
        h = _require_version_hash(cx, puuid, version_id)
        row = _review_row(cx, puuid, version_id)
        if row is None or row["state"] != "in_review":
            raise ReviewStateError("only an in-review version can be signed")
        # review F2/EB-03(2026-07-16):条件 UPDATE + rowcount 仲裁——上面的 SELECT
        # 只提供友好报错;并发下(退回先提交)持旧读的签发曾无条件 UPDATE 成功,
        # 产生 review.return → review.sign 的非法审计序。
        cur = cx.execute("UPDATE reviews SET state='signed', decided_by=?, decided_at=?, note=?"
                         " WHERE id=? AND state='in_review'",
                         (actor(), _now(), note, row["id"]))
        if cur.rowcount != 1:
            raise ReviewStateError("only an in-review version can be signed")
        record_audit(cx, "review.sign", project_uuid=puuid, version_id=version_id,
                     details={"content_hash": h, "note": note, "role": actor_role})
        return _review_joined(cx, puuid, version_id)  # type: ignore[return-value]


def return_review(puuid: str, version_id: int, note: str,
                  actor_role: str | None = None) -> dict:
    """送审中 → 退回(note 必填 —— 退回理由是证据链的一部分)。role 同 sign_review 快照。"""
    if not note or not str(note).strip():
        raise ValueError("return requires a note")
    with _conn() as cx:
        h = _require_version_hash(cx, puuid, version_id)
        row = _review_row(cx, puuid, version_id)
        if row is None or row["state"] != "in_review":
            raise ReviewStateError("only an in-review version can be returned")
        cur = cx.execute("UPDATE reviews SET state='returned', decided_by=?, decided_at=?, note=?"
                         " WHERE id=? AND state='in_review'",   # F2/EB-03 同 sign:条件仲裁
                         (actor(), _now(), note, row["id"]))
        if cur.rowcount != 1:
            raise ReviewStateError("only an in-review version can be returned")
        record_audit(cx, "review.return", project_uuid=puuid, version_id=version_id,
                     details={"content_hash": h, "note": note, "role": actor_role})
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
