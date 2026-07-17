import type { ProjectPayload } from './project'
import { validateProjectPayload } from './project'

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

/**
 * 解析并**严格校验**项目文件:信封 `version===2` + payload 深校验(etas/model/树形/fts),
 * 坏文件带路径点名拒绝、绝不半载入;裸 v2 同样深校验;旧单-ETA 透传给 deserializeProject 兜底。
 */
export function parseProjectFile(text: string): { payload: unknown; libraryOverlay?: unknown } {
  let obj: unknown
  try { obj = JSON.parse(text) } catch { throw new Error('文件不是有效的 JSON') }
  const o = obj as Record<string, unknown> | null
  if (!o || typeof o !== 'object') throw new Error('项目文件格式无法识别')
  if (o.kind === 'bess-psa-project') {
    if (o.version !== 2) throw new Error(`不支持的项目文件版本:${String(o.version)}`)
    if (!o.payload || typeof o.payload !== 'object') throw new Error('项目文件缺少 payload')
    const err = validateProjectPayload(o.payload)
    if (err) throw new Error(`项目文件校验失败:${err}`)
    return { payload: o.payload, libraryOverlay: o.libraryOverlay }
  }
  if (o.v === 2 && Array.isArray(o.etas)) {                                       // 裸 v2
    const err = validateProjectPayload(o)
    if (err) throw new Error(`项目文件校验失败:${err}`)
    return { payload: o }
  }
  if (o.etModel || o.functionalEvents) return { payload: o }                      // 旧单-ETA(兼容)
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
