# ETA Workspace Layout Align + Matrix Fill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. Frontend code changes MUST go through the project's `frontend-dev` subagent; `test-runner` runs vitest; `code-reviewer` reviews the diff.

**Goal:** Fix the two ETA-workspace layout problems — make every row's right column the same width so the page aligns top-to-bottom, and fill the risk-matrix panel's empty right side with a risk-summary card. No interface-style changes.

**Architecture:** Frontend-only layout/visual. A new pure function `riskSummary(totals)` in `frontend/src/riskmatrix.ts` (reusing the existing `C_TO_LEVEL`/`freqBandOf`/`zoneOf`/`CELLS` so it matches `RiskMatrix`'s zone logic) feeds a new presentational `RiskSummary.tsx` that sits beside `RiskMatrix` in the bottom-dock panel. `EventTreeEditor.tsx` gets a single `SIDE_W` constant unifying its right columns. `RiskMatrix` and all data/engine/state are unchanged; `RiskSummary` reuses the app's existing color/font vocabulary (no new style).

**Tech Stack:** React 18, TypeScript (strict, `import type`), Vite 5, vitest 2. Tests: `npm run test --prefix frontend`. Build: `npm run build --prefix frontend`. Rebuild offline single file: `npm run bundle --prefix frontend`. End commit bodies with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `frontend/src/riskmatrix.ts` | modify | Add `RiskSummaryData` interface + `riskSummary(totals)` pure fn (overall zone / zone counts / worst consequence / ≥C4 cumulative). |
| `frontend/src/riskmatrix.test.ts` | create | vitest for `riskSummary`. |
| `frontend/src/components/RiskSummary.tsx` | create | Presentational card consuming `riskSummary`; reuses existing styles. |
| `frontend/src/components/EventTreeEditor.tsx` | modify | `SIDE_W` const unifying right columns (align); mount `RiskSummary` beside `RiskMatrix` (fill). |
| `docs/superpowers/ROADMAP.md` | modify | Record the change. |

---

## Task 1: `riskmatrix.ts` — `riskSummary` pure function (TDD)

**Files:** Modify `frontend/src/riskmatrix.ts`; Create `frontend/src/riskmatrix.test.ts`.

Context (current exports in `riskmatrix.ts`): `FREQ_BANDS` (6 bands, `gt` thresholds), `CELLS` (6 rows × 5 cols of zone codes like `'A1'`/`'B2'`/`'C1'`), `type Zone='A'|'B'|'C'`, `C_TO_LEVEL` (`{C1:2,C2:3,C3:4,C4:5,C5:5}` — 1-based severity column, 1=无事故 unused), `freqBandOf(f)` (1-based band), `zoneOf(cell)` (first char). `RiskMatrix.tsx` already computes `overall` as A→B→C precedence from these; `riskSummary` mirrors that exactly so the card and the matrix never disagree.

- [ ] **Step 1: Write failing tests** — create `frontend/src/riskmatrix.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { riskSummary } from './riskmatrix'

describe('riskSummary', () => {
  it('空 totals → overall null, severe 0, worstC null, 计数全 0', () => {
    const s = riskSummary({})
    expect(s.overall).toBeNull()
    expect(s.severe).toBe(0)
    expect(s.worstC).toBeNull()
    expect(s.zoneCounts).toEqual({ A: 0, B: 0, C: 0 })
  })
  it('仅 C1 中低频 → C 区, worstC C1, severe 0', () => {
    const s = riskSummary({ C1: 1e-5 })  // C1→col2, freq 1e-5 → band5 → CELLS[4][1]='C2' → zone C
    expect(s.overall).toBe('C')
    expect(s.worstC).toBe('C1')
    expect(s.severe).toBe(0)
  })
  it('C5 高频 → A 区, worstC C5, severe 含 C5', () => {
    const s = riskSummary({ C5: 1e-1 })  // C5→col5, freq 0.1 → band1 → CELLS[0][4]='A3' → zone A
    expect(s.overall).toBe('A')
    expect(s.worstC).toBe('C5')
    expect(s.severe).toBeCloseTo(1e-1)
  })
  it('worstC 取最严重有频率类(C4 高于 C2);severe=C4+C5', () => {
    const s = riskSummary({ C2: 1e-3, C4: 1e-6 })
    expect(s.worstC).toBe('C4')
    expect(s.severe).toBeCloseTo(1e-6)
  })
  it('overall 优先级 A>B>C', () => {
    const s = riskSummary({ C5: 1e-1, C1: 1e-5 })  // A from C5, C from C1
    expect(s.overall).toBe('A')
    expect(s.zoneCounts.A).toBeGreaterThan(0)
    expect(s.zoneCounts.C).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run, verify FAIL.** `npm run test --prefix frontend` → `riskSummary` undefined.

- [ ] **Step 3: Implement** — append to `frontend/src/riskmatrix.ts`:

```ts
export interface RiskSummaryData {
  overall: Zone | null
  zoneCounts: Record<Zone, number>
  worstC: string | null
  worstFreq: number
  severe: number
}

/** 由后果频率汇总出风险摘要,与 RiskMatrix 同口径(severity 列 → 频率档 → 区域)。 */
export function riskSummary(totals: Record<string, number>): RiskSummaryData {
  const levelFreq = [0, 0, 0, 0, 0, 0]   // index 1..5
  for (const [c, lvl] of Object.entries(C_TO_LEVEL)) levelFreq[lvl] += totals[c] || 0
  const zoneCounts: Record<Zone, number> = { A: 0, B: 0, C: 0 }
  for (let lvl = 1; lvl <= 5; lvl++) {
    if (levelFreq[lvl] > 0) zoneCounts[zoneOf(CELLS[freqBandOf(levelFreq[lvl]) - 1][lvl - 1])]++
  }
  const overall: Zone | null = zoneCounts.A > 0 ? 'A' : zoneCounts.B > 0 ? 'B' : zoneCounts.C > 0 ? 'C' : null
  let worstC: string | null = null
  let worstFreq = 0
  for (const c of ['C5', 'C4', 'C3', 'C2', 'C1']) {
    if ((totals[c] || 0) > 0) { worstC = c; worstFreq = totals[c]; break }
  }
  const severe = (totals.C4 || 0) + (totals.C5 || 0)
  return { overall, zoneCounts, worstC, worstFreq, severe }
}
```

- [ ] **Step 4: Run, verify PASS.** `npm run test --prefix frontend` (5 new green). `npm run build --prefix frontend` (tsc clean).

- [ ] **Step 5: Commit.**
```bash
git add frontend/src/riskmatrix.ts frontend/src/riskmatrix.test.ts
git commit -m "feat(risk): riskSummary 纯函数(分区评价/各区计数/最严重后果/≥C4 累计) + vitest"
```

---

## Task 2: `RiskSummary.tsx` — risk-summary card

**Files:** Create `frontend/src/components/RiskSummary.tsx`. Depends on Task 1.

Context: presentational only. Reuses the app's existing visual vocabulary (mono font, `C_COLOR` per consequence, `ZONE_COLORS`/`ZONE_LABEL` from `riskmatrix.ts`, the `#16202b`/`#7a8696`/`#64748b` grays already used throughout `EventTreeEditor.tsx`). No new style language, no panel wrapper (it sits inside the existing matrix panel). Sits in a flex column with a left dashed divider, filling the space to the right of the matrix.

- [ ] **Step 1: Create the file** `frontend/src/components/RiskSummary.tsx`:

```tsx
import type { CSSProperties, ReactNode } from 'react'
import { riskSummary, ZONE_COLORS, ZONE_LABEL } from '../riskmatrix'
import type { Zone } from '../riskmatrix'

const mono = '"IBM Plex Mono", monospace'
const C_COLOR: Record<string, string> = { C1: '#16a34a', C2: '#65a30d', C3: '#d97706', C4: '#ea580c', C5: '#dc2626' }
const ZONE_VERDICT: Record<Zone, string> = { A: '需立即处置', B: '需控制', C: '可接受' }

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 11.5 }}>
      <span style={{ color: '#7a8696' }}>{label}</span>{children}
    </div>
  )
}

const pill: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#5a6878', background: '#f6f8fa', borderRadius: 5, padding: '2px 8px' }

export function RiskSummary({ totals, etaCount }: { totals: Record<string, number>; etaCount?: number }) {
  const s = riskSummary(totals)
  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 9, paddingLeft: 14, borderLeft: '1px dashed #dde4eb' }}>
      <div style={{ fontSize: 11, color: '#7a8696' }}>风险摘要{etaCount != null ? ` · ${etaCount} 个 ETA` : ''}</div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11.5, color: '#7a8696' }}>最终评价</span>
        {s.overall ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13.5, fontWeight: 600, color: '#16202b' }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: ZONE_COLORS[s.overall], border: '1px solid rgba(15,25,40,.15)' }} />
            {ZONE_LABEL[s.overall]} · {ZONE_VERDICT[s.overall]}
          </span>
        ) : <span style={{ fontSize: 13, color: '#94a3b8' }}>—(无后果频率)</span>}
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {(['A', 'B', 'C'] as Zone[]).map((z) => (
          <span key={z} style={pill}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: ZONE_COLORS[z] }} />{z} 区 {s.zoneCounts[z]}
          </span>
        ))}
      </div>

      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Row label="最严重后果">
          {s.worstC
            ? <span style={{ fontFamily: mono, fontWeight: 700, color: C_COLOR[s.worstC] }}>{s.worstC} · {s.worstFreq.toExponential(2)}/yr</span>
            : <span style={{ color: '#94a3b8' }}>—</span>}
        </Row>
        <Row label="≥C4 累计">
          <span style={{ fontFamily: mono, color: '#c4690f' }}>{s.severe > 0 ? `${s.severe.toExponential(2)}/yr` : '—'}</span>
        </Row>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify build.** `npm run build --prefix frontend` (tsc clean). `npm run test --prefix frontend` (unchanged green). (Visual verified in Task 3 once mounted.)

- [ ] **Step 3: Commit.**
```bash
git add frontend/src/components/RiskSummary.tsx
git commit -m "feat(risk): RiskSummary 卡(复用现有样式, 消费 riskSummary)"
```

---

## Task 3: `EventTreeEditor.tsx` — unify right column width + mount RiskSummary

**Files:** Modify `frontend/src/components/EventTreeEditor.tsx`. Depends on Tasks 1-2.

Read the file first. Relevant spots: layout consts at top (~L24 `SEQ_COLS`); outcome-table wrapper (~L272 `width: 300`); bottom dock — matrix `<section>` body (~L317) and checklist `<section>` (~L321 `width: 330`); `aggTotals` (~L146) and `aggCount` (~L148) are already computed.

- [ ] **Step 1: Import RiskSummary.** Add after the `RiskMatrix` import (~L13 `import { RiskMatrix } from './RiskMatrix'`):
```tsx
import { RiskSummary } from './RiskSummary'
```

- [ ] **Step 2: Add the `SIDE_W` constant.** Near the other layout consts at the top of the file (just after `const SEQ_COLS = '40px 1fr 44px 82px 34px'`):
```ts
const SIDE_W = 300   // 工作区右栏统一宽(末态序列表 / 参与汇总 ETA), 使上下右缘对齐
```

- [ ] **Step 3: Unify the outcome-table width.** Find (~L272):
```tsx
            <div style={{ width: 300, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
```
Replace with:
```tsx
            <div style={{ width: SIDE_W, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
```

- [ ] **Step 4: Unify the checklist section width.** Find (~L321):
```tsx
          <section style={{ ...panel, width: 330, flexShrink: 0 }}>
```
Replace with:
```tsx
          <section style={{ ...panel, width: SIDE_W, flexShrink: 0 }}>
```

- [ ] **Step 5: Mount RiskSummary beside the matrix (fill the blank).** Find the matrix panel body (~L317):
```tsx
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 12 }}>
              <RiskMatrix totals={aggTotals} />
            </div>
```
Replace with (flex row: matrix at content width on the left, summary fills the rest):
```tsx
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 12, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <RiskMatrix totals={aggTotals} />
              <RiskSummary totals={aggTotals} etaCount={aggCount} />
            </div>
```

- [ ] **Step 6: Verify.** `npm run build --prefix frontend` (tsc clean). `npm run test --prefix frontend` (unchanged green). Controller preview-DOM verifies: (a) outcome table and ETA-checklist right edges share the same X (aligned); (b) the matrix panel now shows the risk-summary card to the right of the grid (no large blank); (c) summary shows the final-zone verdict.

- [ ] **Step 7: Commit.**
```bash
git add frontend/src/components/EventTreeEditor.tsx
git commit -m "feat(eta): 统一右栏宽 SIDE_W(上下对齐) + 矩阵区并排 RiskSummary(填充空白)"
```

---

## Task 4: Regression + rebuild standalone + docs

**Files:** Rebuild `bess-eta-standalone.html`; Modify `docs/superpowers/ROADMAP.md`.

- [ ] **Step 1: Full regression.**
  - `npm run test --prefix frontend` → all vitest green (incl. 5 new in Task 1).
  - `npm run build --prefix frontend` → `tsc -b && vite build` clean.
  - `.venv/Scripts/python.exe -m pytest -q` → backend unchanged (no regression).
- [ ] **Step 2: Rebuild offline single file.** `npm run bundle --prefix frontend` → rewrites `bess-eta-standalone.html` (confirm size printed, exit 0).
- [ ] **Step 3: Smoke-check (preview).** Controller (servers already run on :5173/:8000, or start `frontend`): on the ETA tab, confirm the bottom risk row shows matrix + risk-summary side by side (no blank), and the sequence table / ETA-checklist right edges line up.
- [ ] **Step 4: Docs.** Add a bullet to `docs/superpowers/ROADMAP.md` (frontend section, after the latest 2026-06-24 entry): "ETA 工作台布局对齐 + 矩阵填空(2026-06-25,分支 feat/eta-barrier-reorder-cn-names):统一右栏宽 `SIDE_W=300`(末态序列表↔参与汇总 ETA 上下对齐,检视器 356 一致右轨);风险矩阵 `section` 内并排 `RiskSummary` 卡(新 `riskSummary` 纯函数:分区评价/各区计数/最严重后果/≥C4 累计)填充原空白;暂不改界面风格,`RiskMatrix` 与引擎/数据不变。重建 bess-eta-standalone.html。spec/plan docs/superpowers/{specs,plans}/2026-06-25-eta-professional-layout*"
- [ ] **Step 5: Commit.**
```bash
git add docs/superpowers/ROADMAP.md
git commit -m "chore(eta): ROADMAP 记录 布局对齐 + 矩阵填空(离线单文件已重建)"
```

---

## Self-Review

**Spec coverage:**
- §2.1 column alignment (`SIDE_W` unifying outcome table 300 + checklist 330→300; main columns flex; inspector 356 unchanged) → Task 3 Steps 2-4. ✓
- §2.2 matrix fill (`riskSummary` pure fn + `RiskSummary` card beside `RiskMatrix`, reusing styles) → Task 1 (`riskSummary`) + Task 2 (`RiskSummary`, style reuse) + Task 3 Step 5 (mount). ✓
- §2 "no style change / RiskMatrix unchanged" → `RiskMatrix.tsx` not in File Structure; `RiskSummary` uses existing color/font vocabulary only. ✓
- §3 compatibility (no data/engine/state change) → only `riskmatrix.ts` (additive pure fn) + a presentational component + layout widths touched. ✓
- §4 tests → Task 1 vitest (empty/C-zone/A-zone/worstC/overall-precedence); alignment + fill via preview (Task 3/4). ✓
- §6 build order → Tasks 1→2→3→4 match. Standalone rebuild → Task 4. ✓

**Placeholder scan:** Task 1 complete fn + tests. Task 2 complete component. Task 3 exact find/replace blocks. Task 4 exact commands. No TBD/TODO/"handle edge cases". ✓

**Type consistency:** `riskSummary(totals): RiskSummaryData` / `RiskSummaryData` fields (`overall`/`zoneCounts`/`worstC`/`worstFreq`/`severe`) match between Task 1 (def + tests) and Task 2 (consumer). `RiskSummary({ totals, etaCount })` prop names match between Task 2 (def) and Task 3 (caller, passing `aggTotals`/`aggCount`). `SIDE_W` defined Task 3 Step 2, used Steps 3-4. `ZONE_COLORS`/`ZONE_LABEL`/`Zone` are existing `riskmatrix.ts` exports. ✓
