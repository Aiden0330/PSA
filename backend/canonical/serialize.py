"""Canonical serialization + content hash (ADR-1 §6.6).

The hash is computed over the document with volatile stamps stripped
(created_at / modified_at at every level), so identical content always
yields the identical hash — the idempotency premise of ADR-2's
save-creates-version (D6).
"""
from __future__ import annotations

import hashlib
import json
from typing import Any

from backend.canonical.models import ProjectDocument

_VOLATILE = {"created_at", "modified_at"}


def _strip(x: Any) -> Any:
    if isinstance(x, dict):
        return {k: _strip(v) for k, v in x.items() if k not in _VOLATILE}
    if isinstance(x, list):
        return [_strip(v) for v in x]
    return x


def canonical_json(doc: ProjectDocument) -> str:
    """Deterministic full serialization (sorted keys, compact, UTF-8)."""
    return json.dumps(doc.model_dump(mode="json"), sort_keys=True,
                      ensure_ascii=False, separators=(",", ":"))


def content_hash(doc: ProjectDocument) -> str:
    stripped = _strip(doc.model_dump(mode="json"))
    blob = json.dumps(stripped, sort_keys=True, ensure_ascii=False,
                      separators=(",", ":"))
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()
