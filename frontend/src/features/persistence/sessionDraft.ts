import type { ProjectPayload } from '../../project'

/**
 * 会话过期草稿暂存(FE-04 修复 → schema v2)。保存动作撞上 401(AuthRequiredError,
 * PSA_AUTH=local 会话已过期)时,编辑内容仍在内存中,但用户可能刷新/关标签 —— 落一份
 * 到 localStorage,重新登录后一键恢复。与 localStore.ts 的常规离线存档列表分开命名空间。
 *
 * v2 相对 v1 的三处修复(前端评审 FE-04):
 * 1. **保留 CAS 基线** lastVersionHash —— v1 恢复时清空基线 → 后续保存无 base_version_hash
 *    成强制覆盖语义,可绕过 409 覆盖服务端他端更新;v2 恢复带回基线,冲突照常 409。
 * 2. **按项目为键的 map** —— v1 单全局槽,A、B 先后 401 时后一个草稿无声覆盖前一个;
 *    v2 以 savedId(未存档用占位)为键,各项目草稿互不覆盖。
 * 3. **stageSessionDraft 返回成功/失败** —— v1 吞掉 setItem 异常(配额/隐私模式),
 *    UI 却宣称"已暂存";v2 返回 boolean,失败时调用方给下载兜底。
 */
const DRAFT_KEY = 'bess-eta:session-expired-draft:v2'

export interface SessionDraft {
  name: string
  payload: ProjectPayload
  savedId: string
  projectUuid: string
  lastVersionHash?: string     // CAS 基线:恢复后带回,保存仍受 409 保护
  at: string
}
export type SessionDraftMeta = Pick<SessionDraft, 'name' | 'at' | 'savedId'>

type DraftMap = Record<string, SessionDraft>

const draftKeyOf = (savedId: string, at: string) => savedId || `unsaved:${at}`

function readMap(): DraftMap {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    const m = raw ? JSON.parse(raw) : {}
    return m && typeof m === 'object' ? (m as DraftMap) : {}
  } catch { return {} }
}

function writeMap(m: DraftMap): boolean {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(m)); return true }
  catch { return false }               // 配额/隐私模式:调用方据此给下载兜底,绝不谎报成功
}

/** 暂存草稿;返回是否真正写入(FE-04:失败必须可见,不静默谎报)。 */
export function stageSessionDraft(
  name: string, payload: ProjectPayload, savedId: string,
  opts: { projectUuid?: string; lastVersionHash?: string } = {},
): { ok: boolean; key: string } {
  const at = new Date().toISOString()
  const key = draftKeyOf(savedId, at)
  const m = readMap()
  m[key] = { name, payload, savedId, projectUuid: opts.projectUuid ?? '',
             lastVersionHash: opts.lastVersionHash, at }
  return { ok: writeMap(m), key }
}

/** 全部草稿(按暂存时间倒序)。 */
export function listSessionDrafts(): SessionDraft[] {
  return Object.values(readMap()).sort((a, b) => (a.at < b.at ? 1 : -1))
}

export function getSessionDraft(key: string): SessionDraft | null {
  return readMap()[key] ?? null
}

export function clearSessionDraft(key: string): void {
  const m = readMap()
  if (key in m) { delete m[key]; writeMap(m) }
}

/** 该草稿的稳定键(供恢复/清除定位)。 */
export const sessionDraftKey = (d: Pick<SessionDraft, 'savedId' | 'at'>) => draftKeyOf(d.savedId, d.at)
