# ETA/FTA Modeling Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 5 modeling features to the BESS PSA frontend — initiating-event frequency from 3 sources (manual/FTA/product-dimension), a Consequences tab where leaves bind to specific consequence entries (many per C1–C5 level), FTA-tab ↔ ETA linkage (edit mounted FTAs), FTA intermediate events (gates with descriptions), and product-dimension cell→initiating-event mapping.

**Architecture:** Frontend-only (React 18 + TS, Vite). All ETA model logic lives in `frontend/src/eventtree.ts` (pure, unit-tested with vitest); FTA model in `frontend/src/model.ts`. The engine/MEF/backend contract is **unchanged** — consequence binning stays C1–C5 (`toEngineRequest`/`consequenceTotals` resolve a leaf's entry id to its level). Backward compatibility is centralized in `normalizeEta` (run on every load), so old archives and old leaves (`consequence:'C1'`) keep working.

**Tech Stack:** React 18, TypeScript (strict, `verbatimModuleSyntax` → `import type`), Vite 5, vitest 2 (jsdom). Run tests: `npm run test --prefix frontend` (vitest) and `.venv/Scripts/python.exe -m pytest -q` (backend regression). Type-check/build: `npm run build --prefix frontend`.

**Conventions (IMPORTANT):**
- vitest config includes `src/**/*.{test,spec}.ts(x)`; test files MUST be type-clean (they're in `tsc -b`). Use explicit `import { describe, it, expect } from 'vitest'`.
- All `eventtree.ts`/`model.ts` ops are pure (return new objects).
- `CONSEQUENCES = ['C1','C2','C3','C4','C5']` and `DEFAULT_CONSEQUENCE_DEFS` already exist in `eventtree.ts`.
- Do NOT start servers for unit work. UI tasks verify via the preview tools (frontend `:5173` proxying `/api`→`:8000`); window.prompt-based flows can be driven by overriding `window.prompt` in `preview_eval`.
- End every commit body with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `frontend/src/eventtree.ts` | modify | ETA model: add `initFreqSource`/`product`/`consequences`; consequence-entry + init-source + product helpers; migrate in `normalizeEta`; resolve leaf→level in `consequenceTotals`/`toEngineRequest`/`mostSevere`. |
| `frontend/src/eventtree.test.ts` | create | vitest for the above pure functions. |
| `frontend/src/model.ts` | modify | FTA model: `FtNodeJson.label`; `addGate(..., label?)`. |
| `frontend/src/model.test.ts` | create | vitest for gate label. |
| `frontend/src/components/ConsequencesTab.tsx` | create | The new 后果 tab view: edit the active ETA's `consequences` list. |
| `frontend/src/App.tsx` | modify | Add `cons` tab; init-FTA (`__init__`) mount + recompute `initFreq` by source; FTA-tab left sidebar listing mounted FTAs + canvas data-source switch. |
| `frontend/src/components/EventTreeEditor.tsx` | modify | Initial-event source panel; leaf consequence picker (entries grouped by level). |
| `frontend/src/components/FaultTreeCanvas.tsx` | modify | Render gate as intermediate-event rectangle (label) above the gate symbol. |
| `frontend/src/components/Inspector.tsx` | modify | Edit gate `label`. |
| `frontend/src/layout.ts` | modify (if needed) | Size gate nodes to fit the rectangle. |

---

## Task 1: ETA data model — consequence entries, init source, product dims (pure + vitest)

**Files:**
- Modify: `frontend/src/eventtree.ts`
- Create: `frontend/src/eventtree.test.ts`

This is the foundation. Everything else calls these functions.

- [ ] **Step 1: Write failing tests.** Create `frontend/src/eventtree.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  newBlankEta, normalizeEta, defaultConsequences, consEntries, consLevel, consText,
  addConsequence, updateConsequence, delConsequence, consequenceTotals, toEngineRequest,
  setInitFreqSource, setProduct, computeProductFreq, setConsequence,
} from './eventtree'
import type { EventTreeModel } from './eventtree'

describe('consequence entries', () => {
  it('default 5 entries id=level=C1..C5', () => {
    const d = defaultConsequences()
    expect(d.map((e) => e.id)).toEqual(['C1', 'C2', 'C3', 'C4', 'C5'])
    expect(d.every((e) => e.id === e.level)).toBe(true)
  })

  it('old consequenceDefs migrates to 5 entries; old leaf "C1" still resolves', () => {
    const old = { initEvent: 'IE', initFreq: 1e-3, functionalEvents: [],
      root: { kind: 'leaf', consequence: 'C2' }, consequenceDefs: { C2: '自定义二级' } } as any
    const m = normalizeEta(old)
    expect(consEntries(m)).toHaveLength(5)
    expect(consText(m, 'C2')).toBe('自定义二级')
    expect(consLevel(m, 'C2')).toBe('C2')
  })

  it('add a second consequence under C3; level can repeat', () => {
    let m = newBlankEta('x')
    m = addConsequence(m, '额外三级后果', 'C3')
    const c3 = consEntries(m).filter((e) => e.level === 'C3')
    expect(c3).toHaveLength(2)
    const added = c3.find((e) => e.desc === '额外三级后果')!
    expect(consLevel(m, added.id)).toBe('C3')
  })

  it('default 5 are locked: cannot delete, level immutable, desc editable', () => {
    let m = newBlankEta('x')
    m = delConsequence(m, 'C1')
    expect(consEntries(m).some((e) => e.id === 'C1')).toBe(true)        // not deleted
    m = updateConsequence(m, 'C1', { desc: '改写', level: 'C5' })
    expect(consText(m, 'C1')).toBe('改写')                              // desc changed
    expect(consLevel(m, 'C1')).toBe('C1')                              // level locked
  })

  it('leaf bound to a custom entry bins by that entry level', () => {
    let m = newBlankEta('x')                                           // 2 barriers, cascade leaves C1..C3
    m = addConsequence(m, '特定后果', 'C4')
    const eid = consEntries(m).find((e) => e.desc === '特定后果')!.id
    m = setConsequence(m, ['failure', 'failure'], eid)                 // deepest leaf → custom C4 entry
    const totals = consequenceTotals(m)
    expect(totals.C4).toBeGreaterThan(0)                              // aggregated under level C4
    const req = toEngineRequest(m)
    expect(Object.values(req.consequence_bins)).toContain('C4')       // engine bin is a LEVEL
  })
})

describe('init freq sources', () => {
  it('product freq = rate × cellsPerPack × packsPerSystem', () => {
    let m = newBlankEta('x')
    m = setInitFreqSource(m, 'product')
    m = setProduct(m, { cellsPerPack: 100, packsPerSystem: 20, cellFailureRate: 1e-7 })
    expect(computeProductFreq(m)).toBeCloseTo(2e-4, 12)
  })

  it('normalizeEta defaults source to manual', () => {
    const m = normalizeEta({ initEvent: 'IE', initFreq: 1, functionalEvents: [],
      root: { kind: 'leaf', consequence: 'C1' } } as any)
    expect(m.initFreqSource).toBe('manual')
  })
})
```

- [ ] **Step 2: Run, verify FAIL.** `npm run test --prefix frontend` → fails (new exports undefined).

- [ ] **Step 3: Implement in `frontend/src/eventtree.ts`.**

3a. Add types (near top, after `FuncEvent`):
```ts
export type ConsLevel = 'C1' | 'C2' | 'C3' | 'C4' | 'C5'
export interface ConsequenceDef { id: string; desc: string; level: ConsLevel }
export type InitFreqSource = 'manual' | 'ft' | 'product'
export interface ProductDims { cellsPerPack: number; packsPerSystem: number; cellFailureRate: number }
```

3b. Extend `EventTreeModel` (keep `consequenceDefs?` for old-archive reads):
```ts
export interface EventTreeModel {
  initEvent: string
  initFreq: number
  functionalEvents: FuncEvent[]
  root: EtNode
  consequenceDefs?: Record<string, string>   // legacy; migrated by normalizeEta → consequences
  consequences?: ConsequenceDef[]
  initFreqSource?: InitFreqSource
  product?: ProductDims
}
```

3c. Consequence helpers (add after `consDef`):
```ts
export function defaultConsequences(): ConsequenceDef[] {
  return CONSEQUENCES.map((c) => ({ id: c, desc: DEFAULT_CONSEQUENCE_DEFS[c] ?? '', level: c as ConsLevel }))
}
export function consEntries(m: EventTreeModel): ConsequenceDef[] {
  return m.consequences && m.consequences.length ? m.consequences : defaultConsequences()
}
/** Resolve a leaf's consequence id → entry; a bare level id (old leaf) or unknown → synthesized level entry. */
export function consEntry(m: EventTreeModel, consId: string): ConsequenceDef {
  const e = consEntries(m).find((x) => x.id === consId)
  if (e) return e
  const lvl = (CONSEQUENCES.includes(consId) ? consId : 'C1') as ConsLevel
  return { id: consId, desc: DEFAULT_CONSEQUENCE_DEFS[lvl] ?? '', level: lvl }
}
export function consLevel(m: EventTreeModel, consId: string): ConsLevel { return consEntry(m, consId).level }
export function consText(m: EventTreeModel, consId: string): string { return consEntry(m, consId).desc }

function uniqConsId(list: ConsequenceDef[]): string {
  let i = 1; while (list.some((e) => e.id === `K${i}`)) i++; return `K${i}`
}
export function addConsequence(m: EventTreeModel, desc: string, level: ConsLevel): EventTreeModel {
  const list = consEntries(m)
  return { ...m, consequences: [...list, { id: uniqConsId(list), desc, level }] }
}
export function updateConsequence(
  m: EventTreeModel, id: string, patch: { desc?: string; level?: ConsLevel },
): EventTreeModel {
  const locked = CONSEQUENCES.includes(id)   // default C1..C5: desc editable, level locked
  return { ...m, consequences: consEntries(m).map((e) =>
    e.id === id ? { ...e, desc: patch.desc ?? e.desc, level: locked ? e.level : (patch.level ?? e.level) } : e) }
}
export function delConsequence(m: EventTreeModel, id: string): EventTreeModel {
  if (CONSEQUENCES.includes(id)) return m    // default 5 cannot be deleted
  return { ...m, consequences: consEntries(m).filter((e) => e.id !== id) }
}
```

3d. Replace `consDef` body to delegate to entries (level → joined descs of that level):
```ts
export function consDef(m: EventTreeModel, c: string): string {
  const here = consEntries(m).filter((e) => e.level === c).map((e) => e.desc).filter(Boolean)
  return here.length ? here.join('; ') : (DEFAULT_CONSEQUENCE_DEFS[c] ?? '')
}
```

3e. Init-source + product helpers (add near `setInitFreq`):
```ts
export function setInitFreqSource(m: EventTreeModel, src: InitFreqSource): EventTreeModel {
  return { ...m, initFreqSource: src }
}
export function setProduct(m: EventTreeModel, patch: Partial<ProductDims>): EventTreeModel {
  const base: ProductDims = { cellsPerPack: 100, packsPerSystem: 20, cellFailureRate: 1e-7 }
  return { ...m, product: { ...base, ...m.product, ...patch } }
}
/** product 频率 = 电芯失效率 × 单Pack电芯数 × 单系统Pack数;无 product 时回退现 initFreq。 */
export function computeProductFreq(m: EventTreeModel): number {
  const p = m.product
  return p ? p.cellFailureRate * p.cellsPerPack * p.packsPerSystem : m.initFreq
}
```

3f. Update `normalizeEta` to migrate + default source (replace its `return`):
```ts
  const consequences = (m.consequences && m.consequences.length)
    ? m.consequences
    : CONSEQUENCES.map((c) => ({ id: c, desc: m.consequenceDefs?.[c] ?? DEFAULT_CONSEQUENCE_DEFS[c] ?? '', level: c as ConsLevel }))
  return { ...m, root: fix(m.root, 0), consequences, initFreqSource: m.initFreqSource ?? 'manual' }
```
(Remove the old `consequenceDefs: m.consequenceDefs ?? {...}` from the return.)

3g. Resolve leaf→level where leaves are aggregated. In `consequenceTotals`:
```ts
  for (const n of layout(m, 1, 0).nodes) if (n.kind === 'leaf') {
    const lvl = consLevel(m, n.consequence!)
    t[lvl] = (t[lvl] ?? 0) + (n.freq ?? 0)
  }
```
In `toEngineRequest`, change the leaf line to bin by level:
```ts
      consequence_bins[es] = consLevel(m, n.consequence)
```
In `mostSevere`, take `m` and resolve via level (update signature + its caller `delFe`):
```ts
function mostSevere(m: EventTreeModel, n: EtNode): string {
  let worst = -1
  ;(function walk(x: EtNode) {
    if (x.kind === 'leaf') { const r = CONSEQUENCES.indexOf(consLevel(m, x.consequence)); if (r > worst) worst = r }
    else { walk(x.success); walk(x.failure) }
  })(n)
  return worst < 0 ? 'C1' : CONSEQUENCES[worst]
}
```
In `delFe`, change `consequence: mostSevere(n)` → `consequence: mostSevere(m, n)`.

- [ ] **Step 4: Run, verify PASS.** `npm run test --prefix frontend` → all green (existing + new). Then `npm run build --prefix frontend` → tsc clean.

- [ ] **Step 5: Commit.**
```bash
git add frontend/src/eventtree.ts frontend/src/eventtree.test.ts
git commit -m "feat(eta): 后果条目模型 + 初因来源 + 产品维度(纯函数+迁移+vitest)"
```

---

## Task 2: Consequences tab + leaf consequence picker

**Files:**
- Create: `frontend/src/components/ConsequencesTab.tsx`
- Modify: `frontend/src/App.tsx` (tab nav + render), `frontend/src/components/EventTreeEditor.tsx` (leaf picker)

Depends on Task 1.

- [ ] **Step 1: Build `ConsequencesTab.tsx`.** A controlled component editing the active ETA's consequences. Props:
```ts
import type { EventTreeModel, ConsLevel } from '../eventtree'
export function ConsequencesTab({ model, onChange }: {
  model: EventTreeModel
  onChange: (m: EventTreeModel) => void
}) { /* ... */ }
```
Render, using `consEntries(model)` and `CONSEQUENCES`:
- A table grouped by level C1→C5. Each row: editable `desc` (text input → `updateConsequence(model, id, {desc})`), a `level` `<select>` of C1–C5 (→ `updateConsequence(model, id, {level})`, **disabled when `CONSEQUENCES.includes(id)`** i.e. the default 5), and a 删除 button (calls `delConsequence`; **hidden/disabled when `CONSEQUENCES.includes(id)`**).
- A footer "＋新增后果" button that calls `addConsequence(model, '新后果', 'C3')`.
- A hint line: 默认 C1–C5 五条不可删、等级锁定;可改文字或新增同级后果。
All edits go through `onChange(updateConsequence(...))` etc. No local state beyond input drafts.

- [ ] **Step 2: Wire the tab in `App.tsx`.**
  - Extend the tab union: `const [tab, setTab] = useState<'ft'|'bess'|'params'|'library'|'cons'>('bess')`.
  - Add a nav button after 参考库: `<button onClick={() => setTab('cons')} style={tabBtn(tab === 'cons')}>后果</button>`.
  - Add a render branch (a sibling to the existing `tab === 'library'` / ETA branches): when `tab === 'cons'`, render
    `{etModel ? <ConsequencesTab model={etModel} onChange={etHist.set} /> : <p>加载中…</p>}`
    inside a scrollable padded container matching the other tabs' wrapper styling.
  - Import `ConsequencesTab`.

- [ ] **Step 3: Leaf consequence picker in `EventTreeEditor.tsx`.** Where a leaf's consequence is currently chosen (the leaf `<select>` of C1–C5 and the hover/label showing `consDef`), change to choose a consequence **entry**:
  - Options: `consEntries(model).map((e) => <option value={e.id}>{e.level} — {e.desc}</option>)` (optionally `<optgroup label={level}>` grouped by level).
  - On change: `onChange(setConsequence(model, leafPath, e.target.value))` (unchanged signature; value is now an entry id).
  - Leaf display/hover: `${consLevel(model, leaf.consequence)} — ${consText(model, leaf.consequence)}`.
  - Import `consEntries, consLevel, consText` from `../eventtree`.

- [ ] **Step 4: Verify.**
  - `npm run build --prefix frontend` → tsc clean.
  - Preview DOM check (frontend `:5173`): open ETA, switch to 后果 tab, confirm 5 default rows render with delete disabled; add a C4 consequence; back on the ETA, the leaf picker lists it; pick it for a leaf; the risk matrix / consequence totals still bin under C4. (Drive via `preview_eval`: query `document.querySelectorAll`, set `<select>` value via native setter + `dispatchEvent(new Event('change',{bubbles:true}))`.)

- [ ] **Step 5: Commit.**
```bash
git add frontend/src/components/ConsequencesTab.tsx frontend/src/App.tsx frontend/src/components/EventTreeEditor.tsx
git commit -m "feat(eta): 后果页签(条目编辑, 一级多条) + 叶后果条目选择器"
```

---

## Task 3: Initial-event frequency — 3 sources panel + `__init__` FTA

**Files:**
- Modify: `frontend/src/components/EventTreeEditor.tsx` (initial-event panel), `frontend/src/App.tsx` (`__init__` FTA mount + recompute)

Depends on Task 1.

- [ ] **Step 1: Initial-event source UI in `EventTreeEditor.tsx`.** In the initial-event side panel (where `setInitEvent`/`setInitFreq` are used today), add a 来源 radio bound to `model.initFreqSource ?? 'manual'`, switching via `onChange(setInitFreqSource(model, src))`. Render conditionally:
  - `manual` → existing frequency input (`setInitFreq`).
  - `product` → three number inputs bound to `model.product` (defaults via `setProduct`): 单Pack电芯数 (`cellsPerPack`), 单系统Pack数 (`packsPerSystem`), 电芯失效率 (`cellFailureRate`); each `onChange` → `onChange(setProduct(model, {<field>: Number(v)}))`. Show read-only `总电芯数 = cellsPerPack×packsPerSystem` and `初始频率 = computeProductFreq(model)`.
  - `ft` → a button 「挂载/编辑初始事件 FTA」 that calls a new prop `onEditInitFt()`, plus a read-only display of the current `model.initFreq` (the computed top). 
  - Add props: `onEditInitFt: () => void`. Import `setInitFreqSource, setProduct, computeProductFreq` from `../eventtree`.

- [ ] **Step 2: `App.tsx` — derive `initFreq` from source.** Add an effect/handler that keeps `etModel.initFreq` consistent with the source:
  - When `initFreqSource === 'product'`: on any product change, `etHist.set(setInitFreq(m, computeProductFreq(m)))` (do it inside the same update the editor triggers, or a `useEffect` keyed on `etModel.product`/`initFreqSource`).
  - When `initFreqSource === 'ft'`: reuse the barrier-FT pipeline. Store the init FTA in `etFts` under the reserved name `'__init__'`. Provide `onEditInitFt` that opens the existing `BarrierFtModal` targeting `'__init__'` (the modal already edits an `etFts` fault tree by name + computes its top via `/api/quantify`). On the modal's top-prob callback, `etHist.set(setInitFreq(m, top))`. Reuse `attachStarterFt(etFts.model, '__init__', m.initFreq)` to seed it if absent.
  - When `'manual'`: no derived recompute (user edits directly).
  - Pass `onEditInitFt` into `<EventTreeEditor>`.

- [ ] **Step 3: Verify.**
  - `npm run build --prefix frontend` → clean.
  - Preview DOM: switch source to 产品维度, enter 100 / 20 / 1e-7 → confirm 初始频率 shows `2e-4` and the ETA leaf frequencies scale accordingly; switch to FTA, mount a trivial FTA, confirm top flows into initFreq; switch back to 手工 → manual entry still works.

- [ ] **Step 4: Commit.**
```bash
git add frontend/src/components/EventTreeEditor.tsx frontend/src/App.tsx
git commit -m "feat(eta): 初始事件频率三来源(手工/FTA __init__/产品维度)"
```

---

## Task 4: FTA intermediate events — gate label (pure + vitest, then render)

**Files:**
- Modify: `frontend/src/model.ts`, `frontend/src/components/FaultTreeCanvas.tsx`, `frontend/src/components/Inspector.tsx`, (`frontend/src/layout.ts` if sizing needed)
- Create: `frontend/src/model.test.ts`

Depends on nothing (independent of Tasks 1–3).

- [ ] **Step 1: Failing test.** Create `frontend/src/model.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { addGate, updateNode, getFt } from './model'
import type { ModelJson } from './model'

const base: ModelJson = { model_data: { parameters: [] }, fault_trees: [{ name: 'FT', top: '', nodes: [] }] }

describe('gate label (intermediate event)', () => {
  it('addGate sets an editable label; updateNode changes it', () => {
    let m = addGate(base, 'FT', 'or')
    const gid = getFt(m, 'FT').nodes.find((n) => n.op === 'or')!.id
    expect(getFt(m, 'FT').nodes.find((n) => n.id === gid)!.label).toBeTypeOf('string')
    m = updateNode(m, 'FT', gid, { label: '中间事件A' })
    expect(getFt(m, 'FT').nodes.find((n) => n.id === gid)!.label).toBe('中间事件A')
  })
})
```

- [ ] **Step 2: Run, verify FAIL** (`label` not set by `addGate`): `npm run test --prefix frontend`.

- [ ] **Step 3: Implement in `model.ts`.**
  - Add to `FtNodeJson`: `label?: string`.
  - In `addGate`, seed a default label:
```ts
export function addGate(m: ModelJson, ftName: string, op: string, k = 2): ModelJson {
  const nm = clone(m), ft = getFt(nm, ftName), id = uid('G')
  ft.nodes.push({ id, op, args: [], label: '中间事件', ...(op === 'atleast' ? { k } : {}) })
  return nm
}
```
  (`updateNode` already does `Object.assign(n, patch)`, so `{label}` works with no change.)

- [ ] **Step 4: Run, verify PASS.** `npm run test --prefix frontend`.

- [ ] **Step 5: Render intermediate-event rectangle.** In `FaultTreeCanvas.tsx`, for gate nodes (those with `op`), render a labeled rectangle (showing `node.label || node.id`) above the gate symbol; basic events unchanged. In `Inspector.tsx`, when a gate is selected, add a text input bound to `node.label` → `updateNode(model, ftName, id, { label })`. If gate node width/height in `layout.ts` is fixed, widen gate boxes to fit the label text (follow existing node-sizing patterns). Keep basic-event rendering as-is.

- [ ] **Step 6: Verify.** `npm run build --prefix frontend` → clean. Preview DOM: in the FTA tab, add a gate, set its label in the Inspector, confirm the rectangle shows the label; reload an example FT (gates without label) → renders with id (no regression).

- [ ] **Step 7: Commit.**
```bash
git add frontend/src/model.ts frontend/src/model.test.ts frontend/src/components/FaultTreeCanvas.tsx frontend/src/components/Inspector.tsx frontend/src/layout.ts
git commit -m "feat(fta): 中间事件(门带描述, 渲染为矩形 + Inspector 编辑)"
```

---

## Task 5: FTA tab ↔ ETA linkage (left sidebar of mounted FTAs)

**Files:**
- Modify: `frontend/src/App.tsx`

Depends on Tasks 3 (for `__init__`) — but works without it for barrier FTAs.

- [ ] **Step 1: Build the sidebar + canvas source switch in `App.tsx`.** In the `tab === 'ft'` branch, add a left sidebar listing the active ETA's mounted fault trees:
  - Source list: from `etFts.model?.fault_trees ?? []`, the ones referenced by a barrier (`etModel.functionalEvents.filter(f => f.linkFt).map(f => ({ name: f.id, label: f.label }))`) plus `'__init__'` if present (label「初始事件」). Render each as a clickable row.
  - Add state `const [ftEditTarget, setFtEditTarget] = useState<{ src: 'model' } | { src: 'eta'; name: string }>({ src: 'model' })`.
  - Clicking an ETA row sets `{ src: 'eta', name }`; a "示例模型" group (existing `examples` select) sets `{ src: 'model' }`.
  - The canvas binds to the selected source:
    - `src: 'model'` → existing `model` useModel + `ftName` (unchanged behavior).
    - `src: 'eta'` → render `FaultTreeCanvas`/`Palette`/`Inspector` against `etFts.model` with `ftName = name`, and route edits through `etFts.set(...)` (the same instance the ETA uses → edits sync back to the ETA's mounted FTA). Recompute that barrier's PFD on edit by reusing the existing `onFtEdited(feId, prob)` path (call `/api/quantify` for that fault tree), exactly as `BarrierFtModal` does.
  - Keep `FaultTreeCanvas`/`Palette`/`Inspector` reused; only the model/handlers they receive change with `ftEditTarget`.

- [ ] **Step 2: Verify.** `npm run build --prefix frontend` → clean. Preview DOM: mount an FTA on an ETA barrier, go to FTA tab, confirm the sidebar lists it; select it, edit a basic event's probability on the canvas, return to the ETA, confirm that barrier's PFD updated (linkage works).

- [ ] **Step 3: Commit.**
```bash
git add frontend/src/App.tsx
git commit -m "feat(fta): FTA 页左栏列出 ETA 挂载 FTA, 选中即画布编辑(与 ETA 联动)"
```

---

## Task 6: Regression, report passthrough, docs/memory

**Files:**
- Modify: `frontend/src/components/EventTreeEditor.tsx` (report passthrough if needed), `docs/superpowers/ROADMAP.md`

- [ ] **Step 1: Report passthrough check.** Confirm the report export still sends correct consequence text. In `EventTreeEditor.tsx` where it builds the report request (`consequence_defs` + `labels`), ensure it uses `consText`/`consLevel` so per-sequence labels and per-level defs reflect the new entries. If it already passes `model.consequenceDefs`, switch to building from `consEntries`/`consText`. (Backend `report_export.py` unchanged.)

- [ ] **Step 2: Full regression.**
  - `npm run test --prefix frontend` → all vitest green.
  - `npm run build --prefix frontend` → `tsc -b && vite build` clean.
  - `.venv/Scripts/python.exe -m pytest -q` → no backend regression (169 passed / 2 skipped baseline).

- [ ] **Step 3: Docs.** Add a bullet to `docs/superpowers/ROADMAP.md` (frontend section) summarizing the 5 features + linking this plan/spec.

- [ ] **Step 4: Commit.**
```bash
git add frontend/src/components/EventTreeEditor.tsx docs/superpowers/ROADMAP.md
git commit -m "chore(eta-fta): 报告后果文字透传校正 + ROADMAP 记录"
```

---

## Self-Review

**Spec coverage:** ① init 3-source → Task 3 (+Task 1 helpers). ② consequences tab/multi-per-level → Tasks 1+2. ③ FTA↔ETA linkage → Task 5. ④ intermediate events → Task 4. ⑤ product dimension → Tasks 1+3. ⑥ multi-agent execution → subagent-driven (this plan's required sub-skill). All covered.

**Backward compat:** `normalizeEta` (run on load) migrates `consequenceDefs`→`consequences` and defaults `initFreqSource='manual'`; old leaves `'C1'..'C5'` resolve via `consEntry`. Engine bins remain C1–C5 (`consLevel`). ✓

**Type consistency:** `consequence` (leaf) is an entry id everywhere; `consLevel`/`consText`/`consEntry`/`consEntries` are the only resolvers; `setConsequence` signature unchanged (value is an entry id); `mostSevere(m, n)` updated at its single caller `delFe`. `ConsLevel`/`ConsequenceDef`/`InitFreqSource`/`ProductDims` defined in Task 1 and reused in Tasks 2/3. ✓

**Placeholder scan:** Data-layer steps (Tasks 1, 4) carry complete code + tests. UI steps (Tasks 2, 3, 5) give exact data-functions to call, props, and integration points; the implementer reads each component to place the JSX following existing patterns (no vague "add error handling"). ✓
