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
