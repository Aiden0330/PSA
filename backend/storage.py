from __future__ import annotations
import json, os, re, tempfile, uuid
from datetime import datetime, timezone

_DIR = os.path.join(os.path.dirname(__file__), "..", "saved")
_ID_RE = re.compile(r"^[0-9a-f]+$")


def _dir() -> str:
    os.makedirs(_DIR, exist_ok=True)
    return _DIR


def is_valid_sid(sid: str) -> bool:
    return bool(_ID_RE.match(sid))


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
    # review F2-R1(2026-07-16 冷读):此前共享 `{sid}.tmp`——并发同 sid 保存互相
    # 消耗对方 tmp(小载荷 FileNotFoundError、大载荷发布可解析的混编 JSON),且异常
    # 清理误删对方在途 tmp。改用同目录唯一临时名(mkstemp)+ os.replace 原子换入。
    d = _dir()
    fd, tmp = tempfile.mkstemp(prefix=f".{sid}-", suffix=".tmp", dir=d)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(rec, f, ensure_ascii=False, indent=2)
        os.replace(tmp, _path(sid))                  # 同目录 rename:原子;最后写者胜
    except BaseException:
        if os.path.exists(tmp):
            os.remove(tmp)                           # 只删本调用自己的唯一 tmp
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
