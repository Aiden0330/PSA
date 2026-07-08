# ETA Barrier Reorder + Chinese Barrier Names — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. Frontend code changes MUST go through the project's `frontend-dev` subagent; `test-runner` runs vitest; `code-reviewer` reviews the diff.

**Goal:** Let users reorder ETA barriers with ↑/↓ (rebuilds the cascade in the new order, consequences kept by depth), and make the event-tree show the editable Chinese `label` prominently (column headers) instead of the English `id` code.

**Architecture:** Frontend-only (React + TS, vitest). Three new pure functions in `frontend/src/eventtree.ts` (`isCascade`, `cascadeConsequences`, `reorderFe`) + change `addFe`'s default label to Chinese; UI in `frontend/src/components/EventTreeEditor.tsx` (↑/↓ in the barrier list, column headers show `label` primary). `id`/`feId` stay stable, so mounted FTAs (`etFts`), `pfds`, project serialization, and the engine/MEF contract are all unchanged.

**Tech Stack:** React 18, TypeScript (strict, `import type`), Vite 5, vitest 2. Tests: `npm run test --prefix frontend`. Build: `npm run build --prefix frontend`. Rebuild offline single file: `npm run bundle --prefix frontend`. End commit bodies with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `frontend/src/eventtree.ts` | modify | Add `isCascade` / `cascadeConsequences` / `reorderFe`; change `addFe` default `label` to `屏障${n}`. |
| `frontend/src/eventtree.test.ts` | modify | vitest for the three new functions + `addFe` label. |
| `frontend/src/components/EventTreeEditor.tsx` | modify | Barrier-list ↑/↓ (reorder w/ non-cascade confirm); column headers show `label` primary + `id` secondary; branch inspector / "继续到屏障" show `label`. |
| `docs/superpowers/ROADMAP.md` | modify | Record the change. |

---

## Task 1: `eventtree.ts` — reorder pure functions + Chinese `addFe` label (TDD)

**Files:** Modify `frontend/src/eventtree.ts`; Modify `frontend/src/eventtree.test.ts`.

Context: `functionalEvents: FuncEvent[]` array order = `feIndex` = column order. Invariant: branch `feIndex` strictly increases down every path. `buildCascade(fes, consAtDepth)` (in this file) builds a full cascade: depth d success→leaf `consAtDepth[d]`, failure→continue, all-fail→leaf `consAtDepth[fes.length]`; each branch `feId=fes[d].id`. `CONSEQUENCE_AT_DEPTH` is exported in this file. `EtNode`/`EventTreeModel`/`collapseNode`/`newBlankEta`/`addFe` already exist.

- [ ] **Step 1: Add failing tests** — append a new `describe` to `frontend/src/eventtree.test.ts`:

```ts
import {
  isCascade, cascadeConsequences, reorderFe, addFe, newBlankEta, buildCascade, collapseNode,
} from './eventtree'
import type { EventTreeModel } from './eventtree'

const mk3 = (): EventTreeModel => {
  const fes = [
    { id: 'FE1', label: '屏障A', failProb: 0.1 },
    { id: 'FE2', label: '屏障B', failProb: 0.2, linkFt: 'FE2' },
    { id: 'FE3', label: '屏障C', failProb: 0.3 },
  ]
  return { initEvent: 'IE', initFreq: 1e-3, functionalEvents: fes, root: buildCascade(fes, ['C1', 'C2', 'C3', 'C4']) }
}

describe('isCascade / cascadeConsequences / reorderFe', () => {
  it('isCascade: 默认级联为真', () => {
    expect(isCascade(mk3())).toBe(true)
    expect(isCascade(newBlankEta('x'))).toBe(true)
  })
  it('isCascade: 折叠某分支后为假', () => {
    expect(isCascade(collapseNode(mk3(), ['failure']))).toBe(false)
  })
  it('cascadeConsequences: 级联树返回各深度后果 + 末端(长度 n+1)', () => {
    expect(cascadeConsequences(mk3())).toEqual(['C1', 'C2', 'C3', 'C4'])
  })
  it('reorderFe: 移动屏障后次序变、树重建为级联', () => {
    const m = reorderFe(mk3(), 2, 0)
    expect(m.functionalEvents.map((f) => f.id)).toEqual(['FE3', 'FE1', 'FE2'])
    expect(isCascade(m)).toBe(true)
  })
  it('reorderFe: 后果按深度(位置)保留', () => {
    expect(cascadeConsequences(reorderFe(mk3(), 2, 0))).toEqual(['C1', 'C2', 'C3', 'C4'])
  })
  it('reorderFe: 屏障属性随屏障移动(label/failProb/linkFt), id 不变', () => {
    const m = reorderFe(mk3(), 2, 0)
    expect(m.functionalEvents[0]).toMatchObject({ id: 'FE3', label: '屏障C', failProb: 0.3 })
    expect(m.functionalEvents[2]).toMatchObject({ id: 'FE2', linkFt: 'FE2' })
  })
  it('reorderFe: 越界 / 同位 → 返回原对象', () => {
    const m = mk3()
    expect(reorderFe(m, 0, 0)).toBe(m)
    expect(reorderFe(m, -1, 0)).toBe(m)
    expect(reorderFe(m, 0, 5)).toBe(m)
  })
  it('addFe: 新屏障默认中文名 屏障N, id 仍 FEN', () => {
    const last = addFe(newBlankEta('x')).functionalEvents.slice(-1)[0]
    expect(last.id).toBe('FE3')
    expect(last.label).toBe('屏障3')
  })
})
```

- [ ] **Step 2: Run, verify FAIL.** `npm run test --prefix frontend` → `isCascade`/`cascadeConsequences`/`reorderFe` undefined; `addFe` label test fails (currently `label === id`).

- [ ] **Step 3: Implement.** In `frontend/src/eventtree.ts`:

(a) Change `addFe` (currently `return { ...m, functionalEvents: [...m.functionalEvents, { id, label: id, failProb: 0.1 }] }`) so the label is Chinese:
```ts
export function addFe(m: EventTreeModel): EventTreeModel {
  const n = m.functionalEvents.length + 1
  const id = `FE${n}`
  return { ...m, functionalEvents: [...m.functionalEvents, { id, label: `屏障${n}`, failProb: 0.1 }] }
}
```

(b) Add these three functions (place them after `buildCascade`, near the other tree helpers):
```ts
/** 树是否为「完整级联」:depth d 分支 feId=fes[d].id、success=叶、failure=分支(d+1)或(末层)叶。 */
export function isCascade(m: EventTreeModel): boolean {
  const fes = m.functionalEvents
  let node: EtNode = m.root
  for (let d = 0; d < fes.length; d++) {
    if (node.kind !== 'branch' || node.feId !== fes[d].id || node.success.kind !== 'leaf') return false
    if (d < fes.length - 1) {
      if (node.failure.kind !== 'branch') return false
      node = node.failure
    } else if (node.failure.kind !== 'leaf') return false
  }
  return fes.length === 0 ? node.kind === 'leaf' : true
}

/** 沿失败脊收集各深度成功叶后果 + 末端全失败叶后果(长度 n+1);缺失位(非级联)用 CONSEQUENCE_AT_DEPTH 默认。 */
export function cascadeConsequences(m: EventTreeModel): string[] {
  const fes = m.functionalEvents
  const out: string[] = []
  let node: EtNode = m.root
  for (let d = 0; d < fes.length; d++) {
    if (node.kind === 'branch') {
      out[d] = node.success.kind === 'leaf' ? node.success.consequence : (CONSEQUENCE_AT_DEPTH[d] ?? 'C5')
      node = node.failure
    } else {
      out[d] = CONSEQUENCE_AT_DEPTH[d] ?? 'C5'
    }
  }
  out[fes.length] = node.kind === 'leaf' ? node.consequence : (CONSEQUENCE_AT_DEPTH[fes.length] ?? 'C5')
  return out
}

/** 移动第 fromIdx 个屏障到 toIdx,按新次序重建级联。后果按深度(位置)保留;屏障属性随屏障移动;id/feId 不变。 */
export function reorderFe(m: EventTreeModel, fromIdx: number, toIdx: number): EventTreeModel {
  const n = m.functionalEvents.length
  if (fromIdx < 0 || fromIdx >= n || toIdx < 0 || toIdx >= n || fromIdx === toIdx) return m
  const cons = cascadeConsequences(m)
  const fes = [...m.functionalEvents]
  const [moved] = fes.splice(fromIdx, 1)
  fes.splice(toIdx, 0, moved)
  return { ...m, functionalEvents: fes, root: buildCascade(fes, cons) }
}
```

- [ ] **Step 4: Run, verify PASS.** `npm run test --prefix frontend` (8 new green, rest unchanged). Then `npm run build --prefix frontend` (tsc clean).

- [ ] **Step 5: Commit.**
```bash
git add frontend/src/eventtree.ts frontend/src/eventtree.test.ts
git commit -m "feat(eta): reorderFe/isCascade/cascadeConsequences(屏障重排重建级联) + addFe 默认中文名 + vitest"
```

---

## Task 2: barrier-list ↑/↓ reorder (EventTreeEditor)

**Files:** Modify `frontend/src/components/EventTreeEditor.tsx`. Depends on Task 1.

Read the file first. The barrier list is at ~L466-478 (inside the `tab === 'attr'` block, after the 「功能事件(屏障)」 `<h4>` and the LibPicker). `addBarrier` is defined at ~L112. Imports are at L3-9.

- [ ] **Step 1: Import the new functions.** In the `from '../eventtree'` import block (L3-9), add `reorderFe, isCascade` to the imported names.

- [ ] **Step 2: Add a `moveFe` helper.** Just after the `const addBarrier = ...` line (~L112), add:
```ts
  const moveFe = (d: number, dir: -1 | 1) => {
    const t = d + dir
    if (t < 0 || t >= model.functionalEvents.length) return
    if (!isCascade(model) && !window.confirm('该 ETA 含自定义分支结构,调整屏障次序将重建为标准级联,继续?')) return
    onChange(reorderFe(model, d, t))
  }
```

- [ ] **Step 3: Add a small button style.** Near the other `CSSProperties` consts at the top of the file (after `exportBtn`, ~L21), add:
```ts
const moveBtn: CSSProperties = { width: 20, height: 22, border: '1px solid #cfd8e1', borderRadius: 5, background: '#fff', color: '#56657a', cursor: 'pointer', fontSize: 11, lineHeight: 1, padding: 0, flexShrink: 0 }
```

- [ ] **Step 4: Replace the barrier-list row block.** Find:
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
Replace it with (adds ↑/↓; narrows `id` span to 30 and `label` input to 96 to fit; first row disables ↑, last disables ↓):
```tsx
              {model.functionalEvents.map((fe, d) => (
                <div key={fe.id} style={{ display: 'flex', gap: 5, alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ width: 30, fontSize: 10, color: '#94a3b8', fontFamily: mono, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={fe.id}>{fe.id}</span>
                  <input value={fe.label} onChange={(e) => onChange(renameFe(model, d, e.target.value))} style={{ width: 96, fontSize: 12 }} />
                  <input type="number" step="0.01" min={0} max={1} value={fe.failProb}
                    onChange={(e) => onChange(setFailProb(model, d, +e.target.value))} style={{ width: 54, fontSize: 12 }} />
                  <button title="上移" disabled={d === 0} onClick={() => moveFe(d, -1)} style={{ ...moveBtn, opacity: d === 0 ? 0.4 : 1 }}>↑</button>
                  <button title="下移" disabled={d === model.functionalEvents.length - 1} onClick={() => moveFe(d, 1)} style={{ ...moveBtn, opacity: d === model.functionalEvents.length - 1 ? 0.4 : 1 }}>↓</button>
                  <button title="删除屏障" onClick={() => {
                    const used = branchesUsingFe(model, fe.id)
                    if (used === 0 || window.confirm(`将折叠 ${used} 个引用「${fe.label}」的分支为末态,继续?`)) onChange(delFe(model, d))
                  }} style={{ color: '#dc2626', border: 0, background: 'none', cursor: 'pointer', fontSize: 14, lineHeight: 1, flexShrink: 0 }}>✕</button>
                </div>
              ))}
```

- [ ] **Step 5: Verify.** `npm run build --prefix frontend` (tsc clean). `npm run test --prefix frontend` (unchanged green). Controller preview-DOM verifies: ↑/↓ reorder a cascade ETA → column order changes; non-cascade ETA → confirm dialog appears.

- [ ] **Step 6: Commit.**
```bash
git add frontend/src/components/EventTreeEditor.tsx
git commit -m "feat(eta): 屏障列表 ↑/↓ 调整次序(reorderFe, 非级联先确认)"
```

---

## Task 3: column headers + inspector show Chinese `label` (EventTreeEditor)

**Files:** Modify `frontend/src/components/EventTreeEditor.tsx`. Independent of Task 2 (same file; do after Task 2).

- [ ] **Step 1: Column headers — `label` primary, `id` secondary.** Find the column-header block (~L194-201):
```tsx
                {model.functionalEvents.slice(0, maxDepth).map((fe, d) => (
                  <g key={d}>
                    <line x1={colX(d)} y1={headerH - 6} x2={colX(d)} y2={height - 12} stroke="#f1f5f9" />
                    <text x={colX(d)} y={24} fontSize={11} fontWeight={700} textAnchor="middle" fill="#33404f">{fe.id}</text>
                    <text x={colX(d)} y={39} fontSize={9} fill="#64748b" textAnchor="middle">{(fe.label || '').slice(0, 10)}</text>
                    <text x={colX(d)} y={53} fontSize={9} fill="#94a3b8" textAnchor="middle" fontFamily={mono}>PFD {fe.failProb}</text>
                  </g>
                ))}
```
Replace with (bold = `label`, with full-name `<title>`; small mono line = `id`):
```tsx
                {model.functionalEvents.slice(0, maxDepth).map((fe, d) => {
                  const nm = fe.label || fe.id
                  return (
                  <g key={d}>
                    <line x1={colX(d)} y1={headerH - 6} x2={colX(d)} y2={height - 12} stroke="#f1f5f9" />
                    <text x={colX(d)} y={24} fontSize={11} fontWeight={700} textAnchor="middle" fill="#33404f">
                      {nm.length > 10 ? nm.slice(0, 10) + '…' : nm}
                      <title>{nm}（{fe.id}）</title>
                    </text>
                    <text x={colX(d)} y={39} fontSize={8.5} fill="#94a3b8" textAnchor="middle" fontFamily={mono}>{fe.id}</text>
                    <text x={colX(d)} y={53} fontSize={9} fill="#94a3b8" textAnchor="middle" fontFamily={mono}>PFD {fe.failProb}</text>
                  </g>
                  )
                })}
```

- [ ] **Step 2: Branch inspector title — show `label`.** Find (~L509):
```tsx
                  <div style={{ marginBottom: 6 }}>分支:决定 <b>{selFeId ?? '—'}</b></div>
```
Replace with (`selFe` is already defined at ~L110):
```tsx
                  <div style={{ marginBottom: 6 }}>分支:决定 <b title={selFeId ?? ''}>{selFe?.label || selFeId || '—'}</b></div>
```

- [ ] **Step 3: "继续到屏障" lists — show `label`.** Two spots:

(a) SVG mini-menu (~L262): find
```tsx
                          <text x={mx + 9} y={lf.y + 4 + k * ih + 12} fontSize={10} fill="#9a3412">{f.id} — {(f.label || '').slice(0, 14)}</text>
```
replace with:
```tsx
                          <text x={mx + 9} y={lf.y + 4 + k * ih + 12} fontSize={10} fill="#9a3412">{(f.label || f.id).slice(0, 16)}<title>{f.label || f.id}（{f.id}）</title></text>
```

(b) Inspector dropdown (~L500): find
```tsx
                          {subs.map((f) => <option key={f.id} value={f.id}>{f.id} — {f.label}</option>)}
```
replace with:
```tsx
                          {subs.map((f) => <option key={f.id} value={f.id}>{f.label || f.id}</option>)}
```

- [ ] **Step 4: Verify.** `npm run build --prefix frontend` (tsc clean). `npm run test --prefix frontend` (unchanged green). Controller preview-DOM: column headers show Chinese label bold + small `id` underneath; renaming a barrier label updates the header; a fresh "添加屏障" shows "屏障N".

- [ ] **Step 5: Commit.**
```bash
git add frontend/src/components/EventTreeEditor.tsx
git commit -m "feat(eta): 事件树列头/检视器突出可编辑中文名 label(id 退为次要)"
```

---

## Task 4: Regression + rebuild standalone + docs

**Files:** Rebuild `bess-eta-standalone.html`; Modify `docs/superpowers/ROADMAP.md`.

- [ ] **Step 1: Full regression.**
  - `npm run test --prefix frontend` → all vitest green (incl. 8 new in Task 1).
  - `npm run build --prefix frontend` → `tsc -b && vite build` clean.
  - `.venv/Scripts/python.exe -m pytest -q` → backend unchanged (no regression).
- [ ] **Step 2: Rebuild offline single file.** `npm run bundle --prefix frontend` → rewrites `bess-eta-standalone.html` at repo root (confirm size printed, exit 0).
- [ ] **Step 3: Smoke-check (preview).** Controller starts the `frontend` preview, then: reorder barriers with ↑/↓ on the default cascade ETA (column order changes), confirm column headers show Chinese names, add a barrier → "屏障N". (All client-side; offline path.)
- [ ] **Step 4: Docs.** Add a bullet to `docs/superpowers/ROADMAP.md` (frontend section, after the ⑯ entry): "ETA 屏障次序调整 + 屏障名中文(2026-06-24,分支 feat/eta-barrier-reorder-cn-names):屏障列表 ↑/↓ 重排(reorderFe 按新次序重建级联,后果按深度保留,id 稳定→FTA/pfds 兼容,非级联先确认);事件树列头突出可编辑中文 label(id 退次要)+ addFe 默认中文名;不改 id/初因/引擎契约。重建 bess-eta-standalone.html。spec/plan docs/superpowers/{specs,plans}/2026-06-24-eta-barrier-reorder-cn-names*"
- [ ] **Step 5: Commit.**
```bash
git add docs/superpowers/ROADMAP.md
git commit -m "chore(eta): ROADMAP 记录 屏障次序调整 + 屏障名中文(离线单文件已重建)"
```

---

## Self-Review

**Spec coverage:**
- §2.1 reorder (`isCascade`/`cascadeConsequences`/`reorderFe` + ↑/↓ UI + non-cascade confirm) → Task 1 (functions) + Task 2 (UI). ✓
- §2.2 Chinese names (column header `label` primary, `addFe` Chinese default, inspector/继续到屏障 show label) → Task 1 (`addFe`) + Task 3 (display). ✓
- §3 compatibility (`id`/`feId` stable) → guaranteed: `reorderFe` keeps each `FuncEvent` intact (incl. `id`/`linkFt`), only array order + rebuilt cascade change; no id rename anywhere. ✓
- §4 tests → Task 1 vitest (isCascade/cascadeConsequences/reorderFe incl. by-depth consequence + FTA-link preservation + bounds + addFe label). UI behaviors via preview (Task 2/3/4). ✓
- §6 build order → Tasks 1→2→3→4 match. Standalone rebuild → Task 4. ✓

**Placeholder scan:** Task 1 has complete function + test code. Tasks 2-3 give exact find/replace blocks with full code. Task 4 exact commands. No TBD/TODO/"handle edge cases". ✓

**Type consistency:** `isCascade(m)`, `cascadeConsequences(m): string[]`, `reorderFe(m, fromIdx, toIdx)` signatures match between Task 1 (def + tests) and Task 2 (`moveFe` caller). `moveFe(d, dir)` / `moveBtn` defined and used in Task 2. `selFe`/`selFeId` are existing EventTreeEditor names (Task 3). `nm` local scoped per-map in Task 3 header. ✓
