from __future__ import annotations
from dataclasses import dataclass
from math import fsum
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


def _merged_barrier_pdag(model: Model, et_name: str,
                         house_states: dict[str, bool] | None,
                         boundary_condition_set: str | None):
    """屏障侧合并 + 边界条件 + CCF 展开(_build_event_tree 与集成通道共用——
    review ed90116 F5:此前两处各写一份,修一处会漏另一处)。"""
    et = model.event_trees[et_name]
    big = PDAG()
    fe_top: dict[str, str] = {}
    origin: dict[str, str] = {}                      # nid → 首次引入它的故障树名(报错定位)
    for fe in et.functional_events:
        ft = model.fault_trees[fe.link_ft]
        for nid, n in ft.pdag.nodes.items():
            if nid not in big.nodes:
                big.nodes[nid] = n
                origin[nid] = fe.link_ft
                continue
            existing = big.nodes[nid]
            if existing is n:                        # 同一棵树被多个功能事件链接:合法
                continue
            # review EB-04(2026-07-16 三方评审):屏障↔屏障轴施加与 IE↔屏障轴
            # (ed90116 F1)同一判据——同 id 仅限同参数基本事件;门/异构撞名此前
            # 静默首见胜,第二棵树的定义被无声丢弃(FF=.1/FS=0,正确 .02/.08)。
            # 合法共享(评审 S-1):同参数基本事件,或同 state 的 house(常量可互换、
            # 边界条件集本就按 id 全局覆盖——跨屏障共享 house id 是合理建模习语)。
            ok = ((existing.is_basic and n.is_basic
                   and existing.param_ref == n.param_ref)
                  or (existing.is_house and n.is_house
                      and existing.state == n.state))
            if not ok:
                raise ValueError(
                    f"node id '{nid}' means different things in barrier trees "
                    f"'{origin[nid]}' and '{fe.link_ft}' (event tree '{et_name}'): "
                    "same id is only allowed for basic events sharing the same "
                    "parameter; rename the gate/node in one of the trees")
        fe_top[fe.id] = ft.top
    from psaengine.preprocess.boundary import resolve_house_states, apply_house_states
    states = resolve_house_states(model, house_states, boundary_condition_set)
    if states:
        big = apply_house_states(big, states)        # 副本;合并图与模型共享节点对象,不可原位改
    params = model.parameters
    if model.ccf_groups:
        from psaengine.preprocess.ccf_expand import apply_ccf
        big, params = apply_ccf(big, model.ccf_groups, params)
    return et, big, fe_top, params


def _build_event_tree(model: Model, et_name: str,
                      house_states: dict[str, bool] | None = None,
                      boundary_condition_set: str | None = None) -> EtBuild:
    """合并各功能事件链接的故障树到一个 PDAG + 同一 BddManager + 各 FE 顶 BDD(建一次)。
    跨序列共享基本事件因合并到同一 PDAG/管理器而自动正确(成功分支精确否定)。
    边界条件(house 状态)在合并副本上生效;CCF 组在合并后的 PDAG 上展开一次:
    跨屏障共享的共因事件同样精确否定。"""
    et, big, fe_top, params = _merged_barrier_pdag(model, et_name,
                                                   house_states, boundary_condition_set)
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

    # 批次 F(规格 2026-07-17 S-B):ET 级 Σ 一律 math.fsum(正确舍入 ⇒ 序无关)——
    # quantify 与报告通道从此逐位同源(试点 P-1:此前树序 vs 频率降序差末位 ULP)。
    seq_contrib: dict[str, list] = {}
    cons_contrib: dict[str, list] = {}
    for seq in et.sequences:
        expr = m.one
        for fe_id, branch in seq["path"].items():
            g = fe_bdd[fe_id]
            expr = m.apply_and(expr, g if branch == "failure" else m.apply_not(g))
        p = exact_probability(m, expr, q)
        freq = et.init_frequency * p
        seq_contrib.setdefault(seq["end_state"], []).append(freq)
        cons_contrib.setdefault(et.consequence_of(seq["end_state"]), []).append(freq)
    return {"sequences": {k: fsum(v) for k, v in seq_contrib.items()},
            "consequences": {k: fsum(v) for k, v in cons_contrib.items()}}


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
    # review ed90116 F1(加宽):CCF 守卫覆盖 IE **全部**节点 id——成员撞 IE 门 id 时,
    # 展开会把 E_i 劫持成 CCF 结构(探针实测 4.4× 静默低估),不止基本事件要挡。
    ie_node_ids = set(ie_pdag.nodes)
    for grp in (model.ccf_groups or []):
        shared = ie_node_ids & set(grp.members)
        if shared:
            raise ValueError(f"CCF group {grp.id} overlaps IE-tree node ids {sorted(shared)} — "
                             "集成模式 v1 不支持 IE 事件/节点参与 CCF 组(规格 §3 v1 排除)")

    freq_value, _ = classify_frequency_params(model, ie_pdag)

    # 屏障侧合并(house/bc/CCF 照旧只作用于屏障;共享 helper,review F5)
    et, big, fe_top, params = _merged_barrier_pdag(model, et_name,
                                                   house_states, boundary_condition_set)

    # review ed90116 F2:屏障树引用频率参数 = 量纲违规(初因率混入概率路径),
    # 在此响亮点名拒绝——否则 q 映射缺项,深处 KeyError 以 500 面目示人。
    for bb in big.basic_events():
        if params.get(big.nodes[bb].param_ref).kind == "frequency":
            raise ValueError(
                f"barrier-side basic event '{bb}' references frequency-kind parameter "
                f"'{big.nodes[bb].param_ref}' — 屏障树不得引用初因率(量纲违规);"
                "初因只属于 IE 树,经使能析取进入序列")

    # review ed90116 F1:IE 图并入的碰撞护栏——同 id 仅允许「双方都是基本事件且
    # param_ref 相同」(这是共享使能的**唯一**合法形态)。门/房/参数不一致一律响亮
    # 拒绝:探针实测五类碰撞全部静默错数(最重 88× 低估且 HTTP 200)。
    for nid, n in ie_pdag.nodes.items():
        if nid not in big.nodes:
            big.nodes[nid] = n
            continue
        existing = big.nodes[nid]
        ok = (existing.is_basic and n.is_basic
              and existing.param_ref == n.param_ref)
        if not ok:
            def _shape(x):
                if x.is_basic:
                    return f"basic(param_ref={x.param_ref})"
                if x.is_house:
                    return "house"
                return f"gate({x.op.value if x.op else '?'})"
            raise ValueError(
                f"node id '{nid}' means different things in IE tree vs barrier side "
                f"(IE: {_shape(n)} / barrier: {_shape(existing)}) — 集成模式共享仅限"
                "同参数基本事件;请重命名冲突节点(id 是全局契约)")

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
    # 集成 MC(banked 规格 S1-S3)需要 ref 映射与参数库:big/params 一并返回
    # (内部函数,唯一既有调用方 _integrated_rows 同步解包)。
    return et, m, fe_bdd, initiators, q, big, params


def _integrated_rows(model: Model, et_name: str, ie_ft_name: str,
                     house_states: dict[str, bool] | None,
                     boundary_condition_set: str | None) -> tuple[list[dict], float]:
    et, m, fe_bdd, initiators, q, _big, _params = _build_integrated(
        model, et_name, ie_ft_name, house_states, boundary_condition_set)
    rows: list[dict] = []
    for seq in et.sequences:
        expr = m.one
        for fe_id, branch in seq["path"].items():
            g = fe_bdd[fe_id]
            expr = m.apply_and(expr, g if branch == "failure" else m.apply_not(g))
        rate = fsum(lam * exact_probability(m, m.apply_and(e_bdd, expr), q)
                    for _, lam, e_bdd in initiators)
        rows.append({"end_state": seq["end_state"], "path": dict(seq["path"]),
                     "consequence": et.consequence_of(seq["end_state"]),
                     "frequency": rate})
    ie_frequency = fsum(lam * exact_probability(m, e_bdd, q)
                        for _, lam, e_bdd in initiators)
    return rows, ie_frequency


def quantify_event_tree_integrated(model: Model, et_name: str, ie_ft_name: str = "__init__",
                                   house_states: dict[str, bool] | None = None,
                                   boundary_condition_set: str | None = None) -> dict:
    """序列级 LFT 集成定量:{"sequences","consequences","method":"integrated","ie_frequency"}。
    与 quantify_event_tree 同形(additive 字段),供后端按 ie_fault_tree 存在与否分流。"""
    rows, ie_frequency = _integrated_rows(model, et_name, ie_ft_name,
                                          house_states, boundary_condition_set)
    seq_contrib: dict[str, list] = {}
    cons_contrib: dict[str, list] = {}
    for r in rows:
        seq_contrib.setdefault(r["end_state"], []).append(r["frequency"])
        cons_contrib.setdefault(r["consequence"], []).append(r["frequency"])
    return {"sequences": {k: fsum(v) for k, v in seq_contrib.items()},
            "consequences": {k: fsum(v) for k, v in cons_contrib.items()},
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
