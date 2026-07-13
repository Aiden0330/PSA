import type { ProjectPayload } from '../../project'

/**
 * 会话过期草稿暂存(规格 §9 验收:"会话过期→显式提示不丢编辑,本地草稿暂存")。
 * 保存动作撞上 401(AuthRequiredError,PSA_AUTH=local 会话已过期)时,编辑内容
 * 仍在内存中,但用户可能刷新/关标签 —— 落一份到 localStorage,重新登录后可一键恢复。
 * 与 localStore.ts 的常规离线存档列表分开命名空间:语义不同(那是"后端不可达"回退,
 * 这是"后端可达但认证过期"),混在一起会让人以为是同一件事。
 */
const DRAFT_KEY = 'bess-eta:session-expired-draft:v1'

export interface SessionDraft { name: string; payload: ProjectPayload; savedId: string; at: string }
export type SessionDraftMeta = Pick<SessionDraft, 'name' | 'at'>

export function stageSessionDraft(name: string, payload: ProjectPayload, savedId: string): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ name, payload, savedId, at: new Date().toISOString() }))
  } catch {
    // 暂存本身失败(隐私模式/配额超限)不应掩盖原始的会话过期错误 —— 调用方仍会显式提示用户。
  }
}

export function peekSessionDraft(): SessionDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const d = JSON.parse(raw)
    return d && typeof d === 'object' && d.payload ? (d as SessionDraft) : null
  } catch {
    return null
  }
}

export function clearSessionDraft(): void {
  try { localStorage.removeItem(DRAFT_KEY) } catch { /* 忽略:清不掉不影响正确性,只是残留 */ }
}
