# ETA Editor Interactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two ETA event-tree editor interactions — a full barrier inspector when a branch node is clicked (rename / PFD / mount·detach FTA / reassign barrier / delete), and conditional branch probabilities (成功 1−PFD, 失效 PFD) on the success/failure branches. (Undo/redo already exist — out of scope.)

**Architecture:** Frontend-only. A new pure model op `setBranchFe` (+ `branchFeOptions`) in `frontend/src/eventtree.ts` reassigns a branch's judged functional event while preserving the "ordered-skippable" invariant; the rest reuses existing ops (`renameFe`/`setFailProb`/`delFe`/`onAttachFt`/`onDetachFt`). All UI lives in `frontend/src/components/EventTreeEditor.tsx`. Engine/MEF/backend contract unchanged.

**Tech Stack:** React 18, TypeScript (strict, `import type`), Vite 5, vitest 2. Run tests: `npm run test --prefix frontend`. Type-check/build: `npm run build --prefix frontend`. End commit bodies with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `frontend/src/eventtree.ts` | modify | Add `branchFeOptions(m, path)` + `setBranchFe(m, path, newFeId)` (invariant-guarded reassign). |
| `frontend/src/eventtree.test.ts` | modify | vitest for the two new functions. |
| `frontend/src/components/EventTreeEditor.tsx` | modify | Branch-node barrier inspector (rename/PFD/FTA/reassign/delete) + conditional branch-prob SVG labels. |
| `docs/superpowers/ROADMAP.md` | modify | Record the two interactions. |

---

## Task 1: `setBranchFe` + `branchFeOptions` (pure + vitest)

**Files:** Modify `frontend/src/eventtree.ts`; modify `frontend/src/eventtree.test.ts`.

Context: `EtNode` branch = `{kind:'branch', feId, success, failure}`. Invariant ("ordered-skippable"): along any root→leaf path, branch `feIndex` strictly increases. Existing helpers available in the file: `feIndex(m, feId)`, `maxAncestorFeIndex(m, path)` (root → -1), `nodeAt(root, path)`, `replaceAt(root, path, fn)`, types `EventTreeModel`/`EtNode`/`FuncEvent`.

- [ ] **Step 1: Add failing tests** to `frontend/src/eventtree.test.ts` (append a new `describe`):

```ts
import { branchFeOptions, setBranchFe } from './eventtree'
import type { EventTreeModel } from './eventtree'

const mk = (root: any): EventTreeModel => ({
  initEvent: 'IE', initFreq: 1e-3,
  functionalEvents: [
    { id: 'FE1', label: 'B1', failProb: 0.1 }, { id: 'FE2', label: 'B2', failProb: 0.1 },
    { id: 'FE3', label: 'B3', failProb: 0.1 }, { id: 'FE4', label: 'B4', failProb: 0.1 },
  ],
  root,
})
const leaf = (c = 'C1') => ({ kind: 'leaf', consequence: c })

describe('branchFeOptions / setBranchFe', () => {
  it('both-leaf-children branch → options are all subsequent FEs', () => {
    const m = mk({ kind: 'branch', feId: 'FE2', success: leaf(), failure: leaf('C3') })
    expect(branchFeOptions(m, []).map((f) => f.id)).toEqual(['FE1', 'FE2', 'FE3', 'FE4'])
  })

  it('options are bounded below by ancestors and above by subtree min', () => {
    // root FE1; failure subtree starts at FE3 → root options limited to index < 2
    const m = mk({ kind: 'branch', feId: 'FE1', success: leaf(),
      failure: { kind: 'branch', feId: 'FE3', success: leaf(), failure: leaf('C4') } })
    expect(branchFeOptions(m, []).map((f) => f.id)).toEqual(['FE1', 'FE2'])
  })

  it('setBranchFe reassigns to a valid FE', () => {
    const m = mk({ kind: 'branch', feId: 'FE2', success: leaf(), failure: leaf('C3') })
    const m2 = setBranchFe(m, [], 'FE4')
    expect((m2.root as any).feId).toBe('FE4')
  })

  it('setBranchFe rejects an out-of-order FE (no-op)', () => {
    const m = mk({ kind: 'branch', feId: 'FE1', success: leaf(),
      failure: { kind: 'branch', feId: 'FE3', success: leaf(), failure: leaf('C4') } })
    expect(setBranchFe(m, [], 'FE3')).toBe(m)   // FE3 index 2 not < subtree-min 2 → unchanged ref
  })

  it('setBranchFe is a no-op on a leaf path or unknown id', () => {
    const m = mk({ kind: 'branch', feId: 'FE2', success: leaf(), failure: leaf('C3') })
    expect(setBranchFe(m, ['success'], 'FE3')).toBe(m)   // leaf path
    expect(setBranchFe(m, [], 'NOPE')).toBe(m)           // unknown FE
  })
})
```

- [ ] **Step 2: Run, verify FAIL.** `npm run test --prefix frontend` (functions undefined).

- [ ] **Step 3: Implement** in `frontend/src/eventtree.ts` (add near `branchLeaf`/`delFe`):

```ts
/** 该分支位置可合法指派的功能事件:index 严格 > 祖先最大、严格 < 子树内最小分支 feIndex。含当前 feId。 */
export function branchFeOptions(m: EventTreeModel, path: string[]): FuncEvent[] {
  const node = nodeAt(m.root, path)
  if (!node || node.kind !== 'branch') return []
  const ancMax = maxAncestorFeIndex(m, path)
  let subMin = Infinity
  const walk = (n: EtNode) => {
    if (n.kind === 'branch') { subMin = Math.min(subMin, feIndex(m, n.feId)); walk(n.success); walk(n.failure) }
  }
  walk(node.success); walk(node.failure)
  return m.functionalEvents.filter((_, i) => i > ancMax && i < subMin)
}

/** 改变 path 处分支判定的功能事件;仅当 newFeId 在 branchFeOptions 内(保持有序不变式)才生效, 否则原样返回。 */
export function setBranchFe(m: EventTreeModel, path: string[], newFeId: string): EventTreeModel {
  const node = nodeAt(m.root, path)
  if (!node || node.kind !== 'branch') return m
  if (!branchFeOptions(m, path).some((f) => f.id === newFeId)) return m
  if (node.feId === newFeId) return m
  return { ...m, root: replaceAt(m.root, path, (n) => (n.kind === 'branch' ? { ...n, feId: newFeId } : n)) }
}
```

- [ ] **Step 4: Run, verify PASS.** `npm run test --prefix frontend` (all green incl. 5 new). Then `npm run build --prefix frontend` (tsc clean).

- [ ] **Step 5: Commit.**
```bash
git add frontend/src/eventtree.ts frontend/src/eventtree.test.ts
git commit -m "feat(eta): setBranchFe + branchFeOptions(有序不变式守护的分支屏障重指派) + vitest"
```

---

## Task 2: Branch-node barrier inspector (rename / PFD / FTA / reassign / delete)

**Files:** Modify `frontend/src/components/EventTreeEditor.tsx`. Depends on Task 1.

Read EventTreeEditor first: `sel` is the selected node path (`setSel`); for a selected **branch** node it derives the judged functional event (its `feId`, and `selIdx = feIndex(model, feId)`), and the inspector already shows that barrier's PFD + mount/detach FTA (`onAttachFt(selIdx)`/`onDetachFt(selIdx)`) and, for leaves, "继续到屏障". The barrier list elsewhere already uses `renameFe`/`setFailProb`/`delFe`.

- [ ] **Step 1: Consolidate the selected-branch-node inspector** so that when a branch node is selected it shows a full barrier panel for `selIdx`:
  - **改名**: a text input bound to `model.functionalEvents[selIdx].label` → `onChange(renameFe(model, selIdx, e.target.value))`. (Mirror the existing barrier-list rename if present; otherwise a simple controlled input.)
  - **改 PFD**: number input bound to `model.functionalEvents[selIdx].failProb` → `onChange(setFailProb(model, selIdx, Number(v)))`, shown only when the barrier is NOT FTA-linked (`!model.functionalEvents[selIdx].linkFt`); when linked, show the read-only effective PFD (`pfds?.[feId] ?? failProb`) as today.
  - **挂载 / 卸载 FTA**: keep the existing `onAttachFt(selIdx)` / `onDetachFt(selIdx)` buttons.
  - **重新指派屏障 (new)**: a `<select>` whose options are `branchFeOptions(model, sel)` (`<option value={f.id}>{f.label}</option>`), value = current `feId`, `onChange={(e) => onChange(setBranchFe(model, sel!, e.target.value))}`. Disable/omit when only the current option exists. Label it 「判定屏障」 or 「重新指派」.
  - **删除屏障**: a 删除 button → reuse the existing delete logic: `const used = branchesUsingFe(model, feId); if (used === 0 || window.confirm(\`将折叠 ${used} 个引用「${label}」的分支为末态,继续?\`)) onChange(delFe(model, selIdx))`. After delete, `setSel(null)`.
  - Import `branchFeOptions`, `setBranchFe`, `renameFe`, `setFailProb`, `delFe`, `branchesUsingFe` from `../eventtree` as needed (several already imported).

- [ ] **Step 2: Verify.** `npm run build --prefix frontend` (tsc clean). `npm run test --prefix frontend` (unchanged green). Controller will preview-DOM verify (select a branch node → rename/PFD/reassign dropdown/delete present; reassign changes the column's barrier).

- [ ] **Step 3: Commit.**
```bash
git add frontend/src/components/EventTreeEditor.tsx
git commit -m "feat(eta): 分支节点完整屏障检视器(改名/PFD/FTA/重新指派/删除)"
```

---

## Task 3: Conditional branch probabilities on the branches

**Files:** Modify `frontend/src/components/EventTreeEditor.tsx`. Independent of Tasks 1–2.

Read the SVG branch rendering (~lines 207–211): each branch node draws a vertical connector then a green success line with `<text>成功</text>` and a red failure line with `<text>失效</text>`. Append the conditional probability after each label.

- [ ] **Step 1: Append probabilities.** For each branch at functional-event index `idx` with `fe = model.functionalEvents[idx]`, compute `const pfd = pfds?.[fe.id] ?? fe.failProb`. Add a small helper at the top of the component:
```ts
const fmtP = (p: number) => (p > 0 && p < 0.01 ? p.toExponential(1) : p.toFixed(2))
```
Change the success label text to `成功 {fmtP(1 - pfd)}` and the failure label to `失效 {fmtP(pfd)}` (keep the existing colors/positions; just extend the `<text>` content). Use the branch node's own feIndex to look up `fe` (the layout node exposes `depth`/the feId via the model — use the same lookup the column header uses for `PFD {fe.failProb}`).

- [ ] **Step 2: Verify.** `npm run build --prefix frontend` (tsc clean). Controller preview-DOM verify: branches read e.g. `成功 0.90` / `失效 0.10`, and a tiny PFD shows e.g. `失效 1.0e-5`.

- [ ] **Step 3: Commit.**
```bash
git add frontend/src/components/EventTreeEditor.tsx
git commit -m "feat(eta): 成功/失败分支显示条件概率(1−PFD / PFD)"
```

---

## Task 4: Regression + docs

**Files:** Modify `docs/superpowers/ROADMAP.md`.

- [ ] **Step 1: Full regression.**
  - `npm run test --prefix frontend` → all vitest green (incl. the 5 new).
  - `npm run build --prefix frontend` → `tsc -b && vite build` clean.
  - `.venv/Scripts/python.exe -m pytest -q` → no backend regression (169 passed / 2 skipped).
- [ ] **Step 2: Docs.** Add a bullet to `docs/superpowers/ROADMAP.md` (frontend section): "ETA 编辑器交互(2026-06-24,分支 feat/eta-editor-interactions):分支节点完整屏障检视器(改名/PFD/挂载FTA/重新指派 setBranchFe/删除)+ 成功·失败分支条件概率(1−PFD / PFD)。spec/plan docs/superpowers/{specs,plans}/2026-06-24-eta-editor-interactions*".
- [ ] **Step 3: Commit.**
```bash
git add docs/superpowers/ROADMAP.md
git commit -m "chore(eta): ROADMAP 记录 ETA 编辑器交互增强"
```

---

## Self-Review

**Spec coverage:** §2.1 barrier inspector (reassign/edit/delete) → Task 2 (+ Task 1 `setBranchFe`/`branchFeOptions`). §2.2 conditional branch probs → Task 3. Undo/redo explicitly out of scope. ✓

**Placeholder scan:** Task 1 has complete code + tests. Tasks 2–3 give exact ops/signatures + the format helper; the implementer places JSX in the existing inspector/SVG following current patterns. ✓

**Type consistency:** `setBranchFe(m, path, newFeId)` / `branchFeOptions(m, path)` signatures match between Task 1 (definition + tests) and Task 2 (callers). `fmtP` defined where used (Task 3). `selIdx`/`feId`/`sel` are the existing EventTreeEditor names. ✓
