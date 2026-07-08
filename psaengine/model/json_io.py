from __future__ import annotations
import json
from psaengine.model.pdag import PDAG, Op
from psaengine.model.parameters import Parameter, ParameterLibrary, Distribution
from psaengine.model.fault_tree import FaultTree
from psaengine.model.event_tree import EventTree, FunctionalEvent
from psaengine.model.ccf import CCFGroup
from psaengine.model.model import Model

def _param(d: dict) -> Parameter:
    dist = None
    if "distribution" in d:
        dist = Distribution(d["distribution"]["family"], d["distribution"].get("params", {}))
    return Parameter(d["id"], d["kind"], d["value"], mttr=d.get("mttr"),
                     test_interval=d.get("test_interval"), mission_time=d.get("mission_time"),
                     distribution=dist, source=d.get("source"), version=d.get("version"))

def _pdag(ft: dict, lib: ParameterLibrary) -> PDAG:
    g = PDAG()
    for nd in ft["nodes"]:
        if nd.get("basic"):
            ref = nd.get("param_ref", nd["id"])
            if ref not in lib:
                raise ValueError(f"undefined param_ref '{ref}' for basic event '{nd['id']}'")
            g.basic(nd["id"], param_ref=ref)
        elif nd.get("house"):
            g.house(nd["id"], state=bool(nd["state"]))
    for nd in ft["nodes"]:                       # 第二遍建门(确保子节点已存在)
        if "op" in nd:
            g.gate(nd["id"], Op(nd["op"]), nd["args"], k=nd.get("k"))
    g.top = ft["top"]
    g.validate()
    return g

def load_model(path: str) -> Model:
    with open(path, encoding="utf-8") as f:
        return load_model_from_dict(json.load(f))

def load_model_from_dict(d: dict) -> Model:
    lib = ParameterLibrary()
    for p in d["model_data"]["parameters"]:
        lib.add(_param(p))
    fts = {ft["name"]: FaultTree(ft["top"], _pdag(ft, lib)) for ft in d.get("fault_trees", [])}
    ets = {}
    for et in d.get("event_trees", []):
        ets[et["name"]] = EventTree(
            et["init_event"], et["init_frequency"],
            [FunctionalEvent(fe["id"], fe.get("link_ft"), fe.get("link_basic"))
             for fe in et["functional_events"]],
            et["sequences"], et["consequence_bins"])
    ccfs = [CCFGroup(c["id"], c["members"], c["model"], c["factors"]) for c in d.get("ccf_groups", [])]
    return Model(parameters=lib, fault_trees=fts, event_trees=ets, ccf_groups=ccfs)

def node_to_json(n) -> dict:
    if n.is_basic: return {"id": n.id, "basic": True, "param_ref": n.param_ref}
    if n.is_house: return {"id": n.id, "house": True, "state": n.state}
    out = {"id": n.id, "op": n.op.value, "args": n.args}
    if n.k is not None: out["k"] = n.k
    return out

def fault_tree_to_dict(name: str, ft) -> dict:
    """序列化故障树为引擎 json 格式({name, top, nodes}), 供前端下钻/精确量化复用。"""
    return {"name": name, "top": ft.top,
            "nodes": [node_to_json(ft.pdag.node(i)) for i in ft.pdag.nodes]}

def parameters_to_json(plib) -> list[dict]:
    return [{"id": p, **{k: v for k, v in vars(plib.get(p)).items()
                         if k not in ("id", "distribution") and v is not None}}
            for p in plib.ids()]

def save_model(m: Model, path: str) -> None:
    d = {"model_data": {"parameters": parameters_to_json(m.parameters)},
         "fault_trees": [fault_tree_to_dict(name, ft) for name, ft in m.fault_trees.items()],
         "event_trees": [], "ccf_groups": []}
    with open(path, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
