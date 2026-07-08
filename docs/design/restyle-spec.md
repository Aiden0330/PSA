# BESS PSA — "Match the previews" restyle spec

Goal: make the real pages adopt the **clean, card-based visual language** of the approved mockups, instead of the old dense inline-styled look. The previews' DNA: white cards on a light slate canvas, **soft section headers**, compact **KPI metric cards**, an **icon toolbar** with flat buttons, **severity chips**, **tabular-mono numbers everywhere**, hairline borders, ~10–14px radii, generous-but-compact spacing. Tokens already exist in `frontend/src/theme.css` (`--psa-*`). This pass changes COMPOSITION & STYLING only — preserve every control, handler, prop, and the engine/export logic.

## A. Add these classes to `frontend/src/theme.css`

```css
/* ---- mockup-grade composition ---- */
.psa-ch { display:flex; align-items:center; justify-content:space-between; gap:8px;
  padding:8px 12px; border-bottom:1px solid var(--psa-line); background:var(--psa-soft); flex-shrink:0; }
.psa-ch .t { margin:0; font-size:12px; font-weight:600; color:var(--psa-ink-2); letter-spacing:.2px;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.psa-ch .meta { font-size:11px; color:var(--psa-faint); font-family:var(--psa-font-mono);
  font-variant-numeric:tabular-nums; white-space:nowrap; }

.psa-kpi { background:var(--psa-soft); border:1px solid var(--psa-line); border-radius:var(--psa-r);
  padding:9px 12px; display:flex; flex-direction:column; gap:3px; min-width:0; flex:1; }
.psa-kpi .l { font-size:11px; color:var(--psa-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.psa-kpi .v { font-size:20px; font-weight:600; font-family:var(--psa-font-mono);
  font-variant-numeric:tabular-nums; line-height:1.1; color:var(--psa-ink); }
.psa-kpi .v small { font-size:11px; font-weight:400; color:var(--psa-faint); margin-left:4px; }

.psa-tag { font-size:10.5px; padding:2px 7px; border-radius:5px; background:var(--psa-soft);
  color:var(--psa-ink-2); font-family:var(--psa-font-mono); }
.psa-chip { display:inline-flex; align-items:center; gap:6px; font-size:11.5px; font-weight:500; }
.psa-chip .sq { width:11px; height:11px; border-radius:3px; flex-shrink:0; }

.psa-field { display:flex; align-items:center; gap:8px; margin-bottom:6px; }
.psa-field > label, .psa-field > .k { width:auto; min-width:56px; font-size:11.5px; color:var(--psa-muted); }
```

Keep the existing `.psa-btn(+variants)`, `.psa-card`, `.psa-panel`, `.psa-statusbar`, `.psa-num`, `.psa-dot`.
Update `.psa-panel__head` to match `.psa-ch` (so existing panels using it get the cleaner header): set its `height:auto; padding:8px 12px; font-size:12px; font-weight:600; color:var(--psa-ink-2); background:var(--psa-soft);` and drop the 40px fixed height.

## B. Create `frontend/src/components/icons.tsx` — inline line icons (offline-safe, no CDN)

A single component `Icon` rendering 1.8px-stroke `currentColor` SVGs at a `size` prop (default 16), `viewBox 0 0 24 24`, `fill="none"`, `stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"`. Names needed: `plus` (M12 5v14 M5 12h14), `undo` (arrow-back-up: M9 14l-4-4 4-4 / M5 10h11a4 4 0 0 1 0 8h-1), `redo` (mirror), `save` (device-floppy), `download`, `upload`, `bolt` (M13 3 4 14h7l-1 7 9-11h-7z), `flame`, `chevron-down`, `check` (M5 12l5 5 9-11), `x` (M6 6l12 12 M18 6 6 18), `arrow-up`, `arrow-down`, `trash`. Use these in toolbars/inspector instead of text glyphs `↶ ↷ ✕ ＋ ⚙ 📊`.

## C. Shell — `frontend/src/App.tsx`

- The ETA ribbon (`etaToolbar` + `ribbonBtn/ribbonIcon/ribbonDark/ribbonSelect`): re-render the buttons with `className="psa-btn"` etc. Map: `＋添加屏障` → `psa-btn psa-btn--primary` + `<Icon name="plus"/>`; undo/redo → `psa-btn` icon-only (`<Icon name="undo"/>`/`redo`); `保存项目` → `psa-btn psa-btn--dark` + `<Icon name="save"/>`; `另存为`/`导出文件`/`导入文件` → `psa-btn` + download/upload icons; `打开场景`/`存档` selects keep but use the shared select style; `删除` → `psa-btn psa-btn--danger`.
- FT toolbar & sidebar: same button language; `量化` → `psa-btn psa-btn--dark` + bolt icon.
- Nav tabs and ETA tabs row already match the mockup (active = solid primary pill; tab = dot + name + mono count) — leave structure, just ensure tokens.
- Keep the status bar.

## D. ETA page — `frontend/src/components/EventTreeEditor.tsx` (the priority screen)

- **KPI strip:** replace the `kpiCard` divs (which use a colored `borderLeft`) with `className="psa-kpi"` cards (clean, no left accent). Keep the 4 metrics + values; value gets `.v` (mono), label `.l`, unit in `<small>`.
- **Tree panel:** the `<section style={panel}>` → keep as a `.psa-panel`, but replace the `phead` (accent-bar header) with a `.psa-ch` header: left `<span class="t">事件树 · 纵深防御序列</span>`, right `<span class="meta">{leafCount} 序列 · {engineSeq?'引擎精确':'前端积式'}</span>`. Move the 成功/失效 legend into the header row as small chips. Keep the SVG tree + outcome table exactly; only restyle their container chrome.
- **Outcome table** (right of tree): keep; ensure header row uses `.psa-ch` look and number cells use `.psa-num`.
- **Bottom dock:** both panels (`风险矩阵 · 多 ETA 汇总`, `参与汇总的 ETA`) → `.psa-ch` headers (drop the `accent` bar span). Keep equal-height behavior already in place.
- **Inspector aside:** section headers (`h4s` — 初始事件 / 功能事件(屏障) / 选中节点) → keep as small bold labels but lighter (12px/600 ink-2, no heavy left bar, or a 2px accent). The action buttons (`引擎精确量化`, `重要度 FV/RAW`, exports) → `psa-btn psa-btn--primary` (quantify) / `psa-btn` (others) + icons (bolt / chart / download). Inputs use the shared field style. The 属性/量化结果/重要度 tab strip: keep.
- Use `.psa-chip` (colored square + label) wherever a consequence C-level is shown as a label.

## E. FTA page — `FaultTreeCanvas.tsx`, `nodes.tsx`, `ResultsPanel.tsx`, `Inspector.tsx`, `Palette.tsx`

- Model-list sidebar, the canvas, and the results/inspector → wrap sections in `.psa-card`/`.psa-panel` with `.psa-ch` headers (e.g. `故障树 · <name>` with `顶事件 P = …` meta). Palette buttons → `psa-btn` + icons. Cut-set list rows + importance bars styled like the preview (contribution bar + mono value). KPI cards (顶事件概率 / 最小割集 / 基本事件) → `.psa-kpi`. Keep all reactflow wiring + node geometry.

## F. Params — `ParamLibrary.tsx`

- Wrap the grid in a `.psa-panel` with a `.psa-ch` header (`可靠性参数` + `N 个基本事件` meta). ag-grid already themed via `.psa-grid`. CCF groups → `.psa-card` tiles with `.psa-ch` headers + an "add group" dashed tile (the preview pattern). Toolbar (`新建 CCF 组`, 导出) → `psa-btn`/`--primary` + icons.

## Guardrails (every task)
Preserve all behavior, props, handlers, SVG geometry, engine/export logic, and `C_COLOR` severity fills. No new deps, no CDNs (icons are inline SVG). After each file: `npm --prefix frontend run build` (this runs `tsc -b`, which enforces `noUnusedLocals`) must be exit 0, and `npm --prefix frontend run test` must show 75 passed. Commit per page.
