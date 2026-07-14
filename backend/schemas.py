from __future__ import annotations
from typing import Any, Literal, Optional
from pydantic import BaseModel

class QuantifyRequest(BaseModel):
    model: dict[str, Any]
    fault_tree: Optional[str] = None
    method: str = "exact"
    cutoff: float = 0.0
    limit_order: Optional[int] = None
    # 4a2 边界条件:house 事件状态覆盖 / 模型内命名边界条件集(boundary_condition_sets)
    house_states: dict[str, bool] = {}
    boundary_condition_set: Optional[str] = None
    # 4a3 割集后处理规则(互斥组/删除/恢复);只作用于 MCS 列表,精确概率不受影响
    post_rules: list[dict[str, Any]] = []

class CutSetOut(BaseModel):
    events: list[str]
    order: int
    probability: float

class QuantifyResponse(BaseModel):
    probability: float
    method: str
    cutsets: list[CutSetOut]
    importance: dict[str, dict[str, float]]
    # 4a3:应用了 post_rules 时的统计与后处理列表 REA/MCUB 估计(未用规则时缺省 None,旧契约不变)
    post: Optional[dict[str, Any]] = None

# ── 初因事件故障树频率量化(规格 2026-07-13;与 QuantifyRequest 同口径的独立端点)──
class FtFrequencyRequest(BaseModel):
    model: dict[str, Any]
    fault_tree: str
    cutoff: float = 0.0
    limit_order: Optional[int] = None

class FreqCutSetOut(BaseModel):
    events: list[str]
    order: int
    frequency: float
    initiator: str                     # 该割集中唯一的频率事件(每割集一频率规则)

class FtFrequencyResponse(BaseModel):
    frequency: float                   # /yr,Σ 割集频率
    cutsets: list[FreqCutSetOut]

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
    ccf_groups: list[dict[str, Any]] = []            # 4a1:CCF 在合并 PDAG 上展开(跨屏障共享共因)
    house_states: dict[str, bool] = {}               # 4a2 边界条件(直接覆盖)
    boundary_condition_sets: list[dict[str, Any]] = []   # 4a2 命名集定义(随模型)
    boundary_condition_set: Optional[str] = None     # 4a2 按名引用
    # 4a4:携带项目上下文 → 不确定性/重要度运行同样自动钉扎为分析案例(ADR-2 证据链)
    project_uuid: Optional[str] = None
    project_payload: Optional[dict[str, Any]] = None
    scenario_name: Optional[str] = None

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
    base_version_hash: str | None = None   # D-P5-4 乐观并发:客户端加载时的版本哈希

class MefImportRequest(BaseModel):
    xml: str

class ReportRequest(EtUncertaintyRequest):
    scenario_name: str = "ETA"
    tree_png: Optional[str] = None    # 'data:image/png;base64,...'
    consequence_defs: dict[str, str] = {}   # C1..C5 自定义内涵(空则回退内置)
    labels: dict[str, str] = {}             # fe_id → 人类可读屏障名
    # ADR-2 证据链钉扎(可选,两者同给才生效):项目 uuid + 完整 v2 payload。
    # dirty 时自动建版本(origin=auto_pin)+ 分析案例,报告页脚带 案例#/版本哈希/引擎版本。
    project_uuid: Optional[str] = None
    project_payload: Optional[dict[str, Any]] = None

class AiDraftRequest(BaseModel):
    goal: str
    target: Literal["eta", "fta", "eta_with_fta"]
    current_project: dict[str, Any]
    active_eta_key: Optional[str] = None
    user_context: dict[str, Any] = {}
    project_uuid: Optional[str] = None               # 4b2:有项目上下文时生成即落 ai_drafts + 审计

class AiDraftAppliedRequest(BaseModel):
    status: Literal["applied", "rejected"] = "applied"
    accepted: dict[str, Any] = {}                    # 逐元素接受清单(D7 ghost-diff)
    project_uuid: Optional[str] = None

class AiDraftValidation(BaseModel):
    ok: bool
    errors: list[str] = []
    warnings: list[str] = []
    stages: Optional[dict[str, Any]] = None          # 4b1:schema/lint/dry_run 分段错误

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
    provenance: Optional[dict[str, Any]] = None      # 4b1:model_id/served_by/prompt_version/轨迹
    ai_draft_id: Optional[int] = None                # 4b2:ai_drafts 行 id(应用回执用)
