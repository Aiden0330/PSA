from __future__ import annotations
import json, os
from psaengine.model.pdag import PDAG, Op
from psaengine.model.parameters import Parameter, ParameterLibrary, Distribution
from psaengine.model.fault_tree import FaultTree
from psaengine.model.event_tree import EventTree, FunctionalEvent
from psaengine.model.model import Model

_DATA = os.path.join(os.path.dirname(__file__), "tr_model_data.json")
# 级联深度 → 后果(depth = 从首道起连续失败的屏障数, 0..6), 封顶 C5
CONSEQUENCE_AT_DEPTH = ["C1", "C2", "C3", "C4", "C5", "C5", "C5"]

def load_data(path: str = _DATA) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)

def _barrier_ft(bid: str) -> FaultTree:
    g = PDAG(); g.basic(bid + "_E", param_ref=bid)
    g.gate(bid, Op.NULL, [bid + "_E"]); g.top = bid
    return FaultTree(bid, g)

def build_thermal_runaway_model(scenario: str = "grid_container", data: dict | None = None) -> Model:
    """由 bess-tr-event-tree 技能的 tr_model.json 建热失控级联事件树。
    屏障按演化时序排列, 每多失败一道屏障后果升一级(封顶 C5)。
    PFD / IE 频率均为先验, 带对数正态不确定性, 待现场数据贝叶斯更新。"""
    data = data or load_data()
    barriers = data["barriers"]
    ie_freq = sum(ie["freq_prior"] for ie in data["initiating_events"])

    lib = ParameterLibrary()
    for b in barriers:
        pfd = b["pfd_prior"]
        lib.add(Parameter(b["id"], "probability", pfd,
                          distribution=Distribution("lognormal", {"median": pfd, "error_factor": 3}),
                          source=b.get("source", "bess-tr-event-tree prior (待现场校准)")))
    fts = {b["id"]: _barrier_ft(b["id"]) for b in barriers}
    fes = [FunctionalEvent(b["id"], link_ft=b["id"]) for b in barriers]
    bids = [b["id"] for b in barriers]

    sequences, bins = [], {}
    # depth=j: 前 j 道屏障连续失败、第 j 道成功(止于该级); j=len → 全部失败。互斥穷尽, 概率和=1。
    for j in range(len(bids) + 1):
        path = {bids[k]: "failure" for k in range(j)}
        if j < len(bids):
            path[bids[j]] = "success"
        end = f"D{j}"
        bins[end] = CONSEQUENCE_AT_DEPTH[j]
        sequences.append({"path": path, "end_state": end})
    et = EventTree("IE_TR", ie_freq, fes, sequences, bins)
    return Model(parameters=lib, fault_trees=fts, event_trees={"TR": et}, ccf_groups=[])
