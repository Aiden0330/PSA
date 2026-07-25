from __future__ import annotations
from math import fsum, isfinite, log
import numpy as np
from psaengine.model.model import Model
from psaengine.quantify.probability import exact_probability, exact_probability_batch
from psaengine.eta.sequence import _build_event_tree, quantify_event_tree


def _as_vec(v, n: int) -> np.ndarray:
    """batch 求值对常量表达式(house 强制等)返回 float——广播成列向量。"""
    return v if isinstance(v, np.ndarray) else np.full(n, float(v))

_CLASSES = ["C1", "C2", "C3", "C4", "C5"]


def _validate_mc_params(samples: int, error_factor: float) -> None:
    """EB-05/O1:蒙特卡洛入口数值域 —— samples ≥ 1、error_factor 有限且 ≥ 1。
    消除 samples=0 的 500(空数组分位)与 EF<1 静默退化为确定性结果(带参数名响亮拒绝)。
    EF=1 合法边界:sigma=0 是显式的"无认知不确定"确定性带,非静默退化。"""
    if not isinstance(samples, int) or isinstance(samples, bool) or samples < 1:
        raise ValueError(f"samples must be an integer >= 1, got {samples!r}")
    if not isfinite(error_factor) or error_factor < 1:
        raise ValueError(f"error_factor must be finite and >= 1, got {error_factor!r}")


class _MergedParams:
    """aggregate 通道的跨树参数视图(只需 .get(ref));同名同法则由 spec A 锁保证。"""

    def __init__(self, by_ref: dict):
        self._by_ref = by_ref

    def get(self, ref: str):
        return self._by_ref[ref]


def _epistemic_links(params, median_by_ref: dict[str, float]):
    """CCF 组内认知联动(规格 2026-07-17-ccf-group-sokc-linkage §2,semver 0.4.0)。

    CCF 展开为一组铸 2^m−1 个参数,各持独立 ref 但**认知同源**一个库参数(q_levels 对
    Q_t 线性)。逐 ref 独立抽 ⇒ 并联贡献上分位按 ~√n 收窄,方向非保守(批次 F 修掉的
    单树同病,藏在展开层)。法则:带 epistemic_source 的 ref 不独立抽,其样本 =
    median_minted × (sampled[source] / median_source),缩放后仍截 [0,1]。

    返回 (draw_refs, linked, median_draw):
      draw_refs   —— 实际参与 RNG 抽取的 ref(确定序);源 ref 即使不在树内也纳入
      linked      —— {铸参 ref: 源 ref}
      median_draw —— 抽样空间的 median(含树外源)
    无联动参数时 draw_refs ≡ sorted(median_by_ref)、linked 空 —— 无 CCF 模型的抽样流
    逐位不变(L3 冻结锁)。"""
    linked: dict[str, str] = {}
    for ref in sorted(median_by_ref):                      # 确定序:与 PYTHONHASHSEED 无关
        try:
            src = getattr(params.get(ref), "epistemic_source", None)
        except Exception:
            src = None
        if src and src != ref:
            linked[ref] = src
    if not linked:
        return sorted(median_by_ref), {}, dict(median_by_ref)
    # engine-review F3(2026-07-22):json_io 使该字段成为**用户输入面**。无校验时
    # 链式(A→B→C)/环(A↔B)会静默出数且结果依赖字典序(破坏 G5 逐位重放保证),
    # 悬空源裸 KeyError,频率源会被 [0,1] 截断(量纲违规)。三条一律响亮拒绝。
    for ref in sorted(linked):
        src = linked[ref]
        try:
            sp = params.get(src)
        except Exception:
            raise ValueError(f"epistemic_source '{src}'(参数 '{ref}' 声明)不存在于参数库")
        if getattr(sp, "epistemic_source", None):
            raise ValueError(f"epistemic_source 不得链式:'{ref}' → '{src}' → "
                             f"'{sp.epistemic_source}';认知源须为叶(单跳)")
        if getattr(sp, "kind", None) == "frequency":
            raise ValueError(f"epistemic_source '{src}' 为频率量纲,不可作概率铸参"
                             f"'{ref}' 的认知源(量纲混用)")
        # engine-review 复审 R1(2026-07-22):**声明方**量纲同样要查。频率参数若自带
        # epistemic_source,其样本会走 _apply_links 的 [0,1] 截断(λ=2.4/yr → 封 1.0),
        # 实测 ~8× 静默低估——非保守,且撞 CLAUDE.md 硬约束 4(量纲绝不静默混算)。
        # 引擎铸参恒概率量纲,此拒绝对产品路径零扰动,只封死 json_io 输入面。
        if getattr(params.get(ref), "kind", None) == "frequency":
            raise ValueError(f"频率参数 '{ref}' 不可声明 epistemic_source:认知联动按概率"
                             f"量纲缩放并截 [0,1],会静默压低频率(量纲混用)")
    median_draw = {r: v for r, v in median_by_ref.items() if r not in linked}
    for src in set(linked.values()):
        if src not in median_draw:
            median_draw[src] = (median_by_ref[src] if src in median_by_ref
                                else params.get(src).unavailability())
    return sorted(median_draw), linked, median_draw


def _apply_links(sampled: dict, raw: dict, linked: dict,
                 median_by_ref: dict, median_draw: dict) -> None:
    """把联动铸参的样本按源因子就地写入 sampled(等比缩放,**逐 ref 各自**截 [0,1])。

    engine-review F2(2026-07-22):因子必须取源的**未截断**抽样。用截断值会让源自身的
    [0,1] 封顶(q_rep=0.5 ⇒ 因子最大 2.0)被全组继承——对 q=0.01 的组员是外来的、
    无物理依据的压窄(非保守)。每个铸参只受自己的物理上界约束。"""
    for ref in sorted(linked):
        src = linked[ref]
        ms = median_draw[src]
        v = median_by_ref[ref] * (raw[src] / ms) if ms > 0 else median_by_ref[ref]
        sampled[ref] = min(max(v, 0.0), 1.0)


def event_tree_uncertainty(model: Model, et_name: str, samples: int = 1000,
                           seed: int = 42, error_factor: float = 3.0,
                           house_states: dict | None = None,
                           boundary_condition_set: str | None = None) -> dict:
    """对数正态(median=nominal, EF)采样,建一次 BDD 只重算概率,每后果出 p05/p50/p95。

    批次 F(规格 2026-07-17 S-A,SOKC 修正):抽样单位 = **参数 ref**(refs 排序、单一
    RNG 流、每迭代一个联合向量)——同 ref 的多个底事件节点共享同一次抽样(认知同源相关,
    与 aggregate 同法则)。修正前按节点独立抽:同参数冗余通道被当独立认知源,上分位非
    保守收窄 ~1.9×(判别例 p95 0.047 vs 0.09)。init_frequency 视为定值(标量无分布;
    频率参数入带属集成 MC 规格 S3)。逐样本后果 Σ 用 fsum(S-B)。"""
    _validate_mc_params(samples, error_factor)
    b = _build_event_tree(model, et_name, house_states, boundary_condition_set)
    et, big, m, all_basics, fe_bdd = b.et, b.big, b.m, b.all_basics, b.fe_bdd
    seq_exprs = []  # (consequence_class, expr)
    for seq in et.sequences:
        expr = m.one
        for fe_id, branch in seq["path"].items():
            g = fe_bdd[fe_id]
            expr = m.apply_and(expr, g if branch == "failure" else m.apply_not(g))
        seq_exprs.append((et.consequence_of(seq["end_state"]), expr))
    ref_of = {bb: big.nodes[bb].param_ref for bb in all_basics}
    median_by_ref = {ref: b.params.get(ref).unavailability() for ref in set(ref_of.values())}
    refs = sorted(median_by_ref)              # 确定序 → 与 aggregate 同流,可复现
    rng = np.random.default_rng(seed)
    sigma = log(error_factor) / 1.645 if error_factor > 1 else 0.0
    # P-7 向量化:抽样循环逐字不动(RNG 流与标量版逐位同),抽完按 ref 收列向量;
    # BDD 求值改 batch(每序列一次遍历,节点级全样本 numpy 乘加——与标量同表达式
    # ⇒ 每样本逐位同);逐样本后果 Σ 仍 fsum(S-B 口径)。57s/千样本 → 秒级。
    draw_refs, linked, median_draw = _epistemic_links(b.params, median_by_ref)
    sample_by_ref = {ref: np.empty(samples) for ref in refs}
    for i in range(samples):
        raw: dict[str, float] = {}
        sampled: dict[str, float] = {}
        for ref in draw_refs:                    # 抽样序与旧版逐字同 → RNG 流逐位同
            mu = median_draw[ref]
            if sigma <= 0 or mu <= 0:
                raw[ref] = sampled[ref] = (mu if sigma <= 0 else 0.0)
                continue
            d = float(np.exp(rng.normal(log(mu), sigma)))
            raw[ref] = d
            sampled[ref] = float(np.clip(d, 0.0, 1.0))
        _apply_links(sampled, raw, linked, median_by_ref, median_draw)
        for ref in refs:
            sample_by_ref[ref][i] = sampled[ref]
    q_vec = {bb: sample_by_ref[ref] for bb, ref in ref_of.items()}
    seq_probs = [(c, _as_vec(exact_probability_batch(m, expr, q_vec), samples))
                 for c, expr in seq_exprs]
    series = {c: np.zeros(samples) for c in _CLASSES}
    for i in range(samples):
        contribs: dict[str, list] = {}
        for c, pv in seq_probs:
            contribs.setdefault(c, []).append(et.init_frequency * float(pv[i]))
        for c in _CLASSES:
            series[c][i] = fsum(contribs.get(c, ()))
    point = quantify_event_tree(model, et_name, house_states=house_states,
                                boundary_condition_set=boundary_condition_set)["consequences"]
    bands = {c: {"p05": float(np.percentile(series[c], 5)),
                 "p50": float(np.percentile(series[c], 50)),
                 "p95": float(np.percentile(series[c], 95))} for c in _CLASSES}
    return {"point": {c: float(point.get(c, 0.0)) for c in _CLASSES}, "bands": bands}


def _param_law_signature(p) -> tuple:
    """参数的认识论法则指纹(spec A 同一性判据):量纲 kind / 点值 value / 时间参数 /
    Q(t) 系数 / 分布。provenance(source/version)刻意不入指纹——那是溯源元数据,非数值法则。"""
    d = getattr(p, "distribution", None)
    dist = (d.family, tuple(sorted(d.params.items()))) if d is not None else None
    return (p.kind, p.value, p.mttr, p.test_interval, p.mission_time,
            p.gamma, p.alpha, p.beta, p.t0, dist,
            # engine-review F5(2026-07-22):CCF 铸参名 CCF_<gid> 不含成员名——两树复用
            # 组 id 但成员不同、库值恰同时,同名铸参会带不同 epistemic_source;此门若不
            # 看该字段就静默"首见者胜",把树 2 的组内相关拆散。纳入指纹 ⇒ 歧义复用点名拒绝。
            getattr(p, "epistemic_source", None))


def _assert_shared_ref_consistent(ref: str, p, tidx: int, law_by_ref: dict) -> None:
    """EB-09/O3:spec A(2026-07-14)前提 —— 同 ref 名 = 同认识论参数(项目全局命名空间)。
    同名跨树参数法则不一致 → 点名拒绝。修前 aggregate 静默取首个中值(下方 median_by_ref),
    canonical 允许同 ref 异值 → 点估计走首值、联合分位带亦走首值,二者掩盖了「本是两个不同模型」
    的矛盾(评审算例:.1/.9 同 ref,点 C2=.001 但 p05/p50/p95 均 .0002)。此处只加 load 边界校验,
    不改任何抽样数学:同 ref 同值 sig 相等 → 逐位不扰动。"""
    sig = _param_law_signature(p)
    prev = law_by_ref.get(ref)
    if prev is None:
        law_by_ref[ref] = (sig, tidx)
        return
    if prev[0] != sig:
        raise ValueError(
            f"共享参数 ref '{ref}' 在树 #{prev[1]} 与树 #{tidx} 定义不一致 "
            f"(spec A:同 ref 名=同认识论参数,须逐字段一致): {prev[0]} vs {sig}")


def aggregate_event_tree_uncertainty(specs: list, samples: int = 1000,
                                     seed: int = 42, error_factor: float = 3.0,
                                     house_states: dict | None = None,
                                     boundary_condition_set: str | None = None) -> dict:
    """勾选集聚合的不确定性带(spec A §2.2)。specs = [(model, et_name), ...]。

    跨树认知参数同一性 = **同 param ref 名**(项目全局命名空间;RiskSpectrum「同名即同事件」
    的自然外推)。每次 MC 迭代抽**一个联合参数向量**(union of ref names):同 ref 名共享同一次
    抽样,施加到全部树,逐树逐后果精确求率,逐级相加,得聚合分位带。

    点估计 = 各树 quantify_event_tree 后果**逐级求和**(期望线性,E[ΣN]=ΣE[N] 精确,与相关
    结构无关;取 nominal=median)。init_frequency 视为定值(不入带)。

    刻意不做的两种错误实现:①同 seed 逐树各跑再相加(RNG 流套在各树底事件枚举序上 → 字典序
    伪耦合);②各树独立抽样再相加(共享数据源被当独立 → 上分位静默压窄,非保守)。此处用
    单一 rng + 按 ref 名的联合向量,二者皆非。返回 {"point","bands","per_tree"}。"""
    _validate_mc_params(samples, error_factor)
    if not specs:
        raise ValueError("aggregate_event_tree_uncertainty: 需要至少一棵事件树")
    trees = []
    median_by_ref: dict[str, float] = {}
    law_by_ref: dict[str, tuple] = {}     # EB-09/O3:同 ref 名参数法则一致性(spec A load 边界)
    param_by_ref: dict[str, object] = {}  # ref → Parameter(首见者;CCF 联动查 epistemic_source)
    for tidx, (model, et_name) in enumerate(specs):
        b = _build_event_tree(model, et_name, house_states, boundary_condition_set)
        et, big, m, all_basics, fe_bdd = b.et, b.big, b.m, b.all_basics, b.fe_bdd
        seq_exprs = []  # (consequence_class, expr)
        for seq in et.sequences:
            expr = m.one
            for fe_id, branch in seq["path"].items():
                g = fe_bdd[fe_id]
                expr = m.apply_and(expr, g if branch == "failure" else m.apply_not(g))
            seq_exprs.append((et.consequence_of(seq["end_state"]), expr))
        ref_of = {bb: big.nodes[bb].param_ref for bb in all_basics}   # 底事件 → 参数 ref 名
        for ref in ref_of.values():                                  # 同 ref 名跨树共用同一 median
            p = b.params.get(ref)
            _assert_shared_ref_consistent(ref, p, tidx, law_by_ref)  # spec A:异值同名点名拒绝
            if ref not in median_by_ref:
                median_by_ref[ref] = p.unavailability()
            param_by_ref.setdefault(ref, p)                          # CCF 联动:跨树参数视图
        for pid in b.params.ids():                                   # 源参数可能不被任何底事件引用
            param_by_ref.setdefault(pid, b.params.get(pid))
        trees.append({"m": m, "seq_exprs": seq_exprs, "ref_of": ref_of,
                      "init_frequency": et.init_frequency})

    refs = sorted(median_by_ref)              # 确定序 → 联合抽样可复现
    rng = np.random.default_rng(seed)         # 单一 RNG 流(不逐树重播种)
    sigma = log(error_factor) / 1.645 if error_factor > 1 else 0.0
    # P-7 向量化:抽样循环逐字不动 → 收列向量;每 (树,序列) 一次 batch 遍历。
    # CCF 联动:跨树按 ref 名合并的参数视图(同名同法则已由 _assert_shared_ref_consistent 锁)
    draw_refs, linked, median_draw = _epistemic_links(_MergedParams(param_by_ref), median_by_ref)
    sample_by_ref = {ref: np.empty(samples) for ref in refs}
    for i in range(samples):
        raw = {}                               # 一次迭代 = 一个联合参数向量(按 ref 名)
        sampled = {}
        for ref in draw_refs:
            mu = median_draw[ref]
            if sigma <= 0 or mu <= 0:
                raw[ref] = sampled[ref] = (mu if sigma <= 0 else 0.0)
                continue
            d = float(np.exp(rng.normal(log(mu), sigma)))
            raw[ref] = d
            sampled[ref] = float(np.clip(d, 0.0, 1.0))
        _apply_links(sampled, raw, linked, median_by_ref, median_draw)
        for ref in refs:
            sample_by_ref[ref][i] = sampled[ref]
    tree_probs = []                            # [(init_frequency, [(c, N 向量)…])…] 保持树序
    for t in trees:
        q_vec = {bb: sample_by_ref[ref] for bb, ref in t["ref_of"].items()}
        tree_probs.append((t["init_frequency"],
                           [(c, _as_vec(exact_probability_batch(t["m"], expr, q_vec), samples))
                            for c, expr in t["seq_exprs"]]))
    series = {c: np.zeros(samples) for c in _CLASSES}
    for i in range(samples):
        contribs: dict[str, list] = {}
        for init_freq, pairs in tree_probs:    # 同一抽样施加到全部树,逐级相加(fsum,S-B)
            for c, pv in pairs:
                contribs.setdefault(c, []).append(init_freq * float(pv[i]))
        for c in _CLASSES:
            series[c][i] = fsum(contribs.get(c, ()))

    point_contrib: dict[str, list] = {c: [] for c in _CLASSES}
    per_tree: list[dict] = []
    for model, et_name in specs:               # 点估计 = 逐树精确后果求和(fsum);per_tree 供钉扎分解
        cons = quantify_event_tree(model, et_name, house_states=house_states,
                                   boundary_condition_set=boundary_condition_set)["consequences"]
        row = {c: float(cons.get(c, 0.0)) for c in _CLASSES}
        per_tree.append(row)
        for c in _CLASSES:
            point_contrib[c].append(row[c])
    point = {c: fsum(point_contrib[c]) for c in _CLASSES}
    bands = {c: {"p05": float(np.percentile(series[c], 5)),
                 "p50": float(np.percentile(series[c], 50)),
                 "p95": float(np.percentile(series[c], 95))} for c in _CLASSES}
    return {"point": point, "bands": bands, "per_tree": per_tree}


def barrier_importance_exact(model: Model, et_name: str,
                             house_states: dict | None = None,
                             boundary_condition_set: str | None = None) -> dict:
    """扰动法屏障级重要度(按后果):
    FV = (R − R|该屏障必有效) / R;RAW = R|该屏障必失效 / R(R=0 记 0)。
    强制的是功能事件顶 BDD(经 fe_overrides),共享底事件下其他屏障不受影响。
    注意:对良性后果(需某屏障成功才达成, 如 C1)FV 可为负、RAW 可<1, 属正常语义。"""
    et = model.event_trees[et_name]
    bc = {"house_states": house_states, "boundary_condition_set": boundary_condition_set}
    base = quantify_event_tree(model, et_name, **bc)["consequences"]
    pert: dict = {}
    for fe in et.functional_events:
        pert[(fe.id, "work")] = quantify_event_tree(model, et_name, {fe.id: "work"}, **bc)["consequences"]
        pert[(fe.id, "fail")] = quantify_event_tree(model, et_name, {fe.id: "fail"}, **bc)["consequences"]
    out: dict[str, list] = {}
    for c in _CLASSES:
        R = base.get(c, 0.0)
        rows = []
        for fe in et.functional_events:
            rw = pert[(fe.id, "work")].get(c, 0.0)
            rf = pert[(fe.id, "fail")].get(c, 0.0)
            fv = (R - rw) / R if R > 0 else 0.0
            raw = rf / R if R > 0 else 0.0
            rows.append({"barrier": fe.id, "fv": float(fv), "raw": float(raw)})
        rows.sort(key=lambda x: -x["fv"])
        out[c] = rows
    return out


# ── 集成 LFT 模式(banked 规格 2026-07-16-integrated-mc-uncertainty-importance)──

def event_tree_uncertainty_integrated(model: Model, et_name: str, ie_ft_name: str = "__init__",
                                      *, samples: int = 1000, seed: int = 42,
                                      error_factor: float = 3.0,
                                      house_states: dict | None = None,
                                      boundary_condition_set: str | None = None) -> dict:
    """集成模式 MC:rate(s) = Σᵢ λᵢ·P(Eᵢ∧Path_s) 逐样本重算,出 p05/p50/p95。

    语义(规格 S1–S8):按参数 **ref** 排序联合抽样、单一 RNG 流(SOKC,与单树/聚合
    批次 F 同法则);**量纲分流**:frequency 类 ref 只截 [0,∞) 上不封顶(λ 中位 0.8/yr
    EF3 的 p95 就该是 2.4/yr),probability/Q(t) 类截 [0,1];初因 λᵢ 入带(S3——IE-FT
    模式的 λ 是带认知不确定性的库参数);Q(t) 谱施于 unavailability(S4);逐样本后果
    Σ 用 fsum(批次 F S-B 口径);点估计 = quantify_event_tree_integrated 逐位同源。"""
    from psaengine.eta.sequence import (_build_integrated,
                                        quantify_event_tree_integrated)
    _validate_mc_params(samples, error_factor)
    et, m, fe_bdd, initiators, q_base, big, params = _build_integrated(
        model, et_name, ie_ft_name, house_states, boundary_condition_set)
    seq_pairs = []                                  # (consequence, path_expr)
    for seq in et.sequences:
        expr = m.one
        for fe_id, branch in seq["path"].items():
            g = fe_bdd[fe_id]
            expr = m.apply_and(expr, g if branch == "failure" else m.apply_not(g))
        seq_pairs.append((et.consequence_of(seq["end_state"]), expr))
    # 联合 ref 空间 = P 侧(非频率底事件)∪ λ 侧;中位:频率取 .value,其余 unavailability()
    ref_of = {bb: big.nodes[bb].param_ref for bb in q_base}
    lam_ref = {init: big.nodes[init].param_ref for init, _, _ in initiators}
    median_by_ref: dict[str, float] = {}
    freq_refs: set[str] = set()
    for ref in set(ref_of.values()):
        median_by_ref[ref] = params.get(ref).unavailability()
    for init, lam, _ in initiators:
        r = lam_ref[init]
        median_by_ref[r] = params.get(r).value      # λ 本值(频率语境,勿走 unavailability 护栏)
        freq_refs.add(r)
    refs = sorted(median_by_ref)
    rng = np.random.default_rng(seed)
    sigma = log(error_factor) / 1.645 if error_factor > 1 else 0.0
    # P-7 向量化:抽样循环逐字不动 → 收列向量;每 (初因,序列) 对一次 batch 遍历。
    draw_refs, linked, median_draw = _epistemic_links(params, median_by_ref)
    sample_by_ref = {ref: np.empty(samples) for ref in refs}
    for i in range(samples):
        raw = {}
        sampled = {}
        for ref in draw_refs:
            mu = median_draw[ref]
            if sigma <= 0 or mu <= 0:
                raw[ref] = sampled[ref] = (mu if sigma <= 0 else 0.0)
                continue
            draw = float(np.exp(rng.normal(log(mu), sigma)))
            raw[ref] = draw
            sampled[ref] = draw if ref in freq_refs else float(np.clip(draw, 0.0, 1.0))
        _apply_links(sampled, raw, linked, median_by_ref, median_draw)   # 铸参恒概率量纲 → 截 [0,1]
        for ref in refs:
            sample_by_ref[ref][i] = sampled[ref]
    q_vec = {bb: sample_by_ref[ref] for bb, ref in ref_of.items()}
    seq_probs = []                             # [(c, [(λ 向量, P 向量)…按 initiators 序])…]
    for c, expr in seq_pairs:
        per_init = [(sample_by_ref[lam_ref[init]],
                     _as_vec(exact_probability_batch(m, m.apply_and(e_bdd, expr), q_vec), samples))
                    for init, _, e_bdd in initiators]
        seq_probs.append((c, per_init))
    series = {c: np.zeros(samples) for c in _CLASSES}
    for i in range(samples):
        contribs: dict[str, list] = {}
        for c, per_init in seq_probs:
            contribs.setdefault(c, []).append(fsum(
                float(lam_v[i]) * float(p_v[i]) for lam_v, p_v in per_init))
        for c in _CLASSES:
            series[c][i] = fsum(contribs.get(c, ()))
    point = quantify_event_tree_integrated(model, et_name, ie_ft_name,
                                           house_states=house_states,
                                           boundary_condition_set=boundary_condition_set)["consequences"]
    bands = {c: {"p05": float(np.percentile(series[c], 5)),
                 "p50": float(np.percentile(series[c], 50)),
                 "p95": float(np.percentile(series[c], 95))} for c in _CLASSES}
    return {"point": {c: float(point.get(c, 0.0)) for c in _CLASSES}, "bands": bands}


def barrier_importance_exact_integrated(model: Model, et_name: str, ie_ft_name: str = "__init__",
                                        *, house_states: dict | None = None,
                                        boundary_condition_set: str | None = None) -> dict:
    """集成模式扰动法屏障重要度:FV=(R−R|必有效)/R、RAW=R|必失效/R,R = 集成后果率。
    强制功能事件顶 BDD(fe_bdd → 常量),与普通通道语义逐字对齐;IE 树内部事件不扰动
    (初因贡献另有频率通道 by_initiator);R=0 记 0、良性后果 FV 可负 RAW 可 <1 照旧。"""
    from psaengine.eta.sequence import _build_integrated
    et, m, fe_bdd, initiators, q_s, big, params = _build_integrated(
        model, et_name, ie_ft_name, house_states, boundary_condition_set)

    def cons_with(overrides: dict | None) -> dict:
        fb = dict(fe_bdd)
        if overrides:
            for fid, mode in overrides.items():
                fb[fid] = m.one if mode == "fail" else m.zero
        contribs: dict[str, list] = {}
        for seq in et.sequences:
            expr = m.one
            for fe_id, branch in seq["path"].items():
                g = fb[fe_id]
                expr = m.apply_and(expr, g if branch == "failure" else m.apply_not(g))
            rate = fsum(lam * exact_probability(m, m.apply_and(e_bdd, expr), q_s)
                        for _, lam, e_bdd in initiators)
            contribs.setdefault(et.consequence_of(seq["end_state"]), []).append(rate)
        return {c: fsum(v) for c, v in contribs.items()}

    base = cons_with(None)
    pert = {}
    for fe in et.functional_events:
        pert[(fe.id, "work")] = cons_with({fe.id: "work"})
        pert[(fe.id, "fail")] = cons_with({fe.id: "fail"})
    out: dict[str, list] = {}
    for c in _CLASSES:
        R = base.get(c, 0.0)
        rows = []
        for fe in et.functional_events:
            rw = pert[(fe.id, "work")].get(c, 0.0)
            rf = pert[(fe.id, "fail")].get(c, 0.0)
            rows.append({"barrier": fe.id,
                         "fv": float((R - rw) / R) if R > 0 else 0.0,
                         "raw": float(rf / R) if R > 0 else 0.0})
        rows.sort(key=lambda x: -x["fv"])
        out[c] = rows
    return out
