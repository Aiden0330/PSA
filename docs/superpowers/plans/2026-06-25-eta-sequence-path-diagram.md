# ETA Accident-Sequence Path Diagram — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. Frontend code changes MUST go through the project's `frontend-dev` subagent; `code-reviewer` reviews the diff.

**Goal:** Add an accident-sequence path diagram to the ETA workspace's bottom area — one row per end-state sequence (initiating event → barrier ✓/✗ chips → graded consequence + frequency), sorted by frequency, click-linked to the event-tree highlight.

**Architecture:** Frontend-only, presentational. A new `SequencePaths.tsx` consumes the already-computed `seqRows` (sequences with `path`/`freq`/`consequence`) from `EventTreeEditor`; the bottom dock is restructured from 2 panels to 3 (`[path diagram | risk matrix+summary | ETA checklist]`) with a small height re-balance. Reuses existing helpers (`consLevel`/`consText`/`gradeLabel`, `C_COLOR`, `psa-*` styles). No data/engine/state changes.

**Tech Stack:** React 18, TypeScript (strict, `import type`), Vite 5, vitest 2. Tests: `npm run test --prefix frontend`. Build: `npm run build --prefix frontend`. Rebuild offline single file: `npm run bundle --prefix frontend`. End commit bodies with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `frontend/src/components/SequencePaths.tsx` | create | Presentational path diagram: per-sequence rows, sorted by frequency, click-to-select. |
| `frontend/src/components/EventTreeEditor.tsx` | modify | Restructure bottom dock to 3 panels + mount `SequencePaths`; re-balance tree/dock heights. |
| `docs/superpowers/ROADMAP.md` | modify | Record the change. |

---

## Task 1: `SequencePaths.tsx` — path diagram component

**Files:** Create `frontend/src/components/SequencePaths.tsx`.

Context: purely presentational. The caller (`EventTreeEditor`) passes `seqRows` — each item is `{ i, seq, lf, freq, c, path, diff }` where `lf.path` is the leaf's path key array, `c` is a consequence id, and `path` is `[{ feId, outcome:'success'|'failure' }]` (the barriers traversed, in order). The component sorts by `freq` desc, renders each as a row, and calls `onSelect(lf.path)` on click; a row is highlighted when `selKey === lf.path.join('/')`. Barrier display name = `model.functionalEvents.find(f => f.id === feId)?.label ?? feId`. Reuses `consLevel`/`consText`/`gradeLabel` (from `../eventtree`), `C_COLOR` (from `../riskmatrix`), and the existing `psa-chip` CSS class.

- [ ] **Step 1: Create the file** `frontend/src/components/SequencePaths.tsx`:

```tsx
import type { EventTreeModel } from '../eventtree'
import { consLevel, consText, gradeLabel } from '../eventtree'
import { C_COLOR } from '../riskmatrix'

const mono = '"IBM Plex Mono", monospace'

export interface SeqRow {
  i: number
  seq: number
  lf: { path: string[] }
  freq: number
  c: string
  path: { feId: string; outcome: 'success' | 'failure' }[]
  diff?: boolean
}

export function SequencePaths({ rows, model, selKey, onSelect }: {
  rows: SeqRow[]
  model: EventTreeModel
  selKey: string
  onSelect: (path: string[]) => void
}) {
  const sorted = [...rows].sort((a, b) => b.freq - a.freq)
  const label = (feId: string) => model.functionalEvents.find((f) => f.id === feId)?.label ?? feId
  if (sorted.length === 0) return <div style={{ fontSize: 12, color: 'var(--psa-faint)', padding: 12 }}>暂无序列。</div>
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {sorted.map((r) => {
        const lvl = consLevel(model, r.c)
        const cc = C_COLOR[lvl] || '#64748b'
        const active = selKey === r.lf.path.join('/')
        return (
          <div key={r.i} onClick={() => onSelect(r.lf.path)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', borderBottom: '1px solid var(--psa-line)', cursor: 'pointer', background: active ? 'var(--psa-primary-soft)' : 'transparent' }}>
            <span style={{ width: 20, height: 20, borderRadius: 5, background: cc, color: '#fff', fontFamily: mono, fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{r.seq}</span>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4, fontSize: 11.5, color: 'var(--psa-faint)' }}>
              初因
              {r.path.length === 0 && <span style={{ color: 'var(--psa-muted)' }}>· 直接末态</span>}
              {r.path.map((p, k) => (
                <span key={k} className="psa-chip" title={label(p.feId)}>
                  <span style={{ color: p.outcome === 'failure' ? '#dc2626' : '#16a34a', fontWeight: 700 }}>{p.outcome === 'failure' ? '✗' : '✓'}</span>
                  <span style={{ maxWidth: 84, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label(p.feId)}</span>
                </span>
              ))}
            </div>
            <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="psa-chip"><span className="sq" style={{ background: cc }} />{gradeLabel(lvl)}</span>
              <span className="psa-num" style={{ fontSize: 11, color: 'var(--psa-ink)' }} title={consText(model, r.c)}>{r.diff ? '▶ ' : ''}{r.freq.toExponential(2)}/yr</span>
            </span>
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Verify build.** `npm run build --prefix frontend` (tsc clean — the file is unused until Task 2, but must type-check). `npm run test --prefix frontend` (unchanged green).

- [ ] **Step 3: Commit.**
```bash
git add frontend/src/components/SequencePaths.tsx
git commit -m "feat(eta): SequencePaths 事故序列路径图组件(纯展示, 复用 seqRows)"
```

---

## Task 2: mount in EventTreeEditor bottom dock (3 panels)

**Files:** Modify `frontend/src/components/EventTreeEditor.tsx`. Depends on Task 1.

Read the file first. The tree panel `<section>` is at ~L168; the bottom dock `<div>` opens at ~L286 with two children (risk-matrix `<section>` ~L287, ETA-checklist `<section>` ~L297). `seqRows`, `selKey`, `setSel`, `model`, `leafCount` are all in scope in the render.

- [ ] **Step 1: Import the component.** Add near the other component imports (e.g. after `import { RiskSummary } from './RiskSummary'`):
```tsx
import { SequencePaths } from './SequencePaths'
```

- [ ] **Step 2: Give the bottom dock more height.** Find the tree panel section opener (~L168):
```tsx
        <section className="psa-panel" style={{ flex: '5 1 0', minHeight: 260 }}>
```
Replace with:
```tsx
        <section className="psa-panel" style={{ flex: '4.5 1 0', minHeight: 260 }}>
```
Then find the bottom dock opener (~L286):
```tsx
        <div style={{ flex: '3 1 0', minHeight: 220, display: 'flex', gap: 12, alignItems: 'stretch' }}>
```
Replace with:
```tsx
        <div style={{ flex: '4 1 0', minHeight: 220, display: 'flex', gap: 12, alignItems: 'stretch' }}>
```

- [ ] **Step 3: Insert the path-diagram panel as the first child of the bottom dock.** Immediately after the bottom-dock opening `<div …>` from Step 2 (i.e., before the existing `<section className="psa-panel" style={{ flex: 1, minWidth: 0 }}>` that holds the risk matrix), insert:
```tsx
          <section className="psa-panel" style={{ flex: '1.6 1 0', minWidth: 0 }}>
            <div className="psa-ch">
              <span className="t">事故序列路径图</span>
              <span className="meta">{leafCount} 序列 · 按频率</span>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
              <SequencePaths rows={seqRows} model={model} selKey={selKey} onSelect={setSel} />
            </div>
          </section>
```
(The risk-matrix `<section>` stays `flex: 1`; the ETA-checklist `<section>` stays `width: var(--psa-side-w)`. Result: `[路径图 1.6 | 矩阵+摘要 1 | 参与汇总 side-w]`.)

- [ ] **Step 4: Verify.** `npm run build --prefix frontend` (tsc clean). `npm run test --prefix frontend` (unchanged green). Controller preview-DOM verifies: bottom area now shows the 事故序列路径图 panel (3-column dock, no overflow); rows are per-sequence with ✓/✗ barrier chips + grade + freq, sorted by frequency; clicking a row highlights the matching sequence in the event tree (`selKey` linkage).

- [ ] **Step 5: Commit.**
```bash
git add frontend/src/components/EventTreeEditor.tsx
git commit -m "feat(eta): 底部坞重排三栏 + 挂载事故序列路径图(树/底部高度 4.5:4)"
```

---

## Task 3: Regression + rebuild standalone + docs

**Files:** Rebuild `bess-eta-standalone.html`; Modify `docs/superpowers/ROADMAP.md`.

- [ ] **Step 1: Full regression.**
  - `npm run test --prefix frontend` → all vitest green (75; no new tests — presentational).
  - `npm run build --prefix frontend` → `tsc -b && vite build` clean.
  - `.venv/Scripts/python.exe -m pytest -q` → backend unchanged (no regression).
- [ ] **Step 2: Rebuild offline single file.** `npm run bundle --prefix frontend` → rewrites `bess-eta-standalone.html` (confirm size printed, exit 0).
- [ ] **Step 3: Smoke-check (preview).** Controller (servers run on :5173/:8000, or start `frontend`): on the ETA tab, confirm the bottom 事故序列路径图 panel renders per-sequence path rows sorted by frequency, and clicking a row highlights that sequence in the tree.
- [ ] **Step 4: Docs.** Add a bullet to `docs/superpowers/ROADMAP.md` (frontend section, after the latest entry): "ETA 事故序列路径图(2026-06-25,分支 feat/fta-standalone-and-quantify):底部坞重排三栏 `[事故序列路径图 | 风险矩阵+摘要 | 参与汇总 ETA]`(树/底部 flex 4.5:4),新 `SequencePaths.tsx` 纯展示组件——每序列一行 初因→屏障 ✓/✗ 芯片→分级(0–IV)+频率,按频率降序,点行联动事件树高亮(复用 `seqRows`/`gradeLabel`/`C_COLOR`,不改数据/引擎)。重建 bess-eta-standalone.html。spec/plan docs/superpowers/{specs,plans}/2026-06-25-eta-sequence-path-diagram*"
- [ ] **Step 5: Commit.**
```bash
git add docs/superpowers/ROADMAP.md
git commit -m "chore(eta): ROADMAP 记录 事故序列路径图(离线单文件已重建)"
```

---

## Self-Review

**Spec coverage:**
- §2.1 `SequencePaths.tsx` (per-sequence rows, sort by freq, barrier ✓/✗ chips with names, grade + freq, click→onSelect, selKey highlight, reuse helpers/styles) → Task 1. ✓
- §2.2 EventTreeEditor bottom-dock 3-panel restructure + flex re-balance (tree 4.5 / dock 4, path 1.6 / matrix 1 / checklist side-w) → Task 2. ✓
- §3 compatibility (presentational, reuse `seqRows`, no data/engine change; bidirectional highlight via shared `sel`/`selKey`/`setSel`) → Task 1 (consumes props) + Task 2 (passes `seqRows`/`selKey`/`setSel`). ✓
- §4 tests (no new vitest — presentational; preview verifies rows/sort/linkage) → Task 2 Step 4 + Task 3 Step 3. ✓
- §5 traversed-barriers-only (the component maps only `r.path`, which is the traversed barriers) ✓; §6 build order → Tasks 1→2→3. ✓

**Placeholder scan:** Task 1 has the complete component. Task 2 has exact find/replace anchors + the inserted JSX. Task 3 has exact commands. No TBD/TODO. ✓

**Type consistency:** `SequencePaths({ rows, model, selKey, onSelect })` prop names/types match between Task 1 (def) and Task 2 (caller passes `seqRows`/`model`/`selKey`/`setSel`). `SeqRow` shape (`i`/`seq`/`lf.path`/`freq`/`c`/`path[{feId,outcome}]`/`diff?`) matches EventTreeEditor's `seqRows` element (structural). `consLevel`/`consText`/`gradeLabel` from `../eventtree`, `C_COLOR` from `../riskmatrix` — all existing exports. ✓
