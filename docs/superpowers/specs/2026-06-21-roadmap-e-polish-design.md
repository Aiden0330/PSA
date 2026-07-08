# ROADMAP E 小项打包(undo/redo · 重要度热力 · 图导出 · MEF 导入)— 设计文档

- 日期:2026-06-21 · 分支 `feat/roadmap-e-polish`
- 状态:**已确认 4 项范围,待 spec 复核**
- 方法:后端 TDD(仅 MEF 导入端点);前端 build + `preview_eval`;一项一 commit

## 0. 目标

ROADMAP E 净新增 4 个小项(CSV 导出/ETA 存盘已在前批完成,不含;拖拽位置持久化暂不含):
1. ETA 事件树 undo/redo;2. 故障树节点 FV/RAW 重要度热力着色;3. 事件树图导出 PNG/SVG;4. UI 内 MEF XML 导入。

## 1. 现状关键事实

- `useModel`(`useModel.ts`)= 通用历史 reducer(past/present/future + set/reset/undo/redo/canUndo/canRedo),但类型固定 `ModelJson`。
- App 的 `etModel` 现为 `useState`;在 loadEt/onLoadSaved/selectEta/onNewEta/onAttachFt/onDetachFt/onFtEdited/`setEtModel`(EventTreeEditor onChange)多处更新。
- 故障树标签:`quantify` 得 `result: QuantifyResult`,含 `importance: Record<string, Record<string, number>>`(由 `Analysis.importance(["fv","raw","birnbaum"])`);`FaultTreeCanvas` 已有 `highlight: Set<string>`(割集回溯着色)。
- `EventTreeEditor` 已有 `svgRef`(Task 7);`util/svgToPng.ts` 已有。
- MEF 读取:`psaengine/model/mef_xml.py::load_mef_xml(path) -> Model`(入参路径)。`json_io` 有 `fault_tree_to_dict`/`parameters_to_json`(序列化 Model→ModelJson)。

> 执行时需先确认:`importance` 的精确结构(measure→{event} 还是 event→{measure});`FaultTreeCanvas` 节点渲染(React Flow 自定义节点)如何按值上色;`mef_xml` 是否有字符串解析(无则端点写临时文件再 `load_mef_xml`)。

## 2. 设计

### 2.1 ETA undo/redo(`useHistory<T>` + App + EventTreeEditor)

- 泛化:`useModel.ts` 改为通用 `useHistory<T>(initial: T | null)`(reducer 逻辑不变,类型参数化);`export function useModel(initial) { return useHistory<ModelJson>(initial) }`(现有消费者不变)。
- App:`const etHist = useHistory<EventTreeModel>(null)`;`etModel = etHist.model`。所有 `setEtModel(x)`→ 结构编辑用 `etHist.set(x)`;加载类(loadEt/onLoadSaved/selectEta/onNewEta)用 `etHist.reset(x)`(清历史);`onFtEdited` 用 `set`。`set` 需支持「值或更新函数」→ 给 `useHistory` 的 `set` 增加 `(v: T | (prev)=>T)` 重载(onFtEdited/onAttachFt 用了函数式更新)。
- EventTreeEditor:`onChange` 即 `etHist.set`;ETA 工具栏(场景行附近)加 ↶/↷ 按钮(`disabled={!canUndo/!canRedo}`)。需把 `canUndo/canRedo/undo/redo` 传入或在 App 层放按钮。**放 App 的 ETA 工具栏**(App 持 etHist),避免给 EventTreeEditor 加多 prop。

### 2.2 故障树重要度热力着色(`FaultTreeCanvas` + App)

- App 故障树标签:量化后由 `result.importance` 取每基本事件 FV → `heat: Record<string, number>`(归一化到 0..1,按 max FV)。工具栏加「重要度热力」开关 `heatOn`。
- `FaultTreeCanvas` 加可选 `heat?: Record<string, number>`;基本事件节点在 `heat[id]` 存在时填色(绿 `#16a34a` → 红 `#dc2626` 线性插值,或分档),其余/门节点不变。与 `highlight`(割集)叠加规则:heat 仅作用基本事件填充,highlight 作描边,互不冲突。
- 取数:执行时确认 importance 结构;封装 `fvOf(importance, eventId)` 提取。

### 2.3 事件树图导出 PNG/SVG(`EventTreeEditor`)

- 「导出报告」行旁加「PNG / SVG」两按钮:
  - PNG:`svgToPng(svgRef.current)` → `<a download=event_tree.png>`。
  - SVG:`new XMLSerializer().serializeToString(svgRef.current)` → `Blob([...], 'image/svg+xml')` → 下载 `event_tree.svg`。
- 复用 Task 7 的下载模式(objectURL + 临时 `<a>`)。

### 2.4 UI 内 MEF XML 导入(后端端点 + 故障树标签)

- 后端 `POST /api/import/mef`(`UploadFile` 或 `{xml: str}` body):把内容写临时文件 → `load_mef_xml(tmp)` → `Model` → 序列化 `{"model": {model_data:{parameters: parameters_to_json}, fault_trees:[fault_tree_to_dict...], event_trees:[], ccf_groups:[]}, "fault_tree": <首个 FT 名>}`(与 `/api/model/{id}` 返回同形,前端可直接 `reset`)。
- 前端故障树标签工具栏加「导入 MEF XML」`<input type=file accept=".xml">`:读文件文本 → POST → `reset(resp.model)` + `setFtName(resp.fault_tree)`。
- `api.ts`:`importMef(xmlText) -> {model, fault_tree}`。
- **测试**:`tests/backend/test_mef_import_api.py` — 用现有 MEF 样例(或 `save`→读)POST,断言 200 + `model.fault_trees` 非空 + `fault_tree` 名存在。

## 3. 文件改动

**新增**:`frontend/src/useHistory.ts`(或就地泛化 `useModel.ts`);测试 `tests/backend/test_mef_import_api.py`。
**修改**:`frontend/src/useModel.ts`(委托 useHistory)、`frontend/src/App.tsx`(etHist + undo/redo 按钮 + heat 开关 + MEF 导入)、`frontend/src/components/FaultTreeCanvas.tsx`(heat 着色)、`frontend/src/components/EventTreeEditor.tsx`(PNG/SVG 按钮)、`frontend/src/api.ts`(importMef)、`backend/app.py`(/api/import/mef)、`backend/schemas.py`(若用 JSON body)。

## 4. 构建顺序与验收

| # | 项 | 验收 |
|---|---|---|
| 1 | ETA undo/redo | 改屏障 PFD/加屏障后 ↶ 还原、↷ 重做;加载/切场景清历史 |
| 2 | FT 热力着色 | 量化后开热力 → 基本事件按 FV 绿→红;关闭复原 |
| 3 | 图导出 | 点 PNG/SVG 触发下载(blob size>0;SVG 文本含 `<svg`) |
| 4 | MEF 导入 | 后端端点 200 返回含 fault_trees 的 model;前端上传后 FT 画布渲染该模型 |

全量:`pytest -q`(≥130 + MEF 导入测试,CUDD 仍 2 skip);`npm run build --prefix frontend` 通过;**改后端端点后重启 uvicorn 预览**。

## 5. 取默认值 / 风险

- undo/redo 用泛化历史 hook(DRY,复用成熟 reducer);load 类操作清历史(符合直觉)。
- 热力默认关闭、量化后可开;绿→红线性。
- MEF 导入返回与 `/api/model/{id}` 同形,前端复用现有 `reset` 路径。
- **坑**:`set` 需支持函数式更新(onFtEdited 等);改后端须重启预览;执行时先核实 importance 结构 / canvas 节点上色点 / mef 字符串解析。
- 拖拽位置持久化不在本批。
