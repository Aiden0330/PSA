from __future__ import annotations
import json, os, re, uuid
from datetime import datetime, timezone

_DIR = os.path.join(os.path.dirname(__file__), "..", "saved")
_ID_RE = re.compile(r"^[0-9a-f]+$")


def _dir() -> str:
    os.makedirs(_DIR, exist_ok=True)
    return _DIR


def _path(sid: str) -> str:
    if not _ID_RE.match(sid):          # 路径安全: 仅 hex id
        raise KeyError(sid)
    return os.path.join(_dir(), f"{sid}.json")


def mint_sid() -> str:
    return uuid.uuid4().hex[:8]


def save_workspace(name: str, payload: dict, sid: str | None = None) -> dict:
    """存一份 ETA 工作台 payload(不透明), 返回元数据。
    review F2/EB-07:temp + os.replace 原子落盘——此前直写,中途失败会把
    既有存档截断损毁。"""
    sid = sid or mint_sid()
    rec = {"id": sid, "name": name,
           "saved_at": datetime.now(timezone.utc).isoformat(), "payload": payload}
    tmp = _path(sid) + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(rec, f, ensure_ascii=False, indent=2)
        os.replace(tmp, _path(sid))
    except BaseException:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise
    return {"id": sid, "name": name, "saved_at": rec["saved_at"]}


def list_workspaces() -> list[dict]:
    out = []
    for fn in os.listdir(_dir()):
        if fn.endswith(".json"):
            try:
                with open(os.path.join(_dir(), fn), encoding="utf-8") as f:
                    r = json.load(f)
                out.append({"id": r["id"], "name": r["name"], "saved_at": r["saved_at"]})
            except Exception:
                pass
    out.sort(key=lambda x: x["saved_at"], reverse=True)
    return out


def load_workspace(sid: str) -> dict:
    p = _path(sid)
    if not os.path.isfile(p):
        raise KeyError(sid)
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def delete_workspace(sid: str) -> None:
    p = _path(sid)
    if not os.path.isfile(p):
        raise KeyError(sid)
    os.remove(p)
