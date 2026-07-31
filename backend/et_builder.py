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
    manual_fe_ids = {fe["id"] for fe in req["functional_events"] if not fe.get("link_ft")}
    for pid, spec in req.get("parameters", {}).items():
        # 影蔽守卫(2026-07-30,与 ie 块守卫 ed90116 F3 同族):未挂载功能事件已按手输
        # pfd 写入同 id 参数——请求参数再撞同 id 会"后写胜出"静默改值(场景残留参数曾
        # 把 UI 的 0.7 覆成 0.01)。一律响亮拒绝,绝不静默仲裁。
        if pid in manual_fe_ids:
            raise ValueError(
                f"请求参数 '{pid}' 与未挂载功能事件的手输 PFD 同 id——参数会静默覆写 pfd。"
                f"请勿转发未被纳入树引用的参数(前端已过滤;若见此错,检查请求构造)")
        # EB-08:带 kind 键的类型化参数(canonical v2 反构的 Q(t):rate/weibull/glm/…)
        # 透传 kind 与全部类型字段,replay 重建精确不可用度;不带 kind 的旧形状(前端
        # {value} 或裸标量)维持 probability 强转,逐位零扰动。
        if isinstance(spec, dict) and "kind" in spec:
            p: dict = {"id": pid, "kind": spec["kind"], "value": float(spec["value"])}
            for f in ("mttr", "test_interval", "mission_time",
                      "gamma", "alpha", "beta", "t0"):
                if spec.get(f) is not None:
                    p[f] = float(spec[f])
            params.append(p)
        else:
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
