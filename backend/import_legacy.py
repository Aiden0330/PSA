"""One-time import of legacy saved/*.json archives into the ADR-2 store.

Each archive becomes one project (uuid5-derived from its sid, so re-imports
and later /api/saved dual-writes converge on the same project) with one
version (origin='import'). Pre-v2 single-ETA archives are wrapped the same
way the frontend's deserializeProject does. Idempotent: identical content
hits the version-hash idempotency and creates nothing.

Run: .venv/bin/python -m backend.import_legacy
"""
from __future__ import annotations

import json
import os

from backend import storage, store
from backend.canonical import to_canonical

_EMPTY_FTS = {"model_data": {"parameters": []}, "fault_trees": []}


def wrap_legacy(payload: dict, fallback_name: str) -> dict:
    """Mirror frontend deserializeProject's legacy single-ETA branch."""
    key = "saved0"
    model = payload.get("etModel", payload)
    return {"v": 2,
            "etas": [{"key": key, "name": fallback_name or "ETA", "renamed": True,
                      "model": model, "fts": payload.get("fts") or _EMPTY_FTS, "pfds": {}}],
            "activeKey": key, "checkedKeys": {key: True}}


def import_saved_dir(directory: str | None = None) -> list[dict]:
    directory = directory or storage._dir()
    results: list[dict] = []
    if not os.path.isdir(directory):
        return results
    for fn in sorted(os.listdir(directory)):
        if not fn.endswith(".json"):
            continue
        with open(os.path.join(directory, fn), encoding="utf-8") as f:
            rec = json.load(f)
        sid, name = rec["id"], rec.get("name", fn)
        payload = rec.get("payload", {})
        wrapped = payload.get("v") == 2 and isinstance(payload.get("etas"), list)
        v2 = payload if wrapped else wrap_legacy(payload, name)
        puuid = store.legacy_project_uuid(sid)
        try:
            doc, sidecar = to_canonical(v2, puuid, project_name=name)
        except Exception as e:
            results.append({"sid": sid, "ok": False, "error": str(e)})
            continue
        store.ensure_project(puuid, name)
        ver = store.create_version(puuid, doc, sidecar, origin="import",
                                   message=f"import saved/{sid}.json"
                                           + ("" if wrapped else " (legacy single-ETA wrapped)"))
        results.append({"sid": sid, "ok": True, "project_uuid": puuid, **ver})
    return results


if __name__ == "__main__":
    for r in import_saved_dir():
        print(r)
