"""Deterministic entity uuids (ADR-1 D4/D6).

Same project uuid + same v2 content => byte-identical canonical document =>
same content hash, which is what makes ADR-2's save-idempotency work. Entity
uuids are uuid5 over a project-scoped namespace and a kind-qualified path.
"""
from __future__ import annotations

import uuid


def project_ns(project_uuid: str) -> uuid.UUID:
    return uuid.UUID(project_uuid)


def entity_uuid(ns: uuid.UUID, path: str) -> str:
    return str(uuid.uuid5(ns, path))
