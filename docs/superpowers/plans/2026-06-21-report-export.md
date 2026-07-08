# QRA 报告导出(Word / PDF / CSV)实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 由当前 ETA 一键重算量化+不确定性+重要度,导出 Word/PDF/CSV 报告(Word/PDF 含彩色风险矩阵 + 嵌入事件树图 + 免责声明;CSV 纯数据)。

**Architecture:** 后端 `report_export.py` 复用三引擎函数聚合数据,用 python-docx/reportlab/csv 生成;`POST /api/report?format=` 返回二进制下载。前端 `svgToPng` 捕获事件树 SVG 上传,「导出报告」三按钮触发下载。

**Tech Stack:** python-docx / reportlab / csv(均已装);React/TS。

**验证:** 后端 `.\.venv\Scripts\python.exe -m pytest -q`;前端 `npm run build --prefix frontend` + `preview_eval`;**改后端端点后重启 uvicorn 预览**。提交结尾 `Co-Authored-By: Claude Opus 4.8`。

---

## Task 1: `backend/report_export.py` + 单测

**Files:** Create `backend/report_export.py`; Test `tests/backend/test_report_export.py`

- [ ] **Step 1: 写失败测试** `tests/backend/test_report_export.py`

```python
from bess.scenarios import build_scenario_model
from backend.report_export import build_report_data, report_csv, report_docx, report_pdf, _freq_band, _risk_level


def _data():
    return build_report_data(build_scenario_model("SC_OVERCHARGE"), "TR", samples=100, seed=1)


def test_report_data_shape():
    d = _data()
    assert set(d["consequences"]) >= {"C1", "C5"}
    assert d["bands"]["C5"]["p05"] <= d["bands"]["C5"]["p95"]
    assert "C5" in d["importance"]


def test_coloring_helpers():
    assert _freq_band(5e-5) == 1 and _freq_band(0.5) == 3
    assert _risk_level(5, 5) == "extreme" and _risk_level(1, 1) == "low" and _risk_level(3, 3) == "medium"


def test_csv_contains_consequences():
    txt = report_csv(_data()).decode("utf-8")
    assert "C5" in txt and "FV" in txt


def test_docx_is_zip():
    b = report_docx(_data(), "测试场景", None)
    assert b[:4] == b"PK\x03\x04" and len(b) > 1000


def test_pdf_is_pdf():
    b = report_pdf(_data(), "测试场景", None)
    assert b[:4] == b"%PDF" and len(b) > 1000
```

- [ ] **Step 2: 跑测试确认失败** → ModuleNotFoundError。

- [ ] **Step 3: 写 `backend/report_export.py`**

```python
from __future__ import annotations
import csv, io
from psaengine.eta.sequence import quantify_event_tree
from psaengine.eta.uncertainty import event_tree_uncertainty, barrier_importance_exact

_SEV = ["C1", "C2", "C3", "C4", "C5"]
_C_LABEL = {"C1": "单体排气", "C2": "模组蔓延", "C3": "簇/舱火灾", "C4": "多舱火灾", "C5": "爆燃/爆炸"}
_C_EN = {"C1": "cell vent", "C2": "module spread", "C3": "rack/unit fire", "C4": "multi-unit fire", "C5": "deflagration"}
_FREQ_BANDS = [("F1", "极不可能", 1e-6), ("F2", "不可能", 1e-4), ("F3", "偶尔", 1e-2), ("F4", "可能", 1.0), ("F5", "频繁", float("inf"))]
_SEV_RANK = {"C1": 1, "C2": 2, "C3": 3, "C4": 4, "C5": 5}
_RISK_HEX = {"low": "16a34a", "medium": "eab308", "high": "f97316", "extreme": "dc2626"}
_DISCLAIMER = ("本报告内置失效率/PFD 为公开来源参考量级,频率带与可接受准则为示意默认值;"
               "正式工程分析须按项目实测数据与法规校核替换。")


def _freq_band(f: float) -> int:
    if f <= 0:
        return 0
    for i, (_, _, mx) in enumerate(_FREQ_BANDS):
        if f < mx:
            return i
    return len(_FREQ_BANDS) - 1


def _risk_level(sev_rank: int, freq_rank: int) -> str:
    s = sev_rank * freq_rank
    if s <= 4: return "low"
    if s <= 9: return "medium"
    if s <= 14: return "high"
    return "extreme"


def build_report_data(model, et_name: str = "TR", samples: int = 1000, seed: int = 42, error_factor: float = 3.0) -> dict:
    cons = quantify_event_tree(model, et_name)["consequences"]
    unc = event_tree_uncertainty(model, et_name, samples=samples, seed=seed, error_factor=error_factor)
    imp = barrier_importance_exact(model, et_name)
    return {"consequences": {c: float(cons.get(c, 0.0)) for c in _SEV}, "bands": unc["bands"], "importance": imp}


def report_csv(data: dict) -> bytes:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["后果", "说明", "点估计/yr", "p05", "p50", "p95"])
    for c in _SEV:
        b = data["bands"].get(c, {})
        w.writerow([c, _C_LABEL[c], f"{data['consequences'].get(c, 0.0):.4e}",
                    f"{b.get('p05', 0.0):.4e}", f"{b.get('p50', 0.0):.4e}", f"{b.get('p95', 0.0):.4e}"])
    w.writerow([])
    w.writerow(["后果", "屏障", "FV", "RAW"])
    for c in _SEV:
        for r in data["importance"].get(c, []):
            w.writerow([c, r["barrier"], f"{r['fv']:.4f}", f"{r['raw']:.4f}"])
    return ("﻿" + buf.getvalue()).encode("utf-8")   # BOM 便于 Excel 读中文


def _shade(cell, hex_color: str) -> None:
    from docx.oxml.ns import qn
    from docx.oxml import OxmlElement
    shd = OxmlElement("w:shd"); shd.set(qn("w:val"), "clear"); shd.set(qn("w:fill"), hex_color)
    cell._tc.get_or_add_tcPr().append(shd)


def report_docx(data: dict, scenario_name: str, tree_png: bytes | None) -> bytes:
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

    if tree_png:
        doc.add_heading("事件树", level=1)
        doc.add_picture(io.BytesIO(tree_png), width=Inches(6.2))
    doc.add_paragraph(); doc.add_paragraph("⚠ " + _DISCLAIMER)
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


def report_pdf(data: dict, scenario_name: str, tree_png: bytes | None) -> bytes:
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
    story += [Paragraph("后果频率(每站每年)" if cn else "Consequence frequency (/site·yr)", h2), t, Spacer(1, 8)]

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
    story += [Paragraph("风险矩阵(后果 × 频率)" if cn else "Risk matrix (consequence × frequency)", h2), rm, Spacer(1, 8)]

    irows = [["barrier", "FV", "RAW"]] + [[r["barrier"], f"{r['fv']:.3f}", f"{r['raw']:.2f}"] for r in data["importance"].get("C5", [])]
    it = Table(irows); it.setStyle(grid_style())
    story += [Paragraph("屏障重要度 FV/RAW(C5)" if cn else "Barrier importance FV/RAW (C5)", h2), it, Spacer(1, 8)]

    if tree_png:
        img = Image(io.BytesIO(tree_png)); maxw = 16 * cm
        if img.drawWidth > maxw:
            img.drawHeight = img.drawHeight * maxw / img.drawWidth; img.drawWidth = maxw
        story += [Paragraph("事件树" if cn else "Event tree", h2), img, Spacer(1, 8)]
    story += [Spacer(1, 8), Paragraph(_DISCLAIMER if cn else
              "Built-in failure/PFD values are public reference magnitudes; calibrate to project data & regulations.", nm)]
    doc.build(story)
    return buf.getvalue()
```

- [ ] **Step 4: 跑测试确认通过** — `... -m pytest tests/backend/test_report_export.py -q` → PASS。

- [ ] **Step 5: 提交**

```bash
git add backend/report_export.py tests/backend/test_report_export.py
git commit -m "feat(report): QRA 报告生成(CSV/Word/PDF, 彩色风险矩阵, CJK-safe PDF)"
```

## Task 2: `/api/report` 端点 + schemas

**Files:** Modify `backend/schemas.py`, `backend/app.py`; Test `tests/backend/test_report_api.py`

- [ ] **Step 1: 写失败测试** `tests/backend/test_report_api.py`

```python
from fastapi.testclient import TestClient
from backend.app import app

client = TestClient(app)


def _req():
    return {
        "init_event": "IE", "init_frequency": 1.0,
        "functional_events": [{"id": "FE1", "pfd": 0.1}, {"id": "FE2", "pfd": 0.2}],
        "fault_trees": {}, "parameters": {},
        "sequences": [
            {"path": {"FE1": "success"}, "end_state": "L0"},
            {"path": {"FE1": "failure", "FE2": "success"}, "end_state": "L1"},
            {"path": {"FE1": "failure", "FE2": "failure"}, "end_state": "L2"},
        ],
        "consequence_bins": {"L0": "C1", "L1": "C2", "L2": "C3"},
        "scenario_name": "单元测试场景", "samples": 80,
    }


def test_report_csv():
    r = client.post("/api/report?format=csv", json=_req())
    assert r.status_code == 200 and "text/csv" in r.headers["content-type"]
    assert "C3" in r.content.decode("utf-8")


def test_report_docx():
    r = client.post("/api/report?format=docx", json=_req())
    assert r.status_code == 200 and r.content[:4] == b"PK\x03\x04"


def test_report_pdf():
    r = client.post("/api/report?format=pdf", json=_req())
    assert r.status_code == 200 and r.content[:4] == b"%PDF"


def test_report_bad_format():
    assert client.post("/api/report?format=xls", json=_req()).status_code == 400
```

- [ ] **Step 2: 跑测试确认失败** → 404/422。

- [ ] **Step 3: `schemas.py` 加请求模型**(在 `SaveWorkspaceRequest` 后)

```python
class ReportRequest(EtUncertaintyRequest):
    scenario_name: str = "ETA"
    tree_png: Optional[str] = None    # 'data:image/png;base64,...'
```

- [ ] **Step 4: `backend/app.py` 加端点 + import**

顶部 import 加 `from fastapi import Response`(已在则跳过;当前是 `from fastapi import FastAPI, HTTPException` → 改为 `from fastapi import FastAPI, HTTPException, Response`)。`import base64`。端点(放 `/api/event-tree/*` 附近):

```python
@app.post("/api/report")
def api_report(req: schemas.ReportRequest, format: str = "docx"):
    import base64
    from backend.et_builder import build_model_from_request
    from backend import report_export as rx
    if format not in ("docx", "pdf", "csv"):
        raise HTTPException(400, "format must be docx|pdf|csv")
    model = build_model_from_request(req.model_dump())
    data = rx.build_report_data(model, "TR", samples=req.samples, seed=req.seed, error_factor=req.error_factor)
    png = None
    if req.tree_png and "," in req.tree_png:
        try: png = base64.b64decode(req.tree_png.split(",", 1)[1])
        except Exception: png = None
    if format == "csv":
        body = rx.report_csv(data); media = "text/csv; charset=utf-8"; ext = "csv"
    elif format == "docx":
        body = rx.report_docx(data, req.scenario_name, png); media = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"; ext = "docx"
    else:
        body = rx.report_pdf(data, req.scenario_name, png); media = "application/pdf"; ext = "pdf"
    return Response(content=body, media_type=media,
                    headers={"Content-Disposition": f'attachment; filename="qra_report.{ext}"'})
```

- [ ] **Step 5: 跑测试 + 全量回归** → PASS（≥121 绿）。

- [ ] **Step 6: 提交**

```bash
git add backend/schemas.py backend/app.py tests/backend/test_report_api.py
git commit -m "feat(api): POST /api/report?format=docx|pdf|csv 报告下载"
```

## Task 3: 前端 svgToPng + 导出按钮

**Files:** Create `frontend/src/util/svgToPng.ts`; Modify `frontend/src/api.ts`, `frontend/src/components/EventTreeEditor.tsx`

- [ ] **Step 1: 写 `frontend/src/util/svgToPng.ts`**

```ts
/** 把 SVG 元素栅格化为 PNG dataURL(白底)。 */
export function svgToPng(svg: SVGSVGElement): Promise<string> {
  const xml = new XMLSerializer().serializeToString(svg)
  const w = svg.viewBox.baseVal.width || svg.clientWidth || +(svg.getAttribute('width') || 800)
  const h = svg.viewBox.baseVal.height || svg.clientHeight || +(svg.getAttribute('height') || 600)
  const svg64 = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml)
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h)
      ctx.drawImage(img, 0, 0, w, h)
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = reject
    img.src = svg64
  })
}
```

- [ ] **Step 2: `api.ts` 加 `exportReport`**(末尾)

```ts
export async function exportReport(format: 'docx' | 'pdf' | 'csv', req: any, scenarioName: string, treePng?: string): Promise<void> {
  const r = await fetch(`${BASE}/report?format=${format}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...req, scenario_name: scenarioName, tree_png: treePng ?? null }),
  })
  if (!r.ok) throw new Error(`report → ${r.status}`)
  const blob = await r.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `qra_report.${format}`
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
```

- [ ] **Step 3: `EventTreeEditor.tsx` 加导出**

import 加 `exportReport`(`../api`)、`svgToPng`(`../util/svgToPng`)。给最外层事件树 `<svg>` 一个 ref(`const svgRef = useRef<SVGSVGElement>(null)`;`<svg ref={svgRef} ...>`);import `useRef`。加状态 `const [expBusy, setExpBusy] = useState(false)`。处理:

```tsx
const onExport = async (fmt: 'docx' | 'pdf' | 'csv') => {
  setExpBusy(true); setQErr(null)
  try {
    const req = toEngineRequest(model, linked)
    let png: string | undefined
    if (fmt !== 'csv' && svgRef.current) png = await svgToPng(svgRef.current)
    await exportReport(fmt, { ...req, samples: 1000 }, model.initEvent, png)
  } catch (e: any) { setQErr(String(e?.message ?? e)) }
  finally { setExpBusy(false) }
}
```

按钮(放「深化分析」按钮下):
```tsx
<div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
  <span style={{ fontSize: 12, alignSelf: 'center' }}>导出报告:</span>
  {(['docx', 'pdf', 'csv'] as const).map((f) => (
    <button key={f} onClick={() => onExport(f)} disabled={expBusy}
      style={{ fontSize: 12, border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', padding: '4px 10px' }}>
      {f === 'docx' ? 'Word' : f.toUpperCase()}
    </button>
  ))}
</div>
```

- [ ] **Step 4: 构建** — `npm run build --prefix frontend` 通过(修 TS;`useRef` 已 import)。

- [ ] **Step 5: 重启预览并验证**
  - `preview_stop` 旧 → `preview_start` bess-app(载入 /api/report)。
  - `preview_eval`:进 ETA(默认),三个导出按钮在;直接 `fetch('/api/report?format=csv', {POST, body: 最小 et 请求})` 验 200 + 文本含 `C5`;`format=docx` 验 blob size>0 且前 2 字节 `PK`(`await (await fetch(...)).arrayBuffer()` 取头)。

- [ ] **Step 6: 提交**

```bash
git add frontend/src/util/svgToPng.ts frontend/src/api.ts frontend/src/components/EventTreeEditor.tsx
git commit -m "feat(frontend): 导出报告(Word/PDF/CSV), 事件树 SVG→PNG 嵌入"
```

## 收尾

- [ ] 全量回归 `... -m pytest -q`(≥121 + 新增,CUDD 仍 2 skip)。
- [ ] `npm run build --prefix frontend` 通过;预览端到端(三格式下载 200/正确头)。
- [ ] 更新 `docs/superpowers/ROADMAP.md`(报告导出 Word/PDF/CSV)。

## 自检(plan vs spec)

- spec 2.1 report_export(build_report_data/csv/docx/pdf + 着色)→ Task 1。
- spec 2.2 端点 + ReportRequest → Task 2。
- spec 2.3 前端 svgToPng + exportReport + 按钮 → Task 3。
- 类型一致:`build_report_data/report_csv/report_docx/report_pdf/_freq_band/_risk_level`、`ReportRequest`、`exportReport/svgToPng` 跨任务一致。
- 关键坑:CJK PDF 用 reportlab 内置 `STSong-Light`(失败回退 Helvetica+英文标签);docx 表样式用内置 `Table Grid`;改后端须重启预览 uvicorn。
