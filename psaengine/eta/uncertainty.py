from __future__ import annotations
from math import log
import numpy as np
from psaengine.model.model import Model
from psaengine.quantify.probability import exact_probability
from psaengine.eta.sequence import _build_event_tree, quantify_event_tree

_CLASSES = ["C1", "C2", "C3", "C4", "C5"]


def event_tree_uncertainty(model: Model, et_name: str, samples: int = 1000,
                           seed: int = 42, error_factor: float = 3.0,
                           house_states: dict | None = None,
                           boundary_condition_set: str | None = None) -> dict:
    """对各底事件做对数正态(median=nominal, EF)采样, 建一次 BDD 只重算概率,
    给每个后果 C1–C5 出 p05/p50/p95 + 点估计。共享底事件一次采样 → 自动相关。
    init_frequency 视为定值。边界条件同 quantify_event_tree(4a2)。"""
    b = _build_event_tree(model, et_name, house_states, boundary_condition_set)
    et, big, m, all_basics, fe_bdd = b.et, b.big, b.m, b.all_basics, b.fe_bdd
    seq_exprs = []  # (consequence_class, expr)
    for seq in et.sequences:
        expr = m.one
        for fe_id, branch in seq["path"].items():
            g = fe_bdd[fe_id]
            expr = m.apply_and(expr, g if branch == "failure" else m.apply_not(g))
        seq_exprs.append((et.consequence_of(seq["end_state"]), expr))
    medians = {bb: b.params.get(big.nodes[bb].param_ref).unavailability() for bb in all_basics}
    rng = np.random.default_rng(seed)
    sigma = log(error_factor) / 1.645 if error_factor > 1 else 0.0
    series = {c: np.zeros(samples) for c in _CLASSES}
    for i in range(samples):
        if sigma > 0:
            q = {bb: float(np.clip(np.exp(rng.normal(log(mu), sigma)), 0.0, 1.0)) if mu > 0 else 0.0
                 for bb, mu in medians.items()}
        else:
            q = dict(medians)
        cons: dict[str, float] = {}
        for c, expr in seq_exprs:
            cons[c] = cons.get(c, 0.0) + et.init_frequency * exact_probability(m, expr, q)
        for c in _CLASSES:
            series[c][i] = cons.get(c, 0.0)
    point = quantify_event_tree(model, et_name, house_states=house_states,
                                boundary_condition_set=boundary_condition_set)["consequences"]
    bands = {c: {"p05": float(np.percentile(series[c], 5)),
                 "p50": float(np.percentile(series[c], 50)),
                 "p95": float(np.percentile(series[c], 95))} for c in _CLASSES}
    return {"point": {c: float(point.get(c, 0.0)) for c in _CLASSES}, "bands": bands}


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
    if not specs:
        raise ValueError("aggregate_event_tree_uncertainty: 需要至少一棵事件树")
    trees = []
    median_by_ref: dict[str, float] = {}
    for model, et_name in specs:
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
            if ref not in median_by_ref:
                median_by_ref[ref] = b.params.get(ref).unavailability()
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
        totals = {c: 0.0 for c in _CLASSES}
        for t in trees:                        # 同一抽样施加到全部树,逐级相加
            q = {bb: sampled[ref] for bb, ref in t["ref_of"].items()}
            for c, expr in t["seq_exprs"]:
                totals[c] += t["init_frequency"] * exact_probability(t["m"], expr, q)
        for c in _CLASSES:
            series[c][i] = totals[c]

    point = {c: 0.0 for c in _CLASSES}
    per_tree: list[dict] = []
    for model, et_name in specs:               # 点估计 = 逐树精确后果求和;per_tree 供钉扎分解
        cons = quantify_event_tree(model, et_name, house_states=house_states,
                                   boundary_condition_set=boundary_condition_set)["consequences"]
        row = {c: float(cons.get(c, 0.0)) for c in _CLASSES}
        per_tree.append(row)
        for c in _CLASSES:
            point[c] += row[c]
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
