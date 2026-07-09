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


def build_report_data(model, et_name: str = "TR", *, consequence_defs: dict | None = None,
                      labels: dict | None = None, linked_fe_ids: list | None = None,
                      samples: int = 1000, seed: int = 42, error_factor: float = 3.0,
                      top_n: int = TOP_N) -> dict:
    all_seqs = event_tree_sequences(model, et_name)   # 一次构树: 既出主导序列, 也据此聚合后果频率(免重复建 BDD)
    unc = event_tree_uncertainty(model, et_name, samples=samples, seed=seed, error_factor=error_factor)
    imp = barrier_importance_exact(model, et_name)
    cons: dict[str, float] = {}
    for s in all_seqs:
        cons[s["consequence"]] = cons.get(s["consequence"], 0.0) + s["frequency"]

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

    return {"consequences": {c: float(cons.get(c, 0.0)) for c in _SEV}, "bands": unc["bands"],
            "importance": imp, "consequence_defs": consequence_out, "sequences": sequences, "fta": fta}


def _evidence_line(ev: dict) -> str:
    """ADR-2 证据链页脚:报告数字 → 分析案例 → 版本哈希 → 引擎版本。"""
    return (f"评价依据:分析案例 #{ev['case_id']} · 模型版本 {ev['version_hash'][:8]}"
            f" · 引擎 bess-psa {ev['engine_version']} · {ev['created_at']}")


def report_csv(data: dict, evidence: dict | None = None) -> bytes:
    buf = io.StringIO()
    w = csv.writer(buf)
    cdefs = data.get("consequence_defs", {})
    w.writerow(["后果", "内涵", "点估计/yr", "p05", "p50", "p95"])
    for c in _SEV:
        b = data["bands"].get(c, {})
        w.writerow([c, cdefs.get(c, _C_LABEL[c]), f"{data['consequences'].get(c, 0.0):.4e}",
                    f"{b.get('p05', 0.0):.4e}", f"{b.get('p50', 0.0):.4e}", f"{b.get('p95', 0.0):.4e}"])
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
    doc = Document()
    doc.add_heading("BESS 热失控 QRA 报告", level=0)
    doc.add_paragraph(f"场景:{scenario_name}")

    doc.add_heading("后果频率(每站每年)", level=1)
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

    doc.add_heading("风险矩阵(后果 × 频率)", level=1)
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
    styles = getSampleStyleSheet()
    h0 = ParagraphStyle("h0", parent=styles["Title"], fontName=font)
    h2 = ParagraphStyle("h2", parent=styles["Heading2"], fontName=font)
    nm = ParagraphStyle("nm", parent=styles["Normal"], fontName=font)
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, title="BESS QRA Report")
    story = [Paragraph("BESS 热失控 QRA 报告" if cn else "BESS Thermal-Runaway QRA Report", h0),
             Paragraph((f"场景:{scenario_name}" if cn else f"Scenario: {scenario_name}"), nm), Spacer(1, 8)]

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
    story += [Paragraph("后果频率(每站每年)" if cn else "Consequence frequency (/site.yr)", h2), t, Spacer(1, 8)]

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
    story += [Paragraph("风险矩阵(后果 × 频率)" if cn else "Risk matrix (consequence x frequency)", h2), rm, Spacer(1, 8)]

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
    story += [Spacer(1, 8), Paragraph(_DISCLAIMER if cn else
              "Built-in failure/PFD values are public reference magnitudes; calibrate to project data & regulations.", nm)]
    if evidence:
        story += [Spacer(1, 4), Paragraph(_evidence_line(evidence), nm)]
    doc.build(story)
    return buf.getvalue()
