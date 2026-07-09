"""Canonical ProjectDocument schema v1.0 (ADR-1 §6).

Design decisions carried from the spec:
- D3: MEF-aligned core naming (basic-event/house-event/gate, ccf groups,
  parameters) + workbench namespace for concepts MEF lacks.
- D4: every entity has a stable `uuid` (identity; all cross-references use
  uuids) plus a human-readable `ref` (used in MEF export / engine requests /
  reports) and an optional display `label`.
- Provenance blocks are mandatory on value-carrying entities.

v1 pragmatic deviations (recorded in the plan):
- parameters/fault_trees are scoped per event tree, mirroring payload v2's
  per-tab `fts` (same ref may denote different values across tabs). Document-
  level pooling is Phase 3 normalization work.
- CcfGroup.members hold refs (strings), not uuids, until CCF gets first-class
  editing.
- FunctionalEvent keeps BOTH a pfd parameter (last known value + provenance)
  and an optional linked fault tree (computed-from marker) — lossless with
  v2's failProb/linkFt pair.

Strictness: every model forbids unknown fields, so the exported JSON Schema
carries additionalProperties:false throughout (ADR-3 relies on this).
"""
from __future__ import annotations

from typing import Any, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field

SCHEMA_VERSION = "1.0"


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Source(_Strict):
    citation: Optional[str] = None
    url: Optional[str] = None
    note: Optional[str] = None


class Provenance(_Strict):
    origin: Literal["human", "ai-draft", "import", "library"] = "human"
    source: Optional[Source] = None
    grade: Optional[str] = None      # A|B|C|D by convention; str so odd archives convert
    unit: Optional[str] = None
    evidence: list[str] = Field(default_factory=list)
    # Stamped by the storage layer at save time (ADR-2), never during
    # conversion — content hashing strips these (serialize.content_hash).
    created_at: Optional[str] = None
    modified_at: Optional[str] = None


class Distribution(_Strict):
    family: str
    params: dict[str, Any] = Field(default_factory=dict)


class Parameter(_Strict):
    uuid: str
    ref: str
    kind: Literal["probability", "rate", "frequency"]
    value: float
    mttr: Optional[float] = None
    test_interval: Optional[float] = None
    mission_time: Optional[float] = None
    distribution: Optional[Distribution] = None
    label: Optional[str] = None
    provenance: Provenance = Field(default_factory=Provenance)
    # Verbatim residue of v2 ParamJson's open fields (round-trip fidelity).
    extra: dict[str, Any] = Field(default_factory=dict)


class FtNode(_Strict):
    uuid: str
    ref: str
    type: Literal["basic-event", "house-event", "gate"]
    op: Optional[Literal["and", "or", "atleast", "xor", "not", "null"]] = None
    args: list[str] = Field(default_factory=list)  # node uuids
    k: Optional[int] = None
    state: Optional[bool] = None                   # house-event only (spec 6.4)
    param: Optional[str] = None                    # parameter uuid
    label: Optional[str] = None


class FaultTree(_Strict):
    uuid: str
    ref: str                                       # was v2 identity ("name")
    label: Optional[str] = None
    top: str                                       # node uuid
    nodes: list[FtNode] = Field(default_factory=list)


class CcfGroup(_Strict):
    uuid: str
    ref: str
    members: list[str] = Field(default_factory=list)   # refs (v1 deviation)
    model: str                                          # beta|mgl|alpha|phi by convention
    factors: dict[str, float] = Field(default_factory=dict)
    provenance: Provenance = Field(default_factory=Provenance)


class ProductDims(_Strict):
    cells_per_pack: float
    packs_per_system: float
    cell_failure_rate: float


class InitiatingEvent(_Strict):
    uuid: str
    ref: str
    description: str                               # v2 initEvent (also display fallback)
    frequency_param: str                           # parameter uuid (kind=frequency)
    freq_source: Literal["manual", "ft", "product"] = "manual"
    product: Optional[ProductDims] = None
    provenance: Provenance = Field(default_factory=Provenance)


class FunctionalEvent(_Strict):
    uuid: str
    ref: str                                       # stable id (B_BMS / FE1)
    label: Optional[str] = None                    # Chinese display name
    pfd_param: str                                 # parameter uuid (kind=probability)
    linked_fault_tree: Optional[str] = None        # fault tree uuid
    provenance: Provenance = Field(default_factory=Provenance)


class EtLeaf(_Strict):
    kind: Literal["leaf"]
    consequence: str                               # consequence uuid


class EtBranch(_Strict):
    kind: Literal["branch"]
    fe: str                                        # functional event uuid
    success: "EtNode"
    failure: "EtNode"


EtNode = Union[EtBranch, EtLeaf]


class Consequence(_Strict):
    uuid: str
    ref: str                                       # C1..C5 or custom K1..
    desc: str = ""
    level: Literal["C1", "C2", "C3", "C4", "C5"]


class EventTree(_Strict):
    uuid: str
    ref: str                                       # v2 tab key (stable)
    name: str
    name_locked: bool = False                      # v2 `renamed`
    initiating_event: InitiatingEvent
    functional_events: list[FunctionalEvent] = Field(default_factory=list)
    root: EtNode
    consequences: list[Consequence] = Field(default_factory=list)
    parameters: list[Parameter] = Field(default_factory=list)
    fault_trees: list[FaultTree] = Field(default_factory=list)
    ccf_groups: list[CcfGroup] = Field(default_factory=list)


class ModelBundle(_Strict):
    """A standalone FTA workspace (workbench user_fts)."""
    parameters: list[Parameter] = Field(default_factory=list)
    fault_trees: list[FaultTree] = Field(default_factory=list)
    ccf_groups: list[CcfGroup] = Field(default_factory=list)


class Workbench(_Strict):
    # D2: analysis-relevant config lives in-document.
    aggregate_scope: list[str] = Field(default_factory=list)   # event tree uuids
    user_fts: Optional[ModelBundle] = None
    # FMEA rows/mapping pass through opaquely in v1 (uuid-ification is Phase 3).
    fmea_rows: Optional[list[Any]] = None
    fmea_mapping: Optional[dict[str, Any]] = None


class ProjectInfo(_Strict):
    uuid: str
    name: Optional[str] = None
    created_at: Optional[str] = None
    modified_at: Optional[str] = None


class ProjectDocument(_Strict):
    schema_version: Literal["1.0"] = SCHEMA_VERSION
    project: ProjectInfo
    event_trees: list[EventTree] = Field(default_factory=list)
    workbench: Workbench = Field(default_factory=Workbench)


EtBranch.model_rebuild()
ProjectDocument.model_rebuild()
