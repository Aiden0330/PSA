# ETA 有序可跳过分支 + 屏障增删 + 初始事件布局修复 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 ETA 编辑器支持「每分支显式记录所判定屏障、可从选中叶继续到任意更靠后的屏障(允许跳过)」、屏障增删、并修复初始事件标签与首屏障列重叠。

**Architecture:** 纯前端模型重构(`eventtree.ts`:`EtNode` 分支加 `feId`,`layout`/`toEngineRequest` 改用 feId,新增 `subsequentFes`/`delFe`/`normalizeEta` 等纯函数)+ `EventTreeEditor.tsx` UI(叶继续下拉、跨跳过列连线、布局修复、屏障删除)+ `App.tsx` 旧存档 `normalizeEta` 兼容。引擎 `quantify_event_tree` 已逐 `path.items()` 处理子集路径,后端运行时不改,仅加 1 条守护测试。

**Tech Stack:** TypeScript + React 18 + Vite 5(前端);Python + pytest(后端守护测试)。

**验证范式(重要)**:本仓库前端**无单测框架**(`build = tsc -b && vite build`)。沿用本项目既有做法:每个前端任务以 `npm run build`(tsc 类型安全)+ `preview_eval`(对运行中的前端做 DOM/SVG 行为断言)验收;`eventtree.ts` 纯逻辑通过「回归(原级联场景量化不变)+ UI 行为断言」间接覆盖。后端用真实 pytest(test-first)。

**preview 复用助手**:多处需驱动 React 受控控件。统一用「原生 setter + 派发事件」(本会话验证过的 React 18 模式):
```js
function setReactValue(el, value) {
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype
    : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}
```

---

## File Structure

| 文件 | 职责 | 本计划改动 |
|---|---|---|
| `frontend/src/eventtree.ts` | 事件树模型 + 纯函数(模型层) | `EtNode` 加 `feId`;`buildCascade`/`branchLeaf`/`layout`/`toEngineRequest` 改写;新增 `feIndex`/`maxAncestorFeIndex`/`subsequentFes`/`normalizeEta`/`mostSevere`/`branchesUsingFe`/`delFe`;`EtLayoutNode` 加 `successCol`/`failureCol` |
| `frontend/src/components/EventTreeEditor.tsx` | ETA 渲染 + 侧栏(视图层) | 跨跳过列连线;叶「继续到后续屏障」下拉;初始事件布局修复;屏障行 feId + ✕ 删除;选中分支按 feId 派生 |
| `frontend/src/App.tsx` | 模型装载接线 | `onLoadSaved` 调 `normalizeEta` |
| `tests/test_event_tree_skip.py` | 引擎子集路径守护 | 新建 |
| `docs/superpowers/ROADMAP.md` | 路线图 | 追加本批次条目 |

---

## Task 1: 后端守护测试 — 子集(跳过中间屏障)路径量化

**Files:**
- Create: `tests/test_event_tree_skip.py`

- [ ] **Step 1: Write the test**

`build_model_from_request`(`backend/et_builder.py`)把每个 `{"id","pfd"}` 功能事件建成平凡故障树,事件树命名 `"TR"`;`quantify_event_tree` 逐 `seq["path"].items()` 仅乘出现的 FE。本测试锁定「序列省略中间 FE 时,频率只乘所测 FE」这一契约(前端跳过语义依赖它)。

```python
from backend.et_builder import build_model_from_request
from psaengine.eta.sequence import quantify_event_tree


def _req():
    return {
        "init_event": "X", "init_frequency": 1.0,
        "functional_events": [
            {"id": "FE1", "pfd": 0.1},
            {"id": "FE2", "pfd": 0.2},
            {"id": "FE3", "pfd": 0.3},
        ],
        "fault_trees": {}, "parameters": {},
        "sequences": [
            {"path": {"FE1": "success", "FE3": "failure"}, "end_state": "L0"},  # 跳过 FE2
            {"path": {"FE1": "success", "FE3": "success"}, "end_state": "L1"},  # 跳过 FE2
            {"path": {"FE1": "failure"}, "end_state": "L2"},                    # 跳过 FE2,FE3
        ],
        "consequence_bins": {"L0": "C2", "L1": "C1", "L2": "C3"},
    }


def test_sequence_skipping_middle_fe_multiplies_tested_only():
    model = build_model_from_request(_req())
    seq = quantify_event_tree(model, "TR")["sequences"]
    assert abs(seq["L0"] - (1.0 * (1 - 0.1) * 0.3)) < 1e-12        # FE2 不参与
    assert abs(seq["L1"] - (1.0 * (1 - 0.1) * (1 - 0.3))) < 1e-12
    assert abs(seq["L2"] - (1.0 * 0.1)) < 1e-12


def test_skip_consequences_aggregate():
    model = build_model_from_request(_req())
    cons = quantify_event_tree(model, "TR")["consequences"]
    assert abs(cons["C1"] - (1.0 * (1 - 0.1) * (1 - 0.3))) < 1e-12
    assert abs(cons["C2"] - (1.0 * (1 - 0.1) * 0.3)) < 1e-12
    assert abs(cons["C3"] - (1.0 * 0.1)) < 1e-12
```

- [ ] **Step 2: Run the test**

Run: `python -m pytest tests/test_event_tree_skip.py -v`
Expected: **PASS**(引擎已支持子集路径;本测试是守护/契约测试,锁定该行为,使后续若有人改 `quantify_event_tree` 误处理缺失 FE 会被捕获)。

- [ ] **Step 3: Confirm full suite unaffected**

Run: `python -m pytest -q`
Expected: 全部通过(原 135 passed / 2 skipped + 本文件 2 例 → 137 passed / 2 skipped)。

- [ ] **Step 4: Commit**

```bash
git add tests/test_event_tree_skip.py
git commit -m "test(eta): 守护引擎子集路径(跳过中间屏障)量化契约

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: 模型层重构(`eventtree.ts`)+ 旧存档兼容(`App.tsx`)

**Files:**
- Modify: `frontend/src/eventtree.ts`(多处函数改写 + 新增)
- Modify: `frontend/src/App.tsx`(`onLoadSaved` 接 `normalizeEta`)

本任务结束时构建必须绿:`EtNode.feId` 设为**必填**(仅 `eventtree.ts` 内部构造分支字面量,无外部字面量);`branchLeaf` 的 `feId` 设为**可选参数**且默认取首个后续 FE → 现有 `branchLeaf(model, sel!)`(2 参)调用语义不变(下一屏障),编译通过。`EventTreeEditor.tsx` 本任务**不改**。

- [ ] **Step 1: `EtNode` 分支加 `feId`(必填)**

`frontend/src/eventtree.ts:6-8` 替换:
```ts
export type EtNode =
  | { kind: 'branch'; feId: string; success: EtNode; failure: EtNode }
  | { kind: 'leaf'; consequence: string }
```

- [ ] **Step 2: `buildCascade` 写入 feId**

`frontend/src/eventtree.ts:21-27` 整段替换:
```ts
/** 级联:depth d 成功→叶(consAtDepth[d]);失败→继续;全失败→叶(consAtDepth[n])。每分支 feId=fes[d].id。 */
export function buildCascade(fes: FuncEvent[], consAtDepth: string[]): EtNode {
  function build(d: number): EtNode {
    if (d >= fes.length) return { kind: 'leaf', consequence: consAtDepth[fes.length] ?? 'C5' }
    return {
      kind: 'branch', feId: fes[d].id,
      success: { kind: 'leaf', consequence: consAtDepth[d] ?? 'C1' }, failure: build(d + 1),
    }
  }
  return build(0)
}
```

- [ ] **Step 3: 新增 feId 索引 / 后续屏障 / 规范化 助手**

在 `frontend/src/eventtree.ts` 的 `nodeAt` 函数之前(约第 38 行前)插入:
```ts
export function feIndex(m: EventTreeModel, feId: string): number {
  return m.functionalEvents.findIndex((f) => f.id === feId)
}
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
/** 该节点可分支到的后续屏障(index 严格大于祖先最大 feIndex)。 */
export function subsequentFes(m: EventTreeModel, path: string[]): FuncEvent[] {
  const mx = maxAncestorFeIndex(m, path)
  return m.functionalEvents.filter((_, i) => i > mx)
}
/** 给缺 feId 的旧存档分支按当前深度补 feId(满级联 depth 即原 feIndex);已带 feId 幂等。 */
export function normalizeEta(m: EventTreeModel): EventTreeModel {
  function fix(n: EtNode, depth: number): EtNode {
    if (n.kind === 'leaf') return n
    const feId = (n as { feId?: string }).feId ?? m.functionalEvents[depth]?.id ?? `FE${depth + 1}`
    return { kind: 'branch', feId, success: fix(n.success, depth + 1), failure: fix(n.failure, depth + 1) }
  }
  return { ...m, root: fix(m.root, 0) }
}
```

- [ ] **Step 4: `branchLeaf` 改为带可选 feId(默认首个后续)**

`frontend/src/eventtree.ts:56-63` 整段替换:
```ts
export function branchLeaf(m: EventTreeModel, path: string[], feId?: string): EventTreeModel {
  const subs = subsequentFes(m, path)
  const chosen = feId ?? subs[0]?.id          // 默认下一可用屏障(与旧"下一屏障"语义一致)
  if (!chosen || !subs.some((f) => f.id === chosen)) return m   // 无后续 / 非法 → 原样
  const root = replaceAt(m.root, path, (n) =>
    n.kind === 'leaf'
      ? { kind: 'branch', feId: chosen, success: { kind: 'leaf', consequence: n.consequence }, failure: { kind: 'leaf', consequence: n.consequence } }
      : n)
  return { ...m, root }
}
```

- [ ] **Step 5: 新增 `mostSevere` / `branchesUsingFe` / `delFe`**

在 `frontend/src/eventtree.ts` 的 `addBarrierFromLib` 之后插入:
```ts
/** CONSEQUENCES 升序;返回子树中最严重后果(无叶→'C1')。 */
function mostSevere(n: EtNode): string {
  let worst = -1
  ;(function walk(x: EtNode) {
    if (x.kind === 'leaf') { const r = CONSEQUENCES.indexOf(x.consequence); if (r > worst) worst = r }
    else { walk(x.success); walk(x.failure) }
  })(n)
  return worst < 0 ? 'C1' : CONSEQUENCES[worst]
}
/** 统计树中判定该 feId 的分支数(供删除确认提示)。 */
export function branchesUsingFe(m: EventTreeModel, feId: string): number {
  let c = 0
  ;(function walk(n: EtNode) { if (n.kind === 'branch') { if (n.feId === feId) c++; walk(n.success); walk(n.failure) } })(m.root)
  return c
}
/** 删除第 idx 个功能事件;凡判定它的分支折叠为单叶(后果=该子树最严重,保守)。 */
export function delFe(m: EventTreeModel, idx: number): EventTreeModel {
  const fe = m.functionalEvents[idx]
  if (!fe) return m
  function fix(n: EtNode): EtNode {
    if (n.kind === 'leaf') return n
    if (n.feId === fe.id) return { kind: 'leaf', consequence: mostSevere(n) }
    return { ...n, success: fix(n.success), failure: fix(n.failure) }
  }
  return { ...m, functionalEvents: m.functionalEvents.filter((_, i) => i !== idx), root: fix(m.root) }
}
```

- [ ] **Step 6: `EtLayoutNode` 加 `successCol`/`failureCol`,`layout` 改用 feId 定列 + col 线程**

`frontend/src/eventtree.ts:100-125` 整段替换(`EtLayoutNode` 接口 + `layout`):
```ts
export interface EtLayoutNode {
  path: string[]; depth: number; y: number; kind: 'branch' | 'leaf'
  consequence?: string; freq?: number; successY?: number; failureY?: number
  successCol?: number; failureCol?: number
}
/** 叶按 DFS(成功优先)分行;分支 y=两子中点。列:分支=自身 feIndex,叶=父 feIndex+1(根叶=0)。 */
export function layout(m: EventTreeModel, rowH: number, headerH: number) {
  let row = 0
  const nodes: EtLayoutNode[] = []
  function walk(n: EtNode, path: string[], prob: number, col: number): { y: number; col: number } {
    if (n.kind === 'leaf') {
      const y = headerH + row * rowH + rowH / 2
      row++
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

- [ ] **Step 7: `toEngineRequest` 的 walk 改用 `n.feId`**

`frontend/src/eventtree.ts:153-164`(`walk` 函数体 + 调用)整段替换为:
```ts
  function walk(n: EtNode, path: Record<string, string>): void {
    if (n.kind === 'leaf') {
      const es = `L${leaf++}`
      sequences.push({ path: { ...path }, end_state: es })
      consequence_bins[es] = n.consequence
      return
    }
    walk(n.success, { ...path, [n.feId]: 'success' })
    walk(n.failure, { ...path, [n.feId]: 'failure' })
  }
  walk(m.root, {})
```
> 注:此处删去了原先的 `depth` 形参与 `m.functionalEvents[depth]?.id` 取键。`functional_events` 输出仍为全部 `m.functionalEvents`(不变)。

- [ ] **Step 8: `App.tsx` 旧存档规范化**

`frontend/src/App.tsx:12` 的 import 追加 `normalizeEta`:
```ts
import { buildCascade, newBlankEta, normalizeEta, setLinkFt, toEngineRequest, CONSEQUENCE_AT_DEPTH } from './eventtree'
```
`frontend/src/App.tsx:137` 替换:
```ts
    const model = normalizeEta(rec.payload.etModel as EventTreeModel)
```

- [ ] **Step 9: 构建(类型安全)**

Run: `npm run build --prefix frontend`
Expected: 成功,无 TS 报错。(`EventTreeEditor` 未改:`branchLeaf(model, sel!)` 因 feId 可选仍合法;读取 `b.successCol` 等新字段不报错;原级联渲染 `colX(b.depth+1)` 仍成立。)

- [ ] **Step 10: 回归验收(原级联不变)**

确保前端在运行(必要时 `preview_start bess-app`),`preview_eval` 选一个内置场景并跑引擎量化,断言序列频率与改造前一致(每 FE 仍按序全测 → 等价)。例如对 `SC_OVERCHARGE`:
```js
// 选择场景下拉到第一个 scenario,点「⚙ 引擎精确量化」,读叶上 ▶/= 值仍出现且与积式一致(无 NaN)
const svg = document.querySelector('svg')
const txt = [...svg.querySelectorAll('text')].map(t => t.textContent).join(' ')
JSON.stringify({ hasLeaves: /C[1-5]/.test(txt), noNaN: !/NaN/.test(txt) })
```
Expected: `{"hasLeaves":true,"noNaN":true}`;且引擎量化按钮不报错(无 `失败:` 文本)。

- [ ] **Step 11: Commit**

```bash
git add frontend/src/eventtree.ts frontend/src/App.tsx
git commit -m "feat(eta): 模型层支持显式 feId 分支(有序可跳过)+ delFe/normalizeEta

- EtNode 分支加 feId;layout/toEngineRequest 改用 feId(子集路径)
- branchLeaf 带可选 feId(默认首个后续屏障,旧语义兼容)
- 新增 feIndex/subsequentFes/branchesUsingFe/delFe/normalizeEta
- App.onLoadSaved 规范化旧存档

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: 视图层 #2 — 叶继续下拉 + 跨跳过列连线 + 选中分支按 feId

**Files:**
- Modify: `frontend/src/components/EventTreeEditor.tsx`

- [ ] **Step 1: 分支连线改用 successCol/failureCol(支持跨跳过列)**

`frontend/src/components/EventTreeEditor.tsx:110-121`(直角连接器 `nodes.filter(... 'branch')` 块)整段替换:
```tsx
          {/* 直角连接器(支持跨被跳过的列) */}
          {nodes.filter((n) => n.kind === 'branch').map((b, i) => {
            const x = colX(b.depth)
            const xs = colX(b.successCol ?? b.depth + 1)
            const xf = colX(b.failureCol ?? b.depth + 1)
            return (
              <g key={'b' + i}>
                <line x1={x} y1={b.successY} x2={x} y2={b.failureY} stroke="#94a3b8" strokeWidth={1.5} />
                <line x1={x} y1={b.successY} x2={xs} y2={b.successY} stroke="#16a34a" strokeWidth={2} />
                <text x={x + 6} y={b.successY! - 4} fontSize={9} fill="#16a34a">成功</text>
                <line x1={x} y1={b.failureY} x2={xf} y2={b.failureY} stroke="#dc2626" strokeWidth={2} />
                <text x={x + 6} y={b.failureY! - 4} fontSize={9} fill="#dc2626">失败</text>
              </g>
            )
          })}
```

- [ ] **Step 2: 选中分支按 feId 派生(替换 depth 派生)**

`frontend/src/components/EventTreeEditor.tsx:88-90`(`selIdx`/`selFeId` 两行)替换:
```tsx
  // 选中分支 → 其功能事件(屏障);按节点显式 feId 定位,而非深度
  const selFeId = selNode?.kind === 'branch' ? selNode.feId : undefined
  const selFe = selFeId ? model.functionalEvents.find((f) => f.id === selFeId) : undefined
  const selIdx = selFe ? model.functionalEvents.indexOf(selFe) : -1
```
> 下游 `model.functionalEvents[selIdx]` 的多处读取在 `selIdx>=0` 守卫下与 `selFe` 等价,无需再改;`onAttachFt?.(selIdx)`/`onDetachFt?.(selIdx)` 仍传 functionalEvents 下标,正确。

- [ ] **Step 3: 叶「继续到下一屏障」按钮 → 后续屏障下拉**

先在 import 处加入 `subsequentFes`。`frontend/src/components/EventTreeEditor.tsx:3-6` 的 import 列表追加 `subsequentFes`:
```tsx
import {
  branchLeaf, collapseNode, setConsequence, setFailProb, renameFe, addFe, addBarrierFromLib,
  nodeAt, layout, toEngineRequest, subsequentFes, CONSEQUENCES,
} from '../eventtree'
```
`frontend/src/components/EventTreeEditor.tsx:208-214`(叶分支按钮块,即 `<button disabled={sel!.length >= ...}>在此继续到下一屏障 ▸</button>` 及其后的提示)整段替换:
```tsx
            {(() => {
              const subs = subsequentFes(model, sel!)
              return subs.length === 0 ? (
                <div style={{ color: '#94a3b8', marginTop: 6 }}>已无更多可分支的后续屏障(可先「+ 添加屏障」)。</div>
              ) : (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span>继续到屏障:</span>
                  <select value="" onChange={(e) => { if (e.target.value) onChange(branchLeaf(model, sel!, e.target.value)) }}>
                    <option value="" disabled>选择后续屏障…</option>
                    {subs.map((f) => <option key={f.id} value={f.id}>{f.id} — {f.label}</option>)}
                  </select>
                </div>
              )
            })()}
```

- [ ] **Step 4: 构建**

Run: `npm run build --prefix frontend`
Expected: 成功,无 TS 报错。

- [ ] **Step 5: 行为验收(跳过分支)**

前端运行中,`preview_eval`:选中一个内置场景 → 点击树上**根节点圆点**(选中根分支?否,需选叶)。实际操作:选末态叶(最上方"成功"叶),在侧栏「继续到屏障」下拉里选一个**非相邻**的后续屏障(若可选≥2),断言新分支落在该屏障列、被跳过列在该路径无分支。
```js
// 1) 选中第一个叶锚点(circle, stroke=#d97706)
const leaf = [...document.querySelectorAll('circle')].find(c => c.getAttribute('stroke') === '#d97706')
leaf.dispatchEvent(new MouseEvent('click', { bubbles: true }))
```
然后在第二次 eval 中(DOM 更新后)对下拉选第二个后续屏障并断言:
```js
const sel = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => o.text.includes(' — ')))
const opts = [...sel.options].filter(o => o.value)
// 选最后一个后续屏障(若≥2 即为"跳过"分支)
setReactValue(sel, opts[opts.length - 1].value)
const svg = document.querySelector('svg')
const branchRisers = [...svg.querySelectorAll('line')].filter(l => l.getAttribute('stroke') === '#94a3b8').length
JSON.stringify({ chosen: opts[opts.length - 1].text, branchRisers, ok: branchRisers >= 1 })
```
Expected:返回中 `chosen` 为靠后屏障,`branchRisers` 增加(出现新分支),无报错。随后点「⚙ 引擎精确量化」断言无 `失败:` 文本(子集路径量化成功)。

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/EventTreeEditor.tsx
git commit -m "feat(eta): 选中叶可继续到任意后续屏障(下拉)+ 跨跳过列连线

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: 视图层 #1 — 初始事件布局修复(消除与首列重叠)

**Files:**
- Modify: `frontend/src/components/EventTreeEditor.tsx`

- [ ] **Step 1: 加宽前导区 `LEFT`**

`frontend/src/components/EventTreeEditor.tsx:42`:
```tsx
  const rowH = 46, headerH = 64, colW = 150, LEFT = 180
```

- [ ] **Step 2: 初始事件名截断 + 悬浮全名**

`frontend/src/components/EventTreeEditor.tsx:96-97`(初始事件名/频两行 `<text>`)替换为(名称限 13 字符,超出加 `…` 与 `<title>`;留 [8, LEFT-12] 空间):
```tsx
          <text x={8} y={26} fontSize={12} fontWeight={700}>
            {model.initEvent.length > 13 ? model.initEvent.slice(0, 13) + '…' : model.initEvent}
            <title>{model.initEvent}</title>
          </text>
          <text x={8} y={42} fontSize={10} fill="#64748b">{model.initFreq.toExponential(2)}/yr</text>
```

- [ ] **Step 3: 构建**

Run: `npm run build --prefix frontend`
Expected: 成功。

- [ ] **Step 4: 布局验收(无重叠)**

前端运行中,`preview_eval` 断言初始事件名文本的右边界不侵入首屏障列头文本的左边界:
```js
const svg = document.querySelector('svg')
const texts = [...svg.querySelectorAll('text')]
const init = texts.find(t => t.getAttribute('y') === '26')           // 初始事件名
const feHdr = texts.find(t => t.getAttribute('y') === '22')          // 首屏障列头(粗体, textAnchor=middle)
const a = init.getBBox(), b = feHdr.getBBox()
JSON.stringify({ initRight: Math.round(a.x + a.width), feLeft: Math.round(b.x), noOverlap: (a.x + a.width) <= b.x })
```
Expected: `noOverlap: true`(`initRight` ≤ `feLeft`)。若仍重叠,增大 `LEFT` 或减小截断长度后重验。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/EventTreeEditor.tsx
git commit -m "fix(eta): 加宽前导区并截断初始事件名,消除与首屏障列重叠

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: 视图层 #3 — 屏障删除(✕ + 确认折叠)

**Files:**
- Modify: `frontend/src/components/EventTreeEditor.tsx`

- [ ] **Step 1: import 追加 `branchesUsingFe`/`delFe`**

`frontend/src/components/EventTreeEditor.tsx` 顶部 eventtree import 列表追加 `branchesUsingFe, delFe`:
```tsx
import {
  branchLeaf, collapseNode, setConsequence, setFailProb, renameFe, addFe, addBarrierFromLib,
  branchesUsingFe, delFe, nodeAt, layout, toEngineRequest, subsequentFes, CONSEQUENCES,
} from '../eventtree'
```

- [ ] **Step 2: 功能事件行加 feId 前缀 + ✕ 删除**

`frontend/src/components/EventTreeEditor.tsx:188-194`(`model.functionalEvents.map((fe, d) => (...))` 块)整段替换:
```tsx
        {model.functionalEvents.map((fe, d) => (
          <div key={fe.id} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
            <span style={{ width: 42, fontSize: 11, color: '#64748b' }} title={fe.id}>{fe.id}</span>
            <input value={fe.label} onChange={(e) => onChange(renameFe(model, d, e.target.value))} style={{ width: 116, fontSize: 12 }} />
            <input type="number" step="0.01" min={0} max={1} value={fe.failProb}
              onChange={(e) => onChange(setFailProb(model, d, +e.target.value))} style={{ width: 60, fontSize: 12 }} />
            <button title="删除屏障" onClick={() => {
              const used = branchesUsingFe(model, fe.id)
              if (used === 0 || window.confirm(`将折叠 ${used} 个引用「${fe.label}」的分支为末态,继续?`)) onChange(delFe(model, d))
            }} style={{ color: '#dc2626', border: 0, background: 'none', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>✕</button>
          </div>
        ))}
```

- [ ] **Step 3: 构建**

Run: `npm run build --prefix frontend`
Expected: 成功。

- [ ] **Step 4: 行为验收(删除)**

前端运行中,`preview_eval`:
```js
// 记录删除前屏障数与列头数
const before = [...document.querySelectorAll('svg text')].filter(t => t.getAttribute('y') === '22').length
// 删除最后一个屏障(通常未被分支引用 → 直接删,无 confirm)
const rows = [...document.querySelectorAll('button[title="删除屏障"]')]
rows[rows.length - 1].dispatchEvent(new MouseEvent('click', { bubbles: true }))
```
第二次 eval(DOM 更新后):
```js
const after = [...document.querySelectorAll('svg text')].filter(t => t.getAttribute('y') === '22').length
JSON.stringify({ after, decreased: true })  // 与 before 比较应 -1
```
Expected: 列头数减少 1,无报错。再用 `window.confirm` 自动 mock(`window.confirm = () => true`)删除一个被引用屏障,断言树折叠为更少的叶且无 `NaN`。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/EventTreeEditor.tsx
git commit -m "feat(eta): 屏障列表支持删除(未引用直删/被引用确认后折叠为末态)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: 全量验证 + ROADMAP + 收尾

**Files:**
- Modify: `docs/superpowers/ROADMAP.md`

- [ ] **Step 1: 后端全量**

Run: `python -m pytest -q`
Expected: 137 passed / 2 skipped(原 135 + Task1 新增 2)。

- [ ] **Step 2: 前端构建**

Run: `npm run build --prefix frontend`
Expected: 成功,无 TS 报错。

- [ ] **Step 3: 综合 preview 复验**

前端运行中,依次确认:① 初始事件不与首列重叠(Task4 断言 `noOverlap:true`);② 叶下拉可跳到非相邻后续屏障并出分支(Task3);③ 删未引用屏障直接删、删被引用屏障确认后折叠(Task5);④ 对一个原级联场景跑「⚙ 引擎精确量化」数值与改造前一致(回归)。

- [ ] **Step 4: 更新 ROADMAP**

在 `docs/superpowers/ROADMAP.md` 追加一行批次记录(置于既有已完成条目区):
```markdown
- [x] ETA 灵活分支:有序可跳过(每分支显式 feId,选中叶可继续到任意后续屏障)+ 屏障增删 + 初始事件布局修复(spec/plan 2026-06-22-eta-flexible-branching)。引擎已支持子集路径,新增守护测试 `tests/test_event_tree_skip.py`。
```

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/ROADMAP.md
git commit -m "docs(roadmap): ETA 有序可跳过分支 + 屏障增删 + 布局修复

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 6: 收尾合并**

用 **superpowers:finishing-a-development-branch** 把 `feat/eta-flexible-branching` 合并回 `main`(`--no-ff`),合并后跑一次 `python -m pytest -q` 确认绿,删除分支。提醒用户硬刷新浏览器(纯前端 + 守护测试,:8000 静态托管 dist,build 后即生效)。

---

## Self-Review(对照 spec)

**1. Spec coverage**
- §2.1 模型(feId/buildCascade/normalizeEta/feIndex/maxAncestorFeIndex/subsequentFes/branchLeaf/delFe/mostSevere/branchesUsingFe/layout/toEngineRequest)→ Task 2 全覆盖。
- §2.2 UI(布局修复/叶下拉/屏障增删/选中分支 feId)→ Task 4 / Task 3 / Task 5 / Task 3。
- §2.3 App normalizeEta → Task 2 Step 8。
- §3 后端守护测试 → Task 1。§4 验收 / §5 回归 → Task 2 Step10、Task 6。
- 无遗漏需求。

**2. Placeholder scan**:无 TBD/TODO;每个代码步骤含完整代码;每个验证步骤含具体命令/eval 与期望值。

**3. Type consistency**:`EtNode.branch.feId:string`(必填,Task2 S1)与 `buildCascade`/`branchLeaf`/`normalizeEta`/`layout`/`toEngineRequest`/`delFe` 全部一致使用 `n.feId`;`branchLeaf(m, path, feId?)` 签名在 Task2 定义、Task3 以三参调用一致;`subsequentFes`/`branchesUsingFe`/`delFe` 在 Task2 定义、Task3/5 import 并调用一致;`EtLayoutNode.successCol/failureCol` 在 Task2 定义、Task3 渲染读取一致。
