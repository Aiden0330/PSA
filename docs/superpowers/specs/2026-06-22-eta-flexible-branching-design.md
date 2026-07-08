# ETA 编辑器:有序可跳过分支 + 屏障增删 + 初始事件布局修复 — 设计文档

- 日期:2026-06-22 · 分支 `feat/eta-flexible-branching`
- 状态:**设计已认可(用户「继续」),待 spec 复核**
- 方法:前端为主(`eventtree.ts` 模型 + 纯函数、`EventTreeEditor.tsx` UI、`App.tsx` 接线);后端仅新增 1 条守护性 pytest(引擎已支持子集路径,逻辑不改)。
- 验证:`npm run build`(tsc 类型)+ `preview_eval` DOM/SVG 断言 +`pytest -q`(≥135 仍过)。前端无单测框架(`build = tsc -b && vite build`),沿用本会话既有的 build + preview 验证范式。

## 0. 目标(用户原话三项)

1. **「ETA 初始事件与后续事件序列在页面上重合」** → 布局修复:初始事件标签/频率不再与第一屏障列表头重叠。
2. **「选中节点应支持继续到后续任意一个被选的屏障」** → 分支模型从"按深度定屏障"改为"每分支显式记 feId、可跳到任意更靠后屏障"(有序可跳过)。
3. **「支持屏障的删减操作」** → 功能事件列表支持删除;删除被分支引用的屏障时,确认后把引用分支折叠为末态。

## 1. 现状关键事实(已核查)

- `eventtree.ts`:`EtNode` 分支 = `{kind:'branch', success, failure}`,**不带屏障引用**;所判定屏障由节点**深度**隐式决定(`functionalEvents[depth]`)。
  - `branchLeaf(m, path)`:把叶变成分支,`if (path.length >= functionalEvents.length) return m`(只能到 depth+1 的屏障)。
  - `layout(m, rowH, headerH)`:`walk` 用 `m.functionalEvents[depth].failProb` 乘积;分支 `successY/failureY`,渲染假设子节点恰在 `depth+1` 列。`maxDepth = functionalEvents.length`。
  - `toEngineRequest`:`walk` 用 `m.functionalEvents[depth].id` 作 path 键,逐叶 DFS(成功优先)→ `L0,L1,…`。
  - `consequenceTotals`:基于 `layout` 叶频率求和(不直接依赖 depth 假设)。
  - `buildCascade(fes, consAtDepth)`:按深度建满级联(每分支隐式 = fes[d])。`newBlankEta` 经它建 2 屏障级联。
- `EventTreeEditor.tsx`:
  - 渲染常量 `rowH=46, headerH=64, colW=150, LEFT=90`;`colX(d)=LEFT+d*colW`。
  - 初始事件:名称 `x=8 y=26`、频率 `x=8 y=42`(左上角文本块);根连接线 `(8, rootY)→(colX(0)=90, rootY)`。
  - 屏障列表头:`colX(d)` 居中,`y=22/37/51`(与初始事件同处顶部带)。**LEFT=90 仅留 ~82px**,常规长度 BESS 事件名右伸即压到 FE1 列头 → 即"重合"。
  - 选中叶:按钮"在此继续到下一屏障 ▸" → `branchLeaf(model, sel!)`(无 feId 选择)。
  - 功能事件列表:label + failProb 可编辑;**只有 +添加屏障 / 从库加屏障,无删除**。
  - 选中分支侧栏:`selIdx = sel!.length`、`selFeId = functionalEvents[selIdx].id`(depth 派生),据此显示来源/PFD/挂 FTA。
- 引擎 `psaengine/eta/sequence.py::quantify_event_tree`:`for fe_id, branch in seq["path"].items()` —— **只处理每序列 path 中出现的 FE**。故省略中间 FE 的子集路径**已被支持**;`backend/et_builder.py` 把每 FE 建平凡/链接 FT,sequences 原样透传。**后端无需改**。
- `App.tsx`:场景经 `loadEt` → `buildCascade(fes, CONSEQUENCE_AT_DEPTH)`(L102);自定义经 `newBlankEta`(L121);存档经 `onLoadSaved` 读 `rec.payload.etModel`(L137)。多 ETA 汇总:**场景**的 consequences 取后端 `getBessEventTree(id).consequences`(L167,不依赖前端树结构),自定义/存档用前端 `consequenceTotals`。

## 2. 设计

### 2.1 数据模型与纯函数(`eventtree.ts`)

**分支节点新增 `feId`:**
```ts
export type EtNode =
  | { kind: 'branch'; feId: string; success: EtNode; failure: EtNode }
  | { kind: 'leaf'; consequence: string }
```
- **不变量(有序可跳过)**:沿任一 root→节点路径,各分支 `feIndex` 严格递增。`feIndex(m, feId)=functionalEvents.findIndex(f=>f.id===feId)`。
- 含义:某分支可判定任一 `feIndex > 祖先最大 feIndex` 的屏障 → "后续任意",跳过中间者合法(该屏障在此路径不被挑战,标准事件树语义)。

**`buildCascade` 改为写 feId**(满级联即 feId=fes[d].id):
```ts
export function buildCascade(fes: FuncEvent[], consAtDepth: string[]): EtNode {
  function build(d: number): EtNode {
    if (d >= fes.length) return { kind: 'leaf', consequence: consAtDepth[fes.length] ?? 'C5' }
    return { kind: 'branch', feId: fes[d].id,
      success: { kind: 'leaf', consequence: consAtDepth[d] ?? 'C1' }, failure: build(d + 1) }
  }
  return build(0)
}
```

**`normalizeEta`(旧存档补 feId,按深度):**
```ts
export function normalizeEta(m: EventTreeModel): EventTreeModel {
  function fix(n: EtNode, depth: number): EtNode {
    if (n.kind === 'leaf') return n
    const feId = (n as any).feId ?? m.functionalEvents[depth]?.id ?? `FE${depth + 1}`
    return { kind: 'branch', feId, success: fix(n.success, depth + 1), failure: fix(n.failure, depth + 1) }
  }
  return { ...m, root: fix(m.root, 0) }
}
```
> 旧树是满级联,depth 即原 feIndex,补出的 feId 与原语义一致。已带 feId 的树幂等。

**祖先最大 feIndex / 后续可选 FE:**
```ts
/** 沿 path 收集祖先分支已判定的最大 feIndex;根(空 path)返回 -1。 */
export function maxAncestorFeIndex(m: EventTreeModel, path: string[]): number {
  let n: EtNode = m.root, mx = -1
  for (const step of path) {
    if (n.kind !== 'branch') break
    mx = Math.max(mx, feIndex(m, n.feId))
    n = step === 'success' ? n.success : n.failure
  }
  return mx
}
/** 该节点可分支到的后续屏障(index 严格大于祖先最大)。 */
export function subsequentFes(m: EventTreeModel, path: string[]): FuncEvent[] {
  const mx = maxAncestorFeIndex(m, path)
  return m.functionalEvents.filter((_, i) => i > mx)
}
```

**`branchLeaf` 多 `feId` 入参:**
```ts
export function branchLeaf(m: EventTreeModel, path: string[], feId: string): EventTreeModel {
  if (!subsequentFes(m, path).some((f) => f.id === feId)) return m   // 非法(非后续)→ 原样
  const root = replaceAt(m.root, path, (n) =>
    n.kind === 'leaf'
      ? { kind: 'branch', feId, success: { kind: 'leaf', consequence: n.consequence },
          failure: { kind: 'leaf', consequence: n.consequence } }
      : n)
  return { ...m, root }
}
```

**`delFe`(删屏障 + 折叠引用分支):**
```ts
/** CONSEQUENCES 升序;返回子树中最严重后果(无叶→'C1')。 */
function mostSevere(n: EtNode): string {
  let worst = -1
  function walk(x: EtNode) {
    if (x.kind === 'leaf') { const r = CONSEQUENCES.indexOf(x.consequence); if (r > worst) worst = r }
    else { walk(x.success); walk(x.failure) }
  }
  walk(n)
  return worst < 0 ? 'C1' : CONSEQUENCES[worst]
}
export function branchesUsingFe(m: EventTreeModel, feId: string): number {
  let c = 0
  ;(function walk(n: EtNode) { if (n.kind === 'branch') { if (n.feId === feId) c++; walk(n.success); walk(n.failure) } })(m.root)
  return c
}
export function delFe(m: EventTreeModel, idx: number): EventTreeModel {
  const fe = m.functionalEvents[idx]; if (!fe) return m
  function fix(n: EtNode): EtNode {
    if (n.kind === 'leaf') return n
    if (n.feId === fe.id) return { kind: 'leaf', consequence: mostSevere(n) }  // 折叠为单叶(保守取最严重)
    return { ...n, success: fix(n.success), failure: fix(n.failure) }
  }
  return { ...m, functionalEvents: m.functionalEvents.filter((_, i) => i !== idx), root: fix(m.root) }
}
```
> 仅删一个 FE:其余分支按 id 引用,后续 FE 下标整体左移不影响引用与不变量(顺序稳定)。

**`layout` 改用 feId 定列、连接线跨跳过列:**
```ts
export interface EtLayoutNode {
  path: string[]; depth: number; y: number; kind: 'branch' | 'leaf'
  consequence?: string; freq?: number; successY?: number; failureY?: number
  successCol?: number; failureCol?: number   // 新增:子节点所在列(供跨列连线)
}
export function layout(m: EventTreeModel, rowH: number, headerH: number) {
  let row = 0
  const nodes: EtLayoutNode[] = []
  function walk(n: EtNode, path: string[], prob: number, col: number): { y: number; col: number } {
    if (n.kind === 'leaf') {
      const y = headerH + row * rowH + rowH / 2; row++
      nodes.push({ path, depth: col, y, kind: 'leaf', consequence: n.consequence, freq: m.initFreq * prob })
      return { y, col }
    }
    const idx = feIndex(m, n.feId)
    const pf = m.functionalEvents[idx]?.failProb ?? 0
    const s = walk(n.success, [...path, 'success'], prob * (1 - pf), idx + 1)
    const f = walk(n.failure, [...path, 'failure'], prob * pf, idx + 1)
    const y = (s.y + f.y) / 2
    nodes.push({ path, depth: idx, y, kind: 'branch', successY: s.y, failureY: f.y, successCol: s.col, failureCol: f.col })
    return { y, col: idx }
  }
  walk(m.root, [], 1, 0)
  return { nodes, leafCount: row, maxDepth: m.functionalEvents.length }
}
```
> `depth` 字段语义改为"列索引"(分支=自身 feIndex,叶=父 feIndex+1,根叶=0)。频率仍只乘路径实际判定的 FE(跳过的不乘)。

**`toEngineRequest` 改用 `n.feId`:**
```ts
function walk(n: EtNode, path: Record<string, string>): void {
  if (n.kind === 'leaf') { const es = `L${leaf++}`; sequences.push({ path: { ...path }, end_state: es }); consequence_bins[es] = n.consequence; return }
  walk(n.success, { ...path, [n.feId]: 'success' })
  walk(n.failure, { ...path, [n.feId]: 'failure' })
}
walk(m.root, {})
```
> `functional_events` 列表仍输出全部 `m.functionalEvents`(各 pfd 或 link_ft);序列 path 为子集。引擎只乘 path 中 FE → 与 `layout` 前端积式一致(独立 FE 时),共享底事件时以引擎值为准(现有 ▶ 橙色逻辑不变)。

### 2.2 UI(`EventTreeEditor.tsx`)

**(a) 初始事件布局修复**
- 加宽前导区:`LEFT 90 → 180`(为初始事件名/频留出 [8, LEFT-12] ≈ 160px)。
- 初始事件名 `x=8` 左对齐,**过长截断**(取前 ~13 个字符 + "…")并加 `<title>`(SVG `<text>` 内 `<title>` 子元素)悬浮全名;频率行不变。
- 根连接线 `(8, rootY)→(colX(0), rootY)` 保持(现落在加宽后的前导区内)。
- 验收以 `preview_eval` 实测首列表头 x 区间与初始事件名 x 区间不交叠(必要时微调 LEFT/截断长度)。

**(b) 继续到任意后续屏障**
- 选中**叶**时,用下拉替换单按钮:
```tsx
const subs = subsequentFes(model, sel!)
// …
{subs.length === 0
  ? <div style={{ color:'#94a3b8' }}>已无更多可分支的后续屏障(可先「+ 添加屏障」)。</div>
  : <div style={{ display:'flex', gap:6, alignItems:'center' }}>
      <span>继续到屏障:</span>
      <select defaultValue="" onChange={(e)=>{ if(e.target.value) onChange(branchLeaf(model, sel!, e.target.value)) }}>
        <option value="" disabled>选择后续屏障…</option>
        {subs.map((f)=><option key={f.id} value={f.id}>{f.id} — {f.label}</option>)}
      </select>
    </div>}
```

**(c) 屏障增删**
- 功能事件每行加 ✕,行首显 `feId`:
```tsx
{model.functionalEvents.map((fe, d) => (
  <div key={fe.id} style={{ display:'flex', gap:6, alignItems:'center', marginBottom:4 }}>
    <span style={{ width:42, fontSize:11, color:'#64748b' }}>{fe.id}</span>
    <input value={fe.label} onChange={(e)=>onChange(renameFe(model, d, e.target.value))} style={{ width:120, fontSize:12 }} />
    <input type="number" step="0.01" min={0} max={1} value={fe.failProb}
      onChange={(e)=>onChange(setFailProb(model, d, +e.target.value))} style={{ width:60, fontSize:12 }} />
    <button title="删除屏障" onClick={()=>{
      const used = branchesUsingFe(model, fe.id)
      if (used === 0 || window.confirm(`将折叠 ${used} 个引用「${fe.label}」的分支为末态,继续?`)) onChange(delFe(model, d))
    }} style={{ color:'#dc2626', border:0, background:'none', cursor:'pointer' }}>✕</button>
  </div>
))}
```
- 保留 `+ 添加屏障`(`addFe`)与从库加屏障(`addBarrierFromLib`)。

**(d) 选中分支侧栏**(改 depth 派生为 feId)
```ts
const selFeId = selNode?.kind === 'branch' ? selNode.feId : undefined
const selFe = selFeId ? model.functionalEvents.find((f) => f.id === selFeId) : undefined
const selIdx = selFe ? model.functionalEvents.indexOf(selFe) : -1
```
- 侧栏"决定 <selFeId>"、来源、PFD/有效性、挂载/解绑 FTA(`onAttachFt(selIdx)`/`onDetachFt(selIdx)`)按 `selFe/selIdx` 取值。`branchLeaf` 旧无 feId 调用处全部更新。

### 2.3 `App.tsx` 接线
- `buildCascade` 已输出 feId(场景 `loadEt`、`newBlankEta` 自动获得)。
- `onLoadSaved`:对旧存档先 `normalizeEta`:
```ts
const model = normalizeEta(rec.payload.etModel as EventTreeModel)
```
- 其余不变(自定义模型由 `newBlankEta` 建,已带 feId)。

### 2.4 不动
- 后端引擎/`et_builder`/报告导出 Python 矩阵;`riskmatrix.ts`/`RiskMatrix.tsx`/`MultiEtaAggregate`;`consequenceTotals`(实现不变,经新 layout 自然正确)。

## 3. 文件改动清单

**修改**
- `frontend/src/eventtree.ts`:`EtNode` 加 feId;`buildCascade` 写 feId;新增 `feIndex/maxAncestorFeIndex/subsequentFes/normalizeEta/branchesUsingFe/delFe/mostSevere`;改写 `branchLeaf(+feId)`、`layout`(列=feIndex + successCol/failureCol)、`toEngineRequest`(用 n.feId);`EtLayoutNode` 加 `successCol/failureCol`。
- `frontend/src/components/EventTreeEditor.tsx`:布局常量与初始事件渲染(LEFT/截断/title)、分支连线用 successCol/failureCol、叶继续下拉、屏障行 feId+✕删除、选中分支 feId 派生。
- `frontend/src/App.tsx`:`onLoadSaved` 调 `normalizeEta`(其余构造点已含 feId)。

**新增**
- 后端 pytest:`tests/test_event_tree_skip.py`(或并入既有事件树测试文件)——子集路径量化守护。

## 4. 构建顺序与验收

| # | 部分 | 验收 |
|---|---|---|
| 1 | 模型纯函数(eventtree.ts)+ 引擎子集守护测试 | `pytest -q` 含新例通过(子集路径 = init×所测 FE 积);`npm run build` 通过 |
| 2 | layout 列=feIndex + 跨列连线 | build 通过;`preview_eval`:满级联场景树形/叶频率与改造前一致(回归) |
| 3 | 初始事件布局修复 | `preview_eval`:初始事件名 x 区间与首屏障列头 x 区间不交叠 |
| 4 | 叶"继续到后续任意屏障"下拉 | `preview_eval`:选叶→下拉含后续 FE;选一个非相邻 FE→出现该列分支,跳过列为空;引擎量化对该树成功返回 |
| 5 | 屏障增删 | `preview_eval`:未引用屏障直接删;被引用屏障删→confirm→引用分支折叠为末态(后果=子树最严重) |

全量:`pytest -q`(≥135 + 新例)、`npm run build` 通过、`preview_eval` 上述断言、对一个原级联场景引擎量化与改造前数值一致(回归)。

## 5. 取默认值 / 风险

- **兼容**:`normalizeEta` + feId 化 `buildCascade` → 旧存档/场景零迁移加载。`feId` 缺失时按深度兜底。
- **不变量保护**:`subsequentFes` 限定下拉只给后续 FE,杜绝乱序/重复判定;`branchLeaf` 再次校验。
- **删除保守**:折叠取子树最严重后果,绝不静默降低风险;被引用时 `window.confirm` 二次确认。
- **引擎语义**:跳过 = 该 FE 在此路径不出现于 path → 引擎不乘其概率(标准事件树语义,引擎已支持)。满级联(每 FE 按序全测)结果与改造前等价 → 回归可验。
- **空屏障**:全删后 `functionalEvents=[]`,根为叶,只显初始事件→单叶,下拉隐藏。
- **`depth` 语义变更**:`EtLayoutNode.depth` 从"路径长度"改为"列索引";仅 `EventTreeEditor` 渲染消费,已同步;`toEngineRequest` 不再用 depth。
- 纯前端 + 1 后端守护测试;用户自有 :8000 静态托管 dist,前端 build 后硬刷新即生效;后端新增测试不改运行时,uvicorn 无需重启。
