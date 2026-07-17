from __future__ import annotations
from math import fsum, isfinite, log
import numpy as np
from psaengine.model.model import Model
from psaengine.quantify.probability import exact_probability
from psaengine.eta.sequence import _build_event_tree, quantify_event_tree

_CLASSES = ["C1", "C2", "C3", "C4", "C5"]


def _validate_mc_params(samples: int, error_factor: float) -> None:
    """EB-05/O1:蒙特卡洛入口数值域 —— samples ≥ 1、error_factor 有限且 ≥ 1。
    消除 samples=0 的 500(空数组分位)与 EF<1 静默退化为确定性结果(带参数名响亮拒绝)。
    EF=1 合法边界:sigma=0 是显式的"无认知不确定"确定性带,非静默退化。"""
    if not isinstance(samples, int) or isinstance(samples, bool) or samples < 1:
        raise ValueError(f"samples must be an integer >= 1, got {samples!r}")
    if not isfinite(error_factor) or error_factor < 1:
        raise ValueError(f"error_factor must be finite and >= 1, got {error_factor!r}")


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
    series = {c: np.zeros(samples) for c in _CLASSES}
    for i in range(samples):
        if sigma > 0:
            sampled = {ref: (float(np.clip(np.exp(rng.normal(log(median_by_ref[ref]), sigma)), 0.0, 1.0))
                             if median_by_ref[ref] > 0 else 0.0) for ref in refs}
        else:
            sampled = {ref: median_by_ref[ref] for ref in refs}
        q = {bb: sampled[ref] for bb, ref in ref_of.items()}
        contribs: dict[str, list] = {}
        for c, expr in seq_exprs:
            contribs.setdefault(c, []).append(et.init_frequency * exact_probability(m, expr, q))
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
            p.gamma, p.alpha, p.beta, p.t0, dist)


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
        trees.append({"m": m, "seq_exprs": seq_exprs, "ref_of": ref_of,
                      "init_frequency": et.init_frequency})

    refs = sorted(median_by_ref)              # 确定序 → 联合抽样可复现
    rng = np.random.default_rng(seed)         # 单一 RNG 流(不逐树重播种)
    sigma = log(error_factor) / 1.645 if error_factor > 1 else 0.0
    series = {c: np.zeros(samples) for c in _CLASSES}
    for i in range(samples):
        if sigma > 0:                          # 一次迭代 = 一个联合参数向量(按 ref 名)
            sampled = {ref: (float(np.clip(np.exp(rng.normal(log(median_by_ref[ref]), sigma)), 0.0, 1.0))
                             if median_by_ref[ref] > 0 else 0.0) for ref in refs}
        else:
            sampled = {ref: median_by_ref[ref] for ref in refs}
        contribs: dict[str, list] = {}
        for t in trees:                        # 同一抽样施加到全部树,逐级相加(fsum,S-B)
            q = {bb: sampled[ref] for bb, ref in t["ref_of"].items()}
            for c, expr in t["seq_exprs"]:
                contribs.setdefault(c, []).append(
                    t["init_frequency"] * exact_probability(t["m"], expr, q))
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
