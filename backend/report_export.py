from __future__ import annotations
import csv, io
from psaengine.eta.sequence import event_tree_sequences
from psaengine.eta.uncertainty import event_tree_uncertainty, barrier_importance_exact
from psaengine.analysis import Analysis

TOP_N = 10

_SEV = ["C1", "C2", "C3", "C4", "C5"]
_C_LABEL = {"C1": "单体排气", "C2": "模组蔓延", "C3": "簇/舱火灾", "C4": "多舱火灾", "C5": "爆燃/爆炸"}
_C_EN = {"C1": "cell vent", "C2": "module spread", "C3": "rack/unit fire", "C4": "multi-unit fire", "C5": "deflagration"}
_FREQ_BANDS = [("F1", "极不可能", 1e-6), ("F2", "不可能", 1e-4), ("F3", "偶尔", 1e-2), ("F4", "可能", 1.0), ("F5", "频繁", float("inf"))]
_SEV_RANK = {"C1": 1, "C2": 2, "C3": 3, "C4": 4, "C5": 5}
_RISK_HEX = {"low": "16a34a", "medium": "eab308", "high": "f97316", "extreme": "dc2626"}
_DISCLAIMER = ("本报告内置失效率/PFD 为公开来源参考量级,频率带与可接受准则为示意默认值;"
               "正式工程分析须按项目实测数据与法规校核替换。")


def _path_summary(path: dict, labels: dict | None) -> str:
    lab = labels or {}
    return " ".join(f"{lab.get(fid, fid)}{'✓' if br == 'success' else '✗'}" for fid, br in path.items())


def _barrier_name(fid: str, labels: dict | None) -> str:
    return (labels or {}).get(fid, fid)


def _freq_band(f: float) -> int:
    if f <= 0:
        return 0
    for i, (_, _, mx) in enumerate(_FREQ_BANDS):
        if f < mx:
            return i
    return len(_FREQ_BANDS) - 1


def _risk_level(sev_rank: int, freq_rank: int) -> str:
    s = sev_rank * freq_rank
    if s <= 4:
        return "low"
    if s <= 9:
        return "medium"
    if s <= 14:
        return "high"
    return "extreme"


_LEVEL_ORDER = {"low": 0, "medium": 1, "high": 2, "extreme": 3}


def risk_placement(consequences: dict) -> dict:
    """把 {C1..C5: 频率/yr} 映射到风险矩阵格,与报告内矩阵**同源**(同 _freq_band、
    同 _SEV_RANK、同 _risk_level)—— 组合总览的"最劣格"标注据此得出,前端绝不重复阈值
    (阈值一旦两处各写 = 口径漂移,监管工具的方法学缺陷)。零频/未量化级不落格。
    返回 {cells:[{severity,freq,freq_band,level}], worst: cell|None}。"""
    cells, worst = [], None
    for c in _SEV:
        f = float(consequences.get(c, 0.0))
        if f <= 0:
            continue
        band = _freq_band(f)                       # 0-based 频带索引
        level = _risk_level(_SEV_RANK[c], band + 1)  # freq_rank 为 1-based,与报告矩阵一致
        cell = {"severity": c, "freq": f, "freq_band": band, "level": level}
        cells.append(cell)
        if worst is None or _LEVEL_ORDER[level] > _LEVEL_ORDER[worst["level"]] or (
                _LEVEL_ORDER[level] == _LEVEL_ORDER[worst["level"]] and _SEV_RANK[c] > _SEV_RANK[worst["severity"]]):
            worst = cell
    return {"cells": cells, "worst": worst}


def build_report_data(model, et_name: str = "TR", *, ie_ft_name: str | None = None,
                      house_states: dict | None = None, boundary_condition_set: str | None = None,
                      consequence_defs: dict | None = None,
                      labels: dict | None = None, linked_fe_ids: list | None = None,
                      samples: int = 1000, seed: int = 42, error_factor: float = 3.0,
                      top_n: int = TOP_N) -> dict:
    # F3 阶段 1(EB-01):点序列经单一分派点(集成 LFT vs 普通 ETA),并透传 house/bc——
    # 此前固定走普通 event_tree_sequences 且不接 house,报告对集成模型发布错误频率、
    # 忽略边界设置。集成模式无 MC 变体:不确定性带退化为点值(不伪造 spread)+ 注记。
    from backend.execution import point_sequences
    integrated = ie_ft_name is not None
    all_seqs = point_sequences(model, et_name, ie_ft_name, house_states, boundary_condition_set)
    # 批次 F(S-B):fsum ⇒ 与 quantify 通道逐位同源(此前降序累加 vs 树序差末位 ULP,试点 P-1)
    from math import fsum
    _contrib: dict[str, list] = {}
    for s in all_seqs:
        _contrib.setdefault(s["consequence"], []).append(s["frequency"])
    cons: dict[str, float] = {c: fsum(v) for c, v in _contrib.items()}
    if integrated:
        # banked 集成 MC/重要度落地(A9):真实 MC 带 + 扰动重要度——退化点值带与
        # "非抽样区间"注记退役(banked 规格 §4 清单第 3 条)。
        from psaengine.eta.uncertainty import (barrier_importance_exact_integrated,
                                               event_tree_uncertainty_integrated)
        unc = event_tree_uncertainty_integrated(
            model, et_name, ie_ft_name, samples=samples, seed=seed,
            error_factor=error_factor, house_states=house_states,
            boundary_condition_set=boundary_condition_set)
        imp = barrier_importance_exact_integrated(
            model, et_name, ie_ft_name, house_states=house_states,
            boundary_condition_set=boundary_condition_set)
        bands = unc["bands"]
        integrated_note = None
    else:
        unc = event_tree_uncertainty(model, et_name, samples=samples, seed=seed,
                                     error_factor=error_factor, house_states=house_states,
                                     boundary_condition_set=boundary_condition_set)
        imp = barrier_importance_exact(model, et_name, house_states=house_states,
                                       boundary_condition_set=boundary_condition_set)
        bands = unc["bands"]
        integrated_note = None

    cdefs = consequence_defs or {}
    # 空串自定义内涵视同未填 → 回退内置标签(避免报告出现空白后果说明)
    consequence_out = {c: (cdefs.get(c) or _C_LABEL[c]) for c in _SEV}

    seqs = all_seqs[:top_n]
    sequences = [{"end_state": s["end_state"], "path_summary": _path_summary(s["path"], labels),
                  "consequence": s["consequence"], "frequency": s["frequency"]} for s in seqs]

    fta: dict[str, dict] = {}
    for fid in (linked_fe_ids or []):
        an = Analysis(model, fault_tree=fid)
        cuts = an.cutsets(cutoff=1e-12)[:top_n]   # 引擎已按概率降序排好(minimal_cutsets)
        # importance() returns {basic_event: {measure: value}}
        imp_raw = an.importance(["fv"])
        fv = {be: vals["fv"] for be, vals in imp_raw.items() if "fv" in vals}
        fta[fid] = {
            "label": _barrier_name(fid, labels),
            "top_prob": float(an.probability()),
            "cutsets": [{"events": list(c.events), "order": c.order, "prob": float(c.probability)} for c in cuts],
            "basics": [{"event": k, "fv": float(v)} for k, v in
                       sorted(fv.items(), key=lambda kv: kv[1], reverse=True)[:top_n]],
        }

    # 收口二轮 D-7:分析设置入正文——单份报告(不查案例库)也答得出"这些数在什么
    # 边界条件/抽样设置下算的"。逐项与本次计算实际消费的入参同源。
    parts = [f"抽样 N={samples} seed={seed} EF={error_factor}"]
    if house_states:
        parts.append("house 覆盖 " + ", ".join(
            f"{k}={'True' if v else 'False'}" for k, v in sorted(house_states.items())))
    if boundary_condition_set:
        parts.append(f"边界条件集「{boundary_condition_set}」")
    if integrated:
        parts.append(f"初因源=故障树({ie_ft_name})")
    out = {"consequences": {c: float(cons.get(c, 0.0)) for c in _SEV}, "bands": bands,
           "importance": imp, "consequence_defs": consequence_out, "sequences": sequences, "fta": fta,
           "analysis_settings_note": "分析设置:" + " · ".join(parts)}
    if integrated_note:
        out["integrated_note"] = integrated_note
    return out


# ── 勾选集聚合报告(spec A §2.1/§2.2/§2.4)────────────────────────────────────
# 页脚免责三句(裁决 §2.1/§2.2,逐字口径):MECE + 重复/重叠告警(方向保守高估)、
# 分位不可加、IE 频率按定值处理。逐树基准注记随分解表带出(spec B)。
_AGG_DISCLOSURES = [
    "聚合前提:各勾选树初因事件互斥(MECE),计不相交的物理事件集。若同时勾选了重复建模"
    "(同一初因的多棵派生树)或重叠建模(如邻舱辐射引燃与内短树 C4/C5 后果重叠)的树,聚合"
    "方向为保守高估(同一初因被计多次)——请对逐树分解核对。",
    "分位数不可加:逐树分解为点估计(nominal 取值),Σ逐树 p95 ≠ 聚合 p95;聚合分位来自跨树"
    "联合抽样(同 ref 名参数共享同一次抽样)。",
    "初因(IE)频率按定值处理,其认知不确定性未计入分位带(初因频率是本领域最大不确定性来源)。",
]
_AGG_DISCLOSURES_EN = [   # PDF 无 CJK 字体时的等义英文(与中文逐句对应)
    "Aggregation assumes mutually exclusive (MECE) initiating events; duplicated or overlapping "
    "trees bias the sum conservatively upward — check the per-tree breakdown.",
    "Quantiles are not additive: per-tree rows are point estimates; sum of per-tree p95 != "
    "aggregate p95 (bands come from joint sampling over shared parameter ref names).",
    "IE frequencies are treated as fixed values; their epistemic uncertainty is not in the bands.",
]


def build_aggregate_report_data(trees: list, *, samples: int = 1000, seed: int = 42,
                                error_factor: float = 3.0, top_n: int = TOP_N) -> dict:
    """勾选集聚合报告数据。trees=[{"model",  "key","name","labels","consequence_defs","init_note"}]。

    聚合后果 = 各树同级逐级求和(精确,期望线性);聚合分位带 = 跨树联合抽样(同 ref 名)。
    风险矩阵沿用同一 consequences 路径(只是收到聚合字典)。逐树分解 + 基准注记进 aggregate 块。
    重要度/FTA 为逐树概念、无聚合语义 → 聚合报告不出该两节(渲染层按 aggregate 存在与否分流)。"""
    from psaengine.eta.uncertainty import aggregate_event_tree_uncertainty
    specs = [(t["model"], "TR") for t in trees]
    agg = aggregate_event_tree_uncertainty(specs, samples=samples, seed=seed, error_factor=error_factor)
    consequences = {c: float(agg["point"].get(c, 0.0)) for c in _SEV}

    per_tree = []
    for t, row in zip(trees, agg["per_tree"]):
        per_tree.append({"key": t["key"], "name": t["name"],
                         "consequences": {c: float(row.get(c, 0.0)) for c in _SEV},
                         "init_note": t.get("init_note")})

    # 主导事故序列:跨树全局 Top-N(频率均为绝对 /yr,可直接比较);end_state 冠以树名消歧。
    all_seqs = []
    for t in trees:
        for s in event_tree_sequences(t["model"], "TR"):
            all_seqs.append({"end_state": f'{t["name"]}·{s["end_state"]}',
                             "path_summary": _path_summary(s["path"], t.get("labels")),
                             "consequence": s["consequence"], "frequency": s["frequency"]})
    all_seqs.sort(key=lambda s: s["frequency"], reverse=True)

    # 后果内涵:逐级取首个非空的树自定义,回退内置(canonical C1–C5 语义应一致)。
    merged_defs = {}
    for c in _SEV:
        val = next((cd for t in trees if (cd := (t.get("consequence_defs") or {}).get(c))), None)
        merged_defs[c] = val or _C_LABEL[c]

    return {
        "consequences": consequences, "bands": agg["bands"],
        "importance": {}, "consequence_defs": merged_defs, "sequences": all_seqs[:top_n], "fta": {},
        "aggregate": {"tree_count": len(trees),
                      "scenarios": [{"key": t["key"], "name": t["name"]} for t in trees],
                      "per_tree": per_tree},
    }


def _agg_scope_label(data: dict) -> str:
    """『勾选集聚合(n 树)』标识;非聚合报告返回空串(单报告零扰动)。"""
    agg = data.get("aggregate")
    return f"勾选集聚合({agg['tree_count']} 树)" if agg else ""


_WORKING_MARK = "工作稿 — 未经签发"


def _is_signed(evidence: dict | None) -> bool:
    """Phase 5 导出门:签发状态由 app 层按 auto-pin 命中的版本查得(内容寻址幂等 =
    任何未保存改动都是新哈希,不可能带着签发章导出)。无项目上下文 = 工作稿。"""
    return bool(evidence and evidence.get("signoff"))


def _evidence_line(ev: dict) -> str:
    """ADR-2 证据链页脚:报告数字 → 分析案例 → 版本哈希 → 引擎指纹(→ 签发行,Phase 5)。
    F3 阶段 3:引擎版本后附 git 短哈希(+dirty;收口二轮 D-6:状态探测失败 ≠ 干净,
    标"git状态未知")。收口二轮 D-2:绑定强度显式可辨——硬核验(request_hash_verified)
    与仅落卷(recorded_only,checked_set 聚合)在页脚措辞不同,沉默不得造成等同声明。"""
    eng = f"引擎 bess-psa {ev['engine_version']}"
    fp = ev.get("engine_fingerprint") or {}
    if fp.get("git_sha") and fp["git_sha"] != "unknown":
        d = fp.get("dirty")
        eng += f"@{fp['git_sha']}" + ("+dirty" if d else ("(git状态未知)" if d is None else ""))
    base = (f"评价依据:分析案例 #{ev['case_id']} · 模型版本 {ev['version_hash'][:8]}"
            f" · {eng} · {ev['created_at']}")
    binding = ev.get("pin_binding")
    if binding == "request_hash_verified":
        base += " · 模型绑定已核验"
    elif binding == "recorded_only":
        base += " · 模型绑定仅记录(未经请求一致性核验)"
    so = ev.get("signoff")
    if so:
        return base + f" · 签发 {so['signer']} {str(so['signed_at'])[:10]}"
    return base + " · 工作稿(未经签发)"


def report_csv(data: dict, evidence: dict | None = None) -> bytes:
    buf = io.StringIO()
    w = csv.writer(buf)
    cdefs = data.get("consequence_defs", {})
    agg = data.get("aggregate")
    if not _is_signed(evidence):
        w.writerow([f"# {_WORKING_MARK}"])
    if agg:   # spec A §2.4:CSV 口径元数据行(scope + n 树 + 场景名)
        w.writerow(["# 口径", "勾选集聚合", f"{agg['tree_count']} 树",
                    "、".join(s["name"] for s in agg["scenarios"])])
    if data.get("analysis_settings_note"):        # 收口二轮 D-7:设置披露入正文
        w.writerow([f"# {data['analysis_settings_note']}"])
    w.writerow(["后果", "内涵", "点估计/yr", "p05", "p50", "p95"])
    for c in _SEV:
        b = data["bands"].get(c, {})
        w.writerow([c, cdefs.get(c, _C_LABEL[c]), f"{data['consequences'].get(c, 0.0):.4e}",
                    f"{b.get('p05', 0.0):.4e}", f"{b.get('p50', 0.0):.4e}", f"{b.get('p95', 0.0):.4e}"])
    if data.get("importance"):   # 聚合报告无逐树重要度语义(空 dict → 整节不出)
        w.writerow([])
        w.writerow(["后果", "屏障", "FV", "RAW"])
        for c in _SEV:
            for r in data["importance"].get(c, []):
                w.writerow([c, r["barrier"], f"{r['fv']:.4f}", f"{r['raw']:.4f}"])
    w.writerow([])
    w.writerow(["主导事故序列(Top-N)"])
    w.writerow(["序列", "路径", "后果", "频率/yr"])
    for s in data.get("sequences", []):
        w.writerow([s["end_state"], s["path_summary"], s["consequence"], f"{s['frequency']:.4e}"])
    for fid, f in data.get("fta", {}).items():
        w.writerow([])
        w.writerow([f"FTA:{f['label']}", f"顶概率={f['top_prob']:.4e}"])
        w.writerow(["割集#", "基本事件(∩)", "阶", "概率"])
        for i, c in enumerate(f["cutsets"], 1):
            w.writerow([i, " ∩ ".join(c["events"]), c["order"], f"{c['prob']:.4e}"])
        w.writerow(["基本事件", "FV"])
        for bsc in f["basics"]:
            w.writerow([bsc["event"], f"{bsc['fv']:.4f}"])
    if agg:   # 逐树分解(点估计)+ 基准注记 + 免责句(spec A §2.1/§2.2)
        w.writerow([])
        w.writerow([f"逐树分解(勾选集聚合,{agg['tree_count']} 树;各行为点估计,分位数不可加)"])
        w.writerow(["事件树"] + _SEV)
        for t in agg["per_tree"]:
            w.writerow([t["name"]] + [f"{t['consequences'].get(c, 0.0):.4e}" for c in _SEV])
        for t in agg["per_tree"]:
            if t.get("init_note"):
                w.writerow([f"※ {t['name']} 初因口径", t["init_note"]])
        for s in _AGG_DISCLOSURES:
            w.writerow([f"⚠ {s}"])
    if evidence:
        w.writerow([])
        w.writerow([_evidence_line(evidence)])
    return ("﻿" + buf.getvalue()).encode("utf-8")   # BOM 便于 Excel 读中文


def _shade(cell, hex_color: str) -> None:
    from docx.oxml.ns import qn
    from docx.oxml import OxmlElement
    shd = OxmlElement("w:shd"); shd.set(qn("w:val"), "clear"); shd.set(qn("w:fill"), hex_color)
    cell._tc.get_or_add_tcPr().append(shd)


def report_docx(data: dict, scenario_name: str, tree_png: bytes | None,
                evidence: dict | None = None) -> bytes:
    from docx import Document
    from docx.shared import Inches
    agg = data.get("aggregate")
    mark = _agg_scope_label(data)                 # 「勾选集聚合(n 树)」或空(单报告零扰动)
    doc = Document()
    doc.add_heading("BESS 热失控 QRA 报告" + (f" · {mark}" if mark else ""), level=0)
    doc.add_paragraph(f"场景:{scenario_name}")
    if agg:   # spec A §2.4:scope 标识不能只靠页脚 —— 标题 + 口径行 + C1–C5 表标题同现
        doc.add_paragraph(f"口径:{mark} — " + "、".join(s["name"] for s in agg["scenarios"]))
    if data.get("analysis_settings_note"):        # 收口二轮 D-7:设置披露入正文
        doc.add_paragraph(data["analysis_settings_note"])
    if not _is_signed(evidence):
        doc.add_paragraph(f"⚠ {_WORKING_MARK}")

    doc.add_heading("后果频率(每站每年)" + (f" · {mark}" if mark else ""), level=1)
    t = doc.add_table(rows=1, cols=5); t.style = "Table Grid"
    for i, h in enumerate(["后果", "点估计", "p05", "p50", "p95"]):
        t.rows[0].cells[i].text = h
    for c in _SEV:
        b = data["bands"].get(c, {}); cells = t.add_row().cells
        cells[0].text = f"{c} {_C_LABEL[c]}"
        cells[1].text = f"{data['consequences'].get(c, 0):.2e}"
        cells[2].text = f"{b.get('p05', 0):.2e}"; cells[3].text = f"{b.get('p50', 0):.2e}"; cells[4].text = f"{b.get('p95', 0):.2e}"

    doc.add_heading("后果内涵(C1–C5)", level=1)
    dt = doc.add_table(rows=1, cols=2); dt.style = "Table Grid"
    dt.rows[0].cells[0].text = "后果"; dt.rows[0].cells[1].text = "内涵"
    cdefs = data.get("consequence_defs", {})
    for c in _SEV:
        cells = dt.add_row().cells
        cells[0].text = c; cells[1].text = cdefs.get(c, _C_LABEL[c])

    # 矩阵落格处 scope 标识同现(§2.4:求和后频率上移频带,聚合行与单场景行落格天然不同)
    doc.add_heading("风险矩阵(后果 × 频率)" + (f" · {mark}" if mark else ""), level=1)
    placed = {c: _freq_band(data["consequences"].get(c, 0)) for c in _SEV if data["consequences"].get(c, 0) > 0}
    rm = doc.add_table(rows=1, cols=6); rm.style = "Table Grid"
    rm.rows[0].cells[0].text = "频率＼后果"
    for i, c in enumerate(_SEV):
        rm.rows[0].cells[i + 1].text = c
    for fi in range(len(_FREQ_BANDS) - 1, -1, -1):       # F5..F1
        cells = rm.add_row().cells
        cells[0].text = _FREQ_BANDS[fi][1]
        for i, c in enumerate(_SEV):
            lvl = _risk_level(_SEV_RANK[c], fi + 1)
            if placed.get(c) == fi:
                cells[i + 1].text = f"{data['consequences'][c]:.1e}"
            _shade(cells[i + 1], _RISK_HEX[lvl])

    if data.get("importance"):   # 聚合报告无跨树重要度语义 → 整节不出(单报告恒非空,零扰动)
        doc.add_heading("屏障重要度 FV/RAW(C5 最严重)", level=1)
        it = doc.add_table(rows=1, cols=3); it.style = "Table Grid"
        for i, h in enumerate(["屏障", "FV", "RAW"]):
            it.rows[0].cells[i].text = h
        for r in data["importance"].get("C5", []):
            cells = it.add_row().cells
            cells[0].text = r["barrier"]; cells[1].text = f"{r['fv']:.3f}"; cells[2].text = f"{r['raw']:.2f}"

    doc.add_heading("主导事故序列(Top-N)", level=1)
    st = doc.add_table(rows=1, cols=4); st.style = "Table Grid"
    for i, h in enumerate(["序列", "路径", "后果", "频率/yr"]):
        st.rows[0].cells[i].text = h
    for s in data.get("sequences", []):
        cells = st.add_row().cells
        cells[0].text = s["end_state"]; cells[1].text = s["path_summary"]
        cells[2].text = s["consequence"]; cells[3].text = f"{s['frequency']:.2e}"

    for fid, f in data.get("fta", {}).items():
        doc.add_heading(f"FTA:{f['label']}(顶概率 {f['top_prob']:.2e})", level=2)
        ct = doc.add_table(rows=1, cols=4); ct.style = "Table Grid"
        for i, h in enumerate(["割集#", "基本事件(∩)", "阶", "概率"]):
            ct.rows[0].cells[i].text = h
        for i, c in enumerate(f["cutsets"], 1):
            cells = ct.add_row().cells
            cells[0].text = str(i); cells[1].text = " ∩ ".join(c["events"])
            cells[2].text = str(c["order"]); cells[3].text = f"{c['prob']:.2e}"
        bt = doc.add_table(rows=1, cols=2); bt.style = "Table Grid"
        bt.rows[0].cells[0].text = "基本事件"; bt.rows[0].cells[1].text = "FV"
        for bsc in f["basics"]:
            cells = bt.add_row().cells
            cells[0].text = bsc["event"]; cells[1].text = f"{bsc['fv']:.3f}"

    if tree_png:
        doc.add_heading("事件树", level=1)
        doc.add_picture(io.BytesIO(tree_png), width=Inches(6.2))
    if agg:   # 页脚证据块:逐树分解表(点估计)+ 逐树基准注记 + 免责三句(§2.1/§2.2)
        doc.add_heading(f"逐树分解({mark};各行为点估计,分位数不可加)", level=1)
        pt = doc.add_table(rows=1, cols=6); pt.style = "Table Grid"
        pt.rows[0].cells[0].text = "事件树"
        for i, c in enumerate(_SEV):
            pt.rows[0].cells[i + 1].text = c
        for tr in agg["per_tree"]:
            cells = pt.add_row().cells
            cells[0].text = tr["name"]
            for i, c in enumerate(_SEV):
                cells[i + 1].text = f"{tr['consequences'].get(c, 0.0):.2e}"
        for tr in agg["per_tree"]:
            if tr.get("init_note"):
                doc.add_paragraph(f"※ {tr['name']} 初因口径:{tr['init_note']}")
        for s in _AGG_DISCLOSURES:
            doc.add_paragraph("⚠ " + s)
    doc.add_paragraph(); doc.add_paragraph("⚠ " + _DISCLAIMER)
    if evidence:
        doc.add_paragraph(_evidence_line(evidence))
    out = io.BytesIO(); doc.save(out); return out.getvalue()


def _pdf_font() -> str:
    """注册 reportlab 内置中日韩字体(STSong-Light), 失败回退 Helvetica。"""
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.cidfonts import UnicodeCIDFont
    try:
        pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
        return "STSong-Light"
    except Exception:
        return "Helvetica"


def report_pdf(data: dict, scenario_name: str, tree_png: bytes | None,
               evidence: dict | None = None) -> bytes:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib import colors
    from reportlab.lib.units import cm
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image
    font = _pdf_font()
    cn = font == "STSong-Light"
    lbl = _C_LABEL if cn else _C_EN
    agg = data.get("aggregate")
    mark = (_agg_scope_label(data) if cn else f"checked-set aggregate ({agg['tree_count']} trees)") if agg else ""
    styles = getSampleStyleSheet()
    h0 = ParagraphStyle("h0", parent=styles["Title"], fontName=font)
    h2 = ParagraphStyle("h2", parent=styles["Heading2"], fontName=font)
    nm = ParagraphStyle("nm", parent=styles["Normal"], fontName=font)
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, title="BESS QRA Report")
    story = [Paragraph(("BESS 热失控 QRA 报告" if cn else "BESS Thermal-Runaway QRA Report")
                       + (f" · {mark}" if mark else ""), h0),
             Paragraph((f"场景:{scenario_name}" if cn else f"Scenario: {scenario_name}"), nm), Spacer(1, 8)]
    if agg:   # §2.4:scope 标识不能只靠页脚
        names = "、".join(s["name"] for s in agg["scenarios"]) if cn else ", ".join(s["name"] for s in agg["scenarios"])
        story += [Paragraph((f"口径:{mark} — {names}" if cn else f"Scope: {mark} — {names}"), nm), Spacer(1, 4)]
    if data.get("analysis_settings_note"):        # 收口二轮 D-7:设置披露入正文
        story += [Paragraph(data["analysis_settings_note"], nm), Spacer(1, 4)]
    if not _is_signed(evidence):
        story += [Paragraph(f"⚠ {_WORKING_MARK}" if cn else "WORKING COPY — NOT SIGNED OFF", nm),
                  Spacer(1, 8)]

    def grid_style(extra=None):
        cmds = [("GRID", (0, 0), (-1, -1), 0.5, colors.grey), ("FONTNAME", (0, 0), (-1, -1), font),
                ("BACKGROUND", (0, 0), (-1, 0), colors.lightgrey), ("FONTSIZE", (0, 0), (-1, -1), 8)]
        return TableStyle(cmds + (extra or []))

    rows = [["Cx", "point", "p05", "p50", "p95"]]
    for c in _SEV:
        b = data["bands"].get(c, {})
        rows.append([f"{c} {lbl[c]}", f"{data['consequences'].get(c, 0):.2e}",
                     f"{b.get('p05', 0):.2e}", f"{b.get('p50', 0):.2e}", f"{b.get('p95', 0):.2e}"])
    t = Table(rows); t.setStyle(grid_style())
    story += [Paragraph(("后果频率(每站每年)" if cn else "Consequence frequency (/site.yr)")
                        + (f" · {mark}" if mark else ""), h2), t, Spacer(1, 8)]

    cdefs = data.get("consequence_defs", {})
    drows = [["Cx", "内涵" if cn else "definition"]] + [[c, cdefs.get(c, lbl[c])] for c in _SEV]
    dt = Table(drows, colWidths=[2 * cm, 13 * cm]); dt.setStyle(grid_style())
    story += [Paragraph("后果内涵(C1–C5)" if cn else "Consequence definitions", h2), dt, Spacer(1, 8)]

    placed = {c: _freq_band(data["consequences"].get(c, 0)) for c in _SEV if data["consequences"].get(c, 0) > 0}
    grid = [["freq\\Cx"] + _SEV]
    cmds = []
    for ri, fi in enumerate(range(len(_FREQ_BANDS) - 1, -1, -1)):
        row = [_FREQ_BANDS[fi][0]]
        for ci, c in enumerate(_SEV):
            lvl = _risk_level(_SEV_RANK[c], fi + 1)
            row.append(f"{data['consequences'][c]:.0e}" if placed.get(c) == fi else "")
            cmds.append(("BACKGROUND", (ci + 1, ri + 1), (ci + 1, ri + 1), colors.HexColor("#" + _RISK_HEX[lvl])))
        grid.append(row)
    rm = Table(grid); rm.setStyle(grid_style(cmds))
    story += [Paragraph(("风险矩阵(后果 × 频率)" if cn else "Risk matrix (consequence x frequency)")
                        + (f" · {mark}" if mark else ""), h2), rm, Spacer(1, 8)]

    if data.get("importance"):   # 聚合报告无跨树重要度语义 → 整节不出(单报告恒非空,零扰动)
        irows = [["barrier", "FV", "RAW"]] + [[r["barrier"], f"{r['fv']:.3f}", f"{r['raw']:.2f}"] for r in data["importance"].get("C5", [])]
        it = Table(irows); it.setStyle(grid_style())
        story += [Paragraph("屏障重要度 FV/RAW(C5)" if cn else "Barrier importance FV/RAW (C5)", h2), it, Spacer(1, 8)]

    srows = [["seq", "path", "Cx", "freq/yr"]]
    for s in data.get("sequences", []):
        srows.append([s["end_state"], s["path_summary"], s["consequence"], f"{s['frequency']:.2e}"])
    st = Table(srows, colWidths=[2 * cm, 9 * cm, 2 * cm, 3 * cm]); st.setStyle(grid_style())
    story += [Paragraph("主导事故序列(Top-N)" if cn else "Dominant sequences (Top-N)", h2), st, Spacer(1, 8)]

    for fid, f in data.get("fta", {}).items():
        story += [Paragraph((f"FTA:{f['label']}(顶概率 {f['top_prob']:.2e})" if cn
                             else f"FTA: {f['label']} (top {f['top_prob']:.2e})"), h2)]
        crows = [["#", "cutset (∩)", "order", "prob"]]
        for i, c in enumerate(f["cutsets"], 1):
            crows.append([str(i), " ∩ ".join(c["events"]), str(c["order"]), f"{c['prob']:.2e}"])
        ct = Table(crows, colWidths=[1 * cm, 10 * cm, 1.5 * cm, 3.4 * cm]); ct.setStyle(grid_style())
        brows = [["basic", "FV"]] + [[bsc["event"], f"{bsc['fv']:.3f}"] for bsc in f["basics"]]
        bt = Table(brows, colWidths=[12 * cm, 4 * cm]); bt.setStyle(grid_style())
        story += [ct, Spacer(1, 4), bt, Spacer(1, 8)]

    if tree_png:
        img = Image(io.BytesIO(tree_png)); maxw = 16 * cm
        if img.drawWidth > maxw:
            img.drawHeight = img.drawHeight * maxw / img.drawWidth; img.drawWidth = maxw
        story += [Paragraph("事件树" if cn else "Event tree", h2), img, Spacer(1, 8)]
    if agg:   # 页脚证据块:逐树分解表 + 逐树基准注记 + 免责三句(§2.1/§2.2)
        story += [Paragraph((f"逐树分解({mark};各行为点估计,分位数不可加)" if cn
                             else f"Per-tree breakdown ({mark}; point estimates — quantiles not additive)"), h2)]
        prow = [["tree"] + _SEV]
        for tr in agg["per_tree"]:
            prow.append([tr["name"]] + [f"{tr['consequences'].get(c, 0.0):.2e}" for c in _SEV])
        ptab = Table(prow, colWidths=[6 * cm] + [2 * cm] * 5); ptab.setStyle(grid_style())
        story += [ptab, Spacer(1, 4)]
        for tr in agg["per_tree"]:
            if tr.get("init_note") and cn:      # 注记为中文文本,无 CJK 字体时略去(避免乱码)
                story += [Paragraph(f"※ {tr['name']} 初因口径:{tr['init_note']}", nm)]
        for s in (_AGG_DISCLOSURES if cn else _AGG_DISCLOSURES_EN):
            story += [Paragraph("⚠ " + s, nm)]
        story += [Spacer(1, 4)]
    story += [Spacer(1, 8), Paragraph(_DISCLAIMER if cn else
              "Built-in failure/PFD values are public reference magnitudes; calibrate to project data & regulations.", nm)]
    if evidence:
        story += [Spacer(1, 4), Paragraph(_evidence_line(evidence), nm)]
    doc.build(story)
    return buf.getvalue()


# ── 站级评估报告(功能② 证据链出口;规格 2026-07-27-station-model)────────────
# 从**钉扎站级案例**生成(导出必经钉扎,项目报告 auto-pin 同律)。标签绑定铁律在文档
# 里同样成立:「≥5 舱(排内连片)」只配 ge5,「整排蔓延(k=排长)」只配 ge_row(评审
# BLOCKING-1);口径申报逐字入文,不许摘要化。站级签发通道未建 ⇒ 恒工作稿 + 诚实声明。

_ST_KPI = [
    ("any", "任一舱 C3+"), ("ge2", "多舱 ≥2 舱"),
    ("ge5", "≥5 舱(排内连片)"), ("ge_row", "整排蔓延(k=排长)"), ("offsite", "站界外后果"),
]


def station_report_docx(case: dict) -> bytes:
    from docx import Document
    sdoc, res = case["doc"], case["results"]
    d = Document()
    d.add_heading(f"站级评估报告 · {sdoc.get('name', '站型')}", level=0)
    d.add_paragraph(f"⚠ {_WORKING_MARK}(站级签发通道尚未建立,本报告恒为工作稿)")
    d.add_paragraph(
        f"评价依据:站级案例 #{case['id']} · 站型文档哈希 doc_hash {case['doc_hash'][:8]}"
        f"({case['doc_hash']}) · 引擎 bess-psa {case['engine_version']}"
        f" · {case['created_at']} · {case['actor']}")

    d.add_heading("站级指标(/站·年)", level=1)
    bands = res.get("bands")                      # ST-6:钉扎案例带 bands 时增三列;旧案例原版式
    ncols = 5 if bands else 2
    t = d.add_table(rows=1, cols=ncols); t.style = "Table Grid"
    heads = ["指标", "点值"] + (["P05", "P50", "P95"] if bands else [])
    for i, h in enumerate(heads):
        t.rows[0].cells[i].text = h
    for key, label in _ST_KPI:
        cells = t.add_row().cells
        cells[0].text = label
        cells[1].text = f"{res['metrics'].get(key, 0):.2e}"
        if bands:
            for i, q in enumerate(("p05", "p50", "p95")):
                cells[2 + i].text = f"{bands.get(key, {}).get(q, 0):.2e}"
    ks = "、".join(f"{r['id']}:k={r['k']}" for r in res.get("rows", []))
    if ks:
        d.add_paragraph(f"逐排 k(整排指标的排长):{ks}")
    for n in res.get("band_notes", []):            # 带口径与部分带记账,随表落文(不可省略)
        d.add_paragraph(n, style="List Bullet")

    ar = res.get("acceptance_results") or []
    if ar:                                        # ST-7:判定章(判据口径/basis 逐条落文;FAIL 章首声明)
        d.add_heading("验收准则判定", level=1)
        kmap = dict(_ST_KPI)
        if any(x["verdict"] == "fail" for x in ar):
            d.add_paragraph("⚠ 存在未通过准则(FAIL)——见下表。本报告为工作稿,判定不构成签发结论。")
        at = d.add_table(rows=1, cols=7); at.style = "Table Grid"
        for i, h in enumerate(["准则", "指标", "判据口径", "限值", "取值", "判定", "裕度(取值/限值)"]):
            at.rows[0].cells[i].text = h
        _V = {"pass": "PASS", "fail": "FAIL", "indeterminate": "无带不可判"}
        for x in ar:
            cells = at.add_row().cells
            cells[0].text = x.get("label") or x["metric"]
            cells[1].text = kmap.get(x["metric"], x["metric"])
            cells[2].text = "点值" if x["eval_basis"] == "point" else "P95(保守)"
            cells[3].text = f"{x['limit']:.2e}"
            cells[4].text = "—" if x["value"] is None else f"{x['value']:.2e}"
            cells[5].text = _V[x["verdict"]]
            cells[6].text = "—" if x["margin"] is None else f"{x['margin']:.2f}×"
        for x in ar:
            d.add_paragraph(f"{x.get('label') or x['metric']} · 限值依据:{x['basis']}"
                            + (f" · {x['reason']}" if x.get("reason") else ""), style="List Bullet")

    d.add_heading("产品配置(舱 = 系统项目钉扎案例的版本快照实例)", level=1)
    pt = d.add_table(rows=1, cols=5); pt.style = "Table Grid"
    for i, h in enumerate(["产品", "舱级 C3+", "舱级 C4+", "模型版本哈希", "分析案例"]):
        pt.rows[0].cells[i].text = h
    for p in res.get("products", []):
        cells = pt.add_row().cells
        cells[0].text = f"{p['key']} · {p.get('label') or ''}"
        cells[1].text = f"{p['f']:.2e}"; cells[2].text = f"{p['f4']:.2e}"
        cells[3].text = f"v{p['case']['vid']} · {p['case']['version_hash'][:8]}"
        cells[4].text = f"#{p['case']['id']} · {p['case']['created_at'][:10]}"

    d.add_heading("站拓扑与蔓延参数", level=1)
    ed = sdoc.get("edge_defaults", {})
    d.add_paragraph(f"排内升级 p={ed.get('intra_p')} · 墙 p={ed.get('wall_p')}(衰减边,不截断)"
                    f" · 跨排 p={ed.get('inter_row_p')} · 站界 p={sdoc.get('offsite', {}).get('p_fence')}")
    for row in sdoc.get("rows", []):
        walls = row.get("walls") or []
        d.add_paragraph(f"排 {row['id']}:{len(row.get('cabins', []))} 舱"
                        + (f",墙位 {walls}" if walls else ",无墙"), style="List Bullet")
    bt = d.add_table(rows=1, cols=4); bt.style = "Table Grid"
    for i, h in enumerate(["站级屏障", "PFD", "置信", "作用域/依据"]):
        bt.rows[0].cells[i].text = h
    for b in sdoc.get("station_barriers", []):
        cells = bt.add_row().cells
        cells[0].text = b.get("label", b.get("key", ""))
        cells[1].text = str(b.get("pfd")); cells[2].text = b.get("grade") or "—"
        cells[3].text = f"{b.get('scope', '')} · {b.get('basis', '')}"

    d.add_heading("跨舱共因申报(v1 只申报,不入点值)", level=1)
    for g in res.get("declared", {}).get("ccf_groups", []):
        d.add_paragraph(f"{g.get('label', g.get('key'))} · β={g.get('beta')} · {g.get('basis', '')}",
                        style="List Bullet")

    d.add_heading("口径申报(逐字,随结果发布)", level=1)
    for s in res.get("declared", {}).get("simplifications", []):
        d.add_paragraph(s, style="List Bullet")

    d.add_paragraph("")
    d.add_paragraph("数据免责:内置数值为公开来源的参考量级,用于演示与初步筛查;"
                    "正式工程分析必须结合项目实际数据校核替换,并由具备资质的工程师审核。")
    buf = io.BytesIO(); d.save(buf)
    return buf.getvalue()
