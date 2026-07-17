/** FE-11 锚点:AI 草案应用回执的可靠 outbox。
 *  应用前先本地落一条待同步回执;401/500/网络中断/卸载/切项目均不丢审计(pending 留存、可重试);
 *  服务端确认后标 synced。 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  stageReceipt, flushReceipt, flushPending, pendingReceipts, listReceipts,
  clearSyncedReceipts, AI_OUTBOX_KEY,
} from './aiOutbox'

const input = (over: Partial<Parameters<typeof stageReceipt>[0]> = {}) => ({
  aiDraftId: 42,
  projectUuid: 'pu-1',
  workspaceId: 'wid-A',
  modelBaselineHash: 'hash-abc',
  accepted: ['e1', 'e2'],
  rejected: ['e3'],
  mode: 'complete_eta',
  status: 'applied' as const,
  ...over,
})

beforeEach(() => localStorage.clear())

describe('aiOutbox — 落盘与绑定', () => {
  it('stageReceipt 同步落 localStorage,pending,绑定项目/workspace/基线/接受清单', () => {
    const { receipt, staged } = stageReceipt(input())
    expect(staged).toBe(true)
    expect(receipt.state).toBe('pending')
    expect(receipt.localId).toMatch(/[0-9a-f]/)
    // 卸载/切项目模拟:即便此后不再 flush,localStorage 里仍在(审计不丢)
    const persisted = listReceipts()
    expect(persisted).toHaveLength(1)
    expect(persisted[0]).toMatchObject({
      aiDraftId: 42, projectUuid: 'pu-1', workspaceId: 'wid-A',
      modelBaselineHash: 'hash-abc', accepted: ['e1', 'e2'], rejected: ['e3'], mode: 'complete_eta',
    })
    // 真落到了 outbox 键上,不是内存态
    expect(localStorage.getItem(AI_OUTBOX_KEY)).toBeTruthy()
  })

  it('localStorage 写失败 → staged=false 但不抛(不阻断建模)', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    const { staged, error } = stageReceipt(input())
    expect(staged).toBe(false)
    expect(error).toBeTruthy()
    spy.mockRestore()
  })
})

describe('aiOutbox — flush 成功/失败/重试', () => {
  it('send 成功 → 标 synced,pending 清空', async () => {
    const { receipt } = stageReceipt(input())
    const send = vi.fn(async () => {})
    await flushReceipt(receipt.localId, send)
    expect(send).toHaveBeenCalledTimes(1)
    expect(pendingReceipts()).toHaveLength(0)
    expect(listReceipts()[0].state).toBe('synced')
  })

  it.each([
    ['401', new Error('未登录(401)')],
    ['500', new Error('applied → 500')],
    ['network reject', new TypeError('fetch failed')],
  ])('send 抛(%s)→ 回执留存 pending、attempts++、记 lastError(不丢审计)', async (_label, err) => {
    const { receipt } = stageReceipt(input())
    const send = vi.fn(async () => { throw err })
    await flushReceipt(receipt.localId, send)
    const p = pendingReceipts()
    expect(p).toHaveLength(1)
    expect(p[0].state).toBe('pending')
    expect(p[0].attempts).toBe(1)
    expect(p[0].lastError).toContain(err.message)
  })

  it('失败后可重试:第二次 send 成功 → synced', async () => {
    const { receipt } = stageReceipt(input())
    await flushReceipt(receipt.localId, async () => { throw new Error('500') })
    expect(pendingReceipts()).toHaveLength(1)
    await flushReceipt(receipt.localId, async () => {})   // 重试成功
    expect(pendingReceipts()).toHaveLength(0)
    expect(listReceipts()[0].state).toBe('synced')
    expect(listReceipts()[0].attempts).toBe(2)
  })

  it('flushPending 只冲 pending,已 synced 不重发', async () => {
    const a = stageReceipt(input({ aiDraftId: 1 })).receipt
    const b = stageReceipt(input({ aiDraftId: 2 })).receipt
    await flushReceipt(a.localId, async () => {})            // a synced
    const send = vi.fn(async () => {})
    await flushPending(send)
    expect(send).toHaveBeenCalledTimes(1)                    // 只有 b
    expect(pendingReceipts()).toHaveLength(0)
    expect(listReceipts().find((r) => r.localId === b.localId)!.state).toBe('synced')
  })

  it('clearSyncedReceipts 只清 synced,pending 保留', async () => {
    const a = stageReceipt(input({ aiDraftId: 1 })).receipt
    stageReceipt(input({ aiDraftId: 2 }))
    await flushReceipt(a.localId, async () => {})
    clearSyncedReceipts()
    const all = listReceipts()
    expect(all).toHaveLength(1)
    expect(all[0].state).toBe('pending')
  })

  it('损坏 outbox JSON → 隔离侧键,回落空(不抛,不吞全部)', () => {
    localStorage.setItem(AI_OUTBOX_KEY, '{bad json')
    expect(listReceipts()).toEqual([])
    const corruptKey = Object.keys(localStorage).find((k) => k.startsWith(`${AI_OUTBOX_KEY}:corrupt-`))
    expect(corruptKey).toBeTruthy()
  })
})
