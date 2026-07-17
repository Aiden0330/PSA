from __future__ import annotations
from dataclasses import dataclass, field, replace
from typing import TYPE_CHECKING, Optional

from psaengine.model.parameters import ParameterLibrary

if TYPE_CHECKING:                                    # 避免与 model.py 的循环导入
    from psaengine.model.model import Model


# ── regime-A 条件参数重绑定 ──────────────────────────────────────────────────────
# 规格:docs/superpowers/specs/2026-07-15-regime-a-rebind-mef-substitution-banked.md §2
# 语义出处:XFTA §7.2(regime A = house 配置条件下的参数重绑定,精确且 BDD 兼容——
# 改的是 q 映射而非割集列表,故 exact/MCS/importance/CCF 展开全部经有效库视图自动一致)。
#
# 单一咽喉设计(MUST):唯一应用点 = effective_parameters();Analysis.__init__ 以解析后
# house 配置调用之,下游全部经 self.q 视图取 unavailability()。禁止逐 unavailability()
# 调用点接线(引擎侧 10+ 处,逐点必漏——88× 教训同族)。


@dataclass
class RebindRule:
    """house 配置条件下对某基本事件参数的换法则。

    - value 形式:点值覆盖 → 有效库条目 = Parameter(param, "probability", value)。
    - to_param 形式:整法则替换(XFTA「取 target 之律」)→ 有效库条目 = to_param 的完整
      Parameter(kind/字段/分布全套),但 id 保留为 param。
    value XOR to_param,恰给一个。
    """
    id: str
    when: dict                                       # dict[house_id, bool];非空,全部命中才激活
    param: str
    value: Optional[float] = None
    to_param: Optional[str] = None

    def __post_init__(self) -> None:
        if not self.when:
            raise ValueError(f"rebind rule '{self.id}': when must be non-empty "
                             "(条件为空的规则语义未定义)")
        has_value = self.value is not None
        has_to = self.to_param is not None
        if has_value == has_to:                      # 同给或双缺
            raise ValueError(f"rebind rule '{self.id}': give exactly one of value / to_param "
                             f"(value={self.value!r}, to_param={self.to_param!r})")
        if has_value and not 0.0 <= float(self.value) <= 1.0:
            raise ValueError(f"rebind rule '{self.id}': value {self.value} out of [0,1]")


def _house_base_states(model: "Model") -> dict[str, bool]:
    """house 节点集与基态。engine-review F-2:跨树收集时同名 house 基态不一致会静默
    后写胜——数值随树序列化顺序翻转(审计/复现事故)。模型级规则遇同 id 不一致必炸,
    绝不让字典序决定风险数。"""
    base: dict[str, bool] = {}
    for ft in model.fault_trees.values():
        for n in ft.pdag.nodes.values():
            if n.is_house:
                if n.id in base and base[n.id] != bool(n.state):
                    raise ValueError(
                        f"house event '{n.id}' has conflicting base states across fault trees "
                        f"({base[n.id]} vs {bool(n.state)}) — a model-level rebind rule cannot "
                        "resolve it deterministically; rename or unify the house base state")
                base[n.id] = bool(n.state)
    return base


def _is_active(rule: RebindRule, house_config: dict, base: dict[str, bool]) -> bool:
    """规则激活 iff ∀(h,s)∈when:有效 house 态(h)==s。
    有效 house 态 = 显式 house_config > PDAG 基态(4a2 优先级;bc_set 已并入 house_config)。
    when 引用未知 house(不在被分析图)→ 响亮。"""
    # engine-review F-4:先全量校验 when 键存在性,再判激活——否则前项状态不符即短路,
    # 后项的未知 house 永不校验(键序决定是否响亮,守卫不完备)。
    for h in rule.when:
        if h not in base:
            raise ValueError(f"rebind rule '{rule.id}': when references unknown house "
                             f"'{h}' (not a house event in the analyzed graph)")
    for h, want in rule.when.items():
        eff = house_config.get(h, base[h]) if house_config else base[h]
        if bool(eff) != bool(want):
            return False
    return True


def effective_parameters(model: "Model", house_config: Optional[dict] = None,
                         purpose: str = "point") -> ParameterLibrary:
    """返回本次分析的有效参数库视图(浅拷贝,被绑条目替换;模型本体绝不改写)。

    purpose="point"  —— probability/cutsets/importance(点扰动)通道。
    purpose="sampling" —— 不确定性抽样通道;任一规则激活即 raise(regime-A × 分布抽样
                          语义留 v2,见规格 §2 排除项)。抽样类调用方以此目的取库为接线义务。
    """
    rules = list(getattr(model, "rebind_rules", None) or [])
    if not rules:
        return model.parameters                      # 零规则:原库直通(基准/常规模型零扰动)

    base = _house_base_states(model)
    hc = house_config or {}
    active = [r for r in rules if _is_active(r, hc, base)]
    if not active:
        return model.parameters                      # 无激活规则:原库直通(R2 逐位基态)

    if purpose == "sampling":
        raise ValueError(
            f"rebind rule '{active[0].id}': parameter rebinding is not supported under "
            "sampling purpose in v1 (regime-A × distribution sampling deferred to v2); "
            "see spec 2026-07-15-regime-a §2")

    # 同一 param ≥2 条激活规则:不许静默后写胜
    by_param: dict[str, list[str]] = {}
    for r in active:
        by_param.setdefault(r.param, []).append(r.id)
    for pid, ids in by_param.items():
        if len(ids) > 1:
            raise ValueError(f"conflicting active rebind rules for parameter '{pid}': "
                             f"{ids} (>=2 rules active on the same parameter)")

    # 有效库视图:浅拷贝(共享未绑 Parameter 引用),被绑条目替换为新 Parameter 对象。
    lib = model.parameters
    view = ParameterLibrary()
    for pid in lib.ids():
        view.add(lib.get(pid))
    for r in active:
        if r.param not in lib:
            raise ValueError(f"rebind rule '{r.id}': parameter '{r.param}' not defined")
        target = lib.get(r.param)
        if target.kind == "frequency":
            raise ValueError(f"rebind rule '{r.id}': parameter '{r.param}' is frequency-kind "
                             "(IE λ 不是配置可绑量;IE 树内 probability-kind 使能参数才可绑)")
        if r.value is not None:
            from psaengine.model.parameters import Parameter
            view.add(Parameter(r.param, "probability", float(r.value)))
        else:
            if r.to_param not in lib:
                raise ValueError(f"rebind rule '{r.id}': to_param '{r.to_param}' not defined")
            src = lib.get(r.to_param)
            if src.kind == "frequency":
                raise ValueError(f"rebind rule '{r.id}': to_param '{r.to_param}' is frequency-kind "
                                 "(不可作为 probability 通道的换法则来源)")
            view.add(replace(src, id=r.param))       # 取 target 之律,id 保留为 param
    return view


def reject_rebind_unwired(model: "Model", channel: str) -> None:
    """engine-review F-1:v1 只有 Analysis(point/importance/CCF)通道经 effective_parameters
    接线;ETA 序列 / 频率 / MC 抽样通道仍读裸 model.parameters,规则会被静默忽略——同模型
    两页两个数,且方向落在风险低估侧(规则建模「工况劣化 q 升」时低估)。接线补齐前,这些
    通道对非空 rebind_rules **响亮拒绝**,绝不静默算错数。接线义务见 ROADMAP backlog。"""
    if getattr(model, "rebind_rules", None):
        raise ValueError(
            f"regime-A rebind rules are not yet wired into the {channel} channel (v1: only the "
            "Analysis point/importance channel honors rebind); refusing to compute silently on the "
            "base library. Use fault_tree Analysis, or await the ETA/frequency/MC wiring (backlog).")
