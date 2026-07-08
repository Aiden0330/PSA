# 报告导出纳入新内容(C1–C5 内涵 / 主导序列 Top-N / FTA)— 设计文档

- 日期:2026-06-22 · 分支 `feat/report-export-new-content`
- 状态:**已确认(FTA=文字/表格全后端算、Top-N=10、屏障重要度保持 C5),待 spec 复核**
- 方法:后端 TDD(pytest,`.venv/Scripts/python.exe -m pytest`);前端 build + 必要时 preview;每部分一 commit

## 0. 目标(用户 2026-06-22 同意的 🥈 + FTA)

在现有 QRA 报告(docx/pdf/csv)基础上**纳入新内容**:① ETA 自定义 **C1–C5 内涵** 文字;② **主导事故序列 Top-N**(序列/路径摘要/后果/频率);③ 每个挂载故障树的屏障的 **FTA 细节**(顶事件概率 + Top-N 最小割集 + 基本事件 FV)。保留现有:后果频率表、彩色风险矩阵、屏障 FV/RAW(C5)、不确定度带(p05/p50/p95)、事件树图、免责。FTA 与主导序列**全后端计算**(请求已携带 `fault_trees`),前端仅补两个小字段。

## 1. 现状关键事实

- `POST /api/report`([backend/app.py:47-71](backend/app.py)):`ReportRequest`(继承 `EtUncertaintyRequest`)→ `build_model_from_request(req)` 重建引擎 `Model` → `build_report_data(model,"TR",...)` → `report_csv/docx/pdf`。
- `ReportRequest` 已携带:`init_event/init_frequency/functional_events/sequences/consequence_bins/fault_trees/parameters`(`EtQuantifyRequest`)+ `samples/seed/error_factor` + `scenario_name/tree_png`。**未携带** `consequence_defs`(前端专属)与 barrier `labels`。
- `et_builder.build_model_from_request`([backend/et_builder.py](backend/et_builder.py)):每个功能事件都建一棵名为 `fid` 的故障树——`link_ft` 用真实 FT(`req["fault_trees"][name]`),否则建平凡单基本事件树。→ **模型已含全部 FT,FTA 内容可在引擎侧算**。
- `quantify_event_tree(model,"TR")`([psaengine/eta/sequence.py:36-60](psaengine/eta/sequence.py))逐序列遍历 `et.sequences`(有 `path`/`end_state`/freq/`consequence_of`),但**只返回聚合** `{sequences:{end_state:freq}, consequences:{Cx:freq}}`。
- 引擎单 FT 定量:`Analysis(model, fault_tree=fid)` → `.probability(method)`、`.cutsets(cutoff,limit_order)`(每项 `events/order/probability`)、`.importance(["fv","raw","birnbaum"])`(见 `/api/quantify` [app.py:27-36](backend/app.py))。
- `report_export.build_report_data` 现返回 `{consequences, bands, importance}`;`report_csv/docx/pdf` 渲染:后果频率表、风险矩阵、屏障 FV/RAW(`importance["C5"]`)、事件树图、免责。`_C_LABEL` 为**硬编码**后果中文短名(非 ETA 自定义内涵)。PDF 用 STSong-Light CJK。
- 前端 `toEngineRequest`([frontend/src/eventtree.ts:231-263](frontend/src/eventtree.ts))出 `functional_events:[{id,link_ft}|{id,pfd}]`,**无 label、无 consequenceDefs**。`exportReport(format,req,scenarioName,treePng)`([api.ts:129](frontend/src/api.ts))POST `{...req, scenario_name, tree_png}`。

## 2. 设计

### 2.1 请求扩展(两个小字段)

`schemas.ReportRequest` 新增(均给默认,后端容缺):
```python
consequence_defs: dict[str, str] = {}   # {"C1":"...","C5":"..."} ETA 自定义内涵
labels: dict[str, str] = {}             # {fe_id: 人类可读屏障名}
```
前端(`App.tsx` 报告导出处)在 `toEngineRequest(...)` 结果上合并:
```ts
consequence_defs: etModel.consequenceDefs ?? {},
labels: Object.fromEntries(etModel.functionalEvents.map(f => [f.id, f.label])),
```
经 `exportReport` 透传。FTA/主导序列**无需**前端改动。

### 2.2 新函数 `event_tree_sequences`(`psaengine/eta/sequence.py`)

不改 `quantify_event_tree`(被多处用),**新增**:
```python
def event_tree_sequences(model, et_name, fe_overrides=None) -> list[dict]:
    """逐序列明细, 按 frequency 降序。复用 _build_event_tree 与 exact_probability。"""
    # 每项: {"end_state","path":{fe_id:"success|failure"},"consequence","frequency"}
```
实现与 `quantify_event_tree` 主体同(同样 `for seq in et.sequences` 算 `p`、`freq=init*p`),但收集逐序列明细而非聚合,末尾 `sorted(key=frequency, reverse=True)`。

### 2.3 `report_export.build_report_data` 扩展

签名(关键字补充,向后兼容):
```python
def build_report_data(model, et_name="TR", *, consequence_defs=None, labels=None,
                      linked_fe_ids=None, samples=1000, seed=42, error_factor=3.0, top_n=10) -> dict
```
在现有 `{consequences,bands,importance}` 基础上加:
- `"consequence_defs"`: `{c: consequence_defs.get(c) or _C_LABEL[c] for c in _SEV}`(缺省回退硬编码)。
- `"sequences"`: `event_tree_sequences(model, et_name)[:top_n]`,每项补 `path_summary`(把 `{fe_id:branch}` 用 `labels` 渲成「屏障A✓ 屏障B✗」式短串;成功=✓ 失败=✗)。
- `"fta"`: 仅对 `linked_fe_ids` 中的 fid:
  ```python
  an = Analysis(model, fault_tree=fid)
  cuts = sorted(an.cutsets(cutoff=1e-12), key=lambda c: c.probability, reverse=True)[:top_n]
  fv = an.importance(measures=["fv"]).get("fv", {})  # {basic: fv}
  fta[fid] = {"label": (labels or {}).get(fid, fid),
              "top_prob": an.probability(method="exact"),
              "cutsets": [{"events": c.events, "order": c.order, "prob": c.probability} for c in cuts],
              "basics": sorted(({"event":k,"fv":v} for k,v in fv.items()), key=lambda x:x["fv"], reverse=True)[:top_n]}
  ```
  `linked_fe_ids` 由 `/api/report` 从 `req.functional_events` 里 `link_ft` 不空者取。

### 2.4 三格式渲染新章节(`report_csv/docx/pdf`)

统一新增章节,顺序见 §3。要点:
- **C1–C5 内涵**:并入后果频率表新增一列「内涵」(取 `data["consequence_defs"][c]`),或紧随其后一张 2 列定义表(docx/pdf 用列;csv 用附加块)。
- **主导事故序列 Top-N**:表头「# / 路径 / 后果 / 频率」;`path_summary` + `consequence` + `frequency`。
- **FTA(逐屏障)**:对每个 `data["fta"]` 项:小标题「FTA:<label>(顶概率 x.xxe-y)」+ 割集表(「# / 基本事件(∩) / 阶 / 概率」)+ 基本事件 FV 表(「基本事件 / FV」)。
- PDF 中文/英文双语沿用 `cn` 开关与 `font`;csv 用 BOM,新块以空行分隔。

### 2.5 `app.py /api/report` 接线

```python
dumped = req.model_dump()                      # 既有就用 model_dump 建模型, 沿用同一字典
linked_ids = [fe["id"] for fe in dumped["functional_events"] if fe.get("link_ft")]
data = rx.build_report_data(model, "TR", consequence_defs=req.consequence_defs,
        labels=req.labels, linked_fe_ids=linked_ids, samples=req.samples,
        seed=req.seed, error_factor=req.error_factor)
```
(统一用 `req.model_dump()` 的字典形态取 `functional_events`,避免 pydantic 模型/字典歧义。)

### 2.6 前端(`api.ts` + `App.tsx`)

`exportReport` 不改签名(`req:any`);在 `App.tsx` 调用处把 `consequence_defs`/`labels` 合并进 `req`(§2.1)。其余不动。

## 3. 报告新结构(章节顺序)

标题/场景 → 后果频率表(+**C1–C5 内涵**)→ 风险矩阵 → **主导事故序列 Top-N** → 屏障 FV/RAW(C5)+ 不确定度带(**保留**)→ **FTA(逐挂载屏障:顶概率 + Top-N 割集 + 基本事件 FV)** → 事件树图 → 免责。

## 4. 文件改动

**修改**:`backend/schemas.py`(ReportRequest +2 字段)、`psaengine/eta/sequence.py`(+`event_tree_sequences`)、`backend/report_export.py`(`build_report_data` 扩展 + 三渲染函数加章节)、`backend/app.py`(`/api/report` 接线)、`frontend/src/App.tsx`(报告请求合并 `consequence_defs`/`labels`)。
**新增测试**:`tests/backend/test_report_new_content.py`(或并入既有报告测试)。
**前端**:无新文件;`api.ts` 可不改(req 透传)。

## 5. 构建顺序与验收(TDD)

| # | 部分 | 验收 |
|---|---|---|
| 1 | `event_tree_sequences` + 测试 | 逐序列明细按 freq 降序;Σfreq 与 `quantify_event_tree` 的 consequences 总和一致(守恒);默认级联前若干主导序列后果合理 |
| 2 | `build_report_data` 扩展 + 测试 | 返回含 `consequence_defs`(缺省回退)、`sequences`(≤top_n、降序)、`fta`(仅 linked、含 top_prob/cutsets/basics);对一棵真实挂载 FT 的模型,`fta[fid].top_prob` 与 `Analysis.probability` 一致 |
| 3 | 三格式渲染加章节 + 测试 | docx/pdf 字节非空且能打开;csv 文本含「内涵」「主导事故序列」「FTA」块;新章节出现 |
| 4 | `schemas` + `/api/report` 接线 + 端点测试 | TestClient POST(docx/pdf/csv)200;传 `consequence_defs/labels` 后报告体含自定义内涵与屏障人名 |
| 5 | 前端合并字段 + build | `npm run build` 通过;preview:导出 docx/csv,内容含新章节(可 `preview_eval` 触发下载或抓请求体) |

全量:`.venv/Scripts/python.exe -m pytest -q`(≥137 + 新增,CUDD 仍 2 skip);`npm run build --prefix frontend` 通过。

## 6. 取默认值 / 风险

- **FTA=文字/表格全后端算**(已确认):零前端渲染负担;模型已携 FT。
- **Top-N=10**(已确认):模块常量 `TOP_N=10`(主导序列与每 FT 割集/基本事件共用)。
- **屏障重要度保持 C5**(已确认):不扩展到全 C1–C5;不确定度沿用后果带。
- **屏障人名**:经 `labels` 传入,新章节优先用 label,缺省回退 fid;现有 C5 重要度章节也复用同一回退助手(顺手一致,改动小)。
- **割集 cutoff**:报告用 `1e-12`(与引擎对拍同量级),避免漏主导割集;模型小,性能可接受(重头仍是 `event_tree_uncertainty` 蒙卡)。
- **容缺**:`consequence_defs/labels` 为空时全部回退现有硬编码/ fid,旧前端/旧存档照常出报告(向后兼容)。
- **范围边界**:报告不含 FTA 图(用户选文字/表格);引擎类计算仍后端(报告本就后端生成)。
