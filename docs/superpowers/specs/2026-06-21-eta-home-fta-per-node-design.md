# ETA 为中心:主页化 + 多 ETA + 每节点挂 FTA + 风险矩阵坐标互换 — 设计文档

- 日期:2026-06-21 · 分支:将新建 feature 分支
- 状态:**已确认方案 A(模态全画布 FTA 编辑器),待 spec 复核**
- 方法:TDD 思路 + 每部分一 commit;前端验证用 build + `preview_eval` DOM(本仓库前端无测试栈)

## 0. 目标(本批 1–4)

1. **风险矩阵坐标互换**:后果(严重度)放 X 轴,频率放 Y 轴。
2. **支持多 ETA**:ETA 工作台可在 5 个预置场景间切换,并可**新建自定义 ETA**。
3. **主页应为 ETA**:加载即落在 ETA 标签,且 ETA 为第一个标签。
4. **每个 ETA 节点挂 FTA 得到防护有效性**:每个屏障(功能事件)可挂载/编辑故障树(**复用现有故障树编辑器**),引擎算出其顶事件概率自动作为该屏障 PFD,有效性 = 1−PFD。

后续(用户指定顺序,各自独立 spec,不在本批):5 深化 QRA(不确定性带+真实重要度)→ 6 持久化 → 7 报告导出 → 8 库驱动编辑。

## 1. 现状关键事实

- **标签**(`App.tsx`):`tab: 'ft'|'bess'|'params'|'library'`,默认 `'ft'`;ETA(`'bess'`)在第三位,点击时惰性加载。
- **ETA 层**:`eventtree.ts`(`EventTreeModel`、`FuncEvent{id,label,failProb}`、`layout`、`consequenceTotals`、`toEngineRequest(model, linked)`)+ `EventTreeEditor.tsx`。`toEngineRequest` 已支持 `link_ft`+`fault_trees`+`parameters` 序列化,按「ftMap[fe.id].nodes.length>2」决定 link/pfd。
- **FT 编辑层**:`model.ts`(`ModelJson`、`FaultTreeJson`、`addGate/addBasic/connect/deleteNode/updateNode/setTop/updateParam`,操作签名均为 `(ModelJson, ftName, ...)`,**天然支持一个 ModelJson 多个命名 FT**)+ `useModel.ts`(撤销/重做 reducer)+ `FaultTreeCanvas/Palette/Inspector`。单 FT 定量:`quantify(model, ftName)`→`/api/quantify`→`{probability,...}`。
- **预置场景响应**:`/api/bess/event-tree?scenario=` 已返回 `fault_trees`(每屏障引擎 json)+ `parameters`。
- **引擎事件树端点**:`/api/event-tree/quantify` 入参 `{functional_events:[{id,pfd|link_ft}], fault_trees, parameters, sequences, consequence_bins}` → 精确否定。
- **风险矩阵**(`RiskMatrix.tsx`+`riskmatrix.ts`):当前 行=严重度 C5→C1、列=频率带 F1→F5;`riskLevel(sevRank,freqRank)` + `freqBandIndex`。
- **后端本批无需改动**:`/api/quantify`、`/api/event-tree/quantify` 均已就绪。

## 2. 设计

### 2.1 主页为 ETA + 多 ETA(req ②③)

- **标签顺序与默认**:`App.tsx` 标签改为 `ETA(事件树) | 故障树(可编辑) | 参数库/CCF | 参考库`;内部 `tab` 默认值改为 ETA;原 `'bess'` 标识保留(避免大改),按钮文案「BESS 事件树(ETA)」前置为第一个。
- **加载时机**:ETA 默认显示 → 在 `useEffect` 挂载时即 `loadEt(scenarioId)`(不再仅在点击时加载)。
- **多 ETA 注册表(内存)**:`etaList` = 预置(来自 `/api/bess/scenarios`)+ 本会话「新建」的自定义 ETA。下拉列出二者;选中 → 载入。
- **新建 ETA**:「+ 新建 ETA」按钮 → 输入名称 → `newBlankEta(name)` 生成空白级联(`initEvent=name`,`initFreq=1e-3`,2 个默认屏障 `failProb=0.1`,后果 `CONSEQUENCE_AT_DEPTH`)。自定义 ETA 存内存(刷新即失,持久化见任务 #6,本批不做)。

### 2.2 每节点挂 FTA → 防护有效性(req ④,方案 A 模态)

**数据模型**
- `FuncEvent` 增 `linkFt?: string`(指向 ETA 自带 `fts: ModelJson` 中的故障树名;约定 **FT 名 = fe.id**)。`linkFt` 存在 = 该屏障由故障树支撑。
- `App` 用**第二个 `useModel` 实例**持有 `fts: ModelJson`(所有屏障故障树 + 参数,自带撤销/重做);`model.ts` 现有操作按 `ftName` 作用于其中某棵,直接复用。
- 每屏障 PFD:算得 FT 顶概率后写 `pfds[id]` **并同步回写 `fe.failProb`**,使 `layout` 的前端积式与右栏显示一致;`linkFt` 仅作「是否挂 FT / 引擎用哪棵」的标志。`/api/event-tree/quantify` 仍用真实 FT 精确否定,故「前端积式(独立)vs 引擎精确」的 ▶ 差异在共享事件下依旧成立。

**加载预置 → 可编辑 FT**
- 预置响应的 `fault_trees{feId→ftjson}`+`parameters[]` 组装为 `fts = { model_data:{parameters}, fault_trees: Object.values(fault_trees) }`。
- 非平凡 FT(`nodes.length>2`)的屏障置 `fe.linkFt=fe.id`(于是 B_BMS/B_OFFGAS 的故障树可点开查看/编辑);平凡(2 节点)屏障保持直接 PFD(`failProb=fe_prob`)。

**挂载 / 改回**
- 直接 PFD 屏障「挂载 FTA」:在 `fts` 建启动 FT(名=fe.id,`OR` 门 + 1 基本事件,参数 = 当前 `failProb`),置 `fe.linkFt=fe.id`。
- 「改回直接 PFD」:清 `fe.linkFt`(FT 暂留),用 `failProb`。

**编辑(方案 A 模态)**
- 选中屏障 → 右栏「直接 PFD ↔ 挂载 FTA」开关 + 当前 PFD/有效性 + 「编辑故障树」。
- 「编辑故障树」→ 全屏**模态**:复用 `FaultTreeCanvas`(可编辑)+`Palette`+`Inspector`,绑定 `fts` 与 `ftName=fe.linkFt`,经第二个 `useModel` 的 `set/undo/redo` 操作;「完成」关闭。
- 关闭模态(及 ETA 量化前)对该屏障调 `quantify(fts, ftName)` → `probability` → 写 `pfds[id]`;右栏显示 **PFD=pfds[id]、有效性=1−PFD**。

**ETA 定量**
- `toEngineRequest(etModel, { fault_trees: fts.fault_trees, parameters: fts.model_data.parameters })` 改为**按 `fe.linkFt` 判定** link/pfd(不再按节点数);`link` 屏障输出 `{id, link_ft: fe.id}` 并带上名为 fe.id 的 FT;其余 `{id, pfd: failProb}`。走现有 `/api/event-tree/quantify` → 精确否定(跨屏障共享基本事件仍精确,▶ 差异保留)。

### 2.3 风险矩阵坐标互换(req ①)

- `RiskMatrix.tsx` 转置:**列 = 严重度 C1→C5(左→右)**;**行 = 频率带 F5→F1(上→下,频率越高越靠上)**。
- 表头行 = C1..C5(后果标签);行首 = 频率带名。单元格 (频率行 r, 严重度列 s):色 = `riskLevel(SEV_RANK[s], freqRankOf(r))`(`freqRank = bandIndex+1`,逻辑与配色不变)。
- 每个后果 Cx 落点 = (行=其频率带 `freqBandIndex(total)`,列=其严重度);标记数值。
- `riskmatrix.ts` 增导出 `SEVERITY_ASC=['C1'..'C5']`(列序);`SEVERITY`(降序)保留不影响他处。

## 3. 文件改动

**前端(本批仅前端)**
- `App.tsx`:默认 ETA + 标签前置;挂载即 `loadEt`;`etaList`(预置+自定义)+「新建 ETA」;第二个 `useModel` 持 `fts`;`pfds` 缓存与重算;把 `fts`/`pfds`/编辑回调传入 `EventTreeEditor`。
- `eventtree.ts`:`FuncEvent.linkFt`;`toEngineRequest` 改按 `linkFt`;`newBlankEta(name)`;`starterFt(failProb)`/`attachFt`/`detachFt` helper;`pfdOf(fe, pfds)`。
- `components/EventTreeEditor.tsx`:屏障 PFD/FTA 开关 + 有效性显示;「编辑故障树」模态(复用 `FaultTreeCanvas`+`Palette`+`Inspector`);用 `pfds` 参与积式频率与标签;关闭模态重算 PFD。
- `components/RiskMatrix.tsx`:转置坐标。
- `riskmatrix.ts`:加 `SEVERITY_ASC`。
- `api.ts`:复用 `quantify(model, ftName)` 取单 FT 顶概率(必要时加薄封装 `ftProbability`)。

**后端**:无改动。

## 4. 构建顺序与验收

| # | 部分 | 验收(build + `preview_eval`) |
|---|---|---|
| 1 | 风险矩阵互换 | 列=C1→C5、行=F5→F1;各 Cx 落点 (频率行, 严重度列) 正确 |
| 2 | 主页为 ETA + 标签前置 + 挂载即载 | 打开直接在 ETA;ETA 为第一标签 |
| 3 | 多 ETA + 新建 | 「新建 ETA」生成自定义项,下拉可选并可编辑 |
| 4 | 节点挂 FTA(方案 A) | 选屏障→挂载/编辑 FT(模态画布)→完成→显示 PFD=FT 顶概率、有效性=1−PFD;ETA 量化采用之;预置 B_BMS 的 FT 可点开;共享事件 ▶ 差异仍在 |

每部分一 commit;全部完成后 `npm run build --prefix frontend` 通过、后端 `pytest -q` 仍全绿(本批不动后端,应不变)。

## 5. 取默认值与风险

- **方案 A**:模态全屏 FT 编辑器(已确认)。
- **自定义 ETA 内存态**:本批不持久化(任务 #6)。
- **N 次 `/api/quantify`**:每个 FTA 屏障一次取顶概率(屏障数 ≤ 个位数,可接受;后续可批量化)。
- **两个 `useModel` 实例**:故障树标签的模型 与 ETA 的 `fts` 各一,互不干扰。
- **FT 名 = fe.id 约定**:贯穿挂载/序列化/引擎查找,避免名错配。
