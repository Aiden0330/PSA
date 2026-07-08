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
