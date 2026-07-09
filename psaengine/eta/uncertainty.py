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
