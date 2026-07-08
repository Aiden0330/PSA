from __future__ import annotations
import numpy as np
from math import log
from psaengine.eta.sequence import quantify_event_tree
from bess.tr_model import build_thermal_runaway_model, load_data
from bess.consequences import CONSEQUENCE_LABELS

_WEIGHTS = {"C1": 1, "C2": 2, "C3": 3, "C4": 4, "C5": 5}
_CLASSES = ["C1", "C2", "C3", "C4", "C5"]

def _barrier_importance(model) -> list[tuple[str, float]]:
    """屏障重要度代理: 屏障失败所牵涉序列的后果严重度加权和(越早的屏障守护越多下游后果)。"""
    et = model.event_trees["TR"]
    imp = []
    for fe in et.functional_events:
        contrib = 0.0
        for seq in et.sequences:
            if seq["path"].get(fe.id) == "failure":
                contrib += _WEIGHTS.get(et.consequence_of(seq["end_state"]), 0)
        imp.append((fe.id, contrib))
    imp.sort(key=lambda x: -x[1])
    return imp

def _uncertainty(model, samples: int, seed: int) -> dict:
    """对屏障 PFD 采样(对数正态 EF=3), 用真实引擎重算事件树, 得各后果类频率分布。"""
    barriers = load_data()["barriers"]
    rng = np.random.default_rng(seed)
    sigma = log(3) / 1.645
    cols = {b["id"]: np.clip(rng.lognormal(log(b["pfd_prior"]), sigma, samples), 0.0, 1.0)
            for b in barriers}
    series = {c: np.zeros(samples) for c in _CLASSES}
    for i in range(samples):
        for b in barriers:
            model.parameters.get(b["id"]).value = float(cols[b["id"]][i])
        res = quantify_event_tree(model, "TR")
        for c, f in res["consequences"].items():
            series[c][i] = f
    for b in barriers:                                   # 还原点估计参数值
        model.parameters.get(b["id"]).value = b["pfd_prior"]
    return {c: {"p05": float(np.percentile(series[c], 5)),
                "p50": float(np.percentile(series[c], 50)),
                "p95": float(np.percentile(series[c], 95))} for c in _CLASSES}

def build_report(scenario: str = "grid_container", samples: int = 10000, seed: int = 42) -> dict:
    model = build_thermal_runaway_model(scenario=scenario)
    cons = quantify_event_tree(model, "TR")["consequences"]
    return {"scenario": scenario, "consequences": cons,
            "uncertainty": _uncertainty(model, samples, seed),
            "barrier_importance": _barrier_importance(model), "samples": samples}

def run_scenario(scenario: str = "grid_container", samples: int = 10000,
                 output: str = "bess_qra_report.md") -> str:
    rpt = build_report(scenario=scenario, samples=samples)
    L = [f"# BESS 热失控 QRA 报告 — 场景: {scenario}", "",
         "## 后果频率(每站每年, 含 5–95% 不确定性带)", "",
         "| 后果类 | 说明 | 点估计 | p05 | p95 |", "|---|---|---|---|---|"]
    for c in _CLASSES:
        if c in rpt["consequences"]:
            b = rpt["uncertainty"][c]
            L.append(f"| {c} | {CONSEQUENCE_LABELS[c]} | {rpt['consequences'][c]:.4g} | "
                     f"{b['p05']:.4g} | {b['p95']:.4g} |")
    L += ["", "## 屏障重要度排序(对后果严重度的贡献)"]
    for bid, score in rpt["barrier_importance"]:
        L.append(f"- **{bid}**: {score:.0f}")
    L += ["", f"*样本数 {rpt['samples']};屏障 PFD / IE 频率为 bess-tr-event-tree 先验, "
          "对数正态(EF=3), 待现场数据贝叶斯校准。*"]
    with open(output, "w", encoding="utf-8") as f:
        f.write("\n".join(L))
    return output
