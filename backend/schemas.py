from __future__ import annotations
from typing import Any, Literal, Optional
from pydantic import BaseModel

class QuantifyRequest(BaseModel):
    model: dict[str, Any]
    fault_tree: Optional[str] = None
    # EB-05/O1:严格枚举(与引擎 Analysis.probability 双锁);拼写错误 → 422 而非静默落 REA。
    method: Literal["exact", "mcub", "rea"] = "exact"
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
    method: Literal["sum", "exact"] = "sum"   # exact = 逐初因使能析取 BDD(Gap 9,规格 2026-07-14)
    # limit_order 有意不提供:频率通道的头条数字 = Σ 割集,阶截断直接咬掉头条
    # (不同于概率通道的精确 P 不受影响)——静默低估不可接受(engine-review F2)。

class FreqCutSetOut(BaseModel):
    events: list[str]
    order: int
    frequency: float
    initiator: str                     # 该割集中唯一的频率事件(每割集一频率规则)

class InitiatorRowOut(BaseModel):
    initiator: str
    rate: float                        # λ_i /yr
    enabling_probability: float        # P(该初因使能析取),BDD 精确
    frequency: float                   # λ_i × P

class FtFrequencyResponse(BaseModel):
    frequency: float                   # /yr;sum=Σ 割集(post-cutoff),exact=Σ 初因 λ·P(全割集口径;cutoff=0 时 ≤ sum)
    method: Literal["sum", "exact"] = "sum"
    cutsets: list[FreqCutSetOut]
    by_initiator: list[InitiatorRowOut] | None = None   # 仅 exact

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
    # 2026-07-15 序列级 LFT 集成:自包含 IE 块 {name?,top,nodes,parameters:[{id,kind,value}...]}
    # ——参数必须带 kind(初因=frequency);设置即走 integrated 通道,响应附 method/ie_frequency。
    ie_fault_tree: Optional[dict[str, Any]] = None
    scenario_name: Optional[str] = None

class EtQuantifyResponse(BaseModel):
    sequences: dict[str, float]
    consequences: dict[str, float]
    method: Optional[str] = None            # "integrated"(LFT 集成)时附;单树响应不变
    ie_frequency: Optional[float] = None    # 集成模式:Σλ_i·P(E_i),供 UI 与频率通道对账

class TreeSpec(BaseModel):
    """勾选集聚合(spec A)的单棵事件树载荷:与单树请求同形的每树字段 + 场景身份(key/name)
    + 可选口径注记(init_note,报告页脚逐树分解用)。labels/consequence_defs 仅报告路径消费。"""
    key: str
    name: str
    init_event: str
    init_frequency: float
    functional_events: list[FuncEventIn]
    fault_trees: dict[str, Any] = {}
    parameters: dict[str, Any] = {}
    sequences: list[dict]
    consequence_bins: dict[str, str]
    ccf_groups: list[dict[str, Any]] = []
    house_states: dict[str, bool] = {}
    boundary_condition_sets: list[dict[str, Any]] = []
    boundary_condition_set: Optional[str] = None
    labels: dict[str, str] = {}
    consequence_defs: dict[str, str] = {}
    init_note: Optional[str] = None            # 初因频率基准注记(spec B),页脚逐树分解带出

class EtUncertaintyRequest(EtQuantifyRequest):
    samples: int = 1000
    seed: int = 42
    error_factor: float = 3.0
    # 勾选集聚合(spec A):默认 single 零扰动;checked_set 时按 trees[] 联合抽样聚合。
    scope: Literal["single", "checked_set"] = "single"
    trees: list[TreeSpec] = []

class SaveWorkspaceRequest(BaseModel):
    name: str
    payload: dict
    id: str | None = None      # 传入已有存档 id → 原地更新; 省略 → 新建
    base_version_hash: str | None = None   # D-P5-4 乐观并发:客户端加载时的版本哈希

class MefImportRequest(BaseModel):
    xml: str

class ReportRequest(EtUncertaintyRequest):
    # ie_fault_tree 经 EtQuantifyRequest 继承已在;此处显式列出以彰显报告支持集成 LFT
    # (F3 阶段 1/EB-01:报告接集成通道)。
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
