from __future__ import annotations
from psaengine.model.json_io import load_model_from_dict
from psaengine.model.model import Model


def build_model_from_request(req: dict) -> Model:
    """把前端序列化的事件树请求转成引擎 Model(复用 load_model_from_dict)。

    功能事件二选一:
    - {"id","pfd"}            → 构单基本事件平凡故障树(独立)。
    - {"id","link_ft":name}   → 用 req["fault_trees"][name](引擎 FT json)。
    跨功能事件共享的基本事件(同 id)在 quantify_event_tree 中合并 → 精确否定。
    """
    params: list[dict] = []
    fault_trees: list[dict] = []
    fes: list[dict] = []
    for fe in req["functional_events"]:
        fid = fe["id"]
        if fe.get("link_ft"):
            spec = req["fault_trees"][fe["link_ft"]]
            fault_trees.append({"name": fid, "top": spec["top"], "nodes": spec["nodes"]})
        else:
            params.append({"id": fid, "kind": "probability", "value": float(fe["pfd"])})
            fault_trees.append({"name": fid, "top": fid, "nodes": [
                {"id": fid + "_E", "basic": True, "param_ref": fid},
                {"id": fid, "op": "null", "args": [fid + "_E"]}]})
        fes.append({"id": fid, "link_ft": fid})
    for pid, spec in req.get("parameters", {}).items():
        val = spec["value"] if isinstance(spec, dict) else spec
        params.append({"id": pid, "kind": "probability", "value": float(val)})
    ie = req.get("ie_fault_tree")
    if ie:
        # 序列级 LFT 集成:IE 块自带类型化参数(初因 kind=frequency)——不得走上面的
        # probability 强转;树名默认 __init__,与前端频率模式存储约定一致。
        # review ed90116 F3:ParameterLibrary.add 后写胜出——IE 块参数若与请求参数同 id,
        # 会静默改值/改型(探针:9× 且 200)。同 id 一律响亮拒绝。
        name = ie.get("name", "__init__")
        existing_ids = {p["id"] for p in params}
        fault_trees.append({"name": name, "top": ie["top"], "nodes": ie["nodes"]})
        for p in ie.get("parameters", []):
            if p["id"] in existing_ids:
                raise ValueError(
                    f"ie_fault_tree parameter '{p['id']}' duplicates a request parameter — "
                    "IE 块参数不得与屏障侧参数同 id(后写覆盖会静默改值/改型)")
            params.append({"id": p["id"], "kind": p.get("kind", "probability"),
                           "value": float(p["value"])})
    model_dict = {
        "model_data": {"parameters": params},
        "fault_trees": fault_trees,
        "event_trees": [{
            "name": "TR", "init_event": req["init_event"],
            "init_frequency": req["init_frequency"], "functional_events": fes,
            "sequences": req["sequences"], "consequence_bins": req["consequence_bins"]}],
        "ccf_groups": req.get("ccf_groups", []) or [],
        "boundary_condition_sets": req.get("boundary_condition_sets", []) or [],
    }
    return load_model_from_dict(model_dict)
