"""初因事件故障树的频率量化(规格 2026-07-13-ie-fault-tree-frequency)。

行业标准方法(RiskSpectrum / SAPHIRE / CAFTA-FRANX 同):
  每个最小割集**恰好一个**频率事件(初因率, /yr),其余为无量纲使能概率;
  割集频率 = 率 × Π(使能概率);顶事件频率 F = Σ 割集频率。
频率的并即求和——绝非概率通道的 1−Π(1−q):频率不是概率,不可互补、不可封顶 1;
两个频率相乘量纲为 1/yr²,直接拒绝。对跨割集共享的使能事件,Σ 为保守方向(高估并)。

与概率通道(exact_probability/Analysis)公用 MCS 机器(minimal_cutsets),
但量化语义完全分离;概率通道对频率参数的反向护栏在 Parameter.unavailability()。
v1 范围:相干树(与 MOCUS 枚举一致);IE 树不含 house/CCF(模态内用户自建树)。
"""
from __future__ import annotations

from math import prod

from psaengine.bdd.kernel import BddManager, build_from_pdag
from psaengine.model.model import Model
from psaengine.ordering.heuristics import dflm
from psaengine.preprocess.normalize import normalize
from psaengine.quantify.cutsets import minimal_cutsets


class FrequencyRuleError(ValueError):
    """违反「每割集恰好一个频率事件」——量纲无从成立,响亮拒绝(绝不静默近似)。"""


def fault_tree_frequency(model: Model, ft_name: str, cutoff: float = 0.0,
                         limit_order: int | None = None) -> dict:
    """量化 ft_name 为初因频率(/yr)。

    返回 {"frequency": F, "cutsets": [{"events","order","frequency","initiator"}...]}
    (cutsets 按频率降序)。任何割集的频率事件数 ≠ 1 → FrequencyRuleError,
    即使该割集会被 cutoff 截掉也先校验(规则违规必须可见)。
    """
    ft = model.fault_trees[ft_name]
    pdag = normalize(ft.pdag)
    order = dflm(pdag)
    m = BddManager(order)
    root = build_from_pdag(m, pdag, pdag.top)

    freq_value: dict[str, float] = {}
    enabling_q: dict[str, float] = {}
    for b in pdag.basic_events():
        p = model.parameters.get(pdag.node(b).param_ref)
        if p.kind == "frequency":
            if p.value < 0:
                raise ValueError(f"frequency {p.id}={p.value} must be >= 0")
            freq_value[b] = p.value
        else:
            enabling_q[b] = p.unavailability()      # probability / rate(λ·MTTR 等)

    cuts = minimal_cutsets(m, root, q=None, limit_order=limit_order)

    detailed: list[dict] = []
    for c in cuts:
        initiators = [e for e in c.events if e in freq_value]
        if len(initiators) != 1:
            raise FrequencyRuleError(
                f"cut set {sorted(c.events)} has {len(initiators)} frequency events "
                f"({sorted(initiators)}); exactly one required — "
                "每个最小割集须恰好一个频率事件(初因率),其余为使能概率")
        init = initiators[0]
        f = freq_value[init] * prod(enabling_q[e] for e in c.events if e != init)
        detailed.append({"events": sorted(c.events), "order": c.order,
                         "frequency": f, "initiator": init})

    detailed = [d for d in detailed if d["frequency"] >= cutoff]
    detailed.sort(key=lambda d: (-d["frequency"], d["order"], d["events"]))
    return {"frequency": sum(d["frequency"] for d in detailed), "cutsets": detailed}
