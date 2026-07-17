"""ADR-1 canonical layer: the single ProjectDocument schema + lossless v2 converters.

Strangler rule: existing endpoints keep speaking payload v2; new capabilities
(storage/versioning/audit, AI structured output, diff) speak canonical only.
"""
from backend.canonical.models import ProjectDocument, SCHEMA_VERSION
from backend.canonical.convert import to_canonical, to_v2
from backend.canonical.serialize import canonical_json, content_hash
from backend.canonical.engine_request import build_engine_request, integrated_variant

__all__ = ["ProjectDocument", "SCHEMA_VERSION", "to_canonical", "to_v2",
           "canonical_json", "content_hash", "build_engine_request", "integrated_variant"]
