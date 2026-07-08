# ETA/FTA 建模增强 — 设计文档

- 日期:2026-06-24 · 分支 `feat/eta-fta-modeling-enhancements`
- 状态:已确认(brainstorm:3 项关键澄清 + 用户批准设计),待 spec 复核 → writing-plans
- 方法:前端为主(React + TS,vitest);后端尽量不改(report 文字由前端透传);多 agent 执行(frontend-dev / test-runner / code-reviewer)

## 0. 目标

对储能 PSA 前端建模工具增 5 项能力(第 6 项为执行方式):

1. **初始事件频率三来源**(手工 / FTA / 产品维度)
2. **后果页签**:叶绑定到具体后果条目,一个等级(C1–C5)可挂多条后果
3. **FTA 页 ↔ ETA 联动**:FTA 页左栏列出 ETA 挂载的 FTA,选中即在画布编辑
4. **FTA 中间事件**:门(gate)带描述,渲染为门上方矩形
5. **产品维度**:单 Pack 电芯数 / 单系统 Pack 数 → 电芯失效率到初始事件的映射(并入第 1 项)
6. **多 agent 工作流执行**

**引擎契约(C1–C5 分箱、Open-PSA MEF 子集)保持不变;旧存档/旧前端向后兼容。**

## 1. 现状关键事实

- **ETA 模型** `frontend/src/eventtree.ts`:`EventTreeModel { initEvent, initFreq(手工数字), functionalEvents: FuncEvent[]{id,label,failProb,linkFt?,source?}, root: EtNode, consequenceDefs?: Record<'C1'..'C5', string> }`;叶 `{ kind:'leaf', consequence:'C1'..'C5' }`。屏障挂 FTA 经 `FuncEvent.linkFt`,其顶概率经 `/api/quantify` 回写为该屏障 `failProb`(PFD)。关键 helpers:`consDef / consequenceTotals / toEngineRequest`(`consequence_bins[end_state] = 叶 level`)/ `setConsequence / buildCascade / normalizeEta / layout`。
- **FTA 模型** `frontend/src/model.ts`:`FtNodeJson { id, basic?, house?, op?, args?, k?, state?, param_ref? }`;门仅有 `id`、**无描述字段**;**无中间事件节点类型**。`ModelJson { model_data.parameters, fault_trees[] }`。
- **App** `frontend/src/App.tsx`:顶层 4 个 tab(`bess` / `ft` / `params` / `library`)。FTA tab 现编辑独立示例模型(`current` + `getModel` → `model` useModel)。ETA 各屏障 FTA 存于第二个 useModel `etFts`,经全屏 `BarrierFtModal` 编辑。
- **后端**:`/api/quantify`、`/api/event-tree/*`;报告 `backend/report_export.py` + `ReportRequest{ consequence_defs, labels }`(前端已透传文字)。引擎 `quantify_event_tree` 按 `consequence_bins`(C1–C5)聚合。

## 2. 设计

### 2.1 初始事件频率:三来源互斥(功能 1 + 5)

**数据模型(eventtree.ts):**
- `EventTreeModel` 增:`initFreqSource?: 'manual' | 'ft' | 'product'`(缺省 `'manual'`);`product?: { cellsPerPack: number; packsPerSystem: number; cellFailureRate: number }`。
- 初始事件 FTA 复用屏障 FTA 机制:存于 `etFts` 的**保留键 `__init__`**(`FuncEvent.linkFt` 不直接适用初始事件,故用约定键)。
- `initFreq` 仍是全局唯一被读取的值;来源仅决定其**如何被算出**:
  - `manual` — 用户输入(现 `setInitFreq`)。
  - `ft` — `etFts.__init__` 经 `/api/quantify` 的顶值 → `initFreq`(作频率;稀有事件近似有效)。
  - `product` — `initFreq = cellFailureRate × cellsPerPack × packsPerSystem`(界面另显示「总电芯数 = cellsPerPack × packsPerSystem」)。
- 新 helpers:`setInitFreqSource(m, src)`、`setProduct(m, patch)`、`computeProductFreq(m): number`(纯函数,可测);`ft` 来源的重算在 App 侧触发(需异步量化)。

**UI(EventTreeEditor 初始事件面板):** 「来源」单选(手工 / FTA / 产品维度);
- manual → 频率输入(现有)。
- ft → 「挂载 / 编辑 FTA」按钮(开 `BarrierFtModal` 编辑 `__init__`)+ 显示算得顶值。
- product → 3 个输入(单 Pack 电芯数 / 单系统 Pack 数 / 电芯失效率)+ 显示总电芯数 + 派生 `initFreq`(只读)。

**触点:** `eventtree.ts`、`App.tsx`(`__init__` FTA 挂载 + 按 source 重算)、`EventTreeEditor.tsx`。
**向后兼容:** 旧模型无 `initFreqSource` → 视为 `'manual'`,`initFreq` 原值不变。

### 2.2 后果页签:叶绑定到具体后果条目(功能 2)

**数据模型:**
- `consequenceDefs?: Record<C, string>` → `consequences?: ConsequenceDef[]`,`ConsequenceDef = { id: string; desc: string; level: 'C1'|'C2'|'C3'|'C4'|'C5' }`。一个 `level` 可对应多条。
- 叶 `{ kind:'leaf', consequence: string }`:`consequence` 现存**后果条目 id**。约定:始终存在 5 条**默认条目** `id = 'C1'..'C5'`、`level = id`、`desc = DEFAULT_CONSEQUENCE_DEFS[id]`。旧叶存 `'C1'..'C5'` 即天然指向这 5 条默认条目 → 向后兼容。
- `normalizeEta` 迁移:旧 `consequenceDefs`(Record)→ 5 条默认条目(`id=level`,`desc` 取旧文字);并确保 5 条默认条目恒在(即便用户新增其它条目),使任何 `'C1'..'C5'` 叶都可解析。
- 新 helpers:`consLevel(m, consId): 'C1'..'C5'`(取条目 `level`;找不到条目则把 `consId` 当 level)、`consText(m, consId)`、`consEntries(m): ConsequenceDef[]`、`addConsequence / updateConsequence / delConsequence`。
- `consequenceTotals` 与 `toEngineRequest` 的 `consequence_bins` 改用 `consLevel(leaf.consequence)` → 引擎 / 风险矩阵仍按 C1–C5,**后端不变**。

**UI:**
- 新**顶层「后果」tab**(与 `bess`/`ft`/`params`/`library` 并列),编辑活动 ETA 的 `consequences` 列表(增 / 删 / 改 `desc` + `level` 下拉)。默认 5 条(C1–C5)**可改 `desc`,但 `id`/`level` 锁定、不可删**,以保证 C1–C5 始终可解析。
- 叶后果选择器(ETA 编辑器内):从 `consequences` 选条目(按 level 分组);叶下拉 / 悬浮显示「条目 desc(level)」。
- 报告:前端把每序列叶解析为 `labels[end_state] = consText`,`consequence_defs[level] = 该 level 各条目 desc 合并`;后端 `ReportRequest` 既有字段照用。

**触点:** `eventtree.ts`、`EventTreeEditor.tsx`、`App.tsx`(tab 导航 + 后果 tab 视图)、报告前端透传。
**向后兼容:** 旧存档 `consequenceDefs` + 叶 `'C1'..'C5'` 经 `normalizeEta` 迁移,显示与分箱不变。

### 2.3 FTA 页 ↔ ETA 联动(功能 3)

- FTA tab 增**左侧栏**,列活动 ETA 的挂载 FTA:各屏障 `linkFt` 对应的 `etFts` 故障树 + `__init__`(若有),以「屏障名 / 初始事件」标注。
- 选中某条 → FTA 画布**直接编辑 `etFts` 内该故障树**(与 ETA 共享同一 `etFts` → 改动即联动回 ETA)。独立示例模型作为另一分组保留。
- 画布编辑目标在「独立 `model`」与「`etFts` 内某 FT」之间切换,由左栏选择驱动;复用 `FaultTreeCanvas / Palette / Inspector`。

**触点:** `App.tsx`(FTA tab 左栏 + 画布数据源切换)。
**向后兼容:** 未选挂载 FTA 时 FTA tab 行为同现状(编辑示例模型)。

### 2.4 FTA 中间事件 = 门带描述(功能 4)

- 数据模型(`model.ts` `FtNodeJson`)门节点增 `label?: string`(描述 / 名称)。门渲染为「**中间事件矩形(显示 label)+ 其下门符号**」。
- `Palette` 新建门带默认 label;`Inspector` 编辑门 label;`layout.ts` / `FaultTreeCanvas.tsx` 渲染矩形 + 门符号。
- 引擎 / MEF 不受影响:`label` 仅前端显示;`load_mef_xml` / `save_mef_xml` 忽略 `label`(MEF round-trip 丢弃 label,可接受)。门无 label 时回退显示 `id`(同现状)。

**触点:** `model.ts`(`FtNodeJson.label` + `addGate` + `updateNode`)、`layout.ts` + `FaultTreeCanvas.tsx`、`Inspector.tsx`、(`Palette.tsx`)。
**向后兼容:** 旧 FT 门无 `label` → 显示 `id`。

### 2.5 产品维度(功能 5)

见 2.1 的 `product` 来源:`product = { cellsPerPack, packsPerSystem, cellFailureRate }`;`initFreq = cellFailureRate × cellsPerPack × packsPerSystem`;界面显示总电芯数。

## 3. 跨切面

- **引擎契约不变**:事件序列 / 分箱仍 C1–C5;MEF 子集不变;后端仅报告可能微调(优先前端透传文字,避免改后端逻辑)。
- **向后兼容 / 迁移**:`normalizeEta` 统一补 `initFreqSource='manual'`、`consequences`(默认 5 条 + 迁移旧 `consequenceDefs`);旧存档 / 旧前端照常工作。
- **持久化**:`project.ts` / `backend/storage.py` 把模型当不透明 JSON,新增字段自动随存(`serializeProject` 无需改;`normalizeEta` 在载入时补全旧档)。单文件离线版重新 `npm run bundle` 即带上。

## 4. 测试策略(TDD)

- **纯函数(vitest)`eventtree.ts`**:`computeProductFreq`;`consLevel`/`consText`;`normalizeEta` 迁移(旧 `consequenceDefs`→`consequences`;旧叶 `'C1'` 解析到默认条目);`consequenceTotals` 按 level 聚合;`toEngineRequest` 的 `consequence_bins = level`;`addConsequence/delConsequence`(默认 5 条不可删)。
- **纯函数(vitest)`model.ts`**:`addGate` 带 label、`updateNode` 改 label。
- **组件 / 集成**:以运行栈 + preview DOM 验证(初始事件来源切换重算;后果 tab 增删与叶选择;FTA 左栏选择 → 画布编辑 → 联动回 ETA;门矩形渲染)。
- **回归**:`pytest -q` 后端不回归;`tsc -b && vite build` 干净;`npm run test`(vitest)全绿。

## 5. 范围守卫 / 非目标

- 不改引擎核心 / MEF 读写子集 / 风险矩阵 C1–C5 语义。
- FTA-mode 初始频率按「顶值即频率」近似(非严格频率代数);大初值 / 非稀有时由用户自负。
- 门 `label` 不进 MEF(round-trip 丢弃);若需持久化进 MEF `attributes` 列为后续。
- 多 ETA 汇总、报告导出维持现契约(后果文字由前端解析透传)。

## 6. 构建顺序(供 writing-plans)

1. `eventtree.ts` 数据模型 + helpers + `normalizeEta` 迁移 + vitest(后果条目 / 初因来源 / 产品维度纯函数)。
2. 顶层「后果」tab + 叶后果选择器(`EventTreeEditor` / `App`)。
3. 初始事件三来源面板(`EventTreeEditor` / `App`;复用 `BarrierFtModal` 挂 `__init__`)。
4. `model.ts` 门 `label` + FTA 画布 / Inspector 渲染中间事件 + vitest。
5. FTA tab 左栏联动(`App`;编辑 `etFts` 内挂载 FTA)。
6. 回归 + 报告前端透传校正 + 文档 / memory。

## 7. 决策 / 默认(已确认)

- **中间事件 = 门加描述**(MEF 对齐),非独立矩形节点。
- **后果:叶绑定到具体后果条目**(一级多条);默认 5 条 `id=C1–C5` 锁 `level` 保兼容。
- **初始频率:手工 / FTA / 产品维度三选一**。
- 后果为顶层页签;FTA-mode 顶值作频率;门 `label` 前端专属(不进 MEF)。
