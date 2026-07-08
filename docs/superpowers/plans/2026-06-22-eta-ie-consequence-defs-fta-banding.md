# ETA 初始事件列 · 每-ETA 后果内涵 · 成功分支可发现性 · FTA 事件/门分带 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 ETA 初始事件成为可编辑的正式最左列(消除重叠)、各 ETA 自定义 C1–C5 文字内涵、成功叶可就近继续到任意后续屏障、屏障 FTA 的基本事件分带到底部。

**Architecture:** 纯前端改动。模型层(`eventtree.ts`)新增纯函数与 `consequenceDefs` 字段;FTA 分带计算抽到独立纯模块(`ftbanding.ts`)供 `layout.ts` 调用;ETA 渲染与侧栏编辑都在 `EventTreeEditor.tsx`。引擎契约与后端零改动;后果 bin 仍为 `C1..C5`,跨-ETA 汇总与风险矩阵不受影响。

**Tech Stack:** React 18 + TypeScript + Vite;SVG 手绘 ETA;ReactFlow + dagre 画 FTA。无前端测试框架 —— 验收用 `npm run build`(tsc 类型检查)+ `npm run lint` + 实时 preview 截图。

**设计依据:** [docs/superpowers/specs/2026-06-22-eta-ie-consequence-defs-fta-banding-design.md](../specs/2026-06-22-eta-ie-consequence-defs-fta-banding-design.md)

---

## 文件结构(改动地图)

| 文件 | 动作 | 职责 |
|---|---|---|
| `frontend/src/eventtree.ts` | 改 | 模型层:`consequenceDefs` 字段、`DEFAULT_CONSEQUENCE_DEFS`、`consDef`、`setInitEvent`/`setInitFreq`/`setConsequenceDef`、`newBlankEta`/`normalizeEta` 补默认 |
| `frontend/src/ftbanding.ts` | 新建 | 纯函数:把基本/房形事件压到底部带,算新中心坐标(无 reactflow 依赖,易测) |
| `frontend/src/layout.ts` | 改 | `layoutFaultTree` 增 `bandLeaves` 形参,调用 `ftbanding` |
| `frontend/src/components/BarrierFtModal.tsx` | 改 | 调 `layoutFaultTree(..., true)` 开启分带 |
| `frontend/src/components/EventTreeEditor.tsx` | 改 | 初始事件正式列(SVG)、侧栏初始事件编辑、后果定义编辑 + 显示、成功叶就近"＋继续"菜单 |

**不动:** `App.tsx`(编辑均经现有 `onChange=etHist.set`,无需新接线)、`MultiEtaAggregate.tsx`、`riskmatrix.ts`、`backend/*`、引擎。

---

## 全局验收命令(每个含代码改动的任务都要先过这两关)

- 在 `frontend/` 下:`npm run build` → 期望:tsc 无类型错误,`vite build` 完成、写出 `dist/`。
- 在 `frontend/` 下:`npm run lint` → 期望:eslint 无 error。

实时验证(UI 任务):`npm run dev` 启动后,在浏览器 ETA 页按各任务的"实时验证"操作并截图。

---

## Task 1: 模型层 — 初始事件编辑 ops + 后果内涵字段

**Files:**
- Modify: `frontend/src/eventtree.ts`

- [ ] **Step 1: 给 `EventTreeModel` 加 `consequenceDefs` 字段**

把接口(现 `eventtree.ts:10-15`)改为:

```ts
export interface EventTreeModel {
  initEvent: string
  initFreq: number
  functionalEvents: FuncEvent[]
  root: EtNode
  consequenceDefs?: Record<string, string>   // C1..C5 → 文字内涵;缺省取 DEFAULT_CONSEQUENCE_DEFS
}
```

- [ ] **Step 2: 新增默认内涵常量 + `consDef` 取值器**

紧接在 `CONSEQUENCE_AT_DEPTH`(现 `eventtree.ts:19`)之后插入:

```ts
/** 各 ETA 新建时的 C1–C5 默认文字内涵(可在编辑器中逐个改写)。 */
export const DEFAULT_CONSEQUENCE_DEFS: Record<string, string> = {
  C1: '单体安全排气',
  C2: '模组内热蔓延/起火',
  C3: 'Pack/簇级起火',
  C4: '箱级起火蔓延',
  C5: '爆炸 + 毒气释放',
}
/** 取某后果在本 ETA 的文字内涵;模型未定义时回退到默认。 */
export function consDef(m: EventTreeModel, c: string): string {
  return m.consequenceDefs?.[c] ?? DEFAULT_CONSEQUENCE_DEFS[c] ?? ''
}
```

- [ ] **Step 3: 新增三个纯编辑函数**

紧接在 `setFailProb`(现 `eventtree.ts:106-108`)之后插入:

```ts
export function setInitEvent(m: EventTreeModel, name: string): EventTreeModel {
  return { ...m, initEvent: name }
}
export function setInitFreq(m: EventTreeModel, freq: number): EventTreeModel {
  return Number.isFinite(freq) && freq >= 0 ? { ...m, initFreq: freq } : m
}
export function setConsequenceDef(m: EventTreeModel, c: string, text: string): EventTreeModel {
  return { ...m, consequenceDefs: { ...DEFAULT_CONSEQUENCE_DEFS, ...m.consequenceDefs, [c]: text } }
}
```

- [ ] **Step 4: `newBlankEta` 带默认内涵**

把 `newBlankEta` 的 return(现 `eventtree.ts:39`)改为:

```ts
  return { initEvent: name || '自定义事件', initFreq: 1e-3, functionalEvents: fes, root: buildCascade(fes, CONSEQUENCE_AT_DEPTH), consequenceDefs: { ...DEFAULT_CONSEQUENCE_DEFS } }
```

- [ ] **Step 5: `normalizeEta` 给旧存档补默认内涵**

把 `normalizeEta` 的 return(现 `eventtree.ts:67`)改为:

```ts
  return { ...m, root: fix(m.root, 0), consequenceDefs: m.consequenceDefs ?? { ...DEFAULT_CONSEQUENCE_DEFS } }
```

- [ ] **Step 6: 类型检查 + lint**

Run(在 `frontend/`):`npm run build`
Expected: 无类型错误,构建成功。
Run:`npm run lint`
Expected: 无 error。

- [ ] **Step 7: Commit**

```bash
git add frontend/src/eventtree.ts
git commit -m "feat(eta): 模型层加初始事件编辑 ops + 每ETA C1–C5 内涵字段

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: FTA 事件/门分带(经典 FTA)

**Files:**
- Create: `frontend/src/ftbanding.ts`
- Modify: `frontend/src/layout.ts`
- Modify: `frontend/src/components/BarrierFtModal.tsx`

- [ ] **Step 1: 新建纯分带模块 `ftbanding.ts`**

创建 `frontend/src/ftbanding.ts`,完整内容:

```ts
// 纯函数:把故障树的基本/房形事件压到画布底部同一带,门保持原 dagre 层级。
// 输入/输出均为"节点中心"坐标,无 reactflow 依赖,便于单测。

export interface BandNode { id: string; isLeaf: boolean; x: number; y: number }
export interface BandOpts { nodeW: number; nodeH: number; gap: number; leafGap: number; marginX: number }

/** 返回需要重定位的叶节点 id → 新中心坐标;门节点不返回(保持原位)。 */
export function bandLeafPositions(nodes: BandNode[], opts: BandOpts): Record<string, { x: number; y: number }> {
  const leaves = nodes.filter((n) => n.isLeaf)
  if (leaves.length === 0) return {}
  const gates = nodes.filter((n) => !n.isLeaf)
  const baseY = (gates.length ? gates : leaves).reduce((m, n) => Math.max(m, n.y), -Infinity)
  const bandY = baseY + opts.nodeH + opts.gap
  // 按原 dagre x 排序(dagre 已把同父子节点横向聚拢),稳定打散到一行。
  const ordered = [...leaves].sort((a, b) => a.x - b.x || a.id.localeCompare(b.id))
  const step = opts.nodeW + opts.leafGap
  const out: Record<string, { x: number; y: number }> = {}
  ordered.forEach((l, i) => { out[l.id] = { x: opts.marginX + opts.nodeW / 2 + i * step, y: bandY } })
  return out
}
```

- [ ] **Step 2: `layoutFaultTree` 增 `bandLeaves` 形参并调用分带**

在 `frontend/src/layout.ts` 顶部 import 区(现 `layout.ts:1-5`)加一行:

```ts
import { bandLeafPositions } from './ftbanding'
```

把函数签名(现 `layout.ts:12`)改为:

```ts
export function layoutFaultTree(model: ModelJson, ftName: string, positions?: Record<string, { x: number; y: number }>, bandLeaves = false): { nodes: Node[]; edges: Edge[] } {
```

在 `dagre.layout(g)`(现 `layout.ts:29`)之后、`const nodes = ...`(现 `layout.ts:31`)之前插入:

```ts
  let bandPos: Record<string, { x: number; y: number }> = {}
  if (bandLeaves) {
    const bn = ft.nodes.map((n) => {
      const p = g.node(n.id)
      return { id: n.id, isLeaf: !!(n.basic || n.house), x: p?.x ?? 0, y: p?.y ?? 0 }
    })
    bandPos = bandLeafPositions(bn, { nodeW: NODE_W, nodeH: NODE_H, gap: 70, leafGap: 24, marginX: 20 })
  }
```

把节点定位行(现 `layout.ts:35-42` 的 `position:` 计算)改为以分带中心优先:

```ts
    const center = bandPos[n.id] ?? { x: (p?.x ?? 0), y: (p?.y ?? 0) }
    const saved = positions?.[n.id]
    return {
      id: n.id,
      type,
      position: saved ?? { x: center.x - NODE_W / 2, y: center.y - NODE_H / 2 },
      data: { label: n.id, op: n.op, k: n.k, args: n.args, isTop: n.id === ft.top },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
    }
```

- [ ] **Step 3: 屏障 FTA 模态开启分带**

在 `frontend/src/components/BarrierFtModal.tsx:19`,把:

```ts
  const graph = layoutFaultTree(model, ftName)
```

改为:

```ts
  const graph = layoutFaultTree(model, ftName, undefined, true)
```

- [ ] **Step 4: 类型检查 + lint**

Run(在 `frontend/`):`npm run build` → Expected: 无类型错误。
Run:`npm run lint` → Expected: 无 error。

- [ ] **Step 5: 实时验证分带**

启动 `npm run dev`,进入 ETA 页 → 选一个挂载了 FTA 的屏障(或先「挂载 FTA」)→ 点「编辑故障树」打开模态 → 在模态里多加 1 个门 + 2~3 个基本事件并连好。
Expected(截图):所有基本事件(圆)对齐在画布**底部同一水平带**,门(AND/OR)在其上方分层,节点不重叠。

- [ ] **Step 6: Commit**

```bash
git add frontend/src/ftbanding.ts frontend/src/layout.ts frontend/src/components/BarrierFtModal.tsx
git commit -m "feat(ft): 屏障故障树基本事件分带到底部(经典 FTA 布局)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: ETA 初始事件成为正式最左列(消除重叠)

**Files:**
- Modify: `frontend/src/components/EventTreeEditor.tsx`

- [ ] **Step 1: 调整布局常量(右移屏障让出初始事件列)**

把 `frontend/src/components/EventTreeEditor.tsx:42`:

```ts
  const rowH = 46, headerH = 64, colW = 150, LEFT = 200
```

改为:

```ts
  const rowH = 46, headerH = 64, colW = 150, LEFT = 240
  const IE_X = 12, IE_RIGHT = 188   // 初始事件列:文字左缘 / 列右边界(根线起点)
```

- [ ] **Step 2: 把左上浮动标签换成正式列 + 从列右缘起根线**

把现 `EventTreeEditor.tsx:97-102` 这段:

```tsx
          <text x={8} y={26} fontSize={12} fontWeight={700}>
            {model.initEvent.length > 12 ? model.initEvent.slice(0, 12) + '…' : model.initEvent}
            <title>{model.initEvent}</title>
          </text>
          <text x={8} y={42} fontSize={10} fill="#64748b">{model.initFreq.toExponential(2)}/yr</text>
          <line x1={8} y1={rootY} x2={colX(0)} y2={rootY} stroke="#334155" strokeWidth={2} />
```

整体替换为:

```tsx
          {/* 初始事件:正式最左列 */}
          <text x={IE_X} y={14} fontSize={9} fill="#94a3b8">初始事件</text>
          <text x={IE_X} y={30} fontSize={12} fontWeight={700}>
            {model.initEvent.length > 16 ? model.initEvent.slice(0, 16) + '…' : model.initEvent}
            <title>{model.initEvent}</title>
          </text>
          <text x={IE_X} y={48} fontSize={10} fill="#64748b">{model.initFreq.toExponential(2)}/yr</text>
          <line x1={IE_RIGHT} y1={headerH - 6} x2={IE_RIGHT} y2={height - 12} stroke="#f1f5f9" />
          <line x1={IE_RIGHT} y1={rootY} x2={colX(0)} y2={rootY} stroke="#334155" strokeWidth={2} />
```

- [ ] **Step 3: 类型检查 + lint**

Run(在 `frontend/`):`npm run build` → Expected: 无类型错误。
Run:`npm run lint` → Expected: 无 error。

- [ ] **Step 4: 实时验证无重叠**

`npm run dev` → ETA 页加载默认「过充」ETA。
Expected(截图):左侧出现独立「初始事件」列(caption + 全名 `IE_OVERCHARGE` + `1.00e-3/yr`),与第一屏障 `B_BMS` 表头**不再重叠**;根连线从初始事件列右缘开始。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/EventTreeEditor.tsx
git commit -m "fix(eta): 初始事件改为正式最左列,消除与首屏障表头重叠

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: ETA 侧栏 — 初始事件编辑 + 后果内涵编辑

**Files:**
- Modify: `frontend/src/components/EventTreeEditor.tsx`

- [ ] **Step 1: 引入新模型函数**

把现 `EventTreeEditor.tsx:3-6` 的 import 块:

```tsx
import {
  branchLeaf, collapseNode, setConsequence, setFailProb, renameFe, addFe, addBarrierFromLib,
  branchesUsingFe, delFe, nodeAt, layout, toEngineRequest, subsequentFes, CONSEQUENCES,
} from '../eventtree'
```

改为(加 `setInitEvent, setInitFreq, setConsequenceDef, consDef`):

```tsx
import {
  branchLeaf, collapseNode, setConsequence, setFailProb, renameFe, addFe, addBarrierFromLib,
  branchesUsingFe, delFe, nodeAt, layout, toEngineRequest, subsequentFes, CONSEQUENCES,
  setInitEvent, setInitFreq, setConsequenceDef, consDef,
} from '../eventtree'
```

- [ ] **Step 2: 在「功能事件(屏障)」标题前插入初始事件编辑块**

在现 `EventTreeEditor.tsx:187` 的 `<h4 ...>功能事件(屏障)</h4>` **之前**插入:

```tsx
        <h4 style={{ margin: '14px 0 4px' }}>初始事件</h4>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
          <span style={{ width: 48, fontSize: 11, color: '#64748b' }}>名称</span>
          <input value={model.initEvent} onChange={(e) => onChange(setInitEvent(model, e.target.value))} style={{ flex: 1, fontSize: 12 }} />
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
          <span style={{ width: 48, fontSize: 11, color: '#64748b' }}>频率/yr</span>
          <input key={'freq' + model.initFreq} defaultValue={model.initFreq.toExponential(2)}
            onBlur={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v) && v >= 0) onChange(setInitFreq(model, v)) }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            title="支持科学计数,如 1e-3;回车或失焦生效" style={{ flex: 1, fontSize: 12 }} />
        </div>
```

- [ ] **Step 3: 在「+ 添加屏障」按钮后插入后果内涵编辑块**

在现 `EventTreeEditor.tsx:206` 的 `<button onClick={() => onChange(addFe(model))} ...>+ 添加屏障</button>` **之后**插入:

```tsx
        <h4 style={{ margin: '14px 0 4px' }}>后果定义 (C1–C5)</h4>
        {CONSEQUENCES.map((c) => (
          <div key={c} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
            <span style={{ width: 24, fontSize: 11, fontWeight: 700, color: C_COLOR[c] }}>{c}</span>
            <input value={consDef(model, c)} onChange={(e) => onChange(setConsequenceDef(model, c, e.target.value))} style={{ flex: 1, fontSize: 12 }} />
          </div>
        ))}
```

- [ ] **Step 4: 类型检查 + lint**

Run(在 `frontend/`):`npm run build` → Expected: 无类型错误。
Run:`npm run lint` → Expected: 无 error。

- [ ] **Step 5: 实时验证编辑联动**

`npm run dev` → ETA 页:
1. 侧栏「初始事件」改名称 → 左列表头同步更新。
2. 频率框输入 `2e-3` 回车 → 左列频率显示 `2.00e-3/yr`;点「⚙ 引擎精确量化」叶频率随之翻倍。
3. 「后果定义」把 C3 改成自定义文字 → 见 Task 5 显示验证。
Expected(截图):上述联动正确;撤销(若有快捷键)/重新选节点不报错。

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/EventTreeEditor.tsx
git commit -m "feat(eta): 侧栏可编辑初始事件名称/频率与 C1–C5 内涵

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: 后果内涵的显示(下拉标签 + 悬浮提示)

**Files:**
- Modify: `frontend/src/components/EventTreeEditor.tsx`

- [ ] **Step 1: 叶后果块加内涵悬浮提示**

把现 `EventTreeEditor.tsx:137`(叶的后果色块 `<rect .../>`)改为带 `<title>` 子元素:

```tsx
                <rect x={resultsX} y={lf.y - 11} width={26} height={18} rx={3} fill={C_COLOR[lf.consequence!] || '#64748b'}>
                  <title>{lf.consequence} — {consDef(model, lf.consequence!)}</title>
                </rect>
```

- [ ] **Step 2: 末态后果下拉显示「C3 — 文字」**

把现 `EventTreeEditor.tsx:215-217` 的后果选择 `<select>`:

```tsx
              <select value={selNode.consequence} onChange={(e) => onChange(setConsequence(model, sel!, e.target.value))}>
                {CONSEQUENCES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
```

改为:

```tsx
              <select value={selNode.consequence} onChange={(e) => onChange(setConsequence(model, sel!, e.target.value))}>
                {CONSEQUENCES.map((c) => <option key={c} value={c}>{c} — {consDef(model, c)}</option>)}
              </select>
```

- [ ] **Step 3: 类型检查 + lint**

Run(在 `frontend/`):`npm run build` → Expected: 无类型错误。
Run:`npm run lint` → Expected: 无 error。

- [ ] **Step 4: 实时验证显示**

`npm run dev` → ETA 页:
1. 鼠标悬停某叶的 Cx 色块 → 出现「C3 — Pack/簇级起火」(或你改写后的文字)提示。
2. 选中一个叶节点 → 「末态后果」下拉每项显示「Cx — 文字」。
3. 在「后果定义」改 C3 文字后,上述两处实时跟随。
Expected(截图):提示与下拉文字正确。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/EventTreeEditor.tsx
git commit -m "feat(eta): 后果块悬浮提示与下拉显示每ETA C1–C5 内涵

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: 成功叶就近「＋继续到屏障」菜单(可发现性)+ 验证既有分支

**Files:**
- Modify: `frontend/src/components/EventTreeEditor.tsx`

- [ ] **Step 1: 先验证既有"成功叶可继续"行为**

`npm run dev` → ETA 页 → 点一个**绿色成功叶**(如 `B_BMS` 成功后的 C1 叶圆点)→ 看右侧栏是否出现「继续到屏障」下拉,并能选一个更靠后的屏障使其分支。
Expected:能正常分支并渲染(含跨跳过列连线)。
若此处异常(下拉缺失/分支不渲染),先记录为 bug:核对 `subsequentFes(model, sel)` 与 `branchLeaf` 路径,修复后再继续。代码层面成功/失败叶共用同一叶分支逻辑,通常无差异。

- [ ] **Step 2: 在可点选锚点之后渲染就近"＋继续"菜单**

在现 `EventTreeEditor.tsx:151-156`(渲染所有圆点 `nodes.map(... <circle .../>)`)的 **之后**、`</svg>` 之前,插入:

```tsx
          {/* 选中"可继续的叶" → 在其右侧就近列出后续屏障,点击即分支(SVG 内,绘于最上层) */}
          {(() => {
            if (selNode?.kind !== 'leaf' || !sel) return null
            const lf = nodes.find((n) => n.kind === 'leaf' && n.path.join('/') === selKey)
            if (!lf) return null
            const subs = subsequentFes(model, sel)
            if (subs.length === 0) return null
            const mx = colX(lf.depth) + 14, mw = 160, ih = 18
            return (
              <g>
                <rect x={mx} y={lf.y - 14} width={mw} height={18 + subs.length * ih} rx={5}
                  fill="#fff" stroke="#f59e0b" strokeWidth={1} />
                <text x={mx + 7} y={lf.y - 1} fontSize={9} fontWeight={700} fill="#b45309">＋继续到屏障:</text>
                {subs.map((f, k) => (
                  <g key={f.id} style={{ cursor: 'pointer' }}
                    onClick={() => { onChange(branchLeaf(model, lf.path, f.id)); setSel(null) }}>
                    <rect x={mx + 5} y={lf.y + 4 + k * ih} width={mw - 10} height={ih - 2} rx={3} fill="#fff7ed" />
                    <text x={mx + 9} y={lf.y + 4 + k * ih + 12} fontSize={10} fill="#9a3412">
                      {f.id} — {(f.label || '').slice(0, 14)}
                    </text>
                  </g>
                ))}
              </g>
            )
          })()}
```

- [ ] **Step 3: 类型检查 + lint**

Run(在 `frontend/`):`npm run build` → Expected: 无类型错误。
Run:`npm run lint` → Expected: 无 error。

- [ ] **Step 4: 实时验证菜单**

`npm run dev` → ETA 页 → 点一个**成功叶**(其后还有可用屏障)。
Expected(截图):该叶右侧就近浮出橙框菜单「＋继续到屏障:」列出后续屏障;点其一 → 该叶即分支到所选屏障,菜单消失,树重绘正确。点末列(无后续)叶时不出菜单。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/EventTreeEditor.tsx
git commit -m "feat(eta): 成功叶就近浮出'继续到屏障'菜单,提升分支可发现性

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: 全量集成验证(不改代码)

**Files:** 无(纯验证 + 截图归档)

- [ ] **Step 1: 五项需求逐条核对**

`npm run dev`,在 ETA 页依次确认并各截一图:
1. ① 初始事件列与首屏障**无重叠**。
2. ② 成功叶可经就近菜单/侧栏继续到任意更靠后屏障。
3. ③ 屏障 FTA 基本事件分带到底部、门在上。
4. ④ 侧栏改初始事件名称/频率 → 左列与引擎量化联动。
5. ⑤ 各 ETA 后果内涵可编辑,下拉/悬浮显示;切到「多 ETA 汇总」勾选几个 ETA。

- [ ] **Step 2: 确认下游不受影响**

在「多 ETA 汇总」与「风险矩阵」处确认:后果仍按 `C1..C5` 汇总、矩阵落档不变(改了某 ETA 的 C 文字内涵**不**改变其 bin 与严重度)。
Expected:汇总表与风险矩阵数值同改前一致。

- [ ] **Step 3: 存档往返验证**

点「💾 保存当前」存一档 → 刷新页面 → 从「存档」载入。
Expected:初始事件名称/频率、各屏障、后果内涵均保留;载入一个改动前的旧档时,后果内涵自动套用默认值(无报错)。

- [ ] **Step 4: 导出冒烟**

点「Word / PDF / 图PNG / 图SVG」各导一次。
Expected:均成功产出,图含新版初始事件列。

- [ ] **Step 5: 最终构建闸**

Run(在 `frontend/`):`npm run build` 且 `npm run lint`
Expected:均通过。

- [ ] **Step 6: 收尾合并(询问用户)**

完成后用 superpowers:finishing-a-development-branch 提供合并/PR/清理选项(默认沿用仓库惯例:把 `feat/eta-ie-consequence-defs-fta-banding` 合回 `main`)。

---

## Self-Review(对照 spec)

- **① 重叠** → Task 3(正式列 + 右移)。✓
- **② 成功叶接所选屏障** → Task 6(验证既有 + 就近菜单)。✓
- **③ FTA 事件/门分带** → Task 2(`ftbanding.ts` + `layout.ts` + 模态开启)。✓
- **④ 初始事件可编辑 + 展示** → Task 1(`setInitEvent/setInitFreq`)+ Task 3(展示)+ Task 4(编辑)。✓
- **⑤ 每-ETA C1–C5 内涵** → Task 1(字段/默认/`consDef`/`setConsequenceDef`)+ Task 4(编辑)+ Task 5(显示);Task 7 校验汇总/矩阵不受影响。✓
- **类型/命名一致性**:`consequenceDefs`、`consDef`、`setInitEvent`、`setInitFreq`、`setConsequenceDef`、`bandLeafPositions`、`bandLeaves` 在定义任务(1/2)与消费任务(3–6)中拼写一致。✓
- **占位符扫描**:无 TBD/TODO;每个代码步给出完整代码与精确插入点。✓
- **范围**:单一前端计划,自洽可测,引擎契约未动。✓
