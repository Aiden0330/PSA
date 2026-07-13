import { EMBEDDED_BESS } from './embeddedData'
import { lsList, lsLoad, lsSave, lsDelete } from './localStore'
import type { AiDraftRequest, AiDraftResponse } from './aiDraft'

const BASE = '/api'

// 最近一次存档操作是否走了 localStorage 回退(后端不可达)。供 UI 显示离线提示。
let _savedOffline = false
export const wasSavedOffline = () => _savedOffline

export interface ExampleItem { id: string; name: string }
export interface ModelEnvelope { model: any; fault_tree: string }
export interface CutSet { events: string[]; order: number; probability: number }
export interface QuantifyPost {
  removed: number
  recovered: number
  probability_rea: number
  probability_mcub: number
}
export interface QuantifyResult {
  probability: number
  method: string
  cutsets: CutSet[]
  importance: Record<string, Record<string, number>>
  post?: QuantifyPost | null              // 4a3:应用了后处理规则时的统计 + MCS 级估计
}
export interface BessResult {
  consequences: Record<string, number>
  uncertainty: Record<string, { p05: number; p50: number; p95: number }>
  barrier_importance: [string, number][]
}

/** 后端不可达(单文件离线)时,GET 类请求回退到内置预置数据。 */
function embedFallback(path: string): unknown {
  const E = EMBEDDED_BESS
  if (!E) return undefined
  if (path === '/bess/scenarios') return E.scenarios
  if (path === '/bess/library') return E.library
  if (path === '/examples') return E.examples
  if (path.startsWith('/bess/event-tree')) {
    const m = path.match(/[?&]scenario=([^&]+)/)
    const key = m ? decodeURIComponent(m[1]) : '_default'
    return E.eventTrees?.[key] ?? E.eventTrees?._default
  }
  if (path.startsWith('/model/')) return E.models?.[decodeURIComponent(path.slice('/model/'.length))]
  return undefined
}

async function jget<T>(path: string): Promise<T> {
  try {
    const r = await fetch(`${BASE}${path}`)
    if (!r.ok) throw new Error(`${path} → ${r.status}`)
    return r.json()
  } catch (e) {
    const fb = embedFallback(path)
    if (fb !== undefined) return fb as T
    throw e
  }
}

export interface EtSequence {
  end_state: string
  path: Record<string, string>
  consequence: string
  frequency: number
}
export interface BessEventTree {
  init_event: string
  init_frequency: number
  functional_events: string[]
  labels: Record<string, string>
  fe_prob: Record<string, number>
  sequences: EtSequence[]
  consequences: Record<string, number>
  barrier_importance: [string, number][]
  fault_trees?: Record<string, any>
  parameters?: any[]
}

export interface SourceRef { citation: string; url?: string; note?: string }
export interface DetectionInfo { difficulty?: number; silent?: boolean; precursor?: string }
export interface LibraryData {
  meta: { disclaimer: string }
  component_failure_rates: { id: string; name: string; failure_mode: string; rate: number; unit: string; grade?: 'C' | 'D'; source: SourceRef; detection?: DetectionInfo }[]
  barrier_effectiveness: { id: string; name: string; category: string; pfd: number; eff?: number; grade?: 'C' | 'D'; source: SourceRef; detection?: DetectionInfo }[]
  initiating_events: { id: string; label: string; category: string; freq_prior: number; source: SourceRef }[]
}
export interface ScenarioItem { id: string; name: string }
export interface EtQuantifyResult { sequences: Record<string, number>; consequences: Record<string, number> }

export const getExamples = () => jget<ExampleItem[]>('/examples')
export const getModel = (id: string) => jget<ModelEnvelope>(`/model/${id}`)
export const bessThermalRunaway = () => jget<BessResult>('/bess/thermal-runaway')
export const getBessEventTree = (scenario?: string) =>
  jget<BessEventTree>('/bess/event-tree' + (scenario ? `?scenario=${encodeURIComponent(scenario)}` : ''))
export const getLibrary = () => jget<LibraryData>('/bess/library')
export const getScenarios = () => jget<ScenarioItem[]>('/bess/scenarios')

export async function draftAiModel(req: AiDraftRequest): Promise<AiDraftResponse> {
  const r = await fetch(`${BASE}/ai/draft-model`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  if (!r.ok) {
    let detail = ''
    try {
      const data = await r.json()
      detail = typeof data?.detail === 'string' ? data.detail : JSON.stringify(data)
    } catch {}
    throw new Error(detail || `AI draft model -> ${r.status}`)
  }
  return r.json()
}

/** 4b2 应用回执:记录逐元素接受清单(fire-and-forget,回执失败不阻断应用)。 */
export async function reportAiDraftApplied(rid: number, accepted: Record<string, unknown>,
                                           projectUuid?: string, status: 'applied' | 'rejected' = 'applied'): Promise<void> {
  try {
    await fetch(`${BASE}/ai/drafts/${rid}/applied`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, accepted, project_uuid: projectUuid }),
    })
  } catch { /* 回执尽力而为 */ }
}

export async function quantifyEventTree(req: any): Promise<EtQuantifyResult> {
  const r = await fetch(`${BASE}/event-tree/quantify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  if (!r.ok) throw new Error(`event-tree quantify → ${r.status}`)
  return r.json()
}

export interface EtBands { point: Record<string, number>; bands: Record<string, { p05: number; p50: number; p95: number }> }
export interface EtImportance { importance: Record<string, { barrier: string; fv: number; raw: number }[]> }

export async function uncertaintyEventTree(req: any): Promise<EtBands> {
  const r = await fetch(`${BASE}/event-tree/uncertainty`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req) })
  if (!r.ok) throw new Error(`uncertainty → ${r.status}`)
  return r.json()
}
export async function importanceEventTree(req: any): Promise<EtImportance> {
  const r = await fetch(`${BASE}/event-tree/importance`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req) })
  if (!r.ok) throw new Error(`importance → ${r.status}`)
  return r.json()
}

export interface SavedItem { id: string; name: string; saved_at: string }
export interface SavedRecord { id: string; name: string; saved_at: string; payload: any }

// ── 修复项 ①(ADR-4 盲区地雷):认证失败 ≠ 后端不可达 ──
// 401/403 意味着后端活着但拒绝了你 —— 此时静默写 localStorage 会让用户以为存到了服务器。
// 规则:AuthRequiredError 从 /api/saved 家族直接上抛(UI 弹登录);只有网络层异常
// (fetch reject)与其余 HTTP 错误(后端不可达/降级语义)才走 localStorage 回退。
export class AuthRequiredError extends Error {
  status: number
  constructor(status: number) {
    super(status === 403 ? '无权限(403):当前账户不能执行此操作' : '未登录(401):请登录后重试;本次操作未写入服务器,也不会伪装为离线存档')
    this.name = 'AuthRequiredError'
    this.status = status
  }
}

async function savedFetch(path: string, init?: RequestInit): Promise<Response> {
  const r = await fetch(`${BASE}${path}`, init)   // 网络异常原样上抛 → 调用方回退
  if (r.status === 401 || r.status === 403) throw new AuthRequiredError(r.status)
  return r
}

export async function listSaved(): Promise<SavedItem[]> {
  try {
    const r = await savedFetch('/saved')
    if (!r.ok) throw new Error(`/saved → ${r.status}`)
    const data = (await r.json()) as SavedItem[]
    _savedOffline = false
    return data
  } catch (e) {
    if (e instanceof AuthRequiredError) throw e
    _savedOffline = true
    return lsList()
  }
}
export async function loadSaved(id: string): Promise<SavedRecord> {
  try {
    const r = await savedFetch(`/saved/${id}`)
    if (!r.ok) throw new Error(`/saved/${id} → ${r.status}`)
    const data = (await r.json()) as SavedRecord
    _savedOffline = false
    return data
  } catch (e) {
    if (e instanceof AuthRequiredError) throw e
    _savedOffline = true
    return lsLoad(id) // 本地无此 id 时 lsLoad 自身抛「不存在」并向上传播(混合模式非目标)
  }
}
export async function saveWorkspace(name: string, payload: any, id?: string): Promise<SavedItem> {
  try {
    // id 省略 → 后端新建; 传入 → 原地更新该存档(JSON.stringify 会丢弃 undefined 的 id 键)
    const r = await savedFetch('/saved', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, payload, id }) })
    if (!r.ok) throw new Error(`save → ${r.status}`)
    const data = (await r.json()) as SavedItem
    _savedOffline = false
    return data
  } catch (e) {
    if (e instanceof AuthRequiredError) throw e
    _savedOffline = true
    return lsSave(name, payload, id)
  }
}
export async function deleteSaved(id: string): Promise<void> {
  try {
    const r = await savedFetch(`/saved/${id}`, { method: 'DELETE' })
    if (!r.ok) throw new Error(`delete → ${r.status}`)
    _savedOffline = false
  } catch (e) {
    if (e instanceof AuthRequiredError) throw e
    _savedOffline = true
    lsDelete(id) // 本地无此 id 时 lsDelete 自身抛「不存在」并向上传播
  }
}

// ── ADR-2 版本库读端(证据链:报告数字 → 案例 → 版本 → 文档)──
export interface ProjectInfo { uuid: string; name: string; created_at: string; modified_at: string; versions: number }
export interface VersionInfo { id: number; content_hash: string; parent_version_id: number | null; created_at: string; actor: string; origin: 'save' | 'auto_pin' | 'import'; message: string | null }
export interface CaseInfo { id: number; version_id: number; kind: string; engine_version: string; created_at: string; settings_json?: string; results_json?: string; artifacts_json?: string }
export const listProjects = () => jget<ProjectInfo[]>('/projects')
export const listProjectVersions = (uuid: string) => jget<VersionInfo[]>(`/projects/${uuid}/versions`)
export const listProjectCases = (uuid: string) => jget<CaseInfo[]>(`/projects/${uuid}/cases`)
export interface DiffChange { op: 'added' | 'removed' | 'changed'; path: string; from?: unknown; to?: unknown }
export interface VersionDiff {
  from: { id: number; content_hash: string }
  to: { id: number; content_hash: string }
  changes: DiffChange[]
  summary: { added: number; removed: number; changed: number }
}
export const diffProjectVersions = (uuid: string, from: number, to: number) =>
  jget<VersionDiff>(`/projects/${uuid}/diff?from=${from}&to=${to}`)

// ── Phase 5 评审/签发(D-P5-5 方向 A)──
// 评审动作离线无意义:失败显式抛错(detail-aware),绝不进 /api/saved 的 localStorage 回退家族。
export interface ReviewInfo {
  id: number
  version_id: number
  content_hash: string
  state: 'in_review' | 'signed' | 'returned'
  submitted_by: string
  submitted_at: string
  decided_by: string | null
  decided_at: string | null
  note: string | null
}
export interface ReviewComment { id: number; author: string; created_at: string; body: string }

async function jpostReview<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!r.ok) {
    let detail = ''
    try { const d = await r.json(); detail = typeof d?.detail === 'string' ? d.detail : '' } catch {}
    throw new Error(detail || `${path} → ${r.status}`)
  }
  return r.json()
}

export const listProjectReviews = (uuid: string) => jget<ReviewInfo[]>(`/projects/${uuid}/reviews`)
export const submitReview = (uuid: string, versionId: number, note?: string) =>
  jpostReview<ReviewInfo>(`/projects/${uuid}/reviews`, { version_id: versionId, note })
export const signReview = (uuid: string, versionId: number, note?: string, password?: string) =>
  jpostReview<ReviewInfo>(`/projects/${uuid}/reviews/${versionId}/sign`, { note, password })
export const returnReview = (uuid: string, versionId: number, note: string) =>
  jpostReview<ReviewInfo>(`/projects/${uuid}/reviews/${versionId}/return`, { note })
export const listVersionComments = (uuid: string, versionId: number) =>
  jget<ReviewComment[]>(`/projects/${uuid}/versions/${versionId}/comments`)
export const addVersionComment = (uuid: string, versionId: number, body: string) =>
  jpostReview<ReviewComment>(`/projects/${uuid}/versions/${versionId}/comments`, { body })

export async function importMef(xml: string): Promise<{ model: any; fault_tree: string }> {
  const r = await fetch(`${BASE}/import/mef`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ xml }) })
  if (!r.ok) throw new Error(`mef import → ${r.status}`)
  return r.json()
}

export async function exportReport(format: 'docx' | 'pdf' | 'csv', req: any, scenarioName: string, treePng?: string): Promise<void> {
  const r = await fetch(`${BASE}/report?format=${format}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...req, scenario_name: scenarioName, tree_png: treePng ?? null }),
  })
  if (!r.ok) throw new Error(`report → ${r.status}`)
  const blob = await r.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `qra_report.${format}`
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// 4a2/4a3 分析设置:house 覆盖 / 命名边界条件集 / 割集后处理规则(空则不改旧请求形状)。
export interface QuantifyOptions {
  house_states?: Record<string, boolean>
  boundary_condition_set?: string
  post_rules?: unknown[]
}
export async function quantify(model: any, fault_tree: string, method = 'exact',
                               opts: QuantifyOptions = {}): Promise<QuantifyResult> {
  const r = await fetch(`${BASE}/quantify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, fault_tree, method, ...opts }),
  })
  if (!r.ok) {
    let detail = ''
    try { const d = await r.json(); detail = typeof d?.detail === 'string' ? d.detail : '' } catch {}
    throw new Error(detail || `quantify → ${r.status}`)
  }
  return r.json()
}
