"""Lossless payload-v2 <-> canonical conversion (ADR-1 D1 strangler).

`to_canonical(payload, project_uuid)` returns `(ProjectDocument, sidecar)`.
The sidecar is the D2 "outside the document" bucket, kept only for the
strangler period so `to_v2(doc, sidecar)` can reproduce the input payload
field-for-field:

  sidecar = {
    "view":        {"activeKey": ..., "checkedKeys": {...verbatim}},
    "derived":     {"pfds": {etaRef: {...verbatim}}},
    "passthrough": {
        "payload_fields": [present optional payload keys],
        "etas": {etaRef: {
            "eta_fields":   [present optional eta keys ("renamed")],
            "model_fields": [present optional model keys],
            "fe_fields":    {feRef: {"present": [...], "linkFt_raw": str?}},
            "consequenceDefs": verbatim (if present),
            "synthetic_consequences": [refs minted for dangling leaf ids],
            "fts": verbatim ModelJson,
            "normalized": bool (root lacked feId and was normalized),
        }},
        "userFts": verbatim ModelJson (if present),
    },
  }

`to_v2(doc, sidecar=None)` without a sidecar produces a canonical-normal v2
payload (semantic, not byte-identical) — the path future canonical-native
mutations (AI accepts, storage) use to serve legacy endpoints.

The model part of an eta is reconstructed FROM canonical entities (proving
the document carries the semantics); the fts part is restored verbatim from
the sidecar (node-shape zoo), with canonical fts fidelity covered separately
by the engine-request equality tests.
"""
from __future__ import annotations

import copy
from typing import Any, Optional

from backend.canonical import models as M
from backend.canonical.ids import entity_uuid, project_ns

_DEFAULT_CONS_DESC = {
    "C1": "单体安全排气", "C2": "模组内热蔓延/起火", "C3": "Pack/簇级起火",
    "C4": "箱级起火蔓延", "C5": "爆炸 + 毒气释放",
}
_CONS_ORDER = ["C1", "C2", "C3", "C4", "C5"]
_MODEL_OPT_FIELDS = ["consequenceDefs", "consequences", "initFreqSource", "product"]
_FE_OPT_FIELDS = ["label", "linkFt", "source", "grade", "evidence"]
_PAYLOAD_OPT_FIELDS = ["userFts", "fmeaRows", "fmeaMapping"]


def _prov_from_fe(fe: dict) -> M.Provenance:
    return M.Provenance(
        origin="human",
        source=M.Source(citation=fe["source"]) if fe.get("source") is not None else None,
        grade=fe.get("grade"),
        evidence=[fe["evidence"]] if fe.get("evidence") is not None else [],
    )


def _param_from_json(p: dict, ns, scope: str) -> M.Parameter:
    # EB-08: typed Q(t) fields (gamma/alpha/beta/t0) are now first-class typed
    # fields, not `extra` residue — so canonical carries the semantics and
    # engine_request/et_builder can rebuild the exact Q(t) model on replay.
    known = {"id", "kind", "value", "mttr", "test_interval", "mission_time",
             "gamma", "alpha", "beta", "t0", "distribution", "source"}
    dist = None
    if p.get("distribution") is not None:
        d = p["distribution"]
        dist = M.Distribution(family=d.get("family", ""), params=d.get("params", {}))
    prov = M.Provenance(origin="human")
    if p.get("source") is not None:
        prov.source = M.Source(citation=str(p["source"]))
    return M.Parameter(
        uuid=entity_uuid(ns, f"{scope}/param:{p['id']}"),
        ref=p["id"], kind=p["kind"], value=p["value"],
        mttr=p.get("mttr"), test_interval=p.get("test_interval"),
        mission_time=p.get("mission_time"),
        gamma=p.get("gamma"), alpha=p.get("alpha"),
        beta=p.get("beta"), t0=p.get("t0"),
        distribution=dist, provenance=prov,
        extra={k: v for k, v in p.items() if k not in known},
    )


def _param_to_json(p: M.Parameter) -> dict:
    out: dict[str, Any] = {"id": p.ref, "kind": p.kind, "value": p.value}
    for k in ("mttr", "test_interval", "mission_time",
              "gamma", "alpha", "beta", "t0"):
        v = getattr(p, k)
        if v is not None:
            out[k] = v
    if p.distribution is not None:
        out["distribution"] = {"family": p.distribution.family,
                               "params": p.distribution.params}
    if p.provenance.source is not None and p.provenance.source.citation is not None:
        out["source"] = p.provenance.source.citation
    out.update(p.extra)
    return out


def _bundle_from_modeljson(mj: dict, ns, scope: str) -> tuple[list[M.Parameter], list[M.FaultTree], list[M.CcfGroup]]:
    params = [_param_from_json(p, ns, scope)
              for p in mj.get("model_data", {}).get("parameters", [])]
    by_ref = {p.ref: p for p in params}
    trees: list[M.FaultTree] = []
    for ft in mj.get("fault_trees", []):
        tscope = f"{scope}/ft:{ft['name']}"
        node_uuid = {n["id"]: entity_uuid(ns, f"{tscope}/node:{n['id']}")
                     for n in ft.get("nodes", [])}
        nodes: list[M.FtNode] = []
        for n in ft.get("nodes", []):
            if n.get("basic"):
                ntype, op = "basic-event", None
            elif n.get("house"):
                ntype, op = "house-event", None
            else:
                ntype, op = "gate", n.get("op")
            pref = n.get("param_ref", n["id"]) if ntype == "basic-event" else None
            nodes.append(M.FtNode(
                uuid=node_uuid[n["id"]], ref=n["id"], type=ntype, op=op,
                args=[node_uuid.get(a, entity_uuid(ns, f"{tscope}/node:{a}"))
                      for a in (n.get("args") or [])],
                k=n.get("k"), state=n.get("state") if ntype == "house-event" else None,
                param=(by_ref[pref].uuid if pref in by_ref else None) if pref else None,
                label=n.get("label"),
            ))
        trees.append(M.FaultTree(
            uuid=entity_uuid(ns, tscope), ref=ft["name"],
            top=node_uuid.get(ft.get("top", ""), entity_uuid(ns, f"{tscope}/node:{ft.get('top','')}")),
            nodes=nodes,
        ))
    ccfs = [M.CcfGroup(uuid=entity_uuid(ns, f"{scope}/ccf:{c['id']}"), ref=c["id"],
                       members=list(c.get("members", [])), model=c.get("model", "beta"),
                       factors=dict(c.get("factors", {})))
            for c in mj.get("ccf_groups") or []]
    return params, trees, ccfs


def _bundle_to_modeljson(params: list[M.Parameter], trees: list[M.FaultTree],
                         ccfs: list[M.CcfGroup]) -> dict:
    """Canonical-normal ModelJson regeneration (sidecar-less path)."""
    node_ref = {}
    for t in trees:
        for n in t.nodes:
            node_ref[n.uuid] = n.ref
    param_ref = {p.uuid: p.ref for p in params}
    fts = []
    for t in trees:
        nodes = []
        for n in t.nodes:
            if n.type == "basic-event":
                nd: dict[str, Any] = {"id": n.ref, "basic": True}
                if n.param is not None:
                    nd["param_ref"] = param_ref.get(n.param, n.ref)
            elif n.type == "house-event":
                nd = {"id": n.ref, "house": True, "state": n.state}
            else:
                nd = {"id": n.ref, "op": n.op, "args": [node_ref[a] for a in n.args]}
                if n.k is not None:
                    nd["k"] = n.k
            if n.label is not None:
                nd["label"] = n.label
            nodes.append(nd)
        fts.append({"name": t.ref, "top": node_ref.get(t.top, ""), "nodes": nodes})
    out = {"model_data": {"parameters": [_param_to_json(p) for p in params
                                         if "__minted__" not in p.extra]},
           "fault_trees": fts}
    if ccfs:
        out["ccf_groups"] = [{"id": c.ref, "members": c.members, "model": c.model,
                              "factors": c.factors} for c in ccfs]
    return out


def _walk_to_canonical(node: dict, fe_uuid: dict[str, str], cons_uuid: dict[str, str],
                       depth: int, fes: list[dict], normalized: list[bool], ns, escope: str):
    if node["kind"] == "leaf":
        return M.EtLeaf(kind="leaf", consequence=cons_uuid[node["consequence"]])
    fe_ref = node.get("feId")
    if fe_ref is None:                                  # archaic archive: normalize
        fe_ref = fes[depth]["id"] if depth < len(fes) else f"FE{depth + 1}"
        normalized[0] = True
    return M.EtBranch(
        kind="branch", fe=fe_uuid[fe_ref],
        success=_walk_to_canonical(node["success"], fe_uuid, cons_uuid, depth + 1, fes, normalized, ns, escope),
        failure=_walk_to_canonical(node["failure"], fe_uuid, cons_uuid, depth + 1, fes, normalized, ns, escope),
    )


def _walk_to_v2(node: M.EtNode, fe_ref: dict[str, str], cons_ref: dict[str, str]) -> dict:
    if isinstance(node, M.EtLeaf):
        return {"kind": "leaf", "consequence": cons_ref[node.consequence]}
    return {"kind": "branch", "feId": fe_ref[node.fe],
            "success": _walk_to_v2(node.success, fe_ref, cons_ref),
            "failure": _walk_to_v2(node.failure, fe_ref, cons_ref)}


def _leaf_refs(node: dict, acc: list[str]) -> None:
    if node["kind"] == "leaf":
        acc.append(node["consequence"])
    else:
        _leaf_refs(node["success"], acc)
        _leaf_refs(node["failure"], acc)


def to_canonical(payload: dict, project_uuid: str,
                 project_name: Optional[str] = None) -> tuple[M.ProjectDocument, dict]:
    if payload.get("v") != 2 or not isinstance(payload.get("etas"), list):
        raise ValueError("to_canonical expects a payload-v2 project (v:2, etas[])")
    ns = project_ns(project_uuid)
    sidecar: dict[str, Any] = {
        "view": {"activeKey": payload.get("activeKey", ""),
                 "checkedKeys": copy.deepcopy(payload.get("checkedKeys", {}))},
        "derived": {"pfds": {}},
        "passthrough": {"payload_fields": [k for k in _PAYLOAD_OPT_FIELDS if k in payload],
                        "etas": {}},
    }
    trees: list[M.EventTree] = []
    for e in payload["etas"]:
        ref = e["key"]
        escope = f"et:{ref}"
        m = e["model"]
        pt: dict[str, Any] = {
            "eta_fields": [k for k in ("renamed",) if k in e],
            "model_fields": [k for k in _MODEL_OPT_FIELDS if k in m],
            "fe_fields": {}, "synthetic_consequences": [],
            "fts": copy.deepcopy(e.get("fts") or {"model_data": {"parameters": []}, "fault_trees": []}),
            "normalized": False,
        }
        if "consequenceDefs" in m:
            pt["consequenceDefs"] = copy.deepcopy(m["consequenceDefs"])
        sidecar["derived"]["pfds"][ref] = copy.deepcopy(e.get("pfds") or {})

        params, fts, ccfs = _bundle_from_modeljson(pt["fts"], ns, escope)
        tree_by_ref = {t.ref: t for t in fts}
        param_by_ref = {p.ref: p for p in params}

        # ---- initiating event ----
        ie_ref = "IE_FREQ"
        while ie_ref in param_by_ref:
            ie_ref += "_"
        # 初因溯源(4c2)进入频率参数的 provenance 块(ADR-1 D4 的正位;随内容哈希,无损往返)
        ie_prov = M.Provenance()
        if m.get("initSource") or m.get("initGrade") or m.get("initEvidence"):
            ie_prov = M.Provenance(
                source=M.Source(citation=m["initSource"]) if m.get("initSource") else None,
                grade=m.get("initGrade"),
                evidence=[m["initEvidence"]] if m.get("initEvidence") else [])
        ie_param = M.Parameter(uuid=entity_uuid(ns, f"{escope}/param:{ie_ref}"),
                               ref=ie_ref, kind="frequency", value=m["initFreq"],
                               provenance=ie_prov,
                               extra={"__minted__": "ie_freq"})
        params.append(ie_param)
        prod = m.get("product")
        ie = M.InitiatingEvent(
            uuid=entity_uuid(ns, f"{escope}/ie"), ref="IE",
            description=m["initEvent"], frequency_param=ie_param.uuid,
            freq_source=m.get("initFreqSource", "manual"),
            product=M.ProductDims(cells_per_pack=prod["cellsPerPack"],
                                  packs_per_system=prod["packsPerSystem"],
                                  cell_failure_rate=prod["cellFailureRate"]) if prod else None,
        )

        # ---- functional events (+ minted pfd params) ----
        fes: list[M.FunctionalEvent] = []
        fe_uuid: dict[str, str] = {}
        for fe in m["functionalEvents"]:
            fref = fe["id"]
            fe_uuid[fref] = entity_uuid(ns, f"{escope}/fe:{fref}")
            pref = f"{fref}__PFD"
            while pref in param_by_ref:
                pref += "_"
            pparam = M.Parameter(uuid=entity_uuid(ns, f"{escope}/param:{pref}"),
                                 ref=pref, kind="probability", value=fe["failProb"],
                                 provenance=_prov_from_fe(fe),
                                 extra={"__minted__": "fe_pfd"})
            params.append(pparam)
            param_by_ref[pref] = pparam
            ff: dict[str, Any] = {"present": [k for k in _FE_OPT_FIELDS if k in fe]}
            linked = None
            if fe.get("linkFt") is not None:
                if fe["linkFt"] in tree_by_ref:
                    linked = tree_by_ref[fe["linkFt"]].uuid
                else:
                    ff["linkFt_raw"] = fe["linkFt"]
            pt["fe_fields"][fref] = ff
            fes.append(M.FunctionalEvent(uuid=fe_uuid[fref], ref=fref,
                                         label=fe.get("label"), pfd_param=pparam.uuid,
                                         linked_fault_tree=linked,
                                         provenance=_prov_from_fe(fe)))

        # ---- consequences (list, defaults, or synthesized for dangling leaves) ----
        cons_src = m.get("consequences") or []
        if not cons_src:
            cons_src = [{"id": c, "desc": _DEFAULT_CONS_DESC[c], "level": c} for c in _CONS_ORDER]
        cons: list[M.Consequence] = [
            M.Consequence(uuid=entity_uuid(ns, f"{escope}/cons:{c['id']}"),
                          ref=c["id"], desc=c.get("desc", ""), level=c["level"])
            for c in cons_src]
        cons_uuid = {c.ref: c.uuid for c in cons}
        leaf_refs: list[str] = []
        _leaf_refs(m["root"], leaf_refs)
        for lr in leaf_refs:
            if lr not in cons_uuid:
                lvl = lr if lr in _CONS_ORDER else "C1"
                c = M.Consequence(uuid=entity_uuid(ns, f"{escope}/cons:{lr}"),
                                  ref=lr, desc=_DEFAULT_CONS_DESC.get(lvl, ""), level=lvl)
                cons.append(c)
                cons_uuid[lr] = c.uuid
                pt["synthetic_consequences"].append(lr)

        normalized = [False]
        root = _walk_to_canonical(m["root"], fe_uuid, cons_uuid, 0,
                                  m["functionalEvents"], normalized, ns, escope)
        pt["normalized"] = normalized[0]
        sidecar["passthrough"]["etas"][ref] = pt

        trees.append(M.EventTree(
            uuid=entity_uuid(ns, escope), ref=ref, name=e["name"],
            name_locked=bool(e.get("renamed", False)),
            initiating_event=ie, functional_events=fes, root=root,
            consequences=cons, parameters=params, fault_trees=fts, ccf_groups=ccfs,
        ))

    wb = M.Workbench(
        aggregate_scope=[t.uuid for t in trees
                         if payload.get("checkedKeys", {}).get(t.ref)],
        fmea_rows=copy.deepcopy(payload.get("fmeaRows")) if "fmeaRows" in payload else None,
        fmea_mapping=copy.deepcopy(payload.get("fmeaMapping")) if "fmeaMapping" in payload else None,
    )
    if "userFts" in payload:
        up, ut, uc = _bundle_from_modeljson(payload["userFts"] or {}, ns, "wb")
        wb.user_fts = M.ModelBundle(parameters=up, fault_trees=ut, ccf_groups=uc)
        sidecar["passthrough"]["userFts"] = copy.deepcopy(payload["userFts"])

    doc = M.ProjectDocument(
        schema_version=_schema_version_for(trees, wb),
        project=M.ProjectInfo(uuid=project_uuid, name=project_name),
        event_trees=trees, workbench=wb,
    )
    return doc, sidecar


def _param_is_v2(p: M.Parameter) -> bool:
    return (p.kind in M._V2_PARAM_KINDS
            or any(getattr(p, f) is not None for f in M._V2_TYPED_FIELDS))


def _schema_version_for(trees: list[M.EventTree], wb: M.Workbench) -> str:
    """EB-08 content-dependent version: "2.0" iff the document actually uses a
    v2 kind/typed field, else "1.0". Keeps every v1 archive at "1.0" (iron law)
    while letting a typed-Q(t) document self-describe."""
    params: list[M.Parameter] = []
    for t in trees:
        params.extend(t.parameters)
    if wb.user_fts is not None:
        params.extend(wb.user_fts.parameters)
    return M.SCHEMA_VERSION_V2 if any(_param_is_v2(p) for p in params) else M.SCHEMA_VERSION


def to_v2(doc: M.ProjectDocument, sidecar: Optional[dict] = None) -> dict:
    sc = sidecar or {"view": {}, "derived": {"pfds": {}}, "passthrough": {"etas": {}}}
    pt_etas = sc.get("passthrough", {}).get("etas", {})
    etas = []
    for t in doc.event_trees:
        pt = pt_etas.get(t.ref, {})
        param_by_uuid = {p.uuid: p for p in t.parameters}
        fe_ref = {fe.uuid: fe.ref for fe in t.functional_events}
        cons_ref = {c.uuid: c.ref for c in t.consequences}
        tree_ref = {ft.uuid: ft.ref for ft in t.fault_trees}
        model_fields = pt.get("model_fields", _MODEL_OPT_FIELDS if sidecar is None else [])
        synth = set(pt.get("synthetic_consequences", []))

        fes_out = []
        for fe in t.functional_events:
            ff = pt.get("fe_fields", {}).get(fe.ref, {"present": _FE_OPT_FIELDS if sidecar is None else []})
            present = ff.get("present", [])
            d: dict[str, Any] = {"id": fe.ref}
            if "label" in present or (sidecar is None and fe.label is not None):
                d["label"] = fe.label
            d["failProb"] = param_by_uuid[fe.pfd_param].value
            if fe.linked_fault_tree is not None and ("linkFt" in present or sidecar is None):
                d["linkFt"] = tree_ref[fe.linked_fault_tree]
            elif "linkFt_raw" in ff:
                d["linkFt"] = ff["linkFt_raw"]
            prov = fe.provenance
            if "source" in present:
                d["source"] = prov.source.citation if prov.source else None
            if "grade" in present:
                d["grade"] = prov.grade
            if "evidence" in present:
                d["evidence"] = prov.evidence[0] if prov.evidence else None
            fes_out.append(d)

        model: dict[str, Any] = {
            "initEvent": t.initiating_event.description,
            "initFreq": param_by_uuid[t.initiating_event.frequency_param].value,
            "functionalEvents": fes_out,
            "root": _walk_to_v2(t.root, fe_ref, cons_ref),
        }
        if "consequenceDefs" in model_fields and "consequenceDefs" in pt:
            model["consequenceDefs"] = copy.deepcopy(pt["consequenceDefs"])
        if "consequences" in model_fields or sidecar is None:
            model["consequences"] = [{"id": c.ref, "desc": c.desc, "level": c.level}
                                     for c in t.consequences if c.ref not in synth]
        if "initFreqSource" in model_fields or sidecar is None:
            model["initFreqSource"] = t.initiating_event.freq_source
        # 初因溯源:从频率参数 provenance 块还原(4c2)
        ie_prov = param_by_uuid[t.initiating_event.frequency_param].provenance
        if ie_prov.source and ie_prov.source.citation:
            model["initSource"] = ie_prov.source.citation
        if ie_prov.grade:
            model["initGrade"] = ie_prov.grade
        if ie_prov.evidence:
            # v2 initEvidence 为单串,取首条(当前唯一写入者 to_canonical 只写 1 条,无损)。
            # 若后续贝叶斯等向 Provenance.evidence 追加多条,此处需改为拼接以免静默截断。
            model["initEvidence"] = ie_prov.evidence[0]
        if ("product" in model_fields or sidecar is None) and t.initiating_event.product is not None:
            p = t.initiating_event.product
            model["product"] = {"cellsPerPack": p.cells_per_pack,
                                "packsPerSystem": p.packs_per_system,
                                "cellFailureRate": p.cell_failure_rate}

        eta: dict[str, Any] = {"key": t.ref, "name": t.name}
        if "renamed" in pt.get("eta_fields", []) or sidecar is None:
            eta["renamed"] = t.name_locked
        eta["model"] = model
        eta["fts"] = copy.deepcopy(pt["fts"]) if "fts" in pt else _bundle_to_modeljson(
            t.parameters, t.fault_trees, t.ccf_groups)
        eta["pfds"] = copy.deepcopy(sc.get("derived", {}).get("pfds", {}).get(t.ref, {}))
        etas.append(eta)

    et_by_uuid = {t.uuid: t.ref for t in doc.event_trees}
    payload: dict[str, Any] = {"v": 2, "etas": etas}
    view = sc.get("view", {})
    payload["activeKey"] = view.get("activeKey",
                                    doc.event_trees[0].ref if doc.event_trees else "")
    payload["checkedKeys"] = copy.deepcopy(view["checkedKeys"]) if "checkedKeys" in view else {
        et_by_uuid[u]: True for u in doc.workbench.aggregate_scope}
    pfields = sc.get("passthrough", {}).get("payload_fields",
                                            _PAYLOAD_OPT_FIELDS if sidecar is None else [])
    if "userFts" in pfields:
        payload["userFts"] = copy.deepcopy(sc["passthrough"]["userFts"]) \
            if sidecar is not None and "userFts" in sc.get("passthrough", {}) else (
            _bundle_to_modeljson(doc.workbench.user_fts.parameters,
                                 doc.workbench.user_fts.fault_trees,
                                 doc.workbench.user_fts.ccf_groups)
            if doc.workbench.user_fts else {"model_data": {"parameters": []}, "fault_trees": []})
    if "fmeaRows" in pfields and doc.workbench.fmea_rows is not None:
        payload["fmeaRows"] = copy.deepcopy(doc.workbench.fmea_rows)
    if "fmeaMapping" in pfields and doc.workbench.fmea_mapping is not None:
        payload["fmeaMapping"] = copy.deepcopy(doc.workbench.fmea_mapping)
    return payload
