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

// FE-07(HTTP 失败 vs 静态降级不得混同):jget 走内置降级时,响应必须"可见来源",
// 而非静默替换。命中 embedded 时在响应对象上挂非枚举 __provenance(不污染 JSON/渲染),
// 并 console.warn。consumer 可用 provenanceOf() 反查这份数据是否来自内置预置。
export interface JgetProvenance { source: 'server' | 'embedded'; reason?: string }
export function provenanceOf(x: unknown): JgetProvenance | undefined {
  return x && typeof x === 'object' ? (x as { __provenance?: JgetProvenance }).__provenance : undefined
}
function markProvenance<T>(data: T, prov: JgetProvenance): T {
  if (data && typeof data === 'object') {
    try { Object.defineProperty(data, '__provenance', { value: prov, enumerable: false, configurable: true, writable: true }) } catch { /* 冻结对象:忽略,来源仍由 console.warn 披露 */ }
  }
  return data
}

async function jget<T>(path: string): Promise<T> {
  try {
    const r = await fetch(`${BASE}${path}`)
    if (!r.ok) throw new Error(`${path} → ${r.status}`)
    return r.json()
  } catch (e) {
    const fb = embedFallback(path)
    if (fb !== undefined) {
      const reason = e instanceof Error ? e.message : String(e)
      console.warn(`[api] ${path} 后端不可达,回退内置预置数据(source=embedded;reason=${reason})`)
      return markProvenance(fb as T, { source: 'embedded', reason })
    }
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
export interface EtQuantifyResult {
  sequences: Record<string, number>
  consequences: Record<string, number>
  // 序列级 LFT 集成(规格 2026-07-15):设了 ie_fault_tree 时后端附带;单树响应两者为 null。
  method?: string | null
  ie_frequency?: number | null
}

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

// FE-11:应用回执不再 fire-and-forget 吞错 —— 检查 response.ok,失败(401/500/…)即抛,
// 网络 reject 原样上抛。可靠性(本地留存/重试)由 features/ai-draft/aiOutbox 承担,
// 本函数只负责一次网络提交并如实报告成败。
export async function reportAiDraftApplied(rid: number, accepted: Record<string, unknown>,
                                           projectUuid?: string, status: 'applied' | 'rejected' = 'applied'): Promise<void> {
  const r = await fetch(`${BASE}/ai/drafts/${rid}/applied`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, accepted, project_uuid: projectUuid }),
  })
  if (!r.ok) {
    let detail = ''
    try { const d = await r.json(); detail = typeof d?.detail === 'string' ? d.detail : '' } catch {}
    throw new StatusError(r.status, detail || `ai draft applied → ${r.status}`)
  }
}

export async function quantifyEventTree(req: any): Promise<EtQuantifyResult> {
  const r = await fetch(`${BASE}/event-tree/quantify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  // integrated 通道的合并护栏(节点 id 碰撞 / IE 参与 CCF / 屏障引用频率参数 / IE 块参数同 id)
  // 以 400 + 中文 detail 响亮拒绝 —— 原样上抛供 UI 显示,不吞成裸状态码。
  if (!r.ok) {
    let detail = ''
    try { const d = await r.json(); detail = typeof d?.detail === 'string' ? d.detail : '' } catch {}
    throw new Error(detail || `event-tree quantify → ${r.status}`)
  }
  return r.json()
}

export interface EtBands {
  point: Record<string, number>
  bands: Record<string, { p05: number; p50: number; p95: number }>
  // spec A(勾选集聚合,scope=checked_set 时后端附带;single 响应不变):
  scope?: 'checked_set'
  per_tree?: { key: string; name: string; consequences: Record<string, number> }[]
}

/** spec A:勾选集聚合的单棵树载荷(与单树请求同形 + 场景身份/口径注记)。
 *  报告/不确定性请求附 { scope:'checked_set', trees: AggregateTreePayload[] } 即聚合。 */
export interface AggregateTreePayload {
  key: string
  name: string
  init_event: string
  init_frequency: number
  functional_events: unknown[]
  fault_trees: Record<string, unknown>
  parameters: Record<string, unknown>
  sequences: unknown[]
  consequence_bins: Record<string, string>
  ccf_groups?: unknown[]
  labels?: Record<string, string>
  consequence_defs?: Record<string, string>
  init_note?: string
}
export interface EtImportance { importance: Record<string, { barrier: string; fv: number; raw: number }[]> }

export async function uncertaintyEventTree(req: any): Promise<EtBands> {
  const r = await fetch(`${BASE}/event-tree/uncertainty`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req) })
  if (!r.ok) throw new Error(`uncertainty → ${r.status}`)
  return r.json()
}
export async function importanceEventTree(req: any): Promise<EtImportance> {
  const r = await fetch(`${BASE}/event-tree/importance`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req) })
  if (!r.ok) {
    let detail = ''
    try { const d = await r.json(); detail = typeof d?.detail === 'string' ? d.detail : '' } catch {}
    throw new Error(detail || `importance → ${r.status}`)
  }
  return r.json()
}

export interface SavedItem { id: string; name: string; saved_at: string }
export interface SavedRecord { id: string; name: string; saved_at: string; payload: any; version_hash?: string }

// D-P5-4 乐观并发:保存时带 base_version_hash,服务器最新版本与之不一致 → 409
// (不覆盖,双方版本俱在)。UI 弹三路径:查看 diff / 另存副本 / 确认覆盖。
export class SaveConflictError extends Error {
  serverHash: string
  baseHash: string
  constructor(serverHash: string, baseHash: string) {
    super('版本冲突:他人已保存了更新的版本')
    this.name = 'SaveConflictError'
    this.serverHash = serverHash
    this.baseHash = baseHash
  }
}

// ── 修复项 ①(ADR-4 盲区地雷):认证失败 ≠ 后端不可达 ──
// 401/403 意味着后端活着但拒绝了你 —— 此时静默写 localStorage 会让用户以为存到了服务器。
// 规则:AuthRequiredError 从 /api/saved 家族直接上抛(UI 弹登录);只有网络层异常
// (fetch reject)与其余 HTTP 错误(后端不可达/降级语义)才走 localStorage 回退。
// review F2-R4:保存的 4xx 客户端缺陷(422 规范化失败 / 非法 id)—— 不是离线信号,
// 抛出让 UI 可见披露,绝不静默回退 localStorage。
export class SaveClientError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'SaveClientError'
    this.status = status
  }
}

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
export async function saveWorkspace(name: string, payload: any, id?: string, baseVersionHash?: string): Promise<SavedItem> {
  try {
    // id 省略 → 后端新建; 传入 → 原地更新该存档(JSON.stringify 会丢弃 undefined 的 id 键)
    const r = await savedFetch('/saved', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, payload, id, base_version_hash: baseVersionHash }) })
    if (r.status === 409) {
      let detail: { server_hash?: string; base_hash?: string } = {}
      try { detail = (await r.json())?.detail ?? {} } catch { /* body 不是预期形状时仍抛冲突 */ }
      throw new SaveConflictError(detail.server_hash ?? '', detail.base_hash ?? baseVersionHash ?? '')
    }
    // review F2-R4(2026-07-16 冷读):4xx 客户端缺陷(422 规范化失败/非法 id)不得
    // 静默回退 localStorage —— 那正是 EB-07 要消除的"服务器静默吞"换成"前端静默吞",
    // 用户仍以为已存到服务器。抛可见错误,由调用方披露(非离线信号)。
    if (r.status >= 400 && r.status < 500) {
      let msg = `save → ${r.status}`
      try { msg = (await r.json())?.detail ?? msg } catch { /* 保留状态码信息 */ }
      throw new SaveClientError(r.status, typeof msg === 'string' ? msg : `save → ${r.status}`)
    }
    if (!r.ok) throw new Error(`save → ${r.status}`)
    const data = (await r.json()) as SavedItem
    _savedOffline = false
    return data
  } catch (e) {
    if (e instanceof AuthRequiredError || e instanceof SaveConflictError
        || e instanceof SaveClientError) throw e
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

// ── R5 组合总览:每项目一行,数字取自已钉扎案例(绝不现算)。risk.* 的频带/评级
//    与报告矩阵同源(后端 report_export.risk_placement),前端不重复阈值。──
export type ReviewState = 'in_review' | 'signed' | 'returned'
export interface PortfolioRiskCell { severity: string; freq: number; freq_band: number; level: 'low' | 'medium' | 'high' | 'extreme' }
/** scenario:该案例覆盖的事件树/场景名(域评审 F2 口径披露);旧钉扎无此键 → null。
 *  scope/tree_count(spec A §2.4):checked_set 案例 → 徽章「聚合 n 树」替代场景名;
 *  旧案例后端补 scope="single"(零迁移),老前端字段可缺省。 */
export interface PortfolioCase { id: number; kind: string; consequences: Record<string, number>; version_hash: string; created_at: string; scenario: string | null; scope?: 'single' | 'checked_set'; tree_count?: number | null; risk: { cells: PortfolioRiskCell[]; worst: PortfolioRiskCell | null } }
/** open_review:挂起的在审行(可能钉在旧版本,is_latest=false → 前端标"已有更新版本")。
 *  review_state 锚定最新版本(当前模型是否签发),两者语义不同,都要。 */
export interface PortfolioRow { uuid: string; name: string; versions: number; latest_hash: string | null; review_state: ReviewState | null; open_review: { version_id: number; version_hash: string; is_latest: boolean } | null; latest_case: PortfolioCase | null; saved_id: string | null }
export const getPortfolio = () => jget<PortfolioRow[]>('/portfolio')
// FE-06:证据链读端走 jgetStatus(带 status 的 StatusError)—— 组件据此区分 401(重认证)/
// 403(无权限)/其它(错误条),绝不把读失败渲染成"暂无数据"。/projects/* 无内置降级,
// 语义与既有 jget 一致(都在非 2xx 上抛),只是错误从裸 Error 升级为可判定 status 的 StatusError。
export const listProjectVersions = (uuid: string) => jgetStatus<VersionInfo[]>(`/projects/${uuid}/versions`)
export const listProjectCases = (uuid: string) => jgetStatus<CaseInfo[]>(`/projects/${uuid}/cases`)
export interface DiffChange { op: 'added' | 'removed' | 'changed'; path: string; from?: unknown; to?: unknown }
export interface VersionDiff {
  from: { id: number; content_hash: string }
  to: { id: number; content_hash: string }
  changes: DiffChange[]
  summary: { added: number; removed: number; changed: number }
}
export const diffProjectVersions = (uuid: string, from: number, to: number) =>
  jgetStatus<VersionDiff>(`/projects/${uuid}/diff?from=${from}&to=${to}`)

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

// FE-06:评审/评论写端也升级为 StatusError(带 status),让 401 会话过期统一进重认证通道
// (原为裸 Error,组件无法区分 401)。所有既有 consumer 只读 .message,语义零回退。
async function jpostReview<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!r.ok) {
    let detail = ''
    try { const d = await r.json(); detail = typeof d?.detail === 'string' ? d.detail : '' } catch {}
    throw new StatusError(r.status, detail || `${path} → ${r.status}`)
  }
  return r.json()
}

export const listProjectReviews = (uuid: string) => jgetStatus<ReviewInfo[]>(`/projects/${uuid}/reviews`)
export const submitReview = (uuid: string, versionId: number, note?: string) =>
  jpostReview<ReviewInfo>(`/projects/${uuid}/reviews`, { version_id: versionId, note })
export const signReview = (uuid: string, versionId: number, note?: string, password?: string) =>
  jpostReview<ReviewInfo>(`/projects/${uuid}/reviews/${versionId}/sign`, { note, password })
export const returnReview = (uuid: string, versionId: number, note: string) =>
  jpostReview<ReviewInfo>(`/projects/${uuid}/reviews/${versionId}/return`, { note })
export const listVersionComments = (uuid: string, versionId: number) =>
  jgetStatus<ReviewComment[]>(`/projects/${uuid}/versions/${versionId}/comments`)
export const addVersionComment = (uuid: string, versionId: number, body: string) =>
  jpostReview<ReviewComment>(`/projects/${uuid}/versions/${versionId}/comments`, { body })

// ── Phase 5 认证(ADR-4 修复项 ①②③ / B4)──
// getMe() 401 ⟺ local 模式且未登录(off 模式恒 200,见 backend/auth/routes.py::me)。
// 关键区分(约束 #0):fetch 本身 reject(离线单文件/无后端)≠ HTTP 401 —— 前者绝不能
// 弹登录墙(单文件模式压根没有后端可登录),只有确凿的 401 响应才是"需要登录"。
// 因此 StatusError 携带 status,authStore 据 e.status===401 精确判定,网络异常一律放行。
export class StatusError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'StatusError'
    this.status = status
  }
}
async function jgetStatus<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`)   // 网络层异常原样上抛(无 status)→ 调用方视为"未知,放行"
  if (!r.ok) {
    let detail = ''
    try { const d = await r.json(); detail = typeof d?.detail === 'string' ? d.detail : '' } catch {}
    throw new StatusError(r.status, detail || `${path} → ${r.status}`)
  }
  return r.json()
}

export interface Identity {
  mode: 'off' | 'local'
  username: string
  role: 'admin' | 'analyst' | 'reviewer'
  display_name: string | null
}
export const getMe = () => jgetStatus<Identity>('/auth/me')
export const login = (username: string, password: string) =>
  jpostReview<Identity>('/auth/login', { username, password })
export async function logout(): Promise<void> {
  await fetch(`${BASE}/auth/logout`, { method: 'POST' })
}

// ── Phase 5 账户管理(admin only,B4 管理面)──
export interface AccountInfo { id: number; username: string; role: string; display_name: string | null; created_at: string; disabled: number }
export const listAccounts = () => jgetStatus<AccountInfo[]>('/admin/accounts')
export const createAccount = (username: string, password: string, role: string, displayName?: string) =>
  jpostReview<AccountInfo>('/admin/accounts', { username, password, role, display_name: displayName })
export async function setAccountDisabled(username: string, disabled: boolean): Promise<void> {
  const r = await fetch(`${BASE}/admin/accounts/${username}/disable?disabled=${disabled}`, { method: 'POST' })
  if (!r.ok) throw new Error(`disable account → ${r.status}`)
}

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
// ── 初因事件故障树频率(规格 2026-07-13):每割集一频率规则,违规 → 后端 400 中文 detail 原样上抛 ──
export interface FreqCutSet { events: string[]; order: number; frequency: number; initiator: string }
// 逐初因精确模式(规格 2026-07-14 §4):把最小割集按初因分组,F_i = λ_i·P(使能析取)。
export type FtFrequencyMethod = 'sum' | 'exact'
export interface FreqByInitiator { initiator: string; rate: number; enabling_probability: number; frequency: number }
export interface FtFrequencyResult {
  frequency: number
  cutsets: FreqCutSet[]
  method?: FtFrequencyMethod          // 后端透传(exact/sum 均回);旧后端缺省 → 视作 sum
  by_initiator?: FreqByInitiator[]    // 仅 exact 附带,按频率降序(规格 §4:Σcutsets ≥ 头条,并存即披露)
}
export async function ftFrequency(model: any, fault_tree: string, method?: FtFrequencyMethod): Promise<FtFrequencyResult> {
  const r = await fetch(`${BASE}/ft/frequency`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // method 省略 → 键被 JSON.stringify 丢弃 → 请求体与既有 sum 调用逐字节一致(默认 sum,零扰动)
    body: JSON.stringify({ model, fault_tree, method }),
  })
  if (!r.ok) {
    let detail = ''
    try { const d = await r.json(); detail = typeof d?.detail === 'string' ? d.detail : '' } catch {}
    throw new Error(detail || `ft frequency → ${r.status}`)
  }
  return r.json()
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
