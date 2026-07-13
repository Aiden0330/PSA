import { describe, it, expect, beforeEach } from 'vitest'
import { clearSessionDraft, peekSessionDraft, stageSessionDraft } from './sessionDraft'
import type { ProjectPayload } from '../../project'

const payload = { etas: [{ key: 't', name: 'T' }] } as unknown as ProjectPayload

beforeEach(() => localStorage.clear())

describe('sessionDraft(会话过期草稿暂存)', () => {
  it('stage → peek 往返:内容/名称/savedId 逐位保留', () => {
    stageSessionDraft('项目甲', payload, 'sid-1')
    const d = peekSessionDraft()
    expect(d?.name).toBe('项目甲')
    expect(d?.savedId).toBe('sid-1')
    expect(d?.payload).toEqual(payload)
    expect(typeof d?.at).toBe('string')
  })

  it('无暂存 → peek 返回 null', () => {
    expect(peekSessionDraft()).toBeNull()
  })

  it('clear 后 peek 返回 null', () => {
    stageSessionDraft('项目甲', payload, 'sid-1')
    clearSessionDraft()
    expect(peekSessionDraft()).toBeNull()
  })

  it('损坏的 JSON → peek 视为无暂存(不抛)', () => {
    localStorage.setItem('bess-eta:session-expired-draft:v1', '{not json')
    expect(peekSessionDraft()).toBeNull()
  })

  it('后一次 stage 覆盖前一次(单槽位,不是队列)', () => {
    stageSessionDraft('项目甲', payload, 'sid-1')
    stageSessionDraft('项目乙', payload, 'sid-2')
    expect(peekSessionDraft()?.name).toBe('项目乙')
  })
})
