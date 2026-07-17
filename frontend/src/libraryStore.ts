import type { LibraryData } from './api'
import { isolateCorrupt } from './storageSafe'
// 注:libraryValidation 反向 type/值依赖本模块(LIBRARY_SECTIONS)——两侧均在函数体内惰性使用,无 TDZ 循环问题。
import { validateOverlayForImport, MAX_LIBRARY_FILE_BYTES } from './libraryValidation'

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
  let raw: string | null
  try { raw = localStorage.getItem(KEY) } catch { return emptyOverlay() } // 存储不可读
  if (!raw) return emptyOverlay()
  let o: unknown
  try { o = JSON.parse(raw) } catch { isolateCorrupt(KEY, raw); return emptyOverlay() } // 坏 JSON → 隔离,不静默丢失
  const base = emptyOverlay()
  if (o && typeof o === 'object') {
    const oo = o as { upsert?: Record<string, unknown>; deleted?: Record<string, unknown> }
    for (const s of LIBRARY_SECTIONS) {
      if (oo.upsert?.[s] && typeof oo.upsert[s] === 'object') base.upsert[s] = oo.upsert[s] as Record<string, LibraryRow>
      if (Array.isArray(oo.deleted?.[s])) base.deleted[s] = oo.deleted[s] as string[]
    }
  }
  return base
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
/**
 * 解析并**事务式校验**参考库文件:大小/版本/结构/逐行范围-单位-来源全通过才返回,
 * 任一不合法即点名抛错(调用方在合并前拦截 → 覆盖层逐位不变)。
 */
export function parseLibraryFile(text: string): LibraryOverlay {
  if (text.length > MAX_LIBRARY_FILE_BYTES) throw new Error(`参考库文件过大(上限 ${Math.floor(MAX_LIBRARY_FILE_BYTES / 1024 / 1024)}MB)`)
  let o: unknown
  try { o = JSON.parse(text) } catch { throw new Error('文件不是有效的 JSON') }
  const obj = o as { kind?: unknown; version?: unknown; overlay?: unknown; upsert?: unknown; deleted?: unknown } | null
  let overlay: unknown
  if (obj?.kind === 'bess-psa-library') {
    if (obj.version !== 1) throw new Error(`不支持的参考库文件版本:${String(obj.version)}`)
    if (!obj.overlay) throw new Error('参考库文件缺少 overlay')
    overlay = obj.overlay
  } else if (obj?.upsert && obj?.deleted) {
    overlay = obj
  } else {
    throw new Error('参考库文件格式无法识别')
  }
  const err = validateOverlayForImport(overlay)
  if (err) throw new Error(`参考库文件校验失败:${err}`)
  return overlay as LibraryOverlay
}
