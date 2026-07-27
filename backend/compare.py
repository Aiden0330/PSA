"""系统对比 assemble(规格 2026-07-26-product-comparison §2-3)。

铁律(组合总览同款):对比**绝不现算**——成员 = 已钉扎 report 案例,数字直读
results_json;结构与参数快照取该案例锚定版本的 canonical 文档(屏障快照
grade/url/note 的第一个跨项目消费者)。对齐门在此计算,禁止前端各自臆断。
"""
from __future__ import annotations

import json
from typing import Any, Optional

from backend import store


class CompareError(Exception):
    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


def parse_members(raw: str) -> list[tuple[str, int]]:
    """"puuid:caseId,puuid:caseId" → [(puuid, case_id)];成员数 2–4。"""
    out: list[tuple[str, int]] = []
    for part in [p for p in (raw or "").split(",") if p.strip()]:
        puuid, _, cid = part.strip().rpartition(":")
        if not puuid or not cid.isdigit():
            raise CompareError(422, f"成员格式非法:'{part}'(应为 <project_uuid>:<case_id>)")
        out.append((puuid, int(cid)))
    if not 2 <= len(out) <= 4:
        raise CompareError(422, f"对比成员数须为 2–4,实得 {len(out)}")
    return out


def _load_case(puuid: str, case_id: int) -> dict:
    with store._conn() as cx:
        r = cx.execute(
            "SELECT c.*, v.content_hash FROM analysis_cases c"
            " JOIN versions v ON v.id = c.version_id"
            " WHERE c.id=? AND c.project_uuid=?", (case_id, puuid)).fetchone()
    if r is None:
        raise CompareError(404, f"成员案例不存在:project {puuid} case {case_id}")
    row = dict(r)
    if row["kind"] != "report":
        raise CompareError(422, f"成员案例 {case_id} kind='{row['kind']}',对比要求 report(含后果点值与 bands)")
    return row


def _fes_from_tree(t: dict, sidecar: Optional[dict], eta_ref: str) -> list[dict]:
    params = {p["uuid"]: p for p in t.get("parameters", [])}
    ff_all: dict[str, Any] = {}
    if sidecar:
        ff_all = (((sidecar.get("passthrough") or {}).get("etas") or {})
                  .get(eta_ref, {}).get("fe_fields", {}))
    fes: list[dict] = []
    for fe in t.get("functional_events", []):
        prov = fe.get("provenance") or {}
        src = prov.get("source") or {}
        p = params.get(fe.get("pfd_param"))
        fes.append({
            "ref": fe["ref"], "label": fe.get("label"),
            "pfd": (p or {}).get("value"),
            "grade": prov.get("grade"),
            "citation": src.get("citation"), "url": src.get("url"), "note": src.get("note"),
            "category": (ff_all.get(fe["ref"], {}) or {}).get("category"),
        })
    return fes


def _member_view(puuid: str, case_id: int) -> dict:
    case = _load_case(puuid, case_id)
    pair = store.get_version_raw(puuid, case["version_id"])
    if pair is None:
        raise CompareError(404, f"成员案例 {case_id} 锚定的版本 {case['version_id']} 不存在")
    doc, sidecar = pair
    proj = store.get_project(puuid) or {}
    results = json.loads(case.get("results_json") or "{}")
    etas: list[dict] = []
    grade_mix = {"A": 0, "B": 0, "C": 0, "D": 0, "none": 0}
    for t in doc.get("event_trees", []):
        fes = _fes_from_tree(t, sidecar, t["ref"])
        for fe in fes:
            g = fe.get("grade")
            grade_mix[g if g in ("A", "B", "C", "D") else "none"] += 1
        params = {p["uuid"]: p for p in t.get("parameters", [])}
        freq_param = params.get((t.get("initiating_event") or {}).get("frequency_param"))
        etas.append({"ref": t["ref"], "name": t.get("name"),
                     "init_freq": (freq_param or {}).get("value"), "fes": fes})
    return {
        "project": {"uuid": puuid, "name": proj.get("name")},
        "case": {"id": case["id"], "kind": case["kind"], "created_at": case["created_at"],
                 "vid": case["version_id"], "version_hash": case["content_hash"]},
        "consequences": results.get("consequences") or {},
        "bands": results.get("bands"),
        "grade_mix": grade_mix,
        "etas": etas,
    }


def _alignment(members: list[dict]) -> dict:
    """ETA 按 ref 全员配对;FE ref 序列一致 ⇒ shared,否则 divergent(附各家序列供
    ◇ 区呈现差集);未在全员出现的 ETA 逐成员进 unmatched。"""
    ref_lists = [[t["ref"] for t in m["etas"]] for m in members]
    common = set(ref_lists[0])
    for refs in ref_lists[1:]:
        common &= set(refs)
    matched = []
    for ref in [r for r in ref_lists[0] if r in common]:   # 按基准成员的呈现序
        fe_refs = []
        for m in members:
            t = next(t for t in m["etas"] if t["ref"] == ref)
            fe_refs.append([fe["ref"] for fe in t["fes"]])
        structural = "shared" if all(fr == fe_refs[0] for fr in fe_refs[1:]) else "divergent"
        matched.append({"ref": ref, "structural": structural, "fe_refs": fe_refs})
    unmatched = [{"member": i, "ref": ref}
                 for i, refs in enumerate(ref_lists) for ref in refs if ref not in common]
    return {"matched": matched, "unmatched": unmatched}


def assemble(members_raw: str, base: int = 0) -> dict:
    members = parse_members(members_raw)
    if not 0 <= base < len(members):
        raise CompareError(422, f"base={base} 越界(成员数 {len(members)})")
    views = [_member_view(pu, cid) for pu, cid in members]
    return {"members": views, "base": base, "alignment": _alignment(views)}
