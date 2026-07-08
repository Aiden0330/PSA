# QRA 报告导出(Word / PDF / CSV)— 设计文档

- 日期:2026-06-21 · 分支 `feat/report-export`
- 状态:**已确认(含事件树图、一键重算导出、三格式),待 spec 复核**
- 方法:后端 TDD;前端 build + `preview_eval`;每部分一 commit
- 依赖:`python-docx`、`reportlab`、(CSV 用 stdlib)均**已装于 `.venv`**,无需新增。

## 0. 目标(任务 7)

把当前 ETA 的分析一键导出为报告:Word(.docx)/ PDF / CSV。后端由当前 ETA **重算**量化 + 不确定性 + 重要度后生成;Word/PDF 含**嵌入的事件树图**(前端 SVG 栅格化上传)与彩色风险矩阵;CSV 为纯数据。

## 1. 现状关键事实

- 引擎已具备:`quantify_event_tree`(后果频率)、`event_tree_uncertainty`(C1–C5 p05/p50/p95)、`barrier_importance_exact`(按后果 FV/RAW)。`backend/et_builder.build_model_from_request` 由前端 `EtQuantifyRequest` 构 `Model`。
- 风险矩阵着色逻辑在前端 `frontend/src/riskmatrix.ts`(`FREQ_BANDS`、`SEV_RANK`、`riskLevel`、配色);报告需在 Python 复刻一小段。
- `bess/report.py` 已有 markdown 报告(默认 TR),但硬编码默认模型;本任务面向任意 ETA、富格式,独立新模块。
- `EventTreeEditor.tsx` 用 SVG 画事件树(可序列化栅格化)。

## 2. 设计

### 2.1 后端 `backend/report_export.py`

```python
def build_report_data(model, et_name="TR", samples=1000, seed=42, error_factor=3.0) -> dict:
    # 复用三引擎函数, 聚合:
    # {"consequences": {Cx: point}, "bands": {Cx:{p05,p50,p95}},
    #  "importance": {Cx:[{barrier,fv,raw}]}, "barriers": [fe.id...]}

# 风险矩阵着色(复刻 riskmatrix.ts):
FREQ_BANDS = [("F1","极不可能",1e-6),("F2","不可能",1e-4),("F3","偶尔",1e-2),("F4","可能",1.0),("F5","频繁",inf)]
SEV = ["C1","C2","C3","C4","C5"]
def _freq_band(f)->int; def _risk_level(sev_rank, freq_rank)->str  # low/medium/high/extreme
_RISK_HEX = {"low":"16a34a","medium":"eab308","high":"f97316","extreme":"dc2626"}

def report_csv(data) -> bytes        # stdlib csv: 后果点估计/p05/p50/p95 + 各后果 FV/RAW
def report_docx(data, scenario_name, tree_png: bytes|None) -> bytes   # python-docx
def report_pdf(data, scenario_name, tree_png: bytes|None) -> bytes    # reportlab
```

- **docx**:`Document()` → 标题 + 场景名 + 后果频率表(后果/点估计/p05/p50/p95)+ 风险矩阵彩色表(行=频率 F5→F1、列=后果 C1→C5,单元格底纹 = `_risk_level` 颜色,落点格标数值;经 `w:shd` XML 设底纹)+ 屏障 FV/RAW 表(按后果分节,默认列 C5)+ `add_picture(BytesIO(tree_png))`(有则)+ 免责声明段。`doc.save(BytesIO)` → bytes。
- **pdf**:`SimpleDocTemplate(BytesIO)` + platypus:`Paragraph` 标题/场景 + `Table`(后果频率)+ 风险矩阵 `Table`+`TableStyle`(`BACKGROUND` 按格着色)+ 重要度 `Table` + `Image(BytesIO(tree_png))`(有则,按页宽缩放)+ 免责 `Paragraph`。`build()` → bytes。
- **csv**:两段——后果频率(Cx,point,p05,p50,p95)+ 重要度(consequence,barrier,fv,raw)。UTF-8 BOM 便于 Excel 中文。

### 2.2 端点(`backend/app.py` + `schemas.py`)

```python
class ReportRequest(EtUncertaintyRequest):     # 含 samples/seed/error_factor
    scenario_name: str = "ETA"
    tree_png: Optional[str] = None             # dataURL 'data:image/png;base64,...'

# POST /api/report?format=docx|pdf|csv
#   build_model_from_request(req) → build_report_data → report_{fmt}
#   返回 Response(content=bytes, media_type=..., headers={Content-Disposition: attachment; filename=...})
#   csv → text/csv; docx → ...wordprocessingml...; pdf → application/pdf
#   format 非法 → 400
```

`tree_png` 解析:剥 `data:image/png;base64,` 前缀后 `base64.b64decode`;CSV 忽略图。

### 2.3 前端(`frontend/src/util/svgToPng.ts` + `api.ts` + `EventTreeEditor.tsx`)

- `svgToPng(svg: SVGSVGElement): Promise<string>`:序列化 `XMLSerializer` → `data:image/svg+xml`(含 width/height)→ `new Image()` → 画到 `canvas`(白底)→ `canvas.toDataURL('image/png')`。
- `api.ts`:`exportReport(format, req, scenarioName, treePng?)`:`fetch('/api/report?format='+format, POST json{...req, scenario_name, tree_png})` → `blob()` → 创建 objectURL + 临时 `<a download=报告.fmt>` 点击下载。
- `EventTreeEditor.tsx`:加「导出报告」+ 三格式按钮(或下拉)。点击:`const svg = 本组件 svg 元素`;Word/PDF → `png=await svgToPng(svg)`,CSV → `png=undefined`;`req=toEngineRequest(model, linked)`;`exportReport(fmt, {...req, samples:1000}, model.initEvent, png)`。

### 2.4 文件改动

**新增**:`backend/report_export.py`;`frontend/src/util/svgToPng.ts`;测试 `tests/backend/test_report_export.py`、`tests/backend/test_report_api.py`。
**修改**:`backend/schemas.py`(ReportRequest)、`backend/app.py`(/api/report)、`frontend/src/api.ts`、`frontend/src/components/EventTreeEditor.tsx`。

## 3. 构建顺序与验收

| # | 部分 | 验收 |
|---|---|---|
| 1 | `report_export.py` + 单测 | `report_csv` 文本含各 Cx 与点估计;`report_docx` 以 `PK\x03\x04` 开头;`report_pdf` 以 `%PDF` 开头;均非空;着色函数边界(`_freq_band`/`_risk_level`) |
| 2 | `/api/report` 端点 + schemas | TestClient 小算例:三 format 各 200 + 正确 `Content-Type` + 附件头;非法 format 400;带 `tree_png` 的 docx 能嵌图(字节更大/不报错) |
| 3 | 前端 svgToPng + 导出按钮 | build 通过;`preview_eval`:按钮在;`exportReport('csv',...)` fetch 返回 blob size>0 且文本含 `C5`;docx fetch blob size>0 |

全量:`pytest -q`(≥121 + 新增,CUDD 仍 2 skip);`npm run build --prefix frontend` 通过;**改后端端点后重启 uvicorn 预览**。

## 4. 取默认值 / 风险

- 三格式后端生成、一键重算、含事件树图(均已确认);CSV 无图。
- 事件树图:前端 SVG→PNG 上传(复用渲染);CSV 跳过。
- 风险矩阵着色逻辑在 Python 复刻 `riskmatrix.ts`(小段,标"示意默认");后续若两端口径要统一可再抽。
- 报告含免责声明(参考量级、须项目校核)。
- 二进制响应用 `fastapi.Response(content=bytes,...)`;文件名含场景名(ASCII 安全化避免头部编码问题)。
- **坑**:改后端须重启预览 uvicorn(本会话惯例)。
