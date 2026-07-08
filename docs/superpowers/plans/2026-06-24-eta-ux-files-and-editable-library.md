# ETA UX Fixes + Project Files + Editable Reference Library — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Frontend code changes MUST go through the project's `frontend-dev` subagent; `test-runner` runs vitest; `code-reviewer` reviews diffs.

**Goal:** Fix five ETA tool issues — ① ETA tab name follows the initial-event name (double-click to override), ② delete an ETA, ③ save/load projects as portable files, ④ editable + expandable reference library, ⑤ FTA list grouped by owning ETA — all working offline in the single-file build.

**Architecture:** Frontend-only (React + TS, vitest). Two new isolated modules carry the heavy logic — `projectFile.ts` (file envelope build/parse) and `libraryStore.ts` (localStorage overlay on the baseline library). `ReferenceLibrary.tsx` is rewritten as an editable table. `App.tsx` integrates everything (① ② ⑤ + buttons + effective-library wiring). Engine/MEF/backend contract unchanged; all persistence is localStorage + files (no backend needed), so the offline standalone HTML keeps full function.

**Tech Stack:** React 18, TypeScript (strict, `import type`), Vite 5, vitest 2. Run tests: `npm run test --prefix frontend`. Type-check/build: `npm run build --prefix frontend`. Rebuild offline single file: `npm run bundle --prefix frontend`. Backend regression: `.venv/Scripts/python.exe -m pytest -q`. End commit bodies with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

| File | Change | Responsibility | Workstream |
|---|---|---|---|
| `frontend/src/projectFile.ts` | create | Project-file envelope: `buildProjectFile` / `parseProjectFile` / `downloadProjectFile`. Overlay carried opaquely (`unknown`) to stay decoupled from libraryStore. | W2 |
| `frontend/src/projectFile.test.ts` | create | vitest for build/parse/round-trip/error. | W2 |
| `frontend/src/libraryStore.ts` | create | Library overlay: `getOverlay`/`setOverlay`/`applyOverlay`/`upsertEntry`/`deleteEntry`/`resetOverlay`/`mergeOverlay` + `buildLibraryFile`/`parseLibraryFile`. | W3 |
| `frontend/src/libraryStore.test.ts` | create | vitest for overlay merge/persist/error. | W3 |
| `frontend/src/components/ReferenceLibrary.tsx` | rewrite | Editable + expandable 3-section table; export/import/reset; notify parent via `onLibraryChange`. | W3 |
| `frontend/src/project.ts` | modify | Add `renamed?: boolean` to `ProjectEta` + serialize/deserialize. | W1 |
| `frontend/src/project.test.ts` | modify | `renamed` round-trip + legacy default. | W1 |
| `frontend/src/App.tsx` | modify | ① derived display name + double-click rename; ② `onDeleteEta` + tab ✕; ⑤ FTA sidebar grouped; wire ③ buttons + ④ effective library. | W1 |
| `docs/superpowers/ROADMAP.md` | modify | Record the batch. | — |

**Workstream scheduling (multi-agent):** W2 (Task 1) and W3 (Tasks 2–3) are independent new files → dispatch in **parallel**. W1 (Tasks 4–8) edits `App.tsx`/`project.ts` and **integrates** W2/W3 → run **after** W2/W3 land, sequentially (4→5→6→7→8). Task 9 (regression + bundle) is the main session.

---

## Task 1 (W2): `projectFile.ts` — project file envelope

**Files:** Create `frontend/src/projectFile.ts`; Create `frontend/src/projectFile.test.ts`.

Context: `frontend/src/project.ts` exports `ProjectPayload` (`{ v:2, etas, activeKey, checkedKeys }`) and `deserializeProject(payload: unknown, fallbackName)` which already tolerates raw v2 and legacy `{etModel,fts}`. This module only wraps/unwraps a file envelope; it passes any library overlay through opaquely (typed `unknown`) so W2 stays independent of W3.

- [ ] **Step 1: Write failing tests** — create `frontend/src/projectFile.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildProjectFile, parseProjectFile } from './projectFile'
import type { ProjectPayload } from './project'

const payload: ProjectPayload = {
  v: 2,
  etas: [{
    key: 'a', name: 'A',
    model: { initEvent: 'IE', initFreq: 1e-3, functionalEvents: [], root: { kind: 'leaf', consequence: 'C1' } } as any,
    fts: { model_data: { parameters: [] }, fault_trees: [] }, pfds: {},
  }],
  activeKey: 'a', checkedKeys: { a: true },
}

describe('projectFile', () => {
  it('buildProjectFile 产出带 kind/version/ISO 时间戳的信封', () => {
    const f = buildProjectFile(payload)
    expect(f.kind).toBe('bess-psa-project')
    expect(f.version).toBe(2)
    expect(f.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(f.payload).toEqual(payload)
    expect(f.libraryOverlay).toBeUndefined()
  })

  it('buildProjectFile 可携带 libraryOverlay(透传)', () => {
    const ov = { upsert: {}, deleted: {} }
    expect(buildProjectFile(payload, ov).libraryOverlay).toEqual(ov)
  })

  it('parseProjectFile 解析信封 → payload', () => {
    expect(parseProjectFile(JSON.stringify(buildProjectFile(payload))).payload).toEqual(payload)
  })

  it('parseProjectFile 携带 overlay 时一并返回', () => {
    const ov = { upsert: {}, deleted: {} }
    expect(parseProjectFile(JSON.stringify(buildProjectFile(payload, ov))).libraryOverlay).toEqual(ov)
  })

  it('parseProjectFile 接受裸 v2 payload', () => {
    expect((parseProjectFile(JSON.stringify(payload)).payload as ProjectPayload).etas).toHaveLength(1)
  })

  it('parseProjectFile 接受旧单-ETA payload', () => {
    const legacy = { etModel: { initEvent: 'IE' }, fts: { model_data: { parameters: [] }, fault_trees: [] } }
    expect((parseProjectFile(JSON.stringify(legacy)).payload as any).etModel.initEvent).toBe('IE')
  })

  it('坏 JSON / 无法识别 → 抛可读错误', () => {
    expect(() => parseProjectFile('{not json')).toThrow(/JSON/)
    expect(() => parseProjectFile(JSON.stringify({ foo: 1 }))).toThrow(/无法识别/)
  })

  it('round-trip 等价', () => {
    expect(parseProjectFile(JSON.stringify(buildProjectFile(payload))).payload).toEqual(payload)
  })
})
```

- [ ] **Step 2: Run, verify FAIL.** `npm run test --prefix frontend` → module not found / functions undefined.

- [ ] **Step 3: Implement** — create `frontend/src/projectFile.ts`:

```ts
import type { ProjectPayload } from './project'

// 项目文件信封(v2)。libraryOverlay 以 unknown 透传, 不耦合 libraryStore 形状(由 App 注入/消费)。
export interface ProjectFile {
  kind: 'bess-psa-project'
  version: 2
  exportedAt: string
  payload: ProjectPayload
  libraryOverlay?: unknown
}

/** 打包当前项目 payload(可选携带参考库覆盖层)为可下载信封。 */
export function buildProjectFile(payload: ProjectPayload, libraryOverlay?: unknown): ProjectFile {
  return {
    kind: 'bess-psa-project', version: 2, exportedAt: new Date().toISOString(),
    payload, ...(libraryOverlay !== undefined ? { libraryOverlay } : {}),
  }
}

/** 解析项目文件:信封 → 取 payload(+overlay);裸 v2 / 旧单-ETA → 透传给调用方的 deserializeProject 兜底。 */
export function parseProjectFile(text: string): { payload: unknown; libraryOverlay?: unknown } {
  let obj: unknown
  try { obj = JSON.parse(text) } catch { throw new Error('文件不是有效的 JSON') }
  const o = obj as Record<string, unknown> | null
  if (!o || typeof o !== 'object') throw new Error('项目文件格式无法识别')
  if (o.kind === 'bess-psa-project' && o.payload && typeof o.payload === 'object') {
    return { payload: o.payload, libraryOverlay: o.libraryOverlay }
  }
  if (o.v === 2 && Array.isArray(o.etas)) return { payload: o }                  // 裸 v2
  if (o.etModel || o.functionalEvents) return { payload: o }                     // 旧单-ETA
  throw new Error('项目文件格式无法识别')
}

/** 触发浏览器下载(纯 DOM 副作用, 不在单测覆盖)。 */
export function downloadProjectFile(file: ProjectFile, baseName: string): void {
  const safe = (baseName || 'bess-psa-project').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80)
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `${safe}.psaproj.json`
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
```

- [ ] **Step 4: Run, verify PASS.** `npm run test --prefix frontend` (8 new green). Then `npm run build --prefix frontend` (tsc clean).

- [ ] **Step 5: Commit.**
```bash
git add frontend/src/projectFile.ts frontend/src/projectFile.test.ts
git commit -m "feat(project): 项目文件导出/导入信封 projectFile.ts + vitest"
```

---

## Task 2 (W3): `libraryStore.ts` — reference-library overlay

**Files:** Create `frontend/src/libraryStore.ts`; Create `frontend/src/libraryStore.test.ts`.

Context: `LibraryData` (see `frontend/src/api.ts`) has three array sections — `component_failure_rates`, `barrier_effectiveness`, `initiating_events` — plus `meta`. Each row has an `id` and a nested `source{citation,url?,note?}`. The overlay stores edits/additions (`upsert` by id) and hidden baseline rows (`deleted`), persisted in `localStorage`. `applyOverlay` is a pure merge (used app-wide to get the effective library). jsdom provides `localStorage`.

- [ ] **Step 1: Write failing tests** — create `frontend/src/libraryStore.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  getOverlay, applyOverlay, upsertEntry, deleteEntry, resetOverlay,
  mergeOverlay, emptyOverlay, buildLibraryFile, parseLibraryFile,
} from './libraryStore'
import type { LibraryData } from './api'

const base: LibraryData = {
  meta: { disclaimer: 'D' } as any,
  component_failure_rates: [
    { id: 'C1', name: '电芯', failure_mode: '热失控', rate: 1e-7, unit: '/cell', source: { citation: 'x' } },
    { id: 'C2', name: 'BMS', failure_mode: '失效', rate: 1e-5, unit: '/h', source: { citation: 'y' } },
  ],
  barrier_effectiveness: [{ id: 'B1', name: 'CID', category: 'cell', pfd: 0.1, source: { citation: 'z' } }],
  initiating_events: [{ id: 'I1', label: '内短', category: 'cell', freq_prior: 1e-3, source: { citation: 'w' } }],
}

beforeEach(() => localStorage.clear())

describe('libraryStore', () => {
  it('无覆盖层 → applyOverlay 与基线等价, 且不改基线对象', () => {
    const out = applyOverlay(base, getOverlay())
    expect(out.component_failure_rates).toHaveLength(2)
    expect(out.component_failure_rates).not.toBe(base.component_failure_rates)
  })

  it('upsert 覆盖既有 id 字段(不增行)', () => {
    upsertEntry('component_failure_rates', { id: 'C1', name: '电芯', failure_mode: '热失控', rate: 9e-9, unit: '/cell', source: { citation: 'x' } })
    const out = applyOverlay(base, getOverlay())
    expect(out.component_failure_rates.find((r) => r.id === 'C1')!.rate).toBe(9e-9)
    expect(out.component_failure_rates).toHaveLength(2)
  })

  it('upsert 新 id → 追加', () => {
    upsertEntry('barrier_effectiveness', { id: 'B9', name: '气溶胶', category: 'module', pfd: 0.2, source: { citation: 'n' } })
    const ids = applyOverlay(base, getOverlay()).barrier_effectiveness.map((r) => r.id)
    expect(ids).toContain('B9'); expect(ids).toHaveLength(2)
  })

  it('delete 隐藏基线行', () => {
    deleteEntry('component_failure_rates', 'C2')
    expect(applyOverlay(base, getOverlay()).component_failure_rates.map((r) => r.id)).toEqual(['C1'])
  })

  it('upsert 同 id 复活被删行', () => {
    deleteEntry('component_failure_rates', 'C2')
    upsertEntry('component_failure_rates', { id: 'C2', name: 'BMS', failure_mode: '失效', rate: 2e-5, unit: '/h', source: { citation: 'y' } })
    expect(applyOverlay(base, getOverlay()).component_failure_rates.find((r) => r.id === 'C2')!.rate).toBe(2e-5)
  })

  it('meta 保留', () => {
    expect(applyOverlay(base, getOverlay()).meta).toEqual(base.meta)
  })

  it('resetOverlay 清空 → 回基线', () => {
    deleteEntry('component_failure_rates', 'C2'); resetOverlay()
    expect(applyOverlay(base, getOverlay()).component_failure_rates).toHaveLength(2)
  })

  it('mergeOverlay 非破坏并入(只 upsert, 保留本地删除)', () => {
    deleteEntry('component_failure_rates', 'C1')
    const other = emptyOverlay()
    other.upsert.barrier_effectiveness['B9'] = { id: 'B9', name: 'x', category: 'm', pfd: 0.3, source: { citation: 'a' } }
    mergeOverlay(other)
    const out = applyOverlay(base, getOverlay())
    expect(out.component_failure_rates.map((r) => r.id)).toEqual(['C2'])
    expect(out.barrier_effectiveness.map((r) => r.id)).toContain('B9')
  })

  it('buildLibraryFile / parseLibraryFile round-trip', () => {
    upsertEntry('barrier_effectiveness', { id: 'B9', name: 'x', category: 'm', pfd: 0.3, source: { citation: 'a' } })
    expect(parseLibraryFile(JSON.stringify(buildLibraryFile())).upsert.barrier_effectiveness['B9'].pfd).toBe(0.3)
  })

  it('parseLibraryFile 坏格式抛错', () => {
    expect(() => parseLibraryFile('{bad')).toThrow(/JSON/)
    expect(() => parseLibraryFile(JSON.stringify({ x: 1 }))).toThrow(/无法识别/)
  })

  it('坏 JSON → getOverlay 返回空覆盖层', () => {
    localStorage.setItem('bess-eta:library-overlay:v1', '{bad')
    expect(getOverlay()).toEqual(emptyOverlay())
  })

  it('setItem 抛错 → 写操作抛可读错误', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError') })
    expect(() => upsertEntry('initiating_events', { id: 'I9', label: 'x', category: 'c', freq_prior: 1e-3, source: { citation: 'q' } })).toThrow(/参考库本地保存失败/)
    spy.mockRestore()
  })
})
```

- [ ] **Step 2: Run, verify FAIL.** `npm run test --prefix frontend`.

- [ ] **Step 3: Implement** — create `frontend/src/libraryStore.ts`:

```ts
import type { LibraryData } from './api'

export type LibrarySection = 'component_failure_rates' | 'barrier_effectiveness' | 'initiating_events'
export const LIBRARY_SECTIONS: LibrarySection[] = ['component_failure_rates', 'barrier_effectiveness', 'initiating_events']

export interface LibraryRow { id: string; [k: string]: unknown }
export interface LibraryOverlay {
  upsert: Record<LibrarySection, Record<string, LibraryRow>>
  deleted: Record<LibrarySection, string[]>
}

const KEY = 'bess-eta:library-overlay:v1'

export function emptyOverlay(): LibraryOverlay {
  return {
    upsert: { component_failure_rates: {}, barrier_effectiveness: {}, initiating_events: {} },
    deleted: { component_failure_rates: [], barrier_effectiveness: [], initiating_events: [] },
  }
}

export function getOverlay(): LibraryOverlay {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return emptyOverlay()
    const o = JSON.parse(raw)
    const base = emptyOverlay()
    if (o && typeof o === 'object') for (const s of LIBRARY_SECTIONS) {
      if (o.upsert?.[s] && typeof o.upsert[s] === 'object') base.upsert[s] = o.upsert[s]
      if (Array.isArray(o.deleted?.[s])) base.deleted[s] = o.deleted[s]
    }
    return base
  } catch { return emptyOverlay() } // 坏 JSON / 不可读 → 空覆盖层
}

export function setOverlay(o: LibraryOverlay): void {
  try { localStorage.setItem(KEY, JSON.stringify(o)) }
  catch { throw new Error('参考库本地保存失败(可能是隐私模式或空间不足)') }
}

/** 纯合并:基线上叠加覆盖层 —— upsert 按 id 覆盖/新增, deleted 隐藏。不改基线对象。 */
export function applyOverlay(base: LibraryData, o: LibraryOverlay): LibraryData {
  const out: LibraryData = { ...base }
  for (const s of LIBRARY_SECTIONS) {
    const rows = (((base as unknown as Record<string, LibraryRow[]>)[s]) ?? [])
    const del = new Set(o.deleted[s] ?? [])
    const ups = o.upsert[s] ?? {}
    const merged = rows.filter((r) => !del.has(r.id)).map((r) => (ups[r.id] ? { ...r, ...ups[r.id] } : r))
    const seen = new Set(merged.map((r) => r.id))
    for (const [id, row] of Object.entries(ups)) if (!seen.has(id) && !del.has(id)) merged.push(row)
    ;(out as unknown as Record<string, LibraryRow[]>)[s] = merged
  }
  return out
}

export function upsertEntry(section: LibrarySection, row: LibraryRow): LibraryOverlay {
  const o = getOverlay()
  o.upsert[section][row.id] = row
  o.deleted[section] = (o.deleted[section] ?? []).filter((x) => x !== row.id) // 复活被删 id
  setOverlay(o); return o
}

export function deleteEntry(section: LibrarySection, id: string): LibraryOverlay {
  const o = getOverlay()
  delete o.upsert[section][id]
  if (!o.deleted[section].includes(id)) o.deleted[section].push(id)
  setOverlay(o); return o
}

export function resetOverlay(): LibraryOverlay { const o = emptyOverlay(); setOverlay(o); return o }

/** 项目导入用:非破坏并入另一覆盖层(只 upsert, 不引入其 deleted)。 */
export function mergeOverlay(other: LibraryOverlay | undefined): LibraryOverlay {
  const o = getOverlay()
  if (other && typeof other === 'object') for (const s of LIBRARY_SECTIONS) {
    for (const [id, row] of Object.entries(other.upsert?.[s] ?? {})) {
      o.upsert[s][id] = row
      o.deleted[s] = o.deleted[s].filter((x) => x !== id)
    }
  }
  setOverlay(o); return o
}

// ── 参考库独立文件(导出/导入) ──
export interface LibraryFile { kind: 'bess-psa-library'; version: 1; exportedAt: string; overlay: LibraryOverlay }
export function buildLibraryFile(): LibraryFile {
  return { kind: 'bess-psa-library', version: 1, exportedAt: new Date().toISOString(), overlay: getOverlay() }
}
export function parseLibraryFile(text: string): LibraryOverlay {
  let o: any
  try { o = JSON.parse(text) } catch { throw new Error('文件不是有效的 JSON') }
  if (o?.kind === 'bess-psa-library' && o.overlay) return o.overlay as LibraryOverlay
  if (o?.upsert && o?.deleted) return o as LibraryOverlay
  throw new Error('参考库文件格式无法识别')
}
```

- [ ] **Step 4: Run, verify PASS.** `npm run test --prefix frontend` (13 new green). `npm run build --prefix frontend` (tsc clean).

- [ ] **Step 5: Commit.**
```bash
git add frontend/src/libraryStore.ts frontend/src/libraryStore.test.ts
git commit -m "feat(library): 参考库 localStorage 覆盖层 libraryStore.ts(合并/持久/文件) + vitest"
```

---

## Task 3 (W3): rewrite `ReferenceLibrary.tsx` — editable + expandable

**Files:** Rewrite `frontend/src/components/ReferenceLibrary.tsx`. Depends on Task 2.

Context: current component is read-only. Rewrite to a column-spec-driven editable table over the effective library (`applyOverlay(base, getOverlay())`). Edits call `upsertEntry`/`deleteEntry`, then `onLibraryChange()` so `App` recomputes the app-wide effective library. Numeric fields use `type=number step=any`; nested `source.*` fields edit under `source`.

- [ ] **Step 1: Replace the file** with:

```tsx
import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { getLibrary } from '../api'
import type { LibraryData } from '../api'
import {
  getOverlay, applyOverlay, upsertEntry, deleteEntry, resetOverlay,
  mergeOverlay, buildLibraryFile, parseLibraryFile,
} from '../libraryStore'
import type { LibrarySection, LibraryRow } from '../libraryStore'

interface Col { key: string; label: string; num?: boolean; src?: boolean }
interface SectionSpec { section: LibrarySection; title: string; cols: Col[]; blank: () => LibraryRow }

const uid = () => 'usr_' + Math.random().toString(36).slice(2, 8)
const SRC: Col[] = [{ key: 'citation', label: '来源', src: true }, { key: 'url', label: 'URL', src: true }, { key: 'note', label: '备注', src: true }]

const SPECS: SectionSpec[] = [
  { section: 'component_failure_rates', title: '器件基础失效率',
    cols: [{ key: 'name', label: '器件' }, { key: 'failure_mode', label: '失效模式' }, { key: 'rate', label: '参考值', num: true }, { key: 'unit', label: '单位' }, { key: 'grade', label: '置信' }, ...SRC],
    blank: () => ({ id: uid(), name: '新器件', failure_mode: '', rate: 1e-6, unit: '', grade: 'D', source: { citation: '' } }) },
  { section: 'barrier_effectiveness', title: '防护措施有效性(PFD)',
    cols: [{ key: 'name', label: '措施' }, { key: 'category', label: '类型' }, { key: 'pfd', label: 'PFD', num: true }, { key: 'eff', label: 'η', num: true }, { key: 'grade', label: '置信' }, ...SRC],
    blank: () => ({ id: uid(), name: '新措施', category: '', pfd: 0.1, source: { citation: '' } }) },
  { section: 'initiating_events', title: '初始事件频率',
    cols: [{ key: 'label', label: '初因' }, { key: 'category', label: '类别' }, { key: 'freq_prior', label: '频率/年', num: true }, ...SRC],
    blank: () => ({ id: uid(), label: '新初因', category: '', freq_prior: 1e-3, source: { citation: '' } }) },
]

const th: CSSProperties = { textAlign: 'left', padding: '6px 8px', borderBottom: '2px solid #e2e8f0', fontSize: 11.5, color: '#334155', whiteSpace: 'nowrap' }
const td: CSSProperties = { padding: '2px 5px', borderBottom: '1px solid #f1f5f9' }
const inp: CSSProperties = { width: '100%', boxSizing: 'border-box', border: '1px solid transparent', borderRadius: 4, padding: '3px 5px', fontSize: 12, background: 'transparent' }
const btn: CSSProperties = { fontSize: 12, border: '1px solid #cbd5e1', borderRadius: 6, padding: '4px 10px', background: '#fff', cursor: 'pointer' }

const cellVal = (row: any, c: Col) => (c.src ? row.source?.[c.key] ?? '' : row[c.key] ?? '')
function withCell(row: any, c: Col, raw: string): LibraryRow {
  if (c.src) return { ...row, source: { ...(row.source ?? {}), [c.key]: raw } }
  if (c.num) { const v = raw === '' ? 0 : Number(raw); return Number.isNaN(v) ? row : { ...row, [c.key]: v } }
  return { ...row, [c.key]: raw }
}

export function ReferenceLibrary({ onLibraryChange }: { onLibraryChange?: () => void }) {
  const [base, setBase] = useState<LibraryData | null>(null)
  const [, force] = useState(0)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { getLibrary().then(setBase).catch((e) => setErr(String(e?.message ?? e))) }, [])

  const refresh = useCallback(() => { force((n) => n + 1); onLibraryChange?.() }, [onLibraryChange])
  const guard = (fn: () => void) => { try { fn(); refresh() } catch (e: any) { setErr(String(e?.message ?? e)) } }
  const eff = base ? applyOverlay(base, getOverlay()) : null

  const onExport = () => {
    const blob = new Blob([JSON.stringify(buildLibraryFile(), null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob); const a = document.createElement('a')
    a.href = url; a.download = 'bess-reference-library.json'; document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const onImport = async (f: File) => { try { mergeOverlay(parseLibraryFile(await f.text())); refresh() } catch (e: any) { setErr(String(e?.message ?? e)) } }

  if (err && !base) return <p style={{ padding: 24, color: '#b91c1c' }}>加载失败:{err}</p>
  if (!eff) return <p style={{ padding: 24 }}>加载中…</p>
  return (
    <div style={{ padding: 24, overflowY: 'auto', height: '100%', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <button style={btn} onClick={onExport}>导出参考库</button>
        <label style={btn}>导入参考库
          <input type="file" accept=".json" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onImport(f); e.currentTarget.value = '' }} />
        </label>
        <button style={{ ...btn, color: '#dc2626' }} onClick={() => { if (window.confirm('恢复内置参考库?将清空全部本地修改与新增。')) guard(() => resetOverlay()) }}>恢复内置</button>
        {err && <span style={{ color: '#b91c1c', fontSize: 12 }}>{err}</span>}
      </div>
      <div style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', padding: 12, borderRadius: 8, fontSize: 13, marginBottom: 18 }}>
        ⚠ {eff.meta.disclaimer}　<b>修改保存在本浏览器(localStorage),可导出文件迁移。</b>
      </div>

      {SPECS.map((spec) => {
        const rows = (eff as unknown as Record<string, any[]>)[spec.section]
        return (
          <div key={spec.section} style={{ marginBottom: 26 }}>
            <h3 style={{ marginBottom: 6 }}>{spec.title} <span style={{ fontSize: 12, color: '#94a3b8' }}>({rows.length})</span></h3>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead><tr>{spec.cols.map((c) => <th key={c.key} style={th}>{c.label}</th>)}<th style={th}></th></tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    {spec.cols.map((c) => (
                      <td key={c.key} style={td}>
                        <input style={inp} type={c.num ? 'number' : 'text'} step="any" value={cellVal(row, c) as any}
                          onChange={(e) => guard(() => upsertEntry(spec.section, withCell(row, c, e.target.value)))}
                          onFocus={(e) => (e.currentTarget.style.borderColor = '#93c5fd')}
                          onBlur={(e) => (e.currentTarget.style.borderColor = 'transparent')} />
                      </td>
                    ))}
                    <td style={td}><button title="删除该行" style={{ color: '#dc2626', border: 0, background: 'transparent', cursor: 'pointer', fontSize: 13 }}
                      onClick={() => { if (window.confirm('删除该行?')) guard(() => deleteEntry(spec.section, row.id)) }}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button style={{ ...btn, marginTop: 6 }} onClick={() => guard(() => upsertEntry(spec.section, spec.blank()))}>＋ 添加一行</button>
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Verify build.** `npm run build --prefix frontend` (tsc clean). `npm run test --prefix frontend` (unchanged green). Controller preview-DOM verifies in Task 8 wiring (edit a rate → persists; add/delete row; export/import/reset).

- [ ] **Step 3: Commit.**
```bash
git add frontend/src/components/ReferenceLibrary.tsx
git commit -m "feat(library): 参考库可编辑/可扩展(三段增删改 + 导出/导入/恢复内置)"
```

---

## Task 4 (W1): `project.ts` — `renamed` field

**Files:** Modify `frontend/src/project.ts`; Modify `frontend/src/project.test.ts`.

Context: `ProjectEta` is the persistable per-ETA snapshot. Add `renamed?: boolean` (true = user manually named the tab; false/absent = follow init-event name). v2 archives missing the field default to `false` (follow init-event, the requested behavior); legacy single-ETA archives default to `true` (preserve the deliberate archive name).

- [ ] **Step 1: Add failing tests** — append to `frontend/src/project.test.ts` (new `describe`):

```ts
describe('project renamed 字段', () => {
  it('renamed 往返保留', () => {
    const tabs: ProjectEta[] = [{ ...mkEta('a', 'A'), renamed: true }, { ...mkEta('b', 'B'), renamed: false }]
    const got = deserializeProject(serializeProject(tabs, 'a', { a: true, b: true }), 'x')
    expect(got.etas.map((e) => e.renamed)).toEqual([true, false])
  })
  it('v2 缺 renamed → 默认 false(跟随初因名)', () => {
    const got = deserializeProject({ v: 2, etas: [mkEta('a', 'A')], activeKey: 'a', checkedKeys: { a: true } }, 'x')
    expect(got.etas[0].renamed).toBe(false)
  })
  it('旧单-ETA → renamed true(保留存档名)', () => {
    const got = deserializeProject({ etModel: { initEvent: 'IE' }, fts: { model_data: { parameters: [] }, fault_trees: [] } }, '我的旧存档')
    expect(got.etas[0].renamed).toBe(true)
  })
})
```

- [ ] **Step 2: Run, verify FAIL.** `npm run test --prefix frontend`.

- [ ] **Step 3: Implement** in `frontend/src/project.ts`:
  - In `interface ProjectEta` add the field after `name`:
```ts
  name: string
  renamed?: boolean
```
  - In `serializeProject`, the `etas.map` object — add `renamed`:
```ts
    etas: etas.map((e) => ({
      key: e.key,
      name: e.name,
      renamed: e.renamed,
      model: e.model,
      fts: e.fts ?? EMPTY_FTS,
      pfds: e.pfds ?? {},
    })),
```
  - In `deserializeProject` v2 branch, the per-eta object — add `renamed`:
```ts
      return {
        key: typeof e.key === 'string' && e.key ? e.key : `eta${i}`,
        name: typeof e.name === 'string' && e.name ? e.name : `ETA ${i + 1}`,
        renamed: typeof e.renamed === 'boolean' ? e.renamed : false,
        model: e.model as EventTreeModel,
        fts: (e.fts as ModelJson) ?? EMPTY_FTS,
        pfds: e.pfds && typeof e.pfds === 'object' ? (e.pfds as Record<string, number>) : {},
      }
```
  - In `deserializeProject` legacy branch, the `eta` object — add `renamed: true`:
```ts
  const eta: ProjectEta = {
    key,
    name: fallbackName || 'ETA',
    renamed: true,
    model: (p?.etModel as EventTreeModel) ?? (p as unknown as EventTreeModel),
    fts: (p?.fts as ModelJson) ?? EMPTY_FTS,
    pfds: {},
  }
```

- [ ] **Step 4: Run, verify PASS.** `npm run test --prefix frontend` (3 new + existing green). `npm run build --prefix frontend` (tsc clean).

- [ ] **Step 5: Commit.**
```bash
git add frontend/src/project.ts frontend/src/project.test.ts
git commit -m "feat(project): ProjectEta.renamed(页签名手动覆盖标记) + 序列化兼容"
```

---

## Task 5 (W1): App ① — tab name follows init-event + double-click rename

**Files:** Modify `frontend/src/App.tsx`. Depends on Task 4.

Read `App.tsx` first. `EtaTab` is at L34; `summaries` at L251-258; `etaFtRows` at L303-315; `onAddEta` at L125-132; `buildScenarioTab` returns at L111; `loadProject` maps at L191-197; the ETA tab render is at L539-544.

- [ ] **Step 1: Add `renamed` to `EtaTab` + a display-name helper.** Change the interface (L34) to:
```ts
interface EtaTab { key: string; name: string; renamed?: boolean; model: EventTreeModel; fts: ModelJson; pfds: Record<string, number> }
```
Add a module-level helper just below the interface:
```ts
/** 页签显示名:未手动改名则跟随初始事件名(实时), 否则用手动名。 */
function etaDisplayName(t: EtaTab, m: EventTreeModel | null): string {
  return t.renamed ? t.name : (m?.initEvent?.trim() || t.name)
}
```

- [ ] **Step 2: Use the derived name in `summaries`.** In the `summaries` map (L251-258), change `return { key: t.key, name: t.name, ... }` so `name` uses the derived value (the loop already computes `m`):
```ts
    return { key: t.key, name: etaDisplayName(t, m), leafCount, worstC, worstFreq, active: t.key === activeKey, checked: !!checkedKeys[t.key] }
```

- [ ] **Step 3: Use the derived name in `etaFtRows`.** In the `etaFtRows` loop (L303-315) the `m` is computed per tab; change the two `etaName: t.name` pushes to `etaName: etaDisplayName(t, m)`:
```ts
      etaFtRows.push({ etaKey: t.key, etaName: etaDisplayName(t, m), name: '__init__', label: '初始事件' })
```
```ts
      if (fe.linkFt) etaFtRows.push({ etaKey: t.key, etaName: etaDisplayName(t, m), name: fe.id, label: fe.label || fe.id })
```

- [ ] **Step 4: Default `renamed:false` on creation.** In `onAddEta` (L125-132), include `renamed: false` in both the push and the `loadIntoActive` object:
```ts
  const onAddEta = () => {
    const key = 'c' + Date.now().toString(36)
    const name = '自定义 ETA ' + (etaTabs.length + 1)
    const m = newBlankEta(name)
    const tab: EtaTab = { key, name, renamed: false, model: m, fts: EMPTY_FTS, pfds: {} }
    setEtaTabs((list) => [...snapshotActive(list), tab])
    loadIntoActive(tab)
    setCheckedKeys((c) => ({ ...c, [key]: true }))
  }
```
In `buildScenarioTab` return (L111), add `renamed: false`:
```ts
    return { key: 'sc:' + (sid || 'default'), name, renamed: false, model, fts, pfds: p }
```
In `loadProject`'s `tabs` map (L191-197), carry `renamed`:
```ts
      const tabs: EtaTab[] = proj.etas.map((e) => ({
        key: e.key,
        name: e.name,
        renamed: e.renamed,
        model: normalizeEta(e.model as EventTreeModel),
        fts: (e.fts as ModelJson) ?? EMPTY_FTS,
        pfds: e.pfds ?? {},
      }))
```

- [ ] **Step 5: Double-click a tab to rename.** In the ETA tab render (L540), add `onDoubleClick` to the tab `<div>`:
```tsx
            {summaries.map((s) => (
              <div key={s.key} onClick={() => selectEta(s.key)}
                onDoubleClick={() => {
                  const t = etaTabs.find((x) => x.key === s.key); if (!t) return
                  const cur = etaDisplayName(t, s.key === activeKey ? etModel : t.model)
                  const name = window.prompt('ETA 名称', cur)
                  if (name && name.trim()) setEtaTabs((list) => list.map((x) => x.key === s.key ? { ...x, name: name.trim(), renamed: true } : x))
                }}
                title={s.name} style={etaTabStyle(s.active)}>
```

- [ ] **Step 6: Verify.** `npm run build --prefix frontend` (tsc clean). `npm run test --prefix frontend` (green). Controller preview-DOM: open ETA tab → edit 初始事件 input → tab label + "当前 ETA" update live; double-click tab → rename → editing init-event no longer changes the tab.

- [ ] **Step 7: Commit.**
```bash
git add frontend/src/App.tsx
git commit -m "feat(eta): 页签名跟随初始事件名(可双击改名覆盖, 持久化 renamed)"
```

---

## Task 6 (W1): App ② — delete an ETA

**Files:** Modify `frontend/src/App.tsx`. Depends on Task 5 (`etaDisplayName`).

- [ ] **Step 1: Add `onDeleteEta`.** Add near `onAddEta` (after L132):
```ts
  const onDeleteEta = (key: string) => {
    if (etaTabs.length <= 1) return                       // 仅剩 1 个不允许删
    const t = etaTabs.find((x) => x.key === key); if (!t) return
    const nm = etaDisplayName(t, t.key === activeKey ? etModel : t.model)
    if (!window.confirm(`删除 ETA「${nm}」?此操作不可撤销。`)) return
    const snap = snapshotActive(etaTabs)                  // 先固化活动页实时编辑
    const remaining = snap.filter((x) => x.key !== key)
    setEtaTabs(remaining)
    setCheckedKeys((c) => { const n = { ...c }; delete n[key]; return n })
    if (key === activeKey) {
      const idx = snap.findIndex((x) => x.key === key)
      loadIntoActive(remaining[Math.min(idx, remaining.length - 1)])
    }
  }
```

- [ ] **Step 2: Add ✕ to each tab.** Inside the tab `<div>` (from Task 5), after the leaf-count `<span>` (L543), add (only when more than one tab):
```tsx
                <span style={{ fontFamily: '"IBM Plex Mono",monospace', fontSize: 10, color: '#9fadbc' }}>({s.leafCount})</span>
                {etaTabs.length > 1 && (
                  <span onClick={(e) => { e.stopPropagation(); onDeleteEta(s.key) }} title="删除此 ETA"
                    style={{ marginLeft: 2, color: '#9fadbc', fontSize: 13, lineHeight: 1, padding: '0 3px', borderRadius: 4 }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = '#dc2626')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = '#9fadbc')}>✕</span>
                )}
```

- [ ] **Step 3: Verify.** `npm run build --prefix frontend` (tsc clean). `npm run test --prefix frontend` (green). Controller preview-DOM: add 2 ETAs → ✕ on a non-active removes it; ✕ on active switches to neighbor; with one tab left the ✕ disappears.

- [ ] **Step 4: Commit.**
```bash
git add frontend/src/App.tsx
git commit -m "feat(eta): 删除 ETA(页签 ✕ + 确认 + 删活动页切相邻, 末个禁删)"
```

---

## Task 7 (W1): App ⑤ — FTA sidebar grouped by ETA

**Files:** Modify `frontend/src/App.tsx`. Depends on Task 5.

Context: the FTA sidebar (L357-371) maps `etaFtRows` flat with a small gray per-row ETA subtitle. Replace with grouping by `etaKey`, an ETA sub-header per group (using the now-meaningful display name), and rows showing just the barrier label.

- [ ] **Step 1: Replace the flat list** (L358-371, the block from `<div style={ftSidebarGroup}>ETA 挂载 FTA</div>` through its closing of the empty/`map`) with:
```tsx
            <div style={ftSidebarGroup}>ETA 挂载 FTA</div>
            {etaFtRows.length === 0
              ? <div style={ftSidebarEmpty}>(无挂载故障树)</div>
              : Object.entries(
                  etaFtRows.reduce((acc, r) => {
                    (acc[r.etaKey] ??= { name: r.etaName, rows: [] }).rows.push(r)
                    return acc
                  }, {} as Record<string, { name: string; rows: typeof etaFtRows }>),
                ).map(([etaKey, grp]) => (
                  <div key={etaKey}>
                    <div style={ftSidebarSubhead} title={grp.name}>{grp.name}</div>
                    {grp.rows.map((row) => (
                      <div key={row.etaKey + ':' + row.name}
                        style={ftSidebarRow(ftIsEta && ftEtaName === row.name && activeKey === row.etaKey)}
                        onClick={() => { if (row.etaKey !== activeKey) selectEta(row.etaKey); setFtEditTarget({ src: 'eta', name: row.name }); setSelected(null); setResult(null); setError(null) }}
                        title={`${row.etaName} / ${row.label}`}
                      >
                        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.label}</span>
                      </div>
                    ))}
                  </div>
                ))
            }
```

- [ ] **Step 2: Add the sub-header style.** Near the other `ftSidebar*` styles (after `ftSidebarGroup`, ~L600), add:
```ts
const ftSidebarSubhead: CSSProperties = { padding: '6px 10px 3px', fontSize: 11.5, fontWeight: 700, color: '#1e3a5f', background: '#eef4fb', borderBottom: '1px solid #e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
```

- [ ] **Step 3: Verify.** `npm run build --prefix frontend` (tsc clean). `npm run test --prefix frontend` (green). Controller preview-DOM: with ≥2 ETAs that each have mounted FTAs, the FTA tab's left list shows one header per ETA (meaningful names from Task 5) with its FTAs beneath; clicking a row under a non-active ETA switches to that ETA and edits its FT.

- [ ] **Step 4: Commit.**
```bash
git add frontend/src/App.tsx
git commit -m "feat(fta): FTA 侧栏按 ETA 分组(组标题=ETA 显示名)"
```

---

## Task 8 (W1): App — wire ③ project files + ④ effective library

**Files:** Modify `frontend/src/App.tsx`. Depends on Tasks 1, 2, 3, 4, 5.

- [ ] **Step 1: Imports.** Add to the import block (top of `App.tsx`):
```ts
import { buildProjectFile, parseProjectFile, downloadProjectFile } from './projectFile'
import { applyOverlay, getOverlay, mergeOverlay } from './libraryStore'
```

- [ ] **Step 2: Effective library via overlay + version.** Replace the `lib` state + its loader (L55 `const [lib, setLib] = ...` and L70 `useEffect(() => { getLibrary().then(setLib)... })`) with a baseline + effective pair:
```ts
  const [libBase, setLibBase] = useState<LibraryData | null>(null)
  const [lib, setLib] = useState<LibraryData | null>(null)
  const [libVersion, setLibVersion] = useState(0)
```
```ts
  useEffect(() => { getLibrary().then(setLibBase).catch(() => {}) }, [])
  useEffect(() => { if (libBase) setLib(applyOverlay(libBase, getOverlay())) }, [libBase, libVersion])
```
(Keep `LibraryData` in the existing `import type { ... LibraryData } from './api'`.)

- [ ] **Step 3: Pass `onLibraryChange` to the library tab.** Change the `library` tab render (L504) from `<ReferenceLibrary />` to:
```tsx
          <ReferenceLibrary onLibraryChange={() => setLibVersion((n) => n + 1)} />
```

- [ ] **Step 4: Add file export/import handlers.** Add near `onSaveAs` (after L185):
```ts
  // 导出项目为文件(含参考库覆盖层, 离线可用)
  const onExportFile = () => {
    if (!etModel) return
    const payload = serializeProject(snapshotActive(etaTabs), activeKey, checkedKeys)
    const active = etaTabs.find((t) => t.key === activeKey)
    const name = active ? etaDisplayName(active, etModel) : 'bess-psa-project'
    downloadProjectFile(buildProjectFile(payload, getOverlay()), name)
  }
  // 从文件导入项目(替换全部页签);若文件携带参考库覆盖层则非破坏并入
  const onImportFile = async (file: File) => {
    try {
      const { payload, libraryOverlay } = parseProjectFile(await file.text())
      const proj = deserializeProject(payload, file.name.replace(/\.[^.]+$/, ''))
      const tabs: EtaTab[] = proj.etas.map((e) => ({
        key: e.key, name: e.name, renamed: e.renamed,
        model: normalizeEta(e.model as EventTreeModel),
        fts: (e.fts as ModelJson) ?? EMPTY_FTS, pfds: e.pfds ?? {},
      }))
      if (!tabs.length) return
      if (libraryOverlay) { mergeOverlay(libraryOverlay as any); setLibVersion((n) => n + 1) }
      setEtaTabs(tabs); setCheckedKeys(proj.checkedKeys); setSavedId('')
      loadIntoActive(tabs.find((t) => t.key === proj.activeKey) ?? tabs[0])
    } catch (e: any) { setError(String(e?.message ?? e)) }
  }
```

- [ ] **Step 5: Add the ribbon buttons.** In the ETA ribbon, after the 另存为 button (L522), insert:
```tsx
            <button onClick={onExportFile} disabled={!etModel} style={ribbonBtn} title="导出项目为文件(.psaproj.json, 离线可用)">导出文件</button>
            <label style={{ ...ribbonBtn, display: 'inline-flex', alignItems: 'center' }} title="从文件导入项目">导入文件
              <input type="file" accept=".json,.psaproj.json" style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onImportFile(f); e.currentTarget.value = '' }} />
            </label>
```

- [ ] **Step 6: Verify.** `npm run build --prefix frontend` (tsc clean). `npm run test --prefix frontend` (green). Controller preview-DOM: edit a library rate → switch to FTA → "＋从库加基本事件" picks the new value; 导出文件 downloads; reload + 导入文件 restores all ETAs; library edits also carried.

- [ ] **Step 7: Commit.**
```bash
git add frontend/src/App.tsx
git commit -m "feat(app): 项目文件导出/导入按钮 + 参考库有效层(覆盖层叠加 + libVersion 重算)"
```

---

## Task 9: Regression + rebuild offline single file + docs

**Files:** Rebuild `bess-eta-standalone.html`; Modify `docs/superpowers/ROADMAP.md`.

- [ ] **Step 1: Full regression.**
  - `npm run test --prefix frontend` → all vitest green (incl. Task 1: 8, Task 2: 13, Task 4: 3 new).
  - `npm run build --prefix frontend` → `tsc -b && vite build` clean.
  - `npm run lint --prefix frontend` → no new errors.
  - `.venv/Scripts/python.exe -m pytest -q` → backend unchanged (no regression).
- [ ] **Step 2: Rebuild offline single file.** `npm run bundle --prefix frontend` → writes `bess-eta-standalone.html` at repo root. Confirm the printed size (~2–3 MB) and that the command exits 0.
- [ ] **Step 3: Smoke-check the standalone (no backend).** Controller opens `bess-eta-standalone.html` via the preview tools and verifies offline: ① add ETA → edit init-event → tab updates; ② delete an ETA; ③ 导出文件 then 导入文件 round-trips; ④ 参考库 edit/add/export/import/恢复内置; ⑤ FTA list grouped. (These exercise localStorage + files only — no backend, matching the offline target.)
- [ ] **Step 4: Docs.** Add a bullet to `docs/superpowers/ROADMAP.md` (frontend section): "ETA 易用性 + 项目文件 + 可编辑参考库(2026-06-24,分支 feat/eta-ux-and-editable-library):①页签名跟随初因名(可双击改名,renamed) ②删除 ETA ③项目文件导出/导入(projectFile,保留快速存档) ④参考库 localStorage 覆盖层可编辑可扩展(libraryStore,文件迁移,库随项目) ⑤FTA 侧栏按 ETA 分组;重建 bess-eta-standalone.html。spec/plan docs/superpowers/{specs,plans}/2026-06-24-eta-ux-files-and-editable-library*"
- [ ] **Step 5: Commit.**
```bash
git add bess-eta-standalone.html docs/superpowers/ROADMAP.md
git commit -m "chore(eta): 重建离线单文件 + ROADMAP 记录 ETA 易用性/文件/可编辑库批次"
```

---

## Self-Review

**Spec coverage:**
- §2.1 ① tab name follows init-event + double-click override → Task 4 (`renamed` persistence) + Task 5 (`etaDisplayName`, summaries/etaFtRows/创建默认/双击改名). ✓
- §2.2 ② delete ETA → Task 6 (`onDeleteEta` + tab ✕, last-tab guard, active→neighbor). ✓
- §2.3 ③ project file export/import (additive) → Task 1 (`projectFile.ts`) + Task 8 Steps 4–5 (buttons/handlers); quick-save untouched. ✓
- §2.4 ④ editable library overlay + file → Task 2 (`libraryStore.ts`) + Task 3 (editable UI) + Task 8 Steps 2–3 (effective lib + libVersion); "库随项目走" → Task 8 Step 4 (`buildProjectFile(..., getOverlay())` + import `mergeOverlay`). ✓
- §2.5 ⑤ FTA grouped by ETA → Task 7. ✓
- §6 multi-agent (W2/W3 parallel, W1 integrate) → File Structure table + task workstream tags + Execution Handoff. ✓
- §7 build order → Tasks 1–9 follow it; §交付 rebuild single HTML → Task 9 Step 2. ✓

**Placeholder scan:** New files (Tasks 1–3) have full code + tests. Modify tasks (4–8) give exact insertion points (line anchors) and complete code blocks. Task 9 has exact commands. No TBD/TODO/"handle edge cases". ✓

**Type consistency:**
- `buildProjectFile(payload, libraryOverlay?: unknown)` / `parseProjectFile(text): {payload: unknown; libraryOverlay?: unknown}` consistent across Task 1 (def + tests) and Task 8 (callers; App casts overlay via `as any` into `mergeOverlay`). ✓
- `LibrarySection`, `LibraryRow`, `LibraryOverlay`, `applyOverlay`/`getOverlay`/`upsertEntry`/`deleteEntry`/`resetOverlay`/`mergeOverlay`/`buildLibraryFile`/`parseLibraryFile`/`emptyOverlay` names match between Task 2 (def + tests), Task 3 (UI imports), Task 8 (App imports). ✓
- `etaDisplayName(t: EtaTab, m: EventTreeModel | null)` defined in Task 5, used in Tasks 5/6/8. ✓
- `ProjectEta.renamed` defined Task 4, consumed in Task 5 (`loadProject`) and Task 8 (`onImportFile`). ✓
- `ReferenceLibrary` prop `onLibraryChange?: () => void` defined Task 3, passed Task 8 Step 3. ✓
- `onDeleteEta` defined Task 6, used in tab render (same task). ✓
- `ftSidebarSubhead` defined Task 7 Step 2, used Task 7 Step 1. ✓
