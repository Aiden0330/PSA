from __future__ import annotations
import os
from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse

from backend import examples, schemas
from psaengine.model.json_io import load_model_from_dict
from psaengine.analysis import Analysis


class UTF8JSONResponse(JSONResponse):
    media_type = "application/json; charset=utf-8"


app = FastAPI(title="BESS PSA", default_response_class=UTF8JSONResponse)
app.add_middleware(CORSMiddleware, allow_origins=["*"],
                   allow_methods=["*"], allow_headers=["*"])

@app.get("/api/examples")
def api_examples():
    return examples.list_examples()

@app.get("/api/model/{eid}")
def api_model(eid: str):
    try:
        return examples.get_model(eid)
    except KeyError:
        raise HTTPException(404, f"unknown example {eid}")

@app.post("/api/quantify", response_model=schemas.QuantifyResponse)
def api_quantify(req: schemas.QuantifyRequest):
    model = load_model_from_dict(req.model)
    an = Analysis(model, fault_tree=req.fault_tree)
    cs = an.cutsets(cutoff=req.cutoff, limit_order=req.limit_order)
    return schemas.QuantifyResponse(
        probability=an.probability(method=req.method), method=req.method,
        cutsets=[schemas.CutSetOut(events=c.events, order=c.order, probability=c.probability)
                 for c in cs],
        importance=an.importance(measures=["fv", "raw", "birnbaum"]))

@app.post("/api/event-tree/quantify", response_model=schemas.EtQuantifyResponse)
def api_event_tree_quantify(req: schemas.EtQuantifyRequest):
    """ROADMAP A: 前端序列化事件树 → 引擎精确否定定量(跨屏障共享事件精确)。"""
    from backend.et_builder import build_model_from_request
    from psaengine.eta.sequence import quantify_event_tree
    model = build_model_from_request(req.model_dump())
    res = quantify_event_tree(model, "TR")
    return schemas.EtQuantifyResponse(sequences=res["sequences"], consequences=res["consequences"])

@app.post("/api/report")
def api_report(req: schemas.ReportRequest, format: str = "docx"):
    """由当前 ETA 重算 → 生成 Word/PDF/CSV 报告下载。"""
    import base64
    from backend.et_builder import build_model_from_request
    from backend import report_export as rx
    if format not in ("docx", "pdf", "csv"):
        raise HTTPException(400, "format must be docx|pdf|csv")
    dumped = req.model_dump()
    model = build_model_from_request(dumped)
    linked_ids = [fe["id"] for fe in dumped["functional_events"] if fe.get("link_ft")]
    data = rx.build_report_data(model, "TR", consequence_defs=req.consequence_defs, labels=req.labels,
                                linked_fe_ids=linked_ids, samples=req.samples, seed=req.seed,
                                error_factor=req.error_factor)
    # ADR-2 自动钉扎:携带项目上下文的报告 → 版本(幂等)+ 分析案例 + 页脚证据链。
    evidence, case_id = None, None
    if req.project_uuid and req.project_payload is not None:
        from datetime import datetime, timezone
        from backend import store
        from backend.canonical import to_canonical
        try:
            doc, sidecar = to_canonical(req.project_payload, req.project_uuid)
        except Exception as e:
            raise HTTPException(400, f"project_payload 无法规范化: {e}")
        store.ensure_project(req.project_uuid, req.scenario_name or "项目")
        ver = store.create_version(req.project_uuid, doc, sidecar, origin="auto_pin",
                                   message=f"auto: report {format}")
        case_id = store.create_case(
            req.project_uuid, ver["id"], "report",
            settings={"format": format, "samples": req.samples, "seed": req.seed,
                      "error_factor": req.error_factor, "scenario_name": req.scenario_name},
            results={"consequences": data["consequences"], "bands": data["bands"]},
            audit_action="report.export")
        evidence = {"case_id": case_id, "version_hash": ver["content_hash"],
                    "engine_version": store.engine_version(),
                    "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    png = None
    if req.tree_png and "," in req.tree_png:
        try:
            png = base64.b64decode(req.tree_png.split(",", 1)[1])
        except Exception:
            png = None
    if format == "csv":
        body, media, ext = rx.report_csv(data, evidence=evidence), "text/csv; charset=utf-8", "csv"
    elif format == "docx":
        body = rx.report_docx(data, req.scenario_name, png, evidence=evidence)
        media, ext = "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"
    else:
        body, media, ext = rx.report_pdf(data, req.scenario_name, png, evidence=evidence), "application/pdf", "pdf"
    if case_id is not None:
        import hashlib
        from backend import store
        store.update_case_artifacts(case_id, {"format": ext, "filename": f"qra_report.{ext}",
                                              "sha256": hashlib.sha256(body).hexdigest()})
    return Response(content=body, media_type=media,
                    headers={"Content-Disposition": f'attachment; filename="qra_report.{ext}"'})

@app.post("/api/import/mef")
def api_import_mef(req: schemas.MefImportRequest):
    """上传 MEF/Open-PSA XML → 解析为模型(与 /api/model/{id} 同形, 供前端载入)。"""
    import tempfile, os
    from psaengine.model.mef_xml import load_mef_xml
    from psaengine.model.json_io import fault_tree_to_dict, parameters_to_json
    fd, path = tempfile.mkstemp(suffix=".xml")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(req.xml)
        try:
            model = load_mef_xml(path)
        except Exception as e:
            raise HTTPException(400, f"MEF 解析失败: {e}")
    finally:
        os.remove(path)
    fts = [fault_tree_to_dict(name, ft) for name, ft in model.fault_trees.items()]
    if not fts:
        raise HTTPException(400, "MEF 中无故障树")
    return {"model": {"model_data": {"parameters": parameters_to_json(model.parameters)},
                      "fault_trees": fts, "event_trees": [], "ccf_groups": []},
            "fault_tree": fts[0]["name"]}

@app.get("/api/saved")
def api_saved_list():
    from backend import storage
    return storage.list_workspaces()

@app.post("/api/saved")
def api_saved_create(req: schemas.SaveWorkspaceRequest):
    from backend import storage
    rec = storage.save_workspace(req.name, req.payload, sid=req.id)
    # ADR-2 绞杀者双写:v2 载荷 → canonical 版本(幂等);失败不影响旧行为(非 v2 载荷等)。
    try:
        from backend import store
        rec["version"] = store.save_workspace_version(rec["id"], req.name, req.payload)
    except Exception:
        pass
    return rec

@app.get("/api/saved/{sid}")
def api_saved_get(sid: str):
    from backend import storage, store
    try:
        rec = storage.load_workspace(sid)
    except KeyError:
        raise HTTPException(404, f"no saved workspace {sid}")
    # ADR-2:附带该存档对应的稳定项目 UUID(前端报告钉扎/案例查询用)
    rec["project_uuid"] = store.legacy_project_uuid(sid)
    return rec

@app.delete("/api/saved/{sid}")
def api_saved_delete(sid: str):
    from backend import storage
    try:
        storage.delete_workspace(sid)
    except KeyError:
        raise HTTPException(404, f"no saved workspace {sid}")
    return {"ok": True}

@app.post("/api/event-tree/uncertainty")
def api_event_tree_uncertainty(req: schemas.EtUncertaintyRequest):
    """事件树蒙特卡洛不确定性带(C1–C5 的 p05/p50/p95 + 点估计)。"""
    from backend.et_builder import build_model_from_request
    from psaengine.eta.uncertainty import event_tree_uncertainty
    model = build_model_from_request(req.model_dump())
    return event_tree_uncertainty(model, "TR", samples=req.samples, seed=req.seed, error_factor=req.error_factor)

@app.post("/api/event-tree/importance")
def api_event_tree_importance(req: schemas.EtQuantifyRequest):
    """扰动法屏障级 FV/RAW 重要度(按后果)。"""
    from backend.et_builder import build_model_from_request
    from psaengine.eta.uncertainty import barrier_importance_exact
    model = build_model_from_request(req.model_dump())
    return {"importance": barrier_importance_exact(model, "TR")}

@app.get("/api/bess/library")
def api_bess_library():
    """带来源引用的预置参考库(器件失效率 / 屏障有效性 / 初因频率)。"""
    from bess.library import load_library
    return load_library()

@app.get("/api/bess/thermal-runaway")
def api_bess_tr():
    from bess.report import build_report
    return build_report(scenario="grid_container", samples=300)

@app.get("/api/bess/scenarios")
def api_bess_scenarios():
    """内置场景事件树列表。"""
    from bess.scenarios import load_scenarios
    return [{"id": s["id"], "name": s["name"]} for s in load_scenarios()]

@app.get("/api/bess/event-tree")
def api_bess_event_tree(scenario: str | None = None):
    """事件树结构 + 每序列定量, 供前端画 ETA 分支图。
    无 scenario = 默认热失控级联(向后兼容);带 scenario = 内置场景模型。"""
    from bess.report import _barrier_importance
    from psaengine.eta.sequence import quantify_event_tree
    if scenario:
        from bess.scenarios import build_scenario_model
        from bess.library import load_library
        from psaengine.model.json_io import fault_tree_to_dict, parameters_to_json
        model = build_scenario_model(scenario)
        lib = load_library()
        labels = {b["id"]: b["name"] for b in lib["barrier_effectiveness"]}
        fe_prob = {b["id"]: b["pfd"] for b in lib["barrier_effectiveness"]}
        # 序列化故障树 + 参数, 供前端 FE 下钻 + 引擎精确量化(共享事件)转发
        ft_json = {name: fault_tree_to_dict(name, ft) for name, ft in model.fault_trees.items()}
        params_json = parameters_to_json(model.parameters)
    else:
        from bess.tr_model import build_thermal_runaway_model, load_data
        model = build_thermal_runaway_model()
        data = load_data()
        labels = {b["id"]: b["label"] for b in data["barriers"]}
        fe_prob = {b["id"]: b["pfd_prior"] for b in data["barriers"]}
        ft_json, params_json = {}, []
    et = model.event_trees["TR"]
    res = quantify_event_tree(model, "TR")
    sequences = [{
        "end_state": s["end_state"],
        "path": s["path"],
        "consequence": et.consequence_of(s["end_state"]),
        "frequency": res["sequences"].get(s["end_state"], 0.0),
    } for s in et.sequences]
    return {
        "init_event": et.init_event,
        "init_frequency": et.init_frequency,
        "functional_events": [fe.id for fe in et.functional_events],
        "labels": labels,
        "fe_prob": fe_prob,
        "sequences": sequences,
        "consequences": res["consequences"],
        "barrier_importance": _barrier_importance(model),
        "fault_trees": ft_json,
        "parameters": params_json,
    }

# ---- ADR-2 只读面:项目 / 版本 / 审计 / 分析案例(证据链查询) ----
@app.get("/api/projects")
def api_projects_list():
    from backend import store
    return store.list_projects()

@app.get("/api/projects/{puuid}")
def api_project_get(puuid: str):
    from backend import store
    p = store.get_project(puuid)
    if p is None:
        raise HTTPException(404, f"no project {puuid}")
    return p

@app.get("/api/projects/{puuid}/versions")
def api_project_versions(puuid: str):
    from backend import store
    return store.list_versions(puuid)

@app.get("/api/projects/{puuid}/versions/{vid}")
def api_project_version(puuid: str, vid: int, include_doc: bool = False):
    from backend import store
    v = store.get_version(puuid, vid, include_doc=include_doc)
    if v is None:
        raise HTTPException(404, f"no version {vid} in project {puuid}")
    return v

@app.get("/api/projects/{puuid}/audit")
def api_project_audit(puuid: str, limit: int = 200):
    from backend import store
    return store.list_audit(puuid, limit=limit)

@app.get("/api/projects/{puuid}/cases")
def api_project_cases(puuid: str):
    from backend import store
    return store.list_cases(puuid)

@app.get("/api/schema/project-document/1.0")
def api_project_document_schema():
    """ADR-1: 规范 ProjectDocument 的 JSON Schema(严格,additionalProperties:false)。
    ADR-3 的 AI 结构化输出直接引用本模式。"""
    from backend.canonical import ProjectDocument
    return ProjectDocument.model_json_schema()

@app.post("/api/ai/draft-model", response_model=schemas.AiDraftResponse)
def api_ai_draft_model(req: schemas.AiDraftRequest):
    """LLM 生成 ETA/FTA 草案。只返回待审核草案;不直接写入项目。"""
    from backend import ai_draft
    if not ai_draft.is_enabled():
        raise HTTPException(503, "AI draft model is disabled; set PSA_AI_ENABLED=1 to enable it.")
    try:
        return ai_draft.create_draft(req)
    except ai_draft.ProviderError as e:
        raise HTTPException(502, str(e))

# ---- 静态托管前端构建产物(存在时) ----
_DIST = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
if os.path.isdir(_DIST):
    app.mount("/", StaticFiles(directory=_DIST, html=True), name="static")
else:
    @app.get("/", response_class=HTMLResponse)
    def _placeholder():
        return "<h1>BESS PSA API</h1><p>前端未构建:cd frontend && npm run build。API 在 /api/*。</p>"
