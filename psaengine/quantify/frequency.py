"""初因事件故障树的频率量化(规格 2026-07-13-ie-fault-tree-frequency)。

行业标准方法(RiskSpectrum / SAPHIRE / CAFTA-FRANX 同):
  每个最小割集**恰好一个**频率事件(初因率, /yr),其余为无量纲使能概率;
  割集频率 = 率 × Π(使能概率);顶事件频率 F = Σ 割集频率。
频率的并即求和——绝非概率通道的 1−Π(1−q):频率不是概率,不可互补、不可封顶 1;
两个频率相乘量纲为 1/yr²,直接拒绝。保守性(engine-review 2026-07-13 F5 更正):
不同初因间求和是**精确**的(不同 Poisson 初因同时发生测度为零),共享使能事件亦精确
((λ₁+λ₂)·q);Σ 的高估来自**同一初因出现在多个割集**(λ·P(A∪B) ≤ λ(qA+qB)),
非稀有使能概率下可超物理上界——与 RiskSpectrum 同为标准做法,方向恒保守;
逐初因精确模式(对每初因的使能析取建 BDD)记入对标账本作为将来增强。

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
from psaengine.model.pdag import Op
from psaengine.quantify.cutsets import minimal_cutsets


def _reject_non_coherent(pdag, ft_name: str) -> None:
    """频率通道仅支持相干树:MCS 枚举(_paths_to_one)按设计丢弃负文字,
    NOT/XOR 会得到静默错误的割集与频率(review F1)——直接响亮拒绝。"""
    seen: set[str] = set()
    stack = [pdag.top]
    while stack:
        nid = stack.pop()
        if nid in seen:
            continue
        seen.add(nid)
        n = pdag.nodes.get(nid)
        if n is None:
            continue
        op = getattr(n, "op", None)
        if op in (Op.NOT, Op.XOR):
            raise FrequencyRuleError(
                f"fault tree {ft_name} contains non-coherent gate {op.value.upper()} at {nid}; "
                "初因频率树仅支持相干逻辑(AND/OR/表决)——NOT/XOR 下最小割集枚举会静默丢弃负文字")
        stack.extend(getattr(n, "args", []) or [])


class FrequencyRuleError(ValueError):
    """违反「每割集恰好一个频率事件」——量纲无从成立,响亮拒绝(绝不静默近似)。"""


def fault_tree_frequency(model: Model, ft_name: str, cutoff: float = 0.0) -> dict:
    """量化 ft_name 为初因频率(/yr)。

    返回 {"frequency": F, "cutsets": [{"events","order","frequency","initiator"}...]}
    (cutsets 按频率降序)。任何割集的频率事件数 ≠ 1 → FrequencyRuleError,
    即使该割集会被 cutoff 截掉也先校验(规则违规必须可见;规则定义在**最小化后**的
    割集上——被吸收律吞并的形并不改变布尔函数,见 review F6)。
    非相干门(NOT/XOR)直接拒绝:MCS 枚举只取正文字,静默丢负文字会给出错误的
    割集与频率(review F1);limit_order 已整体移除——它截断的是头条数字本身,
    与概率通道(精确 P 不受影响)不同,静默低估不可接受(review F2)。
    """
    ft = model.fault_trees[ft_name]
    pdag = normalize(ft.pdag)
    _reject_non_coherent(pdag, ft_name)
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

    cuts = minimal_cutsets(m, root, q=None)

    detailed: list[dict] = []
    for c in cuts:
        initiators = [e for e in c.events if e in freq_value]
        if len(initiators) != 1:
            hint = "(空割集:顶事件恒真——检查常量/house 输入)" if not c.events else ""
            raise FrequencyRuleError(
                f"cut set {sorted(c.events)} has {len(initiators)} frequency events "
                f"({sorted(initiators)}); exactly one required — "
                f"每个最小割集须恰好一个频率事件(初因率),其余为使能概率{hint}")
        init = initiators[0]
        f = freq_value[init] * prod(enabling_q[e] for e in c.events if e != init)
        detailed.append({"events": sorted(c.events), "order": c.order,
                         "frequency": f, "initiator": init})

    detailed = [d for d in detailed if d["frequency"] >= cutoff]
    detailed.sort(key=lambda d: (-d["frequency"], d["order"], d["events"]))
    return {"frequency": sum(d["frequency"] for d in detailed), "cutsets": detailed}
