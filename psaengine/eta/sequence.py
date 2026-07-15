from __future__ import annotations
from dataclasses import dataclass
from psaengine.model.model import Model
from psaengine.model.pdag import PDAG
from psaengine.bdd.kernel import BddManager, build_from_pdag
from psaengine.quantify.probability import exact_probability


@dataclass
class EtBuild:
    et: object
    big: PDAG
    m: BddManager
    all_basics: list
    fe_bdd: dict
    params: object                      # CCF 展开后的参数库(未展开时 = model.parameters)


def _build_event_tree(model: Model, et_name: str,
                      house_states: dict[str, bool] | None = None,
                      boundary_condition_set: str | None = None) -> EtBuild:
    """合并各功能事件链接的故障树到一个 PDAG + 同一 BddManager + 各 FE 顶 BDD(建一次)。
    跨序列共享基本事件因合并到同一 PDAG/管理器而自动正确(成功分支精确否定)。
    边界条件(house 状态)在合并副本上生效;CCF 组在合并后的 PDAG 上展开一次:
    跨屏障共享的共因事件同样精确否定。"""
    et = model.event_trees[et_name]
    big = PDAG()
    fe_top: dict[str, str] = {}
    for fe in et.functional_events:
        ft = model.fault_trees[fe.link_ft]
        for nid, n in ft.pdag.nodes.items():
            if nid not in big.nodes:
                big.nodes[nid] = n
        fe_top[fe.id] = ft.top
    from psaengine.preprocess.boundary import resolve_house_states, apply_house_states
    states = resolve_house_states(model, house_states, boundary_condition_set)
    if states:
        big = apply_house_states(big, states)        # 副本;合并图与模型共享节点对象,不可原位改
    params = model.parameters
    if model.ccf_groups:
        from psaengine.preprocess.ccf_expand import apply_ccf
        big, params = apply_ccf(big, model.ccf_groups, params)
    all_basics = sorted(big.basic_events())
    m = BddManager(all_basics)
    fe_bdd = {fid: build_from_pdag(m, big, top) for fid, top in fe_top.items()}
    return EtBuild(et, big, m, all_basics, fe_bdd, params)


def quantify_event_tree(model: Model, et_name: str, fe_overrides: dict | None = None,
                        house_states: dict[str, bool] | None = None,
                        boundary_condition_set: str | None = None) -> dict:
    """事件树逐序列/逐后果精确定量。
    fe_overrides={fe_id:"fail"|"work"} 把该功能事件顶 BDD 强制为常量(必失效/必有效),
    用于扰动法重要度;默认 None = 原行为(强制的是 FE 顶, 不动其底事件 → 共享事件安全)。
    house_states/boundary_condition_set:4a2 边界条件,见 preprocess/boundary。"""
    b = _build_event_tree(model, et_name, house_states, boundary_condition_set)
    et, big, m, all_basics = b.et, b.big, b.m, b.all_basics
    fe_bdd = dict(b.fe_bdd)
    if fe_overrides:
        for fid, mode in fe_overrides.items():
            fe_bdd[fid] = m.one if mode == "fail" else m.zero
    q = {bb: b.params.get(big.nodes[bb].param_ref).unavailability() for bb in all_basics}

    seq_freq: dict[str, float] = {}
    cons_freq: dict[str, float] = {}
    for seq in et.sequences:
        expr = m.one
        for fe_id, branch in seq["path"].items():
            g = fe_bdd[fe_id]
            expr = m.apply_and(expr, g if branch == "failure" else m.apply_not(g))
        p = exact_probability(m, expr, q)
        freq = et.init_frequency * p
        seq_freq[seq["end_state"]] = seq_freq.get(seq["end_state"], 0.0) + freq
        cls = et.consequence_of(seq["end_state"])
        cons_freq[cls] = cons_freq.get(cls, 0.0) + freq
    return {"sequences": seq_freq, "consequences": cons_freq}


# ── 序列级完整 LFT 集成(规格 2026-07-15-sequence-lft-integration)────────────
# rate(s) = Σ_i λ_i·P(E_i ∧ Path_s):IE 树并入合并图,使能析取与路径条件在同一
# BddManager 上精确求交——IE 使能与屏障共享基本事件自动正确(含成功分支精确否定)。
# 守恒恒等式:Σ_s rate(s) = Σ_i λ_i·P(E_i) = 频率通道 exact 头条(锚点 B 锁)。


def _build_integrated(model: Model, et_name: str, ie_ft_name: str,
                      house_states: dict[str, bool] | None = None,
                      boundary_condition_set: str | None = None):
    """合并屏障树 + IE 树到同一 PDAG/管理器;返回逐初因 (λ_i, E_i_bdd) 与序列求值件。

    v1 排除(响亮拒绝):IE 树含 house 节点;IE 树事件出现在任何 CCF 组
    (展开语义与初因分组的交互留 v2);非相干 IE 树由频率通道校验拒绝。"""
    from psaengine.preprocess.normalize import normalize
    from psaengine.quantify.cutsets import minimal_cutsets
    from psaengine.quantify.frequency import (_reject_non_coherent,
                                              classify_frequency_params,
                                              group_enabler_sets)

    ie_ft = model.fault_trees[ie_ft_name]
    ie_pdag = normalize(ie_ft.pdag)
    _reject_non_coherent(ie_pdag, ie_ft_name)
    if any(n.is_house for n in ie_pdag.nodes.values()):
        raise ValueError(f"IE tree {ie_ft_name} contains house events — 集成模式 v1 "
                         "边界条件仅作用于屏障侧(规格 §3 v1 排除)")
    ie_basics = ie_pdag.basic_events()
    for grp in (model.ccf_groups or []):
        shared = ie_basics & set(grp.members)
        if shared:
            raise ValueError(f"CCF group {grp.id} contains IE-tree events {sorted(shared)} — "
                             "集成模式 v1 不支持 IE 事件参与 CCF 组(规格 §3 v1 排除)")

    freq_value, _ = classify_frequency_params(model, ie_pdag)

    # 屏障侧合并(house/bc/CCF 照旧作用于屏障)+ IE 归一化图并入同一变量空间
    et = model.event_trees[et_name]
    big = PDAG()
    fe_top: dict[str, str] = {}
    for fe in et.functional_events:
        ft = model.fault_trees[fe.link_ft]
        for nid, n in ft.pdag.nodes.items():
            if nid not in big.nodes:
                big.nodes[nid] = n
        fe_top[fe.id] = ft.top
    from psaengine.preprocess.boundary import resolve_house_states, apply_house_states
    states = resolve_house_states(model, house_states, boundary_condition_set)
    if states:
        big = apply_house_states(big, states)
    params = model.parameters
    if model.ccf_groups:
        from psaengine.preprocess.ccf_expand import apply_ccf
        big, params = apply_ccf(big, model.ccf_groups, params)
    for nid, n in ie_pdag.nodes.items():                 # IE 图并入(共享基本事件按 id 统一)
        if nid not in big.nodes:
            big.nodes[nid] = n

    all_basics = sorted(big.basic_events())
    m = BddManager(all_basics)
    fe_bdd = {fid: build_from_pdag(m, big, top) for fid, top in fe_top.items()}
    ie_root = build_from_pdag(m, big, ie_pdag.top)

    cuts = minimal_cutsets(m, ie_root, q=None)
    enabler_sets = group_enabler_sets(cuts, freq_value)  # 一频率规则校验(共享语义)

    initiators: list[tuple[str, float, int]] = []        # (id, λ, E_i 的 BDD)
    for init, esets in enabler_sets.items():
        if any(not s for s in esets):
            e_bdd = m.one                                # 裸初因割集 ⇒ E_i 恒真(最小性)
        else:
            e_bdd = m.zero
            for s in esets:
                conj = m.one
                for e in sorted(s):
                    conj = m.apply_and(conj, m.var(e))
                e_bdd = m.apply_or(e_bdd, conj)
        initiators.append((init, freq_value[init], e_bdd))

    # q 只含非频率参数:初因变量不出现在 E_i∧Path 的 BDD 中(E_i 已剔除初因),
    # Shannon 遍历不会触及——frequency 参数在概率语境 raise 的护栏因此不被触发。
    q = {bb: params.get(big.nodes[bb].param_ref).unavailability()
         for bb in all_basics
         if params.get(big.nodes[bb].param_ref).kind != "frequency"}
    return et, m, fe_bdd, initiators, q


def _integrated_rows(model: Model, et_name: str, ie_ft_name: str,
                     house_states: dict[str, bool] | None,
                     boundary_condition_set: str | None) -> tuple[list[dict], float]:
    et, m, fe_bdd, initiators, q = _build_integrated(
        model, et_name, ie_ft_name, house_states, boundary_condition_set)
    rows: list[dict] = []
    for seq in et.sequences:
        expr = m.one
        for fe_id, branch in seq["path"].items():
            g = fe_bdd[fe_id]
            expr = m.apply_and(expr, g if branch == "failure" else m.apply_not(g))
        rate = sum(lam * exact_probability(m, m.apply_and(e_bdd, expr), q)
                   for _, lam, e_bdd in initiators)
        rows.append({"end_state": seq["end_state"], "path": dict(seq["path"]),
                     "consequence": et.consequence_of(seq["end_state"]),
                     "frequency": rate})
    ie_frequency = sum(lam * exact_probability(m, e_bdd, q)
                       for _, lam, e_bdd in initiators)
    return rows, ie_frequency


def quantify_event_tree_integrated(model: Model, et_name: str, ie_ft_name: str = "__init__",
                                   house_states: dict[str, bool] | None = None,
                                   boundary_condition_set: str | None = None) -> dict:
    """序列级 LFT 集成定量:{"sequences","consequences","method":"integrated","ie_frequency"}。
    与 quantify_event_tree 同形(additive 字段),供后端按 ie_fault_tree 存在与否分流。"""
    rows, ie_frequency = _integrated_rows(model, et_name, ie_ft_name,
                                          house_states, boundary_condition_set)
    seq_freq: dict[str, float] = {}
    cons_freq: dict[str, float] = {}
    for r in rows:
        seq_freq[r["end_state"]] = seq_freq.get(r["end_state"], 0.0) + r["frequency"]
        cons_freq[r["consequence"]] = cons_freq.get(r["consequence"], 0.0) + r["frequency"]
    return {"sequences": seq_freq, "consequences": cons_freq,
            "method": "integrated", "ie_frequency": ie_frequency}


def event_tree_sequences_integrated(model: Model, et_name: str, ie_ft_name: str = "__init__",
                                    house_states: dict[str, bool] | None = None,
                                    boundary_condition_set: str | None = None) -> list[dict]:
    """集成模式逐序列明细(频率降序),行形与 event_tree_sequences 一致。"""
    rows, _ = _integrated_rows(model, et_name, ie_ft_name,
                               house_states, boundary_condition_set)
    rows.sort(key=lambda s: s["frequency"], reverse=True)
    return rows


def event_tree_sequences(model: Model, et_name: str, fe_overrides: dict | None = None,
                         house_states: dict[str, bool] | None = None,
                         boundary_condition_set: str | None = None) -> list[dict]:
    """逐序列明细(非聚合), 按 frequency 降序。复用 _build_event_tree / exact_probability。
    每项: {"end_state","path":{fe_id:"success|failure"},"consequence","frequency"}。
    fe_overrides={fe_id:"fail"|"work"} 把该 FE 顶 BDD 强制为常量(同 quantify_event_tree);
    非 "fail" 一律按 "work" 处理。"""
    b = _build_event_tree(model, et_name, house_states, boundary_condition_set)
    et, big, m, all_basics = b.et, b.big, b.m, b.all_basics
    fe_bdd = dict(b.fe_bdd)
    if fe_overrides:
        for fid, mode in fe_overrides.items():
            fe_bdd[fid] = m.one if mode == "fail" else m.zero
    q = {bb: b.params.get(big.nodes[bb].param_ref).unavailability() for bb in all_basics}

    out: list[dict] = []
    for seq in et.sequences:
        expr = m.one
        for fe_id, branch in seq["path"].items():
            g = fe_bdd[fe_id]
            expr = m.apply_and(expr, g if branch == "failure" else m.apply_not(g))
        p = exact_probability(m, expr, q)
        out.append({
            "end_state": seq["end_state"],
            "path": dict(seq["path"]),
            "consequence": et.consequence_of(seq["end_state"]),
            "frequency": et.init_frequency * p,
        })
    out.sort(key=lambda s: s["frequency"], reverse=True)
    return out
