# FTA 页:自建 FTA 工作区 + 所有 FTA 目标可量化 — 设计文档

- 日期:2026-06-25 · 分支 `feat/fta-standalone-and-quantify`
- 状态:已确认(brainstorm:1 项澄清=自建 FTA 存项目文件,用户批准设计),待 spec 复核 → writing-plans
- 方法:纯前端(React + TS,vitest);多 agent 执行(frontend-dev / test-runner / code-reviewer)
- 交付:重建离线单文件 `bess-eta-standalone.html`

## 0. 目标(用户 2 条)

1. **挂载到 ETA 的 FTA 也能量化**:当前「量化」按钮 + 结果面板只在示例模型(`!ftIsEta`)出现;ETA 挂载 FTA 无量化按钮。→ 让量化按钮 + 结果(割集 / FV 重要度 / 热力)对**所有 FTA 目标**(示例 / ETA 挂载 / 自建)开放。
2. **FTA 页可新增 FTA**:新增「＋新增 FTA」按钮,创建**独立自建故障树**(可命名 / 编辑 / 量化),侧栏「自建 FTA」分组列出,**随项目文件导出 / 导入持久化**。

纯前端;引擎 / 后端 / MEF 契约不变;**暂不改界面风格**(沿用现有 `psa-*` 样式)。

## 1. 现状关键事实(已核对当前 main `5d05b22` 源码)

- `frontend/src/App.tsx`(678 行,UI 改版后):
  - FTA 页编辑目标 `ftEditTarget: { src:'model' } | { src:'eta'; name }`(L70);`ftIsEta` 派生(L322)。
  - 活动画布派生:`cvModel = ftIsEta ? (etFts.model ?? EMPTY_FTS) : model`、`cvFtName`、`cvSet/cvUndo/cvRedo/cvCanUndo/cvCanRedo`(L324-353)——画布 / 检视器 / 调色板 / 库选择器全走 `cv*`。
  - `onQuantify`(L95)写死 `quantify(model, ftName)`;`onCutsetClick`(L92)写死 `model`/`ftName`。
  - 工具栏「量化」按钮 + 热力 + 重置布局在 `{!ftIsEta && (…)}`(L494-500);右栏「量化结果」+ `ResultsPanel` 在 `{!ftIsEta && (…)}`(L542-548)。`FaultTreeCanvas` 的 `highlight={ftIsEta ? new Set() : highlight}`、`heat={!ftIsEta && heatOn && result …}`(L508-509)。
  - 侧栏(L410-444):「ETA 挂载 FTA」分组(按 ETA 分组)+「示例模型」分组。**无新增 FTA 按钮、无自建分组**。
  - `EMPTY_FTS: ModelJson = { model_data:{parameters:[]}, fault_trees:[] }`(模块级)。`model`/`etFts` 由 `useModel(null)`;有 `serializeProject`/`deserializeProject`/`projectFile` 持久化 ETA。
- `frontend/src/model.ts`:`ModelJson{ model_data:{parameters[]}, fault_trees: FaultTreeJson[] }`;`getFt(m,name)`、`addGate/addBasic/connect/deleteNode/updateNode/renameNode`、`attachStarterFt(fts, feId, failProb)`(建 name=feId 的 OR 门 + 1 基本事件 + 参数)、`uid(prefix)`。
- `frontend/src/project.ts`:`ProjectPayload{ v:2, etas, activeKey, checkedKeys }`;`serializeProject(etas, activeKey, checkedKeys)`、`deserializeProject(payload, fallbackName)`。`projectFile.ts` 不透明携带整个 payload(无需改)。
- `frontend/src/api.ts`:`quantify(model, fault_tree)` 走引擎(`/api/quantify`),离线不可用——**自建 FTA 量化需后端**(与示例模型量化同口径,本就如此)。

## 2. 设计

### 2.1 问题 1:所有 FTA 目标可量化

- **`onQuantify` / `onCutsetClick` 改用 `cvModel`/`cvFtName`**(取代写死的 `model`/`ftName`),并**下移定义到 `cv*` 派生之后**(当前在其之前,直接引用会前向引用报错)。`onQuantify`:`if (!cvTreeExists) return; setResult(await quantify(cvModel, cvFtName))`。`onCutsetClick`:`setHighlight(activatedNodes(getFt(cvModel, cvFtName), new Set(events)))`。
- **工具栏**:把「量化」按钮(+「重要度热力」复选)移出 `!ftIsEta`,对所有目标显示;「重置布局」保留 `!ftIsEta`(拖拽位仅示例持久 `ftPos`)。
- **画布**:`highlight={highlight}`、`heat={heatOn && result ? buildHeat(...) : undefined}`(去掉 `!ftIsEta` 门)。
- **右栏**:「量化结果」+ `ResultsPanel` 对所有目标显示(去掉 `!ftIsEta` 门);错误提示合并。
- 切换 FTA 目标时既有 `setResult(null)` 已清空结果(各行 onClick 已含)。

### 2.2 问题 2:自建 FTA 工作区(`model.ts` 纯函数 + App 状态 + 持久化)

**`model.ts` 新增纯函数(+ vitest):**
```ts
/** 在 m 追加一棵起始故障树(OR 门 + 1 基本事件 + 参数);name 唯一化;节点 id 用 uid 干净, FT 名用 name(可中文)。 */
export function addFaultTree(m: ModelJson, name: string): ModelJson
/** 按 name 删除一棵故障树(及仅被它引用的参数;被其他树引用的参数保留)。 */
export function deleteFaultTree(m: ModelJson, name: string): ModelJson
```
- `addFaultTree`:`name` 去空格 + 与现有 `fault_trees[].name` 去重(`name`/`name_2`…);新树 `{ name, top: uid('G'), nodes:[{id:uid('BE'),basic,param_ref}, {id:top,op:'or',args:[be]}] }` + 参数 `{id:be, kind:'probability', value:0.1}`。
- `deleteFaultTree`:移除该树;清理仅被它引用的 `param_ref` 参数(被其他树引用的保留)。

**App 状态 / 路由:**
- 新增 `const userFts = useModel(EMPTY_FTS)`(一份 ModelJson 承载全部自建树,参数共享)。
- `ftEditTarget` 增第三态 `{ src:'standalone'; name }`;派生 `ftIsStandalone`。
- `cvModel/cvFtName/cvSet/cvUndo/cvRedo/cvCanUndo/cvCanRedo` 三路由:standalone→`userFts.*`,eta→`etFts`/`etaSet`,否则 `model`/`set`。`cvTreeExists` 含 standalone 分支(`userFts.model.fault_trees` 命中)。
- `onAddFt`:`window.prompt('新建 FTA 名称', 默认)` → `userFts.set(addFaultTree(userFts.model ?? EMPTY_FTS, name))` → `setFtEditTarget({src:'standalone', name: 新树名})`。
- `onDeleteFt(name)`:`confirm` → `userFts.set(deleteFaultTree(...))`;若删的是当前目标则 `setFtEditTarget({src:'model'})`。

**侧栏(App FTA 左栏):**
- 新增「自建 FTA」分组(在「示例模型」前或后):一个「＋新增 FTA」按钮(`onAddFt`)+ 列出 `userFts.model.fault_trees`,行选中切 `{src:'standalone',name}`,行尾 × 删除(`stopPropagation`→`onDeleteFt`)。
- standalone 行高亮 `ftSidebarRow(ftIsStandalone && cvFtName===ft.name)`;样式沿用现有 `ftSidebarRow/ftSidebarGroup`。

### 2.3 持久化(存入项目文件)

- `project.ts`:`ProjectPayload` 增 `userFts?: ModelJson`;`serializeProject(etas, activeKey, checkedKeys, userFts?)` 写入(深拷贝);`deserializeProject` 返回 `userFts`(缺省 `EMPTY_FTS`,旧存档兼容)。
- App:`onSaveWorkspace`/`onSaveAs`/`onExportFile` 调 `serializeProject(..., userFts.model ?? EMPTY_FTS)`;`loadProject`/`onImportFile` 后 `userFts.reset(proj.userFts ?? EMPTY_FTS)`。
- `projectFile.ts` **不改**(不透明携带 payload)。

## 3. 跨切面 / 兼容

- 引擎 / 后端 / MEF 不变;自建 FTA 量化与示例同口径(`/api/quantify`,离线不可用,与既有一致)。
- 旧项目文件无 `userFts` → 反序列化得空 `EMPTY_FTS`,行为不变。
- `result`/`highlight`/`heatOn` 为三类目标共享;切换目标清空,量化按目标设值——无串扰(各 onClick 已 `setResult(null)`)。
- standalone 节点 id 用 `uid`(干净),FT 名用用户名(可中文,作选择 / 量化键,JS / JSON / 引擎请求按字符串键处理)。

## 4. 测试策略

- **vitest `model.ts`**:`addFaultTree`(追加树 / name 去重 / 起始 OR 门 + 基本事件 + 参数;不改原对象);`deleteFaultTree`(移除指定树 / 清理独占参数 / 保留共享参数 / 删不存在不抛)。
- **vitest `project.ts`**:`userFts` 往返(序列化 + 反序列化保留;旧 payload 缺 `userFts` → `EMPTY_FTS`)。
- **组件 / 集成(preview DOM)**:① 选 ETA 挂载 FTA → 出现「量化」按钮 → 点击得结果(割集 / 顶概率);② ＋新增 FTA → 侧栏「自建 FTA」出现新树、可编辑、可量化;③ 删除自建 FTA;④ 导出项目 → 导入 → 自建 FTA 还原。
- **回归**:`npm run test --prefix frontend` 全绿;`npm run build --prefix frontend` 干净;`.venv/Scripts/python.exe -m pytest -q` 无后端回归。

## 5. 范围 / 默认(已确认)

- 自建 FTA = **独立工作区(`userFts` 一份模型多棵树)+ 存入项目文件**(非仅会话、非加进示例模型)。
- 量化按钮 + 结果对**所有 FTA 目标**开放(示例 / ETA 挂载 / 自建)。
- **暂不改界面风格**;`RiskMatrix`/引擎/后端/MEF 不变。自建 FTA 重命名暂不做(创建时命名;如需后续加)。

## 6. 构建顺序(供 writing-plans)

1. `model.ts`:`addFaultTree` + `deleteFaultTree` + vitest(先红后绿)。
2. `project.ts`:`ProjectPayload.userFts` + 序列化 + vitest。
3. `App.tsx`:① `userFts` 状态 + `ftEditTarget` standalone + `cv*` 三路由;② `onAddFt`/`onDeleteFt` + 侧栏「自建 FTA」分组 + ＋按钮;③ `onQuantify`/`onCutsetClick` 改 `cvModel`/`cvFtName` 并下移 + 工具栏/画布/右栏量化对所有目标开放;④ 保存/读取/导入并入 `userFts`。
4. 回归 + `npm run bundle` 重建单 HTML + ROADMAP 记录。
