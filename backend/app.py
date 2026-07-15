from __future__ import annotations
import os
from fastapi import Depends, FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel

from backend import examples, schemas
from psaengine.model.json_io import load_model_from_dict
from psaengine.analysis import Analysis


class UTF8JSONResponse(JSONResponse):
    media_type = "application/json; charset=utf-8"


app = FastAPI(title="BESS PSA", default_response_class=UTF8JSONResponse)

# 修复项 ③(ADR-4):CORS 收紧。off 模式保持 "*"(本地/离线开发不变,约束 #0);
# server 模式走 PSA_CORS_ORIGINS 白名单(逗号分隔,默认空=仅同源)。
# 注:凭据请求(cookie)下 CORS 规范禁止 "*" + credentials 并存 —— server 模式必走
# 白名单,天然一致;off 模式无 cookie,"*" 无害。
from backend.auth import is_server_mode as _is_server_mode

if _is_server_mode():
    _cors_origins = [o.strip() for o in os.environ.get("PSA_CORS_ORIGINS", "").split(",") if o.strip()]
else:
    _cors_origins = ["*"]
app.add_middleware(CORSMiddleware, allow_origins=_cors_origins, allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])

# Phase 5 auth(B2):登录/登出/身份端点 + 会话身份贯通中间件。
# off 模式:中间件不 set → actor() 回退 OS 用户(约束 #0 逐位不变);/api/auth/me 报 mode。
from backend.auth.routes import router as _auth_router, SESSION_COOKIE as _SESSION_COOKIE
from backend.auth.guards import require_role, require_authenticated, ANALYST, REVIEWER, ANY_ROLE, ADMIN

app.include_router(_auth_router)


@app.middleware("http")
async def _session_identity_middleware(request, call_next):
    token = None
    request.state.identity = None
    if _is_server_mode():
        raw = request.cookies.get(_SESSION_COOKIE)
        if raw:
            from backend import store
            ident = store.get_session(raw)
            if ident:
                request.state.identity = ident      # 守卫读它(role);不重复查库
                token = store.set_current_actor(ident["username"])
    try:
        return await call_next(request)
    finally:
        if token is not None:
            from backend import store
            store.reset_current_actor(token)

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
def api_quantify(req: schemas.QuantifyRequest, _=Depends(require_role(*ANALYST))):
    model = load_model_from_dict(req.model)
    try:
        an = Analysis(model, fault_tree=req.fault_tree,
                      house_states=req.house_states or None,
                      boundary_condition_set=req.boundary_condition_set)
    except ValueError as e:                          # 未知 house/边界集等建模错误 → 400 而非 500
        raise HTTPException(400, str(e))
    cs = an.cutsets(cutoff=req.cutoff, limit_order=req.limit_order)
    post = None
    if req.post_rules:                               # 4a3:后处理只动 MCS 列表;精确概率通道不变
        from psaengine.quantify.postprocess import PostRule, apply_post_rules
        from psaengine.quantify.probability import rea, mcub
        try:
            rules = [PostRule.from_dict(r) for r in req.post_rules]
        except ValueError as e:
            raise HTTPException(400, str(e))
        cs, stats = apply_post_rules(cs, rules)
        probs = [c.probability for c in cs]
        post = {**stats, "probability_rea": rea(probs), "probability_mcub": mcub(probs)}
    return schemas.QuantifyResponse(
        probability=an.probability(method=req.method), method=req.method,
        cutsets=[schemas.CutSetOut(events=c.events, order=c.order, probability=c.probability)
                 for c in cs],
        importance=an.importance(measures=["fv", "raw", "birnbaum"]),
        post=post)

@app.post("/api/ft/frequency", response_model=schemas.FtFrequencyResponse)
def api_ft_frequency(req: schemas.FtFrequencyRequest, _=Depends(require_role(*ANALYST))):
    """初因事件故障树 → 频率(/yr)。每割集恰好一个频率事件(kind=frequency),
    其余为使能概率;method=sum:F = Σ 割集频率;method=exact:逐初因使能析取 BDD,
    F = Σ λ_i·P_i(≤ Σλ 物理上界;全割集口径,cutoff 只滤展示列表)。规则违规/量纲错误 → 400(响亮,绝不静默近似)。"""
    from psaengine.quantify.frequency import FrequencyRuleError, fault_tree_frequency
    model = load_model_from_dict(req.model)
    try:
        r = fault_tree_frequency(model, req.fault_tree, cutoff=req.cutoff, method=req.method)
    except FrequencyRuleError as e:
        raise HTTPException(400, f"频率树规则违规:{e}")
    except KeyError as e:
        raise HTTPException(400, f"故障树不存在:{e}")
    except ValueError as e:
        raise HTTPException(400, f"频率量化失败:{e}")
    return r


@app.post("/api/event-tree/quantify", response_model=schemas.EtQuantifyResponse)
def api_event_tree_quantify(req: schemas.EtQuantifyRequest, _=Depends(require_role(*ANALYST))):
    """ROADMAP A: 前端序列化事件树 → 引擎精确否定定量(跨屏障共享事件精确)。"""
    from backend.et_builder import build_model_from_request
    from psaengine.eta.sequence import quantify_event_tree
    model = build_model_from_request(req.model_dump())
    try:
        if req.ie_fault_tree:                        # 2026-07-15:序列级 LFT 集成通道
            from psaengine.eta.sequence import quantify_event_tree_integrated
            res = quantify_event_tree_integrated(
                model, "TR", ie_ft_name=req.ie_fault_tree.get("name", "__init__"),
                house_states=req.house_states or None,
                boundary_condition_set=req.boundary_condition_set)
            return schemas.EtQuantifyResponse(
                sequences=res["sequences"], consequences=res["consequences"],
                method=res["method"], ie_frequency=res["ie_frequency"])
        res = quantify_event_tree(model, "TR", house_states=req.house_states or None,
                                  boundary_condition_set=req.boundary_condition_set)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return schemas.EtQuantifyResponse(sequences=res["sequences"], consequences=res["consequences"])

def _pin_case(project_uuid: str, project_payload, kind: str, name_hint: str | None,
              settings: dict, results: dict, audit_action: str):
    """ADR-2 自动钉扎:项目上下文 → 版本(幂等)+ 分析案例。返回 {case_id, version_hash, engine_version}。"""
    from backend import store
    from backend.canonical import to_canonical
    try:
        doc, sidecar = to_canonical(project_payload, project_uuid)
    except Exception as e:
        raise HTTPException(400, f"project_payload 无法规范化: {e}")
    store.ensure_project(project_uuid, name_hint or "项目")
    ver = store.create_version(project_uuid, doc, sidecar, origin="auto_pin",
                               message=f"auto: {kind}")
    case_id = store.create_case(project_uuid, ver["id"], kind, settings=settings,
                                results=results, audit_action=audit_action)
    return {"case_id": case_id, "version_id": ver["id"], "version_hash": ver["content_hash"],
            "engine_version": store.engine_version()}


def _checked_set_trees(req) -> list:
    """spec A:校验并构建勾选集聚合的逐树模型。空集响亮 400;逐树边界条件暂不支持(拒绝,
    绝不静默忽略分析设置——UI 序列化不产生该字段,出现即异常调用方)。"""
    from backend.et_builder import build_model_from_request
    if len(req.trees) < 1:
        raise HTTPException(400, "scope=checked_set 需要至少 1 棵勾选事件树(trees 为空)")
    for t in req.trees:
        if t.house_states or t.boundary_condition_set:
            raise HTTPException(400, "勾选集聚合暂不支持逐树边界条件(house_states/boundary_condition_set)")
    out = []
    for t in req.trees:
        try:
            model = build_model_from_request(t.model_dump())
        except (KeyError, ValueError) as e:
            raise HTTPException(400, f"勾选树「{t.name}」无法构建模型: {e}")
        out.append({"model": model, "key": t.key, "name": t.name, "labels": t.labels,
                    "consequence_defs": t.consequence_defs, "init_note": t.init_note})
    return out


@app.post("/api/report")
def api_report(req: schemas.ReportRequest, format: str = "docx", _=Depends(require_role(*ANALYST))):
    """由当前 ETA 重算 → 生成 Word/PDF/CSV 报告下载。scope=checked_set(spec A)时按勾选集
    聚合:逐级求和点估计 + 同 ref 名联合抽样分位带 + 逐树分解页脚;默认 single 零扰动。"""
    import base64
    from backend.et_builder import build_model_from_request
    from backend import report_export as rx
    if format not in ("docx", "pdf", "csv"):
        raise HTTPException(400, "format must be docx|pdf|csv")
    dumped = req.model_dump()
    if req.scope == "checked_set":
        trees = _checked_set_trees(req)
        data = rx.build_aggregate_report_data(trees, samples=req.samples, seed=req.seed,
                                              error_factor=req.error_factor)
        pin_settings = {"format": format, "samples": req.samples, "seed": req.seed,
                        "error_factor": req.error_factor, "scenario_name": req.scenario_name,
                        "scope": "checked_set",
                        "scenarios": [{"key": t["key"], "name": t["name"]} for t in trees]}
        # §2.3 钉扎形状:consequences 聚合值 + per_tree 分解(不带注记,纯 {key,name,consequences})
        pin_results = {"consequences": data["consequences"], "bands": data["bands"],
                       "per_tree": [{"key": p["key"], "name": p["name"], "consequences": p["consequences"]}
                                    for p in data["aggregate"]["per_tree"]]}
    else:
        model = build_model_from_request(dumped)
        linked_ids = [fe["id"] for fe in dumped["functional_events"] if fe.get("link_ft")]
        data = rx.build_report_data(model, "TR", consequence_defs=req.consequence_defs, labels=req.labels,
                                    linked_fe_ids=linked_ids, samples=req.samples, seed=req.seed,
                                    error_factor=req.error_factor)
        pin_settings = {"format": format, "samples": req.samples, "seed": req.seed,
                        "error_factor": req.error_factor, "scenario_name": req.scenario_name}
        pin_results = {"consequences": data["consequences"], "bands": data["bands"]}
    # ADR-2 自动钉扎:携带项目上下文的报告 → 版本(幂等)+ 分析案例 + 页脚证据链。
    evidence, case_id = None, None
    if req.project_uuid and req.project_payload is not None:
        from datetime import datetime, timezone
        pinned = _pin_case(req.project_uuid, req.project_payload, "report", req.scenario_name,
                           settings=pin_settings, results=pin_results,
                           audit_action="report.export")
        case_id = pinned["case_id"]
        evidence = {**pinned,
                    "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
        # Phase 5 导出门:auto-pin 命中的版本已签发 → 页脚签发行;否则工作稿标识。
        # 门本身 = 内容寻址幂等(任何未保存改动都是新哈希 → 无签发状态可命中)。
        from backend import store as _store
        review = _store.review_for_version(req.project_uuid, pinned["version_id"])
        if review and review["state"] == "signed":
            evidence["signoff"] = {"signer": review["decided_by"],
                                   "signed_at": review["decided_at"]}
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
                                              "sha256": hashlib.sha256(body).hexdigest(),
                                              "signed": bool(evidence and evidence.get("signoff"))})
    return Response(content=body, media_type=media,
                    headers={"Content-Disposition": f'attachment; filename="qra_report.{ext}"'})

@app.post("/api/import/mef")
def api_import_mef(req: schemas.MefImportRequest, _=Depends(require_role(*ANALYST))):
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
    ccfs = [{"id": c.id, "members": c.members, "model": c.model, "factors": c.factors,
             **({"staggered": True} if c.staggered else {})} for c in model.ccf_groups]
    return {"model": {"model_data": {"parameters": parameters_to_json(model.parameters)},
                      "fault_trees": fts, "event_trees": [], "ccf_groups": ccfs},
            "fault_tree": fts[0]["name"]}

@app.get("/api/saved")
def api_saved_list():
    from backend import storage
    return storage.list_workspaces()

@app.post("/api/saved")
def api_saved_create(req: schemas.SaveWorkspaceRequest, _=Depends(require_role(*ANALYST))):
    from backend import storage, store
    # D-P5-4 乐观并发:base 非空且与服务器最新版本不一致 → 409(不覆盖),前端选路
    # (查看双方 diff / 另存副本 / 确认覆盖)。版本库内容寻址已保底双方版本俱在,409 只是让
    # 冲突可见,不是防丢。base 为空(单用户/首存/客户端未传)→ 不检查(现行为,约束 #0)。
    if req.base_version_hash and req.id:
        puuid = store.legacy_project_uuid(req.id)
        versions = store.list_versions(puuid)
        if versions:
            latest = versions[-1]["content_hash"]
            if latest != req.base_version_hash:
                raise HTTPException(409, {"message": "版本冲突:他人已保存了更新的版本",
                                          "server_hash": latest, "base_hash": req.base_version_hash})
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
    puuid = store.legacy_project_uuid(sid)
    rec["project_uuid"] = puuid
    # D-P5-4 乐观并发基线:读档时附带当前最新版本哈希,前端下次保存原样带回
    # base_version_hash;非 v2 载荷等场景下版本库可能为空,此时不附带该字段。
    versions = store.list_versions(puuid)
    if versions:
        rec["version_hash"] = versions[-1]["content_hash"]
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
def api_event_tree_uncertainty(req: schemas.EtUncertaintyRequest, _=Depends(require_role(*ANALYST))):
    """事件树蒙特卡洛不确定性带(C1–C5 的 p05/p50/p95 + 点估计)。
    scope=checked_set(spec A):同 ref 名联合抽样跨树聚合;默认 single 零扰动。"""
    from backend.et_builder import build_model_from_request
    from psaengine.eta.uncertainty import event_tree_uncertainty, aggregate_event_tree_uncertainty
    if req.scope == "checked_set":
        trees = _checked_set_trees(req)
        agg = aggregate_event_tree_uncertainty([(t["model"], "TR") for t in trees],
                                               samples=req.samples, seed=req.seed,
                                               error_factor=req.error_factor)
        per_tree = [{"key": t["key"], "name": t["name"], "consequences": row}
                    for t, row in zip(trees, agg["per_tree"])]
        res = {"point": agg["point"], "bands": agg["bands"],
               "scope": "checked_set", "per_tree": per_tree}
        if req.project_uuid and req.project_payload is not None:
            pinned = _pin_case(req.project_uuid, req.project_payload, "uncertainty", req.scenario_name,
                               settings={"samples": req.samples, "seed": req.seed,
                                         "error_factor": req.error_factor, "scope": "checked_set",
                                         "scenarios": [{"key": t["key"], "name": t["name"]} for t in trees]},
                               results={"consequences": agg["point"], "bands": agg["bands"],
                                        "per_tree": per_tree},
                               audit_action="analysis.uncertainty")
            res = {**res, "case": pinned}
        return res
    model = build_model_from_request(req.model_dump())
    res = event_tree_uncertainty(model, "TR", samples=req.samples, seed=req.seed, error_factor=req.error_factor,
                                 house_states=req.house_states or None,
                                 boundary_condition_set=req.boundary_condition_set)
    if req.project_uuid and req.project_payload is not None:   # 4a4:不确定性运行钉扎为案例
        pinned = _pin_case(req.project_uuid, req.project_payload, "uncertainty", req.scenario_name,
                           settings={"samples": req.samples, "seed": req.seed, "error_factor": req.error_factor},
                           results=res, audit_action="analysis.uncertainty")
        res = {**res, "case": pinned}
    return res

@app.post("/api/event-tree/importance")
def api_event_tree_importance(req: schemas.EtQuantifyRequest, _=Depends(require_role(*ANALYST))):
    """扰动法屏障级 FV/RAW 重要度(按后果)。"""
    from backend.et_builder import build_model_from_request
    from psaengine.eta.uncertainty import barrier_importance_exact
    model = build_model_from_request(req.model_dump())
    imp = barrier_importance_exact(model, "TR", house_states=req.house_states or None,
                                   boundary_condition_set=req.boundary_condition_set)
    out: dict = {"importance": imp}
    if req.project_uuid and req.project_payload is not None:   # 4a4:重要度运行钉扎为案例
        out["case"] = _pin_case(req.project_uuid, req.project_payload, "importance", req.scenario_name,
                                settings={"method": "perturbation-exact"},
                                results={"importance": imp}, audit_action="analysis.importance")
    return out

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

@app.get("/api/portfolio")
def api_portfolio():
    """R5 组合总览:每项目一行,数字取自已钉扎案例(证据链正确性)。只读聚合面,
    与 /api/projects 同属无角色门的查询面。"""
    from backend import store
    return store.portfolio()

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

@app.get("/api/projects/{puuid}/diff")
def api_project_diff(puuid: str, frm: int = Query(alias="from"), to: int = Query()):
    """4a5 模型版本对比(parity #5):canonical 文档结构化 diff,列表按身份键对齐。"""
    from backend import store
    from backend.diff import diff_documents
    raws = {}
    for label, vid in (("from", frm), ("to", to)):
        raw = store.get_version_raw(puuid, vid)
        if raw is None:
            raise HTTPException(404, f"no version {vid} in project {puuid}")
        raws[label] = raw[0]
    vs = {v["id"]: v for v in store.list_versions(puuid)}
    return {
        "from": {"id": frm, "content_hash": vs[frm]["content_hash"]},
        "to": {"id": to, "content_hash": vs[to]["content_hash"]},
        **diff_documents(raws["from"], raws["to"]),
    }

@app.get("/api/projects/{puuid}/audit")
def api_project_audit(puuid: str, limit: int = 200):
    from backend import store
    return store.list_audit(puuid, limit=limit)

@app.get("/api/projects/{puuid}/cases")
def api_project_cases(puuid: str):
    from backend import store
    return store.list_cases(puuid)

# ---- Phase 5 评审/签发(D-P5-5 方向 A):台账状态机 + 版本级评论 ----
# 角色守卫属 auth 层(PSA_AUTH=local),落地时在此挂:送审=分析员+,签发/退回=评审人+。

class ReviewSubmitBody(BaseModel):
    version_id: int
    note: str | None = None

class ReviewDecideBody(BaseModel):
    note: str | None = None
    password: str | None = None   # 仅 PSA_AUTH=local 时校验(签发口令复核);off 模式忽略

class ReviewCommentBody(BaseModel):
    body: str

@app.get("/api/projects/{puuid}/reviews")
def api_reviews_list(puuid: str):
    from backend import store
    return store.list_reviews(puuid)

@app.post("/api/projects/{puuid}/reviews")
def api_review_submit(puuid: str, body: ReviewSubmitBody, _=Depends(require_role(*ANALYST))):
    import sqlite3
    from backend import store
    try:
        return store.submit_review(puuid, body.version_id, note=body.note)
    except LookupError as e:
        raise HTTPException(400, f"版本不存在:{e}")
    except store.ReviewStateError as e:
        raise HTTPException(409, f"评审状态冲突:{e}")
    except sqlite3.IntegrityError:
        raise HTTPException(409, "已有送审中版本(单项目同一时刻至多一个送审中)")

@app.post("/api/projects/{puuid}/reviews/{vid}/sign")
def api_review_sign(puuid: str, vid: int, body: ReviewDecideBody,
                    identity=Depends(require_role(*REVIEWER))):
    from backend import store
    role = None
    if identity is not None:                       # server 模式:签发口令复核 + 角色快照
        if not body.password or store.verify_credentials(identity["username"], body.password) is None:
            raise HTTPException(403, "签发口令复核失败:请输入当前账户口令以确认签发")
        role = identity["role"]
    try:
        return store.sign_review(puuid, vid, note=body.note, actor_role=role)
    except LookupError as e:
        raise HTTPException(400, f"版本不存在:{e}")
    except store.ReviewStateError:
        raise HTTPException(409, "仅送审中的版本可签发")

@app.post("/api/projects/{puuid}/reviews/{vid}/return")
def api_review_return(puuid: str, vid: int, body: ReviewDecideBody,
                      identity=Depends(require_role(*REVIEWER))):
    from backend import store
    role = identity["role"] if identity is not None else None
    try:
        return store.return_review(puuid, vid, note=body.note or "", actor_role=role)
    except LookupError as e:
        raise HTTPException(400, f"版本不存在:{e}")
    except store.ReviewStateError:
        raise HTTPException(409, "仅送审中的版本可退回")
    except ValueError:
        raise HTTPException(422, "退回必须填写理由(证据链要求)")

@app.get("/api/projects/{puuid}/versions/{vid}/comments")
def api_version_comments(puuid: str, vid: int):
    from backend import store
    return store.list_review_comments(puuid, vid)

@app.post("/api/projects/{puuid}/versions/{vid}/comments")
def api_version_comment_add(puuid: str, vid: int, body: ReviewCommentBody,
                            _=Depends(require_role(*ANY_ROLE))):
    from backend import store
    try:
        cid = store.add_review_comment(puuid, vid, body.body)
    except LookupError as e:
        raise HTTPException(400, f"版本不存在:{e}")
    except ValueError:
        raise HTTPException(422, "评论内容不能为空")
    return next(c for c in store.list_review_comments(puuid, vid) if c["id"] == cid)

# ---- Phase 5 账户管理(admin only;B4 管理面据此)----

class AccountCreateBody(BaseModel):
    username: str
    password: str
    role: str
    display_name: str | None = None

@app.get("/api/admin/accounts")
def api_admin_accounts_list(_=Depends(require_role(*ADMIN))):
    from backend import store
    return store.list_accounts()

@app.post("/api/admin/accounts")
def api_admin_account_create(body: AccountCreateBody, _=Depends(require_role(*ADMIN))):
    import sqlite3
    from backend import store
    try:
        return store.create_account(body.username, body.password, body.role,
                                    display_name=body.display_name)
    except ValueError as e:
        raise HTTPException(422, str(e))
    except sqlite3.IntegrityError:
        raise HTTPException(409, f"用户名已存在:{body.username}")

@app.post("/api/admin/accounts/{username}/disable")
def api_admin_account_disable(username: str, disabled: bool = True, _=Depends(require_role(*ADMIN))):
    from backend import store
    try:
        store.set_account_disabled(username, disabled)
    except LookupError:
        raise HTTPException(404, f"无此账户:{username}")
    return {"username": username, "disabled": disabled}

@app.get("/api/schema/project-document/1.0")
def api_project_document_schema():
    """ADR-1: 规范 ProjectDocument 的 JSON Schema(严格,additionalProperties:false)。
    ADR-3 的 AI 结构化输出直接引用本模式。"""
    from backend.canonical import ProjectDocument
    return ProjectDocument.model_json_schema()

@app.post("/api/ai/draft-model", response_model=schemas.AiDraftResponse)
def api_ai_draft_model(req: schemas.AiDraftRequest, _=Depends(require_role(*ANALYST))):
    """LLM 生成 ETA/FTA 草案。只返回待审核草案;不直接写入项目。
    生成即落 ai_drafts 溯源表(4b2);带 project_uuid 时并记 ai.draft 审计。"""
    from backend import ai_draft, store
    if not ai_draft.is_enabled():
        raise HTTPException(503, "AI draft model is disabled; set PSA_AI_ENABLED=1 to enable it.")
    try:
        resp = ai_draft.create_draft(req)
    except ai_draft.ProviderError as e:
        raise HTTPException(502, str(e))
    try:
        resp["ai_draft_id"] = store.record_ai_draft(resp, req.model_dump(), req.project_uuid)
    except Exception:
        pass                                          # 溯源落库失败不阻断草案返回(草案本身无副作用)
    return resp


@app.post("/api/ai/drafts/{rid}/applied")
def api_ai_draft_applied(rid: int, body: schemas.AiDraftAppliedRequest, _=Depends(require_role(*ANALYST))):
    """4b2 应用回执:记录逐元素接受清单与状态(applied|rejected)+ ai.apply 审计。"""
    from backend import store
    try:
        ok = store.mark_ai_draft_applied(rid, accepted=body.accepted,
                                         project_uuid=body.project_uuid, status=body.status)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if not ok:
        raise HTTPException(404, f"no ai draft {rid}")
    return {"ok": True}


@app.get("/api/ai/drafts")
def api_ai_drafts(project_uuid: str | None = None, limit: int = 50):
    from backend import store
    return store.list_ai_drafts(project_uuid, limit=limit)

# ---- 静态托管前端构建产物(存在时) ----
_DIST = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
if os.path.isdir(_DIST):
    app.mount("/", StaticFiles(directory=_DIST, html=True), name="static")
else:
    @app.get("/", response_class=HTMLResponse)
    def _placeholder():
        return "<h1>BESS PSA API</h1><p>前端未构建:cd frontend && npm run build。API 在 /api/*。</p>"
