# 多 ETA 汇总到风险矩阵 + 故障树拖拽位置持久化 — 设计文档

- 日期:2026-06-21 · 分支 `feat/eta-aggregate-and-drag`
- 状态:**已确认(A 求和汇总;B 会话内位置),待 spec 复核**
- 方法:纯前端;build + `preview_eval`;两部分各自 commit。后端无改动。

## 0. 目标

A. 多 ETA 汇总:勾选多个 ETA,把各自后果频率 C1–C5 **按类求和**汇总到一张风险矩阵(全站总风险),并列贡献明细表。
B. 故障树手动拖拽位置持久化(会话内):结构编辑后不再被 dagre 重布覆盖。

## 1. 现状关键事实

- ETA 标签当前一次显示一个 `etModel`(下拉选 默认级联 / 5 预置 / 自定义 / 存档)。
- 各 ETA 后果频率来源:预置→`getBessEventTree(scenario)` 的 `.consequences`;默认→`getBessEventTree()`;自定义/存档→`quantifyEventTree(toEngineRequest(model, linked))` 的 `.consequences`(存档的 fts 在 `loadSaved` 的 `payload.fts`)。
- `RiskMatrix`(`components/RiskMatrix.tsx`)接受 `totals: Record<Cx, number>` 并落点着色——**可直接复用**于汇总。
- `layoutFaultTree(model, ftName)`(`layout.ts`)每次用 dagre 重算坐标;`FaultTreeCanvas` 用 React Flow(`useNodesState`,拖动经内部 state,但 pNodes 变化的 useEffect 会 setNodes(pNodes) 覆盖)。

## 2. 设计

### 2.1 Part A — 多 ETA 汇总(`components/MultiEtaAggregate.tsx` + App)

- `App` 构建可选 ETA 列表 `aggEtas: { key, name, resolve: () => Promise<Record<string, number>> }[]`:
  - 默认级联:`key='default'`,`resolve=() => getBessEventTree().then(d => d.consequences)`。
  - 每个预置:`key='scenario:'+id`,`resolve=() => getBessEventTree(id).then(d => d.consequences)`。
  - 每个自定义(`customEtas`):`resolve=() => quantifyEventTree(toEngineRequest(model)).then(r => r.consequences)`。
  - 每个存档(`saved`):`resolve=async () => { const r = await loadSaved(id); return (await quantifyEventTree(toEngineRequest(r.payload.etModel, { fault_trees: r.payload.fts.fault_trees, parameters: r.payload.fts.model_data.parameters }))).consequences }`。
- `MultiEtaAggregate({ etas })`(自管状态):`selected: Set<string>`、`totals`、`rows`、`busy`。勾选变化 → `Promise.all(选中.resolve())` → 各得 `{C1..C5}`;**逐类求和**得 `totals`;`rows=[{name, c1..c5}]`。渲染:勾选清单 + `<RiskMatrix totals={totals} />` + 贡献明细表(行=ETA、列 C1–C5、末行合计)。
- 放置:ETA 标签内**可折叠「多 ETA 汇总」面板**(默认折叠,置于单 ETA 编辑器上方),展开即用。`import { toEngineRequest }`、`quantifyEventTree`、`getBessEventTree`、`loadSaved`、`RiskMatrix`。
- 口径:**求和**(已确认);CONSEQUENCES=C1..C5。

### 2.2 Part B — 故障树拖拽位置持久化(会话内)

- `layout.ts`:`layoutFaultTree(model, ftName, positions?: Record<string, { x: number; y: number }>)`;dagre 照算,节点若在 `positions` 则用存的坐标覆盖,其余 dagre。
- `FaultTreeCanvas`:加 `onNodeDragStop?: (id: string, x: number, y: number) => void`;React Flow `onNodeDragStop={(_, n) => onNodeDragStop?.(n.id, n.position.x, n.position.y)}`。
- `App`(故障树标签):`const [ftPos, setFtPos] = useState<Record<string, Record<string, { x: number; y: number }>>>({})`;`graph = useMemo(() => layoutFaultTree(model, ftName, ftPos[ftName]), [model, ftName, ftPos])`;`FaultTreeCanvas` 加 `onNodeDragStop={(id, x, y) => setFtPos((m) => ({ ...m, [ftName]: { ...(m[ftName] ?? {}), [id]: { x, y } } }))}`;工具栏加「重置布局」`onClick={() => setFtPos((m) => ({ ...m, [ftName]: {} }))}`。
- 按 `ftName` 分桶;切算例/导入 MEF 自然隔离;会话内有效(刷新不留存,已确认)。范围:故障树标签主画布(模态暂不纳入)。

## 3. 文件改动

**新增**:`frontend/src/components/MultiEtaAggregate.tsx`。
**修改**:`frontend/src/App.tsx`(aggEtas 列表 + 折叠面板 + ftPos + 重置;故障树标签 onNodeDragStop)、`frontend/src/layout.ts`(positions 覆盖)、`frontend/src/components/FaultTreeCanvas.tsx`(onNodeDragStop)。

## 4. 构建顺序与验收

| # | 部分 | 验收(build + `preview_eval`) |
|---|---|---|
| A | 多 ETA 汇总 | 展开面板勾选 ≥2 个 ETA → 风险矩阵按求和落点;明细表行数=所选数+合计行;合计=各列求和 |
| B | 拖拽位置持久化 | 拖一个 FT 节点 → 加门(结构编辑)→ 被拖节点坐标保持(不回 dagre);「重置布局」→ 回 dagre |

全量:`pytest -q`(后端未动,≥132,CUDD 仍 2 skip);`npm run build --prefix frontend` 通过。

## 5. 取默认值 / 风险

- A 复用 `RiskMatrix`;求和口径(全站总风险);并行 resolve;存档 resolve 经 `loadSaved` + 引擎精确量化。
- A 面板默认折叠,不干扰单 ETA 编辑。
- B 会话内 map 按 ftName 分桶;React Flow 拖动后 pNodes 重算会带上存储坐标(被拖节点稳定)。
- 均纯前端;无后端/测试栈改动 → 预览无需重启(仅前端 build + reload)。
