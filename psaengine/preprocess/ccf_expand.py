from __future__ import annotations
import copy
from itertools import combinations
from math import comb

from psaengine.model.pdag import PDAG, Op
from psaengine.model.parameters import Parameter, ParameterLibrary

# MGL 层级因子键:ρ_2..ρ_7(NUREG/CR-5485 记号 β,γ,δ…)
_MGL_LEVELS = ("beta", "gamma", "delta", "epsilon", "mu", "nu")
_MAX_GROUP = 8   # 批次 F(P-8):对齐 RiskSpectrum 组上限 8(2^8−1=255 组合可控);>8 仍响亮拒绝
_FACTOR_SUM_TOL = 1e-4    # Σ=1 校验容差,对齐 SCRAM(其 phi 校验容差同级)
_HOMOG_TOL = 1e-9         # 多层展开同质性校验(成员 Q_t 相对差)


def q_levels(model: str, factors: dict, m: int, q_t: float, staggered: bool = False) -> list[float]:
    """Q_k(k=1..m):一个特定 k 重共因基本事件的概率。

    公式:NUREG/CR-5485 Tables 5-11/5-12;与 SCRAM ccf_group.cc 一致
    (spec: docs/superpowers/specs/2026-07-09-ccf-alpha-mgl-semantics.md)。
    一致性恒等式 Σ C(m-1,k-1)·Q_k = Q_t(alpha/mgl;phi 为直接指定,不适用)。
    """
    if m < 2:
        raise ValueError(f"CCF group needs >=2 members, got {m}")
    if m > _MAX_GROUP:
        raise ValueError(f"CCF group size {m} > {_MAX_GROUP} (subset explosion guard)")

    if model == "mgl":
        if staggered:
            raise ValueError("staggered testing is only supported for the alpha model")
        # 批次 F 收口(engine-review F-1):MGL 因子词汇止于 ν(ρ₂..ρ₇)⇒ 上限 7。
        # 不发明无出处的 ρ₈ 键名(数据溯源约束);8 组是 alpha 的地盘(α₁..α₈ 数字命名
        # 天然可扩,NUREG/CR-5485 大组惯例)。修前 m=8 越界 IndexError → 500 无因由。
        if m > len(_MGL_LEVELS) + 1:
            raise ValueError(
                f"MGL group size {m} > {len(_MGL_LEVELS) + 1} (factor vocabulary "
                f"β..ν = ρ₂..ρ₇); use the alpha model (alpha1..alpha{m}) for larger groups")
        # rho[0]=ρ1=1 … rho[m-1]=ρ_m, rho[m]=ρ_{m+1}=0
        rho = [1.0] + [float(factors.get(_MGL_LEVELS[i], 0.0)) for i in range(m - 1)] + [0.0]
        out = []
        for k in range(1, m + 1):
            prod = 1.0
            for i in range(k):
                prod *= rho[i]
            out.append(prod * (1.0 - rho[k]) * q_t / comb(m - 1, k - 1))
        return out

    if model == "alpha":
        alphas = [float(factors.get(f"alpha{k}", 0.0)) for k in range(1, m + 1)]
        if staggered:
            # 错峰式对 α 的尺度敏感(无 α_t 自归一):Σα=1 是 NUREG 定义,静默缩放不可接受
            if abs(sum(alphas) - 1.0) > _FACTOR_SUM_TOL:
                raise ValueError(f"staggered alpha factors must sum to 1, got {sum(alphas):.6g}")
            return [alphas[k - 1] * q_t / comb(m - 1, k - 1) for k in range(1, m + 1)]
        a_t = sum(k * alphas[k - 1] for k in range(1, m + 1))
        if a_t <= 0.0:
            raise ValueError(f"alpha factors sum to zero for group of size {m}")
        return [k * alphas[k - 1] / a_t * q_t / comb(m - 1, k - 1) for k in range(1, m + 1)]

    if model == "phi":
        phis = [float(factors.get(f"phi{k}", 0.0)) for k in range(1, m + 1)]
        if abs(sum(phis) - 1.0) > _FACTOR_SUM_TOL:
            raise ValueError("phi factors must sum to 1 (SCRAM convention)")
        return [phis[k - 1] * q_t for k in range(1, m + 1)]

    if model == "beta":
        raise ValueError("beta uses the lumped legacy expansion in apply_ccf, not q_levels")
    raise ValueError(f"unsupported CCF model '{model}' (mgl|alpha|phi; beta via apply_ccf)")


def _mint_ccf_event(g: PDAG, lib: ParameterLibrary, cid: str, grp_id: str, q: float,
                    source: str | None = None) -> None:
    """生成 CCF 事件并入图/库。生成名撞用户命名空间(节点或参数)即响亮——
    review EB-04(2026-07-16 三方评审):此前 PDAG.basic 对重名静默沿用用户节点、
    ParameterLibrary.add 静默覆盖用户参数(用户 CCF_g q=.9 被无声改写为 βQ,
    顶值 .901 → .018019 且无异常)。"""
    if cid in g.nodes or cid in lib:
        raise ValueError(
            f"CCF group '{grp_id}': generated event id '{cid}' collides with an "
            "existing node/parameter; rename the user-side node/parameter or the group")
    # source = 本组代表成员的参数 ref(q 由它的值导出)。MC 通道据此整组联动抽样:
    # 2^m−1 个铸参认知同源一个库参数,逐 ref 独立抽会按 √n 收窄上分位(非保守)。
    lib.add(Parameter(cid, "probability", q, epistemic_source=source))
    g.basic(cid, param_ref=cid)


def _expand_multilevel(g: PDAG, lib: ParameterLibrary, grp, members: list[str]) -> None:
    """mgl/alpha/phi 全子集展开:成员 x → OR(x__I, 含 x 的所有 k≥2 子集事件)。
    同质假设(NUREG):Q_t 取首成员参数。"""
    m = len(members)
    qs = [lib.get(g.nodes[x].param_ref).unavailability() for x in members]
    q_rep = qs[0]
    # 认知源:多层模型(mgl/alpha/phi)强制同质性校验(下方),组内 Q_t 必同源。
    # engine-review F4 裁决(2026-07-22):规格 §4 把 phi 列为"不联动",前提是"Q_k 非线性
    # 于单一 Q_t"。本库 phi 实现为 q_k = φ_k·Q_t(ccf_expand q_levels),对 Q_t **线性** ⇒
    # 该前提不成立,联动数学自洽且与 mgl/alpha 同理。规格 §4 已随本次落地修订记录。
    rep_ref = g.nodes[members[0]].param_ref
    # NUREG 同质假设:多层展开按单一 Q_t;成员异质时静默取首成员会使其余成员边际概率
    # 被无声改写(评审缺陷 #6)——显式拒绝,提示用 beta(逐成员)或先统一参数
    if any(abs(q - q_rep) > _HOMOG_TOL * max(q_rep, 1e-300) for q in qs):
        raise ValueError(
            f"CCF group '{grp.id}' ({grp.model}) requires homogeneous member probabilities, "
            f"got {dict(zip(members, qs))}; use the beta model or equalize parameters")
    qk = q_levels(grp.model, grp.factors, m, q_rep, staggered=getattr(grp, "staggered", False))

    subset_ids: dict[frozenset, str] = {}
    ordered = sorted(members)
    for k in range(2, m + 1):
        for combo in combinations(ordered, k):
            cid = f"CCF_{grp.id}_" + "_".join(combo)
            _mint_ccf_event(g, lib, cid, grp.id, qk[k - 1], source=rep_ref)
            subset_ids[frozenset(combo)] = cid

    for mem in members:
        indep_id = f"{mem}__I"
        _mint_ccf_event(g, lib, indep_id, grp.id, qk[0], source=rep_ref)
        node = g.nodes[mem]                          # 原位把成员改成 OR 门
        node.is_basic = False
        node.param_ref = None
        node.op = Op.OR
        node.args = [indep_id] + [cid for s, cid in subset_ids.items() if mem in s]


def apply_ccf(pdag: PDAG, ccf_groups, params: ParameterLibrary):
    """CCF 展开:把同组成员基本事件原位改为 OR(独立部分, 共因事件)。
    beta = 集总单事件(既有行为);mgl/alpha/phi = NUREG/CR-5485 全子集多层展开。
    成员变门后所有父引用自动指向该 OR。返回 (新 pdag, 扩充参数库)。"""
    if not ccf_groups:
        return pdag, params
    g = copy.deepcopy(pdag)
    lib = ParameterLibrary()
    for pid in params.ids():
        lib.add(copy.deepcopy(params.get(pid)))

    for grp in ccf_groups:
        present = [m for m in grp.members if m in g.nodes]
        if not present:
            continue                                 # 组属于其他故障树(逐树分析语义)→ 整组跳过
        members = [m for m in present if g.nodes[m].is_basic]
        # 部分在树 / 与先前组重叠(成员已被展开为门):按声明组规模展开会被静默改写 → 响亮失败
        if len(present) != len(grp.members) or len(members) != len(present):
            raise ValueError(
                f"CCF group '{grp.id}' partially present or overlapping in this tree "
                f"(declared {grp.members}, usable {members}); split the group or fix membership")
        if len(members) < 2:
            continue

        if grp.model == "beta":
            beta = grp.factors.get("beta", 0.0)
            if beta <= 0:
                continue
            rep_ref = g.nodes[members[0]].param_ref                            # 代表成员参数(q_rep 出处)
            q_rep = lib.get(rep_ref).unavailability()                          # 代表 Q(首成员)
            qm_of = {mem: lib.get(g.nodes[mem].param_ref).unavailability() for mem in members}
            # 认知联动前提(规格 §2)= 组员同 Q_t(同型冗余部件 ⇒ 失效率同出一处数据源)。
            # engine-review F2(2026-07-22):异质 beta 组不满足该前提,全组共源是未授权
            # 扩展(把不同数据源的部件强行相关,夸大到不可信)。异质时退回**派生忠实**:
            # 各成员独立部分随自己的参数走,共因项随代表参数走。
            homogeneous = all(abs(q - q_rep) <= _HOMOG_TOL * max(q_rep, 1e-300)
                              for q in qm_of.values())
            ccf_id = f"CCF_{grp.id}"
            _mint_ccf_event(g, lib, ccf_id, grp.id, beta * q_rep, source=rep_ref)
            for m in members:
                qm = qm_of[m]
                indep_id = f"{m}__I"
                src = rep_ref if homogeneous else g.nodes[m].param_ref
                _mint_ccf_event(g, lib, indep_id, grp.id, (1.0 - beta) * qm, source=src)
                node = g.nodes[m]                    # 原位把 m 改成 OR 门
                node.is_basic = False
                node.param_ref = None
                node.op = Op.OR
                node.args = [indep_id, ccf_id]
        else:
            _expand_multilevel(g, lib, grp, members)
    return g, lib
