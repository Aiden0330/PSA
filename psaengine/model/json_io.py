from __future__ import annotations
import json
from psaengine.model.pdag import PDAG, Op
from psaengine.model.parameters import Parameter, ParameterLibrary, Distribution
from psaengine.model.fault_tree import FaultTree
from psaengine.model.event_tree import EventTree, FunctionalEvent
from psaengine.model.ccf import CCFGroup
from psaengine.model.model import Model
from psaengine.model.rebind import RebindRule
from psaengine.quantify.postprocess import PostRule

def _param(d: dict) -> Parameter:
    dist = None
    if "distribution" in d:
        dist = Distribution(d["distribution"]["family"], d["distribution"].get("params", {}))
    # kind 为 IE-FT 频率功能(2026-07-13)引入;此前的存档/外部 JSON 没有该字段。
    # 缺失 ⟺ 遗留概率参数(频率参数与 kind 同时诞生),默认 probability 方向安全;
    # 频率语义仍须显式 kind="frequency"(units guard 不受影响)。硬取曾使遗留模型 500。
    return Parameter(d["id"], d.get("kind", "probability"), d["value"], mttr=d.get("mttr"),
                     test_interval=d.get("test_interval"), mission_time=d.get("mission_time"),
                     gamma=d.get("gamma"), alpha=d.get("alpha"), beta=d.get("beta"),
                     t0=d.get("t0"),   # Gap 7 精确 Q(t) 模型字段透传
                     epistemic_source=d.get("epistemic_source"),   # CCF 联动源(往返对称)
                     # periodic_test_complete 十参(banked 规格 2026-07-15)——save 侧
                     # parameters_to_json 走 vars() 非 None 全量,天然对称
                     lambda_test=d.get("lambda_test"), theta=d.get("theta"),
                     test_duration=d.get("test_duration"),
                     available_at_test=d.get("available_at_test"),
                     sigma=d.get("sigma"), omega=d.get("omega"),
                     distribution=dist, source=d.get("source"), version=d.get("version"))

def _pdag(ft: dict, lib: ParameterLibrary) -> PDAG:
    g = PDAG()
    # review engine-reviewer F-1(2026-07-16,EB-04 同类早一层):单树内重复 id 装载期
    # 静默重定义——两遍建图,第二遍 g.gate() 无条件覆盖第一遍的 basic/house 同 id 节点
    # (同 id 既是 basic 又是 gate 时,basic 定义被无声丢弃 → 与 EB-04 同向静默低估)。
    # 源头拒绝:一棵树内 id 必须唯一。
    seen: set[str] = set()
    for nd in ft["nodes"]:
        if nd["id"] in seen:
            raise ValueError(f"duplicate node id '{nd['id']}' within fault tree "
                             f"(top='{ft.get('top')}'): ids must be unique per tree")
        seen.add(nd["id"])
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
    ccfs = [CCFGroup(c["id"], c["members"], c["model"], c["factors"], staggered=bool(c.get("staggered", False)))
            for c in d.get("ccf_groups", [])]
    bc_sets = {b["name"]: {k: bool(v) for k, v in b.get("house_states", {}).items()}
               for b in d.get("boundary_condition_sets", [])}
    rebind_rules = [RebindRule(id=r["id"], when={k: bool(v) for k, v in r["when"].items()},
                               param=r["param"], value=r.get("value"), to_param=r.get("to_param"))
                    for r in d.get("rebind_rules", [])]
    post_rules = [PostRule.from_dict(r) for r in d.get("post_rules", [])]
    return Model(parameters=lib, fault_trees=fts, event_trees=ets, ccf_groups=ccfs,
                 bc_sets=bc_sets, rebind_rules=rebind_rules, post_rules=post_rules)

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

def ccf_groups_to_json(groups) -> list[dict]:
    return [{"id": c.id, "members": c.members, "model": c.model, "factors": c.factors,
             **({"staggered": True} if getattr(c, "staggered", False) else {})} for c in groups or []]

def rebind_rules_to_json(rules) -> list[dict]:
    out = []
    for r in rules or []:
        d = {"id": r.id, "when": r.when, "param": r.param}
        if r.value is not None:
            d["value"] = r.value
        if r.to_param is not None:
            d["to_param"] = r.to_param
        out.append(d)
    return out

def post_rules_to_json(rules) -> list[dict]:
    out = []
    for r in rules or []:
        d = {"kind": r.kind, "events": list(r.events)}
        for k in ("add_event", "prob", "source", "source_prob"):
            v = getattr(r, k)
            if v is not None:
                d[k] = v
        out.append(d)
    return out

def save_model(m: Model, path: str) -> None:
    d = {"model_data": {"parameters": parameters_to_json(m.parameters)},
         "fault_trees": [fault_tree_to_dict(name, ft) for name, ft in m.fault_trees.items()],
         "event_trees": [], "ccf_groups": ccf_groups_to_json(m.ccf_groups)}
    if m.rebind_rules:
        d["rebind_rules"] = rebind_rules_to_json(m.rebind_rules)
    if m.post_rules:
        d["post_rules"] = post_rules_to_json(m.post_rules)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
