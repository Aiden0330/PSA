# BESS PSA — Professional UI Redesign Implementation Plan

> **For agentic workers:** Each task below is dispatched to a fresh `frontend-dev` subagent. Steps use checkbox (`- [ ]`) syntax. This is a **visual-layer restyle**: preserve ALL behavior, logic, props, state, and DOM structure unless a step explicitly says to change layout. No new tests are required, but the existing vitest suite (75 tests) MUST stay green and `npx tsc --noEmit` MUST stay clean after every phase.

**Goal:** Re-skin the existing React+TS BESS PSA frontend into a professional, data-dense engineering-software interface driven by one CSS design-token system — without changing any workflow or information architecture.

**Architecture:** Introduce `frontend/src/theme.css` holding ~40 CSS custom properties (design tokens) + a small set of base utility classes. Then mechanically replace hard-coded hex/values across components with `var(--psa-*)` tokens, add a global status bar, and apply two layout requirements: (#1a) sibling panels in a row are equal height, (#1b) the whole app adapts fluidly across desktop widths. Hybrid theme: dark slate chrome (`#0E1A27`) + light data-dense work area.

**Tech Stack:** React 18, TypeScript, Vite, plain CSS (no Tailwind/CSS-in-JS), ag-grid, echarts, reactflow. Fonts: IBM Plex Sans + IBM Plex Mono + Noto Sans SC (keep).

---

## Design tokens — `frontend/src/theme.css` (Phase 1 writes this verbatim)

```css
/* BESS PSA design tokens — single source of truth for the professional UI.
   Hybrid theme: dark slate chrome + light data-dense work area. */
:root {
  /* chrome (header, status bar, dark footers, init-event node) */
  --psa-chrome: #0E1A27;
  --psa-chrome-2: #142231;
  --psa-chrome-line: #0A141E;
  --psa-chrome-ink: #AEBCCB;
  --psa-chrome-ink-dim: #7C8B9C;

  /* surfaces */
  --psa-bg: #EEF1F4;
  --psa-surface: #FFFFFF;
  --psa-soft: #F8FAFC;
  --psa-soft-2: #FAFBFC;

  /* lines / borders */
  --psa-line: #E6ECF2;
  --psa-line-2: #D7DEE6;
  --psa-line-strong: #CFD8E1;

  /* ink / text */
  --psa-ink: #16202B;
  --psa-ink-2: #33415A;
  --psa-muted: #64748B;
  --psa-faint: #94A3B8;

  /* brand / primary action */
  --psa-primary: #1F6FE0;
  --psa-primary-strong: #1559B8;
  --psa-primary-soft: #E6F1FB;
  --psa-accent: #F0541E;        /* flame orange (logo / init-event accent bar) */
  --psa-amber: #D97706;

  /* status */
  --psa-ok: #2EC26A;
  --psa-danger: #DC2626;
  --psa-danger-strong: #B91C1C;
  --psa-danger-soft: #FEF2F2;
  --psa-warn: #D97706;

  /* consequence severity scale C1..C5 */
  --psa-c1: #16A34A;
  --psa-c2: #65A30D;
  --psa-c3: #D97706;
  --psa-c4: #EA580C;
  --psa-c5: #DC2626;

  /* risk-matrix zones */
  --psa-zone-a: #EF9A9A;
  --psa-zone-b: #FFCC80;
  --psa-zone-c: #A5D6A7;

  /* typography */
  --psa-font-sans: 'IBM Plex Sans', 'Noto Sans SC', system-ui, 'Segoe UI', sans-serif;
  --psa-font-mono: 'IBM Plex Mono', 'Noto Sans SC', monospace;

  /* radius */
  --psa-r-sm: 6px;
  --psa-r: 8px;
  --psa-r-lg: 10px;
  --psa-r-xl: 14px;

  /* elevation (subtle only — no heavy shadows) */
  --psa-shadow: 0 1px 2px rgba(15, 25, 40, .05);
  --psa-shadow-pop: 0 4px 14px -4px rgba(15, 25, 40, .18);

  /* layout */
  --psa-header-h: 54px;
  --psa-statusbar-h: 28px;
  /* responsive right-column / inspector width: shrinks on small screens, caps on large */
  --psa-side-w: clamp(248px, 22vw, 320px);
  --psa-inspector-w: clamp(300px, 24vw, 372px);
  --psa-ftsidebar-w: clamp(150px, 14vw, 208px);
}

/* ---- base utility classes (opt-in; inline styles may also use the vars directly) ---- */
.psa-num { font-family: var(--psa-font-mono); font-variant-numeric: tabular-nums; }

.psa-card { background: var(--psa-surface); border: 1px solid var(--psa-line); border-radius: var(--psa-r-lg); }
.psa-panel { background: var(--psa-surface); border: 1px solid var(--psa-line-2); border-radius: var(--psa-r-lg);
  display: flex; flex-direction: column; overflow: hidden; box-shadow: var(--psa-shadow); }
.psa-panel__head { height: 40px; flex-shrink: 0; border-bottom: 1px solid var(--psa-line);
  display: flex; align-items: center; gap: 8px; padding: 0 14px; background: var(--psa-soft-2);
  font-size: 13px; font-weight: 600; color: var(--psa-ink); }

.psa-btn { height: 30px; display: inline-flex; align-items: center; gap: 6px; padding: 0 11px;
  border: 1px solid var(--psa-line-strong); border-radius: 7px; background: var(--psa-surface);
  color: var(--psa-ink-2); font-size: 12.5px; font-weight: 500; cursor: pointer;
  transition: background .12s, border-color .12s; }
.psa-btn:hover { background: var(--psa-soft); border-color: var(--psa-line-2); }
.psa-btn:disabled { opacity: .55; cursor: default; }
.psa-btn--primary { background: var(--psa-primary); border-color: var(--psa-primary); color: #fff; }
.psa-btn--primary:hover { background: var(--psa-primary-strong); border-color: var(--psa-primary-strong); }
.psa-btn--dark { background: var(--psa-chrome); border-color: var(--psa-chrome); color: #fff; }
.psa-btn--danger { color: var(--psa-danger); }

.psa-statusbar { height: var(--psa-statusbar-h); flex-shrink: 0; background: var(--psa-chrome);
  display: flex; align-items: center; gap: 14px; padding: 0 14px; color: var(--psa-chrome-ink); font-size: 11.5px; }
.psa-statusbar .psa-num { color: #D7E0EA; }

.psa-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; display: inline-block; }
```

---

## Hex → token replacement map (apply across ALL component inline styles)

| Hard-coded hex (any case) | Replace with |
|---|---|
| `#0e1a27`, `#142231` | `var(--psa-chrome)` / `var(--psa-chrome-2)` |
| `#16202b` | `var(--psa-ink)` |
| `#33404f`, `#33415a`, `#445163`, `#16202b`(text in dark headers stays #fff) | `var(--psa-ink-2)` |
| `#64748b`, `#5a6878`, `#7a8696`, `#56657a` | `var(--psa-muted)` |
| `#94a3b8`, `#9fadbc`, `#8fa0b2`, `#94a1b0`, `#8593a3` | `var(--psa-faint)` |
| `#1f6fe0`, `#2563eb`, `#1f6fe0` | `var(--psa-primary)` |
| `#1559b8`, `#1a5fc0`, `#1e40af` | `var(--psa-primary-strong)` |
| `#e6f1fb`, `#f6f9fe`, `#eaf1fb`, `#e6effb` | `var(--psa-primary-soft)` |
| `#e2e8f0`, `#e6ecf2`, `#eef2f6`, `#eef2f7`, `#eef1f5`, `#f1f4f7` | `var(--psa-line)` |
| `#d7dee6`, `#cfd8e1`, `#d2dae2`, `#cbd5e1` | `var(--psa-line-2)` |
| `#f8fafc`, `#fafbfc`, `#f1f5f9` | `var(--psa-soft)` / `var(--psa-soft-2)` |
| `#dc2626`, `#df3b2f`, `#c0291f` | `var(--psa-danger)` |
| `#b91c1c`, `#b45309` | `var(--psa-danger-strong)` / `var(--psa-warn)` |
| `#16a34a` | `var(--psa-c1)` (or `--psa-ok` for status dots) |
| `#65a30d` | `var(--psa-c2)` |
| `#d97706`, `#ef8a2b`, `#c4690f` | `var(--psa-c3)` / `var(--psa-amber)` |
| `#ea580c` | `var(--psa-c4)` |
| `#f0541e`, `#d23a14` | `var(--psa-accent)` |
| `'IBM Plex Mono', ...` literals | `var(--psa-font-mono)` |

Rules for agents:
- Replace **only** color/font literals; do not change numeric layout values except where a step says so.
- The existing `C_COLOR` map in `riskmatrix.ts` already centralizes C1–C5 — leave its hex as-is (it is the single source for SVG fills that can't read CSS vars easily) BUT where a component hardcodes the same severity hex inline, prefer the token.
- SVG `fill=`/`stroke=` attributes can use `var(--psa-*)` in modern browsers; keep it simple — for SVG severity colors keep using the `C_COLOR` import. For SVG chrome/line colors, inline hex → token is fine.
- Keep every `toExponential`/`toFixed` numeric exactly as-is.

---

## Task 1 — Foundation tokens (frontend-dev)

**Files:** Create `frontend/src/theme.css`; Modify `frontend/src/main.tsx` (add `import './theme.css'`); Modify `frontend/src/index.css` (align base input/select/scrollbar to tokens); Delete `frontend/src/App.css` (dead Vite boilerplate — verify no import first).

- [ ] Create `frontend/src/theme.css` with the exact contents from the "Design tokens" section above.
- [ ] In `main.tsx`, add `import './theme.css'` AFTER `import './index.css'`.
- [ ] Grep for `App.css` import (`grep -r "App.css" frontend/src`). If only `main.tsx`/none import it and it is unused, delete the file and remove any import. If something imports it, instead empty it to a single comment.
- [ ] In `index.css`, replace the literal border/color hex in the `select`, `input`, focus, and scrollbar rules with the matching `var(--psa-*)` tokens (e.g. border `#cfd8e1`→`var(--psa-line-2)`, focus `#1f6fe0`→`var(--psa-primary)`, focus ring `rgba(31,111,224,.15)` keep, scrollbar thumb `#c2ccd6` keep or `var(--psa-line-strong)`). Keep the `@import` font line and all selectors/behavior identical.
- [ ] Verify: `cd frontend && npx tsc --noEmit` clean; `npm run test` → 75 passing. Do NOT start the dev server.
- [ ] Commit: `git add -A && git commit -m "feat(ui): design-token layer (theme.css) + base classes; drop dead App.css"`

## Task 2 — App shell + status bar (frontend-dev)

**Files:** Modify `frontend/src/App.tsx` (the `hdr`, `toolbar`, `sectionTitle`, `primaryBtn`, `iconBtn`, `tabBtn`, `etaToolbar`, `ribbon*`, `etaTabsRow`, `etaTabStyle`, `etaAddBtn`, `ftSidebar*` style objects at lines ~660-683, plus the header JSX ~383-404 and the tab routing container backgrounds).

- [ ] Replace every hard-coded hex in the App.tsx `CSSProperties` consts and inline styles using the hex→token map. Header gradient `linear-gradient(180deg,#142231,#0e1a27)` → solid `var(--psa-chrome)` (no gradients — they flash). Logo gradient → solid `var(--psa-accent)`.
- [ ] Add a **global status bar** as the last child of the root `<div>` (after the tab-content conditional, before the modals): a `<footer className="psa-statusbar">` showing: an `--psa-ok` dot + "引擎就绪"; current tab label; and right-aligned `v2.0`. Wire any cheap already-available values (e.g. active ETA name from `activeName`) — do not compute anything new/expensive. Keep it purely presentational.
- [ ] Responsive shell: on the header `<nav>` and the `etaToolbar`/`etaTabsRow`, ensure `flex-wrap: wrap` and remove any `min-width` that forces overflow; the root already sets `minWidth:0`. The nav tab group should wrap below the logo on narrow widths rather than overflow.
- [ ] Preserve ALL onClick handlers, props, conditionals, and the tab state machine exactly.
- [ ] Verify: `npx tsc --noEmit` clean; `npm run test` → 75 passing.
- [ ] Commit: `git add -A && git commit -m "feat(ui): App shell on tokens + global status bar + responsive header/ribbons"`

## Task 3 — ETA workspace: tokens + equal-height + responsive (frontend-dev)

**Files:** Modify `frontend/src/components/EventTreeEditor.tsx`, `frontend/src/components/RiskMatrix.tsx`, `frontend/src/components/RiskSummary.tsx`.

- [ ] Apply the hex→token map to all inline `CSSProperties` and inline `style=` in these three files (the `cell`, `primaryAction`, `tealAction`, `exportBtn`, `moveBtn`, `h4s`, `kpiCard`, `panel`, `phead`, `accent` consts in EventTreeEditor, and the `corner`/`colHead`/`rowHead`/zone styles in RiskMatrix). `primaryAction`/`tealAction` gradients → solid `var(--psa-primary)` / a solid teal `#0F766E` token-free is fine, or add `--psa-teal:#0F766E` to theme.css and use it. Keep `C_COLOR` SVG fills as-is.
- [ ] **#1a equal height:** In the BOTTOM DOCK row (`EventTreeEditor.tsx:326`, the `<div style={{ flex:'3 1 0', ... display:'flex', gap:12 }}>`) ensure `alignItems:'stretch'` so the risk-matrix panel and the ETA-checklist panel are exactly equal height. In the matrix panel body that holds `<RiskMatrix>` + `<RiskSummary>`, set the inner flex container to `alignItems:'stretch'` and let `RiskSummary` fill height so its bottom edge matches the matrix. Confirm the outer workspace↔inspector row (`:159`) keeps `alignItems:'stretch'` (inspector already `alignSelf:'stretch'`).
- [ ] **#1b responsive:** Replace the fixed `SIDE_W = 300` and inspector `width: 356` with the responsive tokens: outcome-table / ETA-checklist columns use `width: var(--psa-side-w)`; inspector aside uses `width: var(--psa-inspector-w)`. Keep `flexShrink:0`. Ensure the tree canvas area keeps `flex:1; minWidth:0; overflow:auto` so it absorbs width changes. Verify nothing forces horizontal overflow at 1280px and 1024px.
- [ ] Preserve all SVG geometry, handlers, quant/import/export logic, and props.
- [ ] Verify: `npx tsc --noEmit` clean; `npm run test` → 75 passing.
- [ ] Commit: `git add -A && git commit -m "feat(ui): ETA workspace on tokens + equal-height bottom dock + responsive widths"`

## Task 4 — FTA workspace (frontend-dev)

**Files:** Modify `frontend/src/components/FaultTreeCanvas.tsx`, `frontend/src/components/nodes.tsx`, `frontend/src/components/ResultsPanel.tsx`, `frontend/src/components/Inspector.tsx`, `frontend/src/components/Palette.tsx`, `frontend/src/components/BarrierFtModal.tsx`.

- [ ] Apply the hex→token map to all inline styles in these files. For reactflow node SVG/HTML in `nodes.tsx`, keep gate/symbol geometry; only swap fill/stroke/border/text colors to tokens (gates/structure → `--psa-ink-2`/`--psa-line-2`; selected → `--psa-primary`; basic-event heat keeps its existing scale).
- [ ] In `App.tsx` the FT tab uses `ftSidebar*` consts (already handled in Task 2) and a `width:440` right panel — change that right panel `width` to `var(--psa-inspector-w)` for consistency/responsiveness (this edit is in App.tsx around `:527`; coordinate: if Task 2 already tokenized it, just confirm).
- [ ] Preserve all reactflow wiring, selection, highlight/heat, and modal behavior.
- [ ] Verify: `npx tsc --noEmit` clean; `npm run test` → 75 passing.
- [ ] Commit: `git add -A && git commit -m "feat(ui): FTA canvas/nodes/results/inspector on tokens + responsive right panel"`

## Task 5 — Data screens (frontend-dev)

**Files:** Modify `frontend/src/components/ParamLibrary.tsx`, `frontend/src/components/ReferenceLibrary.tsx`, `frontend/src/components/ConsequencesTab.tsx`, `frontend/src/components/LibPicker.tsx`, `frontend/src/components/EChart.tsx` (only if it has inline color literals).

- [ ] Apply the hex→token map to all inline styles. For ag-grid in `ParamLibrary.tsx`: if it uses the `ag-theme-*` class, add a small token-driven override block (header bg `var(--psa-soft)`, border `var(--psa-line)`, row hover `var(--psa-primary-soft)`, font `var(--psa-font-sans)`, numeric cells `var(--psa-font-mono)`) either via a `<style>` in the component or appended to `theme.css` under `.psa-grid`. Keep all column defs, data, and behavior identical.
- [ ] `ConsequencesTab.tsx`: severity chips use the C1–C5 tokens; keep entries/logic.
- [ ] Verify: `npx tsc --noEmit` clean; `npm run test` → 75 passing.
- [ ] Commit: `git add -A && git commit -m "feat(ui): parameter/reference/consequences screens on tokens + ag-grid theme"`

## Task 6 — Verification (orchestrator, not an agent)

- [ ] `cd frontend && npx tsc --noEmit` → clean.
- [ ] `npm run test` → 75 passing.
- [ ] `npm run build` → succeeds.
- [ ] Start dev server; screenshot every screen (ETA, FTA, params, library, consequences) at viewport widths 1440 and 1024; confirm: tokens applied (dark chrome, status bar), ETA bottom dock panels equal height (#1a), no horizontal overflow / no cramping at 1024 (#1b).
- [ ] Fix any regressions (dispatch a follow-up frontend-dev agent per screen if needed), re-verify.

## Task 7 — Merge & finalize (orchestrator)

- [ ] `git checkout main && git merge --no-ff feat/ui-pro-redesign` (sync to PSA_6th).
- [ ] Update `MEMORY.md` + `bess-psa-ui-redesign.md` to "implemented + merged".
- [ ] Leave `feat/ui-pro-redesign` branch in place for rollback reference.

---

## Self-review

- **Spec coverage:** tokens (Task 1) ✓; shell+status bar (Task 2) ✓; ETA restyle + #1a height align + #1b responsive (Task 3) ✓; FTA (Task 4) ✓; data screens + ag-grid (Task 5) ✓; verify incl. responsive screenshots (Task 6) ✓; merge-to-main/rollback (Task 7, branch) ✓.
- **No new behavior:** every task says "preserve logic"; only colors/fonts + 3 layout edits (status bar add, equal-height, responsive widths) change.
- **Consistency:** all phases consume the same `theme.css` tokens + hex→token map → uniform result. Token names are fixed in Task 1 and referenced unchanged later.
