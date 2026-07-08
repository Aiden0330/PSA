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


# ft_kind -> () -> (FaultTree, {param_id: (value, citation)})
def _ft_bms():
    g = PDAG()
    g.basic("BMS_SENSOR_FAIL", param_ref="BMS_SENSOR_FAIL")
    g.basic("BMS_LOGIC_FAIL", param_ref="BMS_LOGIC_FAIL")
    g.basic("BMS_CONTACTOR_FAIL", param_ref="BMS_CONTACTOR_FAIL")
    g.gate("B_BMS", Op.OR, ["BMS_SENSOR_FAIL", "BMS_LOGIC_FAIL", "BMS_CONTACTOR_FAIL"])
    g.top = "B_BMS"
    params = {
        "BMS_SENSOR_FAIL": (0.03, "DNV/Gully 2019 传感失效"),
        "BMS_LOGIC_FAIL": (0.01, "IEC 61508 SIL 逻辑"),
        "BMS_CONTACTOR_FAIL": (0.06, "OREDA/exida 接触器拒动"),
    }
    return FaultTree("B_BMS", g), params


def _ft_offgas_shared():
    g = PDAG()
    g.basic("OFFGAS_DET_FAIL", param_ref="OFFGAS_DET_FAIL")
    g.basic("BMS_CONTACTOR_FAIL", param_ref="BMS_CONTACTOR_FAIL")  # 与 B_BMS 共享(联动跳闸经同一接触器)
    g.gate("B_OFFGAS", Op.OR, ["OFFGAS_DET_FAIL", "BMS_CONTACTOR_FAIL"])
    g.top = "B_OFFGAS"
    params = {
        "OFFGAS_DET_FAIL": (0.008, "Li-ion Tamer/Honeywell 离气探测"),
        "BMS_CONTACTOR_FAIL": (0.06, "OREDA/exida 接触器拒动"),
    }
    return FaultTree("B_OFFGAS", g), params


_FT_BUILDERS = {"bms": _ft_bms, "offgas_shared": _ft_offgas_shared}


def build_scenario_model(scenario_id: str) -> Model:
    """由参考库 + 场景定义构建事件树 Model。
    级联语义: 连续失败 j 道屏障 → 后果 CONSEQUENCE_AT_DEPTH[j](封顶 C5)。
    带 decompose 的屏障挂真故障树(可跨屏障共享基本事件 → 引擎精确否定)。"""
    lib = load_library()
    barrier_by_id = {b["id"]: b for b in lib["barrier_effectiveness"]}
    ie_by_id = {e["id"]: e for e in lib["initiating_events"]}
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
            ft, params = _FT_BUILDERS[decompose[bid]]()
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
