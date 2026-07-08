from __future__ import annotations
from typing import Any, Literal, Optional
from pydantic import BaseModel

class QuantifyRequest(BaseModel):
    model: dict[str, Any]
    fault_tree: Optional[str] = None
    method: str = "exact"
    cutoff: float = 0.0
    limit_order: Optional[int] = None

class CutSetOut(BaseModel):
    events: list[str]
    order: int
    probability: float

class QuantifyResponse(BaseModel):
    probability: float
    method: str
    cutsets: list[CutSetOut]
    importance: dict[str, dict[str, float]]

class FuncEventIn(BaseModel):
    id: str
    pfd: Optional[float] = None
    link_ft: Optional[str] = None

class EtQuantifyRequest(BaseModel):
    init_event: str
    init_frequency: float
    functional_events: list[FuncEventIn]
    fault_trees: dict[str, Any] = {}
    parameters: dict[str, Any] = {}
    sequences: list[dict]
    consequence_bins: dict[str, str]

class EtQuantifyResponse(BaseModel):
    sequences: dict[str, float]
    consequences: dict[str, float]

class EtUncertaintyRequest(EtQuantifyRequest):
    samples: int = 1000
    seed: int = 42
    error_factor: float = 3.0

class SaveWorkspaceRequest(BaseModel):
    name: str
    payload: dict
    id: str | None = None      # 传入已有存档 id → 原地更新; 省略 → 新建

class MefImportRequest(BaseModel):
    xml: str

class ReportRequest(EtUncertaintyRequest):
    scenario_name: str = "ETA"
    tree_png: Optional[str] = None    # 'data:image/png;base64,...'
    consequence_defs: dict[str, str] = {}   # C1..C5 自定义内涵(空则回退内置)
    labels: dict[str, str] = {}             # fe_id → 人类可读屏障名

class AiDraftRequest(BaseModel):
    goal: str
    target: Literal["eta", "fta", "eta_with_fta"]
    current_project: dict[str, Any]
    active_eta_key: Optional[str] = None
    user_context: dict[str, Any] = {}

class AiDraftValidation(BaseModel):
    ok: bool
    errors: list[str] = []
    warnings: list[str] = []

class AiDraftResponse(BaseModel):
    draft_id: str
    summary: str = ""
    assumptions: list[str] = []
    questions: list[str] = []
    etas: list[dict[str, Any]] = []
    fts: dict[str, Any] = {}
    traceability: list[dict[str, Any]] = []
    warnings: list[str] = []
    validation: AiDraftValidation
