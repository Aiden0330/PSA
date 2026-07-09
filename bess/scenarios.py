from __future__ import annotations
import json, os
from psaengine.model.pdag import PDAG, Op
from psaengine.model.parameters import Parameter, ParameterLibrary, Distribution
from psaengine.model.fault_tree import FaultTree
from psaengine.model.event_tree import EventTree, FunctionalEvent
from psaengine.model.model import Model
from bess.library import load_library
from bess.tr_model import CONSEQUENCE_AT_DEPTH

_SCEN = os.path.join(os.path.dirname(__file__), "scenarios.json")


def load_scenarios(path: str = _SCEN) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        return json.load(f)["scenarios"]


def _scenario(sid: str) -> dict:
    for s in load_scenarios():
        if s["id"] == sid:
            return s
    raise KeyError(sid)


def _trivial_ft(bid: str) -> FaultTree:
    """单基本事件平凡故障树: 屏障失败 = 其 PFD 参数。"""
    g = PDAG()
    g.basic(bid + "_E", param_ref=bid)
    g.gate(bid, Op.NULL, [bid + "_E"])
    g.top = bid
    return FaultTree(bid, g)


# 分解树参数一律引用参考库条目(2026-07-08 出处评审 F3:硬编码收编,治理统一)。
# ft_kind -> (rates) -> (FaultTree, {param_id: (value, citation)})
def _lib_params(rates: dict[str, dict], cids: list[str]) -> dict[str, tuple[float, str]]:
    return {cid: (rates[cid]["rate"], rates[cid]["source"]["citation"]) for cid in cids}


def _ft_bms(rates: dict[str, dict]):
    g = PDAG()
    for cid in ("CFR_BMS_SENSOR", "CFR_BMS_LOGIC", "CFR_CONTACTOR"):
        g.basic(cid, param_ref=cid)
    g.gate("B_BMS", Op.OR, ["CFR_BMS_SENSOR", "CFR_BMS_LOGIC", "CFR_CONTACTOR"])
    g.top = "B_BMS"
    return FaultTree("B_BMS", g), _lib_params(rates, ["CFR_BMS_SENSOR", "CFR_BMS_LOGIC", "CFR_CONTACTOR"])


def _ft_offgas_shared(rates: dict[str, dict]):
    g = PDAG()
    g.basic("CFR_OFFGAS_DET", param_ref="CFR_OFFGAS_DET")
    g.basic("CFR_CONTACTOR", param_ref="CFR_CONTACTOR")  # 与 B_BMS 共享(联动跳闸经同一接触器)
    g.gate("B_OFFGAS", Op.OR, ["CFR_OFFGAS_DET", "CFR_CONTACTOR"])
    g.top = "B_OFFGAS"
    return FaultTree("B_OFFGAS", g), _lib_params(rates, ["CFR_OFFGAS_DET", "CFR_CONTACTOR"])


_FT_BUILDERS = {"bms": _ft_bms, "offgas_shared": _ft_offgas_shared}


def build_scenario_model(scenario_id: str) -> Model:
    """由参考库 + 场景定义构建事件树 Model。
    级联语义: 连续失败 j 道屏障 → 后果 CONSEQUENCE_AT_DEPTH[j](封顶 C5)。
    带 decompose 的屏障挂真故障树(可跨屏障共享基本事件 → 引擎精确否定)。"""
    lib = load_library()
    barrier_by_id = {b["id"]: b for b in lib["barrier_effectiveness"]}
    ie_by_id = {e["id"]: e for e in lib["initiating_events"]}
    rates_by_id = {c["id"]: c for c in lib["component_failure_rates"]}
    sc = _scenario(scenario_id)
    bids = sc["barriers"]
    decompose = sc.get("decompose", {})
    ie_freq = ie_by_id[sc["init_event"]]["freq_prior"]

    plib = ParameterLibrary()
    fts: dict[str, FaultTree] = {}
    added: set[str] = set()

    def add_param(pid: str, val: float, src: str) -> None:
        if pid not in added:
            plib.add(Parameter(pid, "probability", val,
                               distribution=Distribution("lognormal", {"median": val, "error_factor": 3}),
                               source=src))
            added.add(pid)

    for bid in bids:
        if bid in decompose:
            ft, params = _FT_BUILDERS[decompose[bid]](rates_by_id)
            fts[bid] = ft
            for pid, (val, src) in params.items():
                add_param(pid, val, src)
        else:
            pfd = barrier_by_id[bid]["pfd"]
            add_param(bid, pfd, barrier_by_id[bid]["source"]["citation"])
            fts[bid] = _trivial_ft(bid)
    fes = [FunctionalEvent(bid, link_ft=bid) for bid in bids]

    sequences, bins = [], {}
    for j in range(len(bids) + 1):
        path = {bids[k]: "failure" for k in range(j)}
        if j < len(bids):
            path[bids[j]] = "success"
        end = f"D{j}"
        bins[end] = CONSEQUENCE_AT_DEPTH[min(j, len(CONSEQUENCE_AT_DEPTH) - 1)]
        sequences.append({"path": path, "end_state": end})
    et = EventTree(sc["init_event"], ie_freq, fes, sequences, bins)
    return Model(parameters=plib, fault_trees=fts, event_trees={"TR": et}, ccf_groups=[])
