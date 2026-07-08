# 库驱动编辑(从参考库选条目入树)— 设计文档

- 日期:2026-06-21 · 分支 `feat/library-driven-editing`
- 状态:**已确认范围=ETA 屏障 + FT 基本事件,待 spec 复核**
- 方法:前端为主,build + `preview_eval`;每部分一 commit。后端无改动。

## 0. 目标(任务 8 · 末项)

从参考库一键把条目加入模型,自动带入数值 + 名称 + 来源:
- **ETA 屏障**:从 `barrier_effectiveness` 选 → 新功能事件(label=名称、failProb=pfd、记 source)。
- **FT 基本事件**:从 `component_failure_rates` 选 → 新基本事件(value=rate、记 source + 单位)。

对齐参考工具 `D:\ETA_claude` 的「从内置库选择条目(自动带入数值与来源)」。

## 1. 现状关键事实

- `/api/bess/library` 已返回 `barrier_effectiveness`(`{id,name,category,pfd,source:{citation,note?}}`)与 `component_failure_rates`(`{id,name,failure_mode,rate,unit,source}`)。`api.ts::getLibrary` 已有,`ReferenceLibrary.tsx` 在用。
- ETA 编辑:`eventtree.ts` `FuncEvent{id,label,failProb,linkFt?}` + `addFe`;`EventTreeEditor.tsx`。
- FT 编辑:`model.ts` `addBasic(m,ftName,value)`(基本事件 id 用 `uid('BE')`,参数 `{id,kind:'probability',value}`);`BarrierFtModal.tsx`(ETA 屏障故障树)与 App 故障树标签都用 `Palette`/`FaultTreeCanvas`/`Inspector`。
- `ParamJson` 支持任意附加键(`[k:string]:any`),可放 `source`。`Inspector` 展示参数(若展示 source 需小改;否则 source 仅入模型/存档)。
- 库小(~10 屏障、~5 器件)→ 内联 `select` 选择器即可,无需带搜索的模态浏览器。

## 2. 设计

### 2.1 数据流(`App.tsx`)

挂载时 `getLibrary()` → `lib` state(`LibraryData|null`)。把 `lib?.barrier_effectiveness ?? []` 与 `lib?.component_failure_rates ?? []` 传入 `EventTreeEditor`(再透传给 `BarrierFtModal`)与 App 故障树标签工具栏。

### 2.2 ETA 屏障(`eventtree.ts` + `EventTreeEditor.tsx`)

- `FuncEvent` 增 `source?: string`。
- `addBarrierFromLib(m, b)`:`b={id,name,pfd,source}`;新 FuncEvent `{id: uniq(b.id, 现有 ids), label: b.name, failProb: b.pfd, source: b.source}`(重名加 `_2`…)。
- `EventTreeEditor`:右栏「功能事件」区上方加「从库添加屏障 ▾」`select`(option=屏障名,value=屏障 id);`onChange` → `onChange(addBarrierFromLib(model, 选中条目))`,随后复位 select。屏障面板/选中节点处显示该 FE 的 `source`(若有)。
- 新 prop:`libBarriers?: {id,name,pfd,source:{citation}}[]`(由 App 传)。

### 2.3 FT 基本事件(`model.ts` + `LibPicker` + 模态/FT 标签)

- `addBasicFromLib(m, ftName, c)`:`c={id,name,rate,unit,source}`;新基本事件 id `uniq(c.id, 节点 ids)`,节点 `{id, basic:true, param_ref:id}`,参数 `{id, kind:'probability', value:c.rate, source:`${c.source.citation}(${c.unit})`}`。**不做单位换算**(/demand 即概率,/h 等须自行校核——经 source 标注单位提示)。
- 新组件 `components/LibPicker.tsx`:`{ items: {id,name,unit?}[]; label: string; onPick(id) }` → 一个 `select`,选后回调并复位。模态与 FT 标签共用。
- `BarrierFtModal`:工具栏(Palette 旁)加 `LibPicker`(器件库)→ `api.set(addBasicFromLib(model, ftName, 条目))`。需新 prop `libComponents`。
- App 故障树标签工具栏:同样加 `LibPicker`(器件库)→ `set(addBasicFromLib(model, ftName, 条目))`。
- 选择器旁注:「值为库列数值;/demand 即概率,/h·/cell·yr 等须按任务时间/口径自行校核」。

### 2.4 不做

- 单位→概率自动换算(避免误导;沿用「参考量级须校核」)。
- 后端改动(库端点已在)。

## 3. 文件改动

**新增**:`frontend/src/components/LibPicker.tsx`。
**修改**:`frontend/src/eventtree.ts`(`FuncEvent.source` + `addBarrierFromLib` + `uniqId` 助手)、`frontend/src/model.ts`(`addBasicFromLib`)、`frontend/src/App.tsx`(取 library + 传参 + FT 标签 LibPicker)、`frontend/src/components/EventTreeEditor.tsx`(屏障库选择器 + 源展示 + 透传 libComponents 给模态)、`frontend/src/components/BarrierFtModal.tsx`(器件 LibPicker)。

## 4. 构建顺序与验收

| # | 部分 | 验收(build + `preview_eval`) |
|---|---|---|
| 1 | `addBarrierFromLib`/`addBasicFromLib`/`uniqId` 纯函数 + `FuncEvent.source` | 构建通过;逻辑(重名加后缀、值/源带入)正确 |
| 2 | App 取库 + 传参;`LibPicker` | 库数据到达编辑器(选择器有选项) |
| 3 | ETA 屏障库选择器 | 选库屏障 → 功能事件 +1,label=库名、pf=库 PFD,面板显来源 |
| 4 | FT 器件库选择器(模态 + FT 标签) | 选库器件 → 基本事件 +1,值=库 rate,Inspector/参数含 source(含单位) |

全量:`pytest -q`(后端未动,≥130 绿);`npm run build --prefix frontend` 通过。

## 5. 取默认值 / 风险

- 内联 `select` 选择器(库小);源记入模型/存档(随 Task 6 持久化一并保存)。
- 器件 rate 不换算,单位入 source 标注;诚实声明须校核。
- `FuncEvent.source`、参数 `source` 为元数据,不影响引擎定量;`toEngineRequest` 忽略之;存档 payload 自然包含(在 etModel/fts 内)。
- 重名 id 加后缀避免冲突(ETA path 键 / FT 节点 id 唯一)。
