// FE-11(前端评审:AI 草案应用审计不可靠 → 可靠 outbox):
// 应用 AI 草案前先在本地落一条"待同步回执"(localStorage 队列),服务端确认后标 synced。
// 401/500/网络中断/关闭页面/切项目均不丢审计 —— pending 回执留存,可后台重试。
// 回执绑定 project_uuid / workspace / 模型基线 hash / 逐元素接受清单(可反查草案来源)。
import { isolateCorrupt } from '../../storageSafe'

export const AI_OUTBOX_KEY = 'bess-eta:ai-receipt-outbox:v1'

export type ReceiptState = 'pending' | 'synced'
export type ReceiptStatus = 'applied' | 'rejected'

export interface AiReceipt {
  localId: string
  aiDraftId: number
  projectUuid?: string
  workspaceId: string
  modelBaselineHash?: string        // identity.lastVersionHash —— 应用所基于的模型版本(CAS 基线)
  accepted: string[]
  rejected: string[]
  mode: string
  status: ReceiptStatus
  at: number
  state: ReceiptState
  attempts: number
  lastError?: string
}

/** stageReceipt 的入参(state/attempts/localId 由 outbox 生成)。 */
export type ReceiptInput = Omit<AiReceipt, 'localId' | 'state' | 'attempts' | 'lastError' | 'at'> & { at?: number }

type Store = Record<string, AiReceipt>

function read(): Store {
  let raw: string | null
  try { raw = localStorage.getItem(AI_OUTBOX_KEY) } catch { return {} }
  if (!raw) return {}
  let o: unknown
  try { o = JSON.parse(raw) } catch { isolateCorrupt(AI_OUTBOX_KEY, raw); return {} }
  return o && typeof o === 'object' ? (o as Store) : {}
}

function write(s: Store): void {
  localStorage.setItem(AI_OUTBOX_KEY, JSON.stringify(s))   // 配额/隐私模式抛错 → 由调用方决定是否可见(不静默吞)
}

function genId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto
  if (c?.getRandomValues) {
    const a = new Uint8Array(6)
    c.getRandomValues(a)
    return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('')
  }
  return Math.floor(Math.random() * 0x1000000000000).toString(16)
}

/** 落一条 pending 回执到 localStorage(同步)。写失败(隐私模式/配额)→ staged=false,
 *  但绝不抛出阻断建模 —— 应用照常进行,来源可见由调用方提示。 */
export function stageReceipt(input: ReceiptInput): { receipt: AiReceipt; staged: boolean; error?: string } {
  const receipt: AiReceipt = {
    ...input,
    at: input.at ?? Date.now(),
    localId: genId(),
    state: 'pending',
    attempts: 0,
  }
  try {
    const s = read()
    s[receipt.localId] = receipt
    write(s)
    return { receipt, staged: true }
  } catch (e) {
    return { receipt, staged: false, error: e instanceof Error ? e.message : String(e) }
  }
}

function update(localId: string, patch: Partial<AiReceipt>): void {
  const s = read()
  const cur = s[localId]
  if (!cur) return
  s[localId] = { ...cur, ...patch }
  try { write(s) } catch { /* 写失败:内存态不更新,回执仍为上一次持久值(下次重试仍会尝试) */ }
}

/** 冲一条回执:send 成功 → synced;send 抛(401/500/网络)→ 保持 pending、attempts++、记 lastError。
 *  send 由调用方注入(通常是 api.reportAiDraftApplied),失败即抛。 */
export async function flushReceipt(localId: string, send: (r: AiReceipt) => Promise<void>): Promise<void> {
  const r = read()[localId]
  if (!r || r.state === 'synced') return
  const attempts = r.attempts + 1
  try {
    await send(r)
    update(localId, { state: 'synced', attempts, lastError: undefined })
  } catch (e) {
    update(localId, { attempts, lastError: e instanceof Error ? e.message : String(e) })
  }
}

/** 冲所有 pending(后台重试入口:切项目/挂载时)。逐条独立,一条失败不影响其它。 */
export async function flushPending(send: (r: AiReceipt) => Promise<void>): Promise<void> {
  for (const r of pendingReceipts()) await flushReceipt(r.localId, send)
}

export function listReceipts(): AiReceipt[] {
  return Object.values(read()).sort((a, b) => a.at - b.at)
}
export function pendingReceipts(): AiReceipt[] {
  return listReceipts().filter((r) => r.state === 'pending')
}
/** 清掉已 synced 的回执(服务端已有权威记录);pending 一律保留。 */
export function clearSyncedReceipts(): void {
  const s = read()
  let changed = false
  for (const id of Object.keys(s)) if (s[id].state === 'synced') { delete s[id]; changed = true }
  if (changed) try { write(s) } catch { /* 清理失败无害:synced 仅占空间,不影响审计 */ }
}
