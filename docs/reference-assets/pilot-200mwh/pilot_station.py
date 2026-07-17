"""200 MWh 参考场站试点 · A 阶段:5 场景项目程序化生成 + 全通道分析 + 钉扎。

参考设计(公开口径,全 C/D 级引用):
- LFP 314 Ah ≈ 1.005 kWh/cell;舱 = 20 pack × 104 cells = 2080 cells ≈ 2.09 MWh
- 站 = 96 舱 ≈ 200 MWh,199,680 cells
- 初频:电芯源(SC_ISC)= CFR_CELL_TR 1e-7/cell·yr 经 product 维度 ×96 舱;
  其余场景 = 库 IE freq_prior(/unit·yr,unit=舱)× 96
- 屏障:scenarios.json 屏障链;B_BMS/B_OFFGAS 按 decompose 挂详细故障树
  (BMS = 2oo3 表决 + beta-CCF + 控制器 + 主继;离气 = 探测 ∨ 联动 HEP)
- SC_OVERCHARGE 走集成 LFT:__init__ = AND(充电控制异常需求, 电压感知失效),
  感知失效基本事件与 B_BMS 传感通道**共享**(合并 BDD 精确处理相关)
- 每项目带命名边界条件集「年度检修」(灭火/热管理屏障 house 强制退出)
"""
import json
import time
import urllib.request
import uuid

BASE = "http://127.0.0.1:8000"
CABINS = 96
CELLS_PER_PACK, PACKS_PER_CABIN = 104, 20
CELL_TR = 1e-7          # CFR_CELL_TR /cell·yr, grade D
SRC = {                  # 参数 → (值, 引用, 备注) —— 全部来自 bess/reference_data.json 既有条目
    "B_OFFGAS":  (0.05, "IEEE/CCPS LOPA(B_OFFGAS 内置先验)", "D"),
    "B_BMS":     (0.10, "IEEE/CCPS LOPA(B_BMS 内置先验)", "D"),
    "B_THERMAL": (0.10, "IEEE/CCPS LOPA(B_THERMAL 内置先验)", "D"),
    "B_DEFLAG":  (0.10, "NFPA 68(B_DEFLAG 内置先验)", "D"),
    "B_SPACING": (0.10, "NFPA 855 间距(B_SPACING 内置先验)", "D"),
    "B_RESPONSE": (0.30, "SPAR-H 量级(B_RESPONSE 内置先验)", "D"),
    "S_SENSE":   (0.05, "warn-tr-multi(多参量热失控预警,C 级)", "C"),
    "CTRL":      (0.01, "sil-2(IEC 61508 SIL2 档,C 级)", "C"),
    "RELAY":     (0.01, "act-main-relay(主继切断,D 级)", "D"),
    "GAS_VOC":   (0.05, "warn-gas-voc-early(早期 VOC 探测,C 级)", "C"),
    "HEP_LINK":  (0.01, "hep-action-sparh(SPAR-H 动作项,C 级)", "C"),
}
IE_PRIOR = {"IE_OVERCHARGE": 2e-3, "IE_COOLANT": 5e-4, "IE_EXT_FIRE": 6e-4, "IE_MECH_WATER": 3e-4}
# ↑ 库 initiating_events freq_prior /unit·yr(读库核对);SC_ISC 走 product 维度不用先验


def _lib_ie_priors():
    lib = json.load(open("bess/reference_data.json"))
    return {e["id"]: e.get("freq_prior") for e in lib["initiating_events"]}


def post(path, body, raw=False):
    r = urllib.request.Request(f"{BASE}{path}", data=json.dumps(body).encode(),
                               headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(r, timeout=180) as f:
            data = f.read()
            return f.status, (data.decode("utf-8", "replace") if raw else json.loads(data))
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:300]


def get(path):
    with urllib.request.urlopen(f"{BASE}{path}", timeout=60) as f:
        return json.loads(f.read())


def param(pid, key=None):
    v, cit, grade = SRC[key or pid]
    return {"id": pid, "kind": "probability", "value": v, "source": cit}


def bms_ft():
    """B_BMS 挂树:TOP = OR(2oo3 传感表决, 控制器, 主继);传感 beta-CCF 0.1。
    传感通道 S_V1 用共享 ref VSENSE(过充场景与 __init__ 共享;其余场景同名同值)。"""
    return {
        "name": "FT_BMS", "top": "BMS_TOP", "nodes": [
            {"id": "S_V1", "basic": True, "param_ref": "VSENSE"},
            {"id": "S_V2", "basic": True, "param_ref": "S_SENSE"},
            {"id": "S_V3", "basic": True, "param_ref": "S_SENSE_B"},
            {"id": "VOTE", "op": "atleast", "args": ["S_V1", "S_V2", "S_V3"], "k": 2,
             "label": "2oo3 传感表决"},
            {"id": "CTRL", "basic": True, "param_ref": "CTRL"},
            {"id": "RELAY", "basic": True, "param_ref": "RELAY"},
            {"id": "BMS_TOP", "op": "or", "args": ["VOTE", "CTRL", "RELAY"], "label": "BMS 切断失效"}]}


def offgas_ft():
    return {"name": "FT_OFFGAS", "top": "OG_TOP", "nodes": [
        {"id": "GAS_VOC", "basic": True, "param_ref": "GAS_VOC"},
        {"id": "HEP_LINK", "basic": True, "param_ref": "HEP_LINK"},
        {"id": "OG_TOP", "op": "or", "args": ["GAS_VOC", "HEP_LINK"], "label": "离气探测+联动失效"}]}


def chain_root(barriers, sev_map):
    """有序屏障链:全二叉;叶后果 = C(1+失败数) 封顶 C5(试点映射约定,文档披露)。"""
    def walk(i, fails):
        if i == len(barriers):
            return {"kind": "leaf", "consequence": sev_map(fails)}
        return {"kind": "branch", "feId": barriers[i],
                "success": walk(i + 1, fails), "failure": walk(i + 1, fails + 1)}
    return walk(0, 0)


def build_scenario(sc, priors):
    sev = lambda f: f"C{min(5, 1 + f)}"
    barriers = sc["barriers"]
    decompose = sc.get("decompose", {})
    fts, params = [], [
        {**param(k)} for k in ("S_SENSE", "CTRL", "RELAY", "GAS_VOC", "HEP_LINK")]
    params += [{"id": "S_SENSE_B", "kind": "probability", "value": SRC["S_SENSE"][0],
                "source": SRC["S_SENSE"][1] + "(B 通道)"},
               {"id": "VSENSE", "kind": "probability", "value": SRC["S_SENSE"][0],
                "source": SRC["S_SENSE"][1] + "(V 主通道,过充场景与初因树共享)"}]
    fes = []
    for b in barriers:
        if decompose.get(b) == "bms":
            fts.append(bms_ft())
            fes.append({"id": b, "label": "BMS 切断", "failProb": SRC["B_BMS"][0], "linkFt": "FT_BMS",
                        "source": SRC["B_BMS"][1], "grade": "C"})
        elif decompose.get(b) == "offgas_shared":
            fts.append(offgas_ft())
            fes.append({"id": b, "label": "早期离气探测+联动", "failProb": SRC["B_OFFGAS"][0],
                        "linkFt": "FT_OFFGAS", "source": SRC["B_OFFGAS"][1], "grade": "C"})
        else:
            v, cit, g = SRC[b]
            fes.append({"id": b, "label": b, "failProb": v, "source": cit, "grade": g})
    # 年度检修边界条件:热管理屏障房事件(检修期强制退出)—— 只在含 B_THERMAL 的场景加
    bc_sets, house_nodes = [], []
    if "B_THERMAL" in barriers:
        fts.append({"name": "FT_THERMAL", "top": "TH_TOP", "nodes": [
            {"id": "TH_FAIL", "basic": True, "param_ref": "B_THERMAL"},
            {"id": "H_MAINT", "house": True, "state": False, "label": "年度检修强制退出"},
            {"id": "TH_TOP", "op": "or", "args": ["TH_FAIL", "H_MAINT"], "label": "热管理抑制失效"}]})
        params.append({"id": "B_THERMAL", "kind": "probability", "value": SRC["B_THERMAL"][0],
                       "source": SRC["B_THERMAL"][1]})
        for fe in fes:
            if fe["id"] == "B_THERMAL":
                fe["linkFt"] = "FT_THERMAL"
        bc_sets = [{"name": "年度检修", "house_states": {"H_MAINT": True}}]

    model = {"initEvent": sc["name"], "functionalEvents": fes,
             "root": chain_root(barriers, sev), "initFreqSource": "manual",
             "initFreq": 0.0}
    if sc["id"] == "SC_ISC":
        model["initFreqSource"] = "product"
        model["product"] = {"cellsPerPack": CELLS_PER_PACK,
                            "packsPerSystem": PACKS_PER_CABIN * CABINS,
                            "cellFailureRate": CELL_TR}
        model["initFreq"] = CELLS_PER_PACK * PACKS_PER_CABIN * CABINS * CELL_TR
        model["initSource"] = "CFR_CELL_TR 1e-7/cell·yr × 199,680 cells(96 舱 × 2080)"
        model["initGrade"] = "D"
    elif sc["id"] == "SC_OVERCHARGE":
        # 集成 LFT:__init__ = AND(充电控制异常, 电压感知失效[共享 VSENSE])
        model["initFreqSource"] = "ft"
        fts.append({"name": "__init__", "top": "IE_TOP", "nodes": [
            {"id": "I_CHG", "basic": True, "param_ref": "I_CHG"},
            {"id": "VS_E", "basic": True, "param_ref": "VSENSE"},
            {"id": "IE_TOP", "op": "and", "args": ["I_CHG", "VS_E"], "label": "过充进入(需求∧感知失效)"}]})
        params.append({"id": "I_CHG", "kind": "frequency", "value": 0.5 * CABINS,
                       "source": "工程假设(D):充电控制异常需求 0.5/舱·yr × 96 舱——待现场数据贝叶斯更新"})
        model["initFreq"] = 0.0
    else:
        per_cabin = priors[sc["init_event"]]
        model["initFreq"] = per_cabin * CABINS
        model["initSource"] = f"库 {sc['init_event']} freq_prior {per_cabin}/unit·yr × {CABINS} 舱"
        model["initGrade"] = "D"

    fts_block = {"model_data": {"parameters": params}, "fault_trees": fts}
    if bc_sets:
        fts_block["boundary_condition_sets"] = bc_sets
    # CCF:BMS 传感三通道 beta 0.1(含 B_BMS 的场景)
    if any(decompose.get(b) == "bms" for b in barriers):
        fts_block["ccf_groups"] = [{"id": "CCF_SENS", "members": ["S_V1", "S_V2", "S_V3"],
                                    "model": "beta", "factors": {"beta": 0.1}}]
    return {"key": f"sc:{sc['id']}", "name": sc["name"], "model": model, "fts": fts_block, "pfds": {}}


def to_engine_request(eta):
    """镜像前端 toEngineRequest + withIeFaultTree(typed 直传版)。"""
    m, fts = eta["model"], eta["fts"]
    seqs, bins, leaf = [], {}, [0]

    def walk(n, path):
        if n["kind"] == "leaf":
            es = f"L{leaf[0]}"; leaf[0] += 1
            seqs.append({"path": dict(path), "end_state": es})
            bins[es] = n["consequence"]
            return
        walk(n["success"], {**path, n["feId"]: "success"})
        walk(n["failure"], {**path, n["feId"]: "failure"})
    walk(m["root"], {})
    ft_by_name = {f["name"]: f for f in fts["fault_trees"]}
    fes, trees = [], {}
    for fe in m["functionalEvents"]:
        if fe.get("linkFt") and fe["linkFt"] in ft_by_name:
            fes.append({"id": fe["id"], "link_ft": fe["id"]})
            trees[fe["id"]] = ft_by_name[fe["linkFt"]]
        else:
            fes.append({"id": fe["id"], "pfd": fe["failProb"]})
    typed_fields = ("mttr", "test_interval", "mission_time", "gamma", "alpha", "beta", "t0")
    parameters = {}
    for p in fts["model_data"]["parameters"]:
        if p.get("kind", "probability") == "probability":
            parameters[p["id"]] = {"value": p["value"]}
        else:
            d = {"kind": p["kind"], "value": p["value"]}
            for f in typed_fields:
                if p.get(f) is not None:
                    d[f] = p[f]
            parameters[p["id"]] = d
    req = {"init_event": m["initEvent"], "init_frequency": m["initFreq"],
           "functional_events": fes, "fault_trees": trees, "parameters": parameters,
           "sequences": seqs, "consequence_bins": bins}
    if fts.get("ccf_groups"):
        req["ccf_groups"] = fts["ccf_groups"]
    if m.get("initFreqSource") == "ft" and "__init__" in ft_by_name:
        ie = ft_by_name["__init__"]
        barrier_refs = set()
        for f in fts["fault_trees"]:
            if f["name"] == "__init__":
                continue
            for n in f["nodes"]:
                if n.get("basic"):
                    barrier_refs.add(n.get("param_ref", n["id"]))
        ie_params, seen, pmap = [], set(), {p["id"]: p for p in fts["model_data"]["parameters"]}
        for n in ie["nodes"]:
            if not n.get("basic"):
                continue
            ref = n.get("param_ref", n["id"])
            if ref in barrier_refs or ref in seen or ref not in pmap:
                continue
            seen.add(ref)
            ie_params.append({"id": ref, "kind": pmap[ref].get("kind", "probability"),
                              "value": pmap[ref]["value"]})
            parameters.pop(ref, None)
        req["ie_fault_tree"] = {"name": "__init__", "top": ie["top"], "nodes": ie["nodes"],
                                "parameters": ie_params}
    return req


def main():
    priors = _lib_ie_priors()
    scenarios = json.load(open("bess/scenarios.json"))["scenarios"]
    results = {}
    for sc in scenarios:
        eta = build_scenario(sc, priors)
        puuid = str(uuid.uuid5(uuid.NAMESPACE_URL, f"pilot-200mwh/{sc['id']}"))
        payload = {"v": 2, "etas": [eta], "activeKey": eta["key"], "checkedKeys": {eta["key"]: True}}
        s, saved = post("/api/saved", {"name": f"试点200MWh·{sc['name']}", "payload": payload})
        assert s == 200, (sc["id"], "save", s, saved)
        req = to_engine_request(eta)
        ctx = {"project_uuid": puuid, "project_payload": payload, "scenario_name": sc["name"]}
        t0 = time.time()
        s, q = post("/api/event-tree/quantify", req)
        dt_q = time.time() - t0
        assert s == 200, (sc["id"], "quantify", s, q)
        integrated = "ie_fault_tree" in req
        s_u, unc = post("/api/event-tree/uncertainty", {**req, **ctx, "samples": 3000, "seed": 42})
        s_i, imp = post("/api/event-tree/importance", {**req, **ctx})
        # 报告(csv 便于抽查页脚)+ 钉扎
        s_r, rep = post("/api/report?format=csv", {**req, **ctx, "samples": 2000, "seed": 42}, raw=True)
        footer = next((ln for ln in rep.splitlines() if "评价依据" in ln), "") if s_r == 200 else ""
        results[sc["id"]] = {
            "name": sc["name"], "uuid": puuid, "sid": saved.get("id"),
            "integrated": integrated,
            "consequences": q["consequences"], "method": q.get("method"),
            "ie_frequency": q.get("ie_frequency"),
            "quantify_s": round(dt_q, 3),
            "uncertainty": ("422-预期(集成,规格已入库)" if s_u == 422 and integrated
                            else (unc.get("bands", {}).get("C3") if s_u == 200 else f"HTTP {s_u}")),
            "importance_status": s_i, "report_status": s_r, "footer": footer[:220],
        }
        print(f"[{sc['id']}] {sc['name']}: C={ {k: f'{v:.3e}' for k, v in q['consequences'].items() if v > 0} }"
              f" method={q.get('method')} unc={s_u} imp={s_i} rep={s_r}")
    # 组合总览
    port = get("/api/portfolio")
    print("\nportfolio rows:", len(port) if isinstance(port, list) else list(port.keys()))
    json.dump(results, open("/tmp/claude-501/pilot_A_results.json", "w"), ensure_ascii=False, indent=1)
    print("A 阶段完成 → /tmp/claude-501/pilot_A_results.json")


if __name__ == "__main__":
    main()
