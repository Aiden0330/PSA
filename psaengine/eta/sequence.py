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


def _build_event_tree(model: Model, et_name: str) -> EtBuild:
    """合并各功能事件链接的故障树到一个 PDAG + 同一 BddManager + 各 FE 顶 BDD(建一次)。
    跨序列共享基本事件因合并到同一 PDAG/管理器而自动正确(成功分支精确否定)。"""
    et = model.event_trees[et_name]
    big = PDAG()
    fe_top: dict[str, str] = {}
    for fe in et.functional_events:
        ft = model.fault_trees[fe.link_ft]
        for nid, n in ft.pdag.nodes.items():
            if nid not in big.nodes:
                big.nodes[nid] = n
        fe_top[fe.id] = ft.top
    all_basics = sorted(big.basic_events())
    m = BddManager(all_basics)
    fe_bdd = {fid: build_from_pdag(m, big, top) for fid, top in fe_top.items()}
    return EtBuild(et, big, m, all_basics, fe_bdd)


def quantify_event_tree(model: Model, et_name: str, fe_overrides: dict | None = None) -> dict:
    """事件树逐序列/逐后果精确定量。
    fe_overrides={fe_id:"fail"|"work"} 把该功能事件顶 BDD 强制为常量(必失效/必有效),
    用于扰动法重要度;默认 None = 原行为(强制的是 FE 顶, 不动其底事件 → 共享事件安全)。"""
    b = _build_event_tree(model, et_name)
    et, big, m, all_basics = b.et, b.big, b.m, b.all_basics
    fe_bdd = dict(b.fe_bdd)
    if fe_overrides:
        for fid, mode in fe_overrides.items():
            fe_bdd[fid] = m.one if mode == "fail" else m.zero
    q = {bb: model.parameters.get(big.nodes[bb].param_ref).unavailability() for bb in all_basics}

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


def event_tree_sequences(model: Model, et_name: str, fe_overrides: dict | None = None) -> list[dict]:
    """逐序列明细(非聚合), 按 frequency 降序。复用 _build_event_tree / exact_probability。
    每项: {"end_state","path":{fe_id:"success|failure"},"consequence","frequency"}。
    fe_overrides={fe_id:"fail"|"work"} 把该 FE 顶 BDD 强制为常量(同 quantify_event_tree);
    非 "fail" 一律按 "work" 处理。"""
    b = _build_event_tree(model, et_name)
    et, big, m, all_basics = b.et, b.big, b.m, b.all_basics
    fe_bdd = dict(b.fe_bdd)
    if fe_overrides:
        for fid, mode in fe_overrides.items():
            fe_bdd[fid] = m.one if mode == "fail" else m.zero
    q = {bb: model.parameters.get(big.nodes[bb].param_ref).unavailability() for bb in all_basics}

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
