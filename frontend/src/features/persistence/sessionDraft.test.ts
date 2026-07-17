/** FE-04 锚点:草稿 v2 —— CAS 基线保留、按项目为键、暂存失败可见。 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  stageSessionDraft, listSessionDrafts, getSessionDraft, clearSessionDraft, sessionDraftKey,
} from './sessionDraft'
import type { ProjectPayload } from '../../project'

const payload = (n: string): ProjectPayload => ({ v: 2, etas: [{ key: n, name: n }] } as any)

beforeEach(() => localStorage.clear())

describe('sessionDraft v2 (FE-04)', () => {
  it('保留 CAS 基线 lastVersionHash(此前 v1 恢复清空 → 绕过 409)', () => {
    stageSessionDraft('P', payload('a'), 'sid1', { projectUuid: 'uu', lastVersionHash: 'H1' })
    const d = listSessionDrafts()[0]
    expect(d.lastVersionHash).toBe('H1')
    expect(d.projectUuid).toBe('uu')
  })

  it('按项目为键:A、B 先后 401 不互相覆盖', () => {
    stageSessionDraft('A', payload('a'), 'sidA', { lastVersionHash: 'HA' })
    stageSessionDraft('B', payload('b'), 'sidB', { lastVersionHash: 'HB' })
    expect(listSessionDrafts()).toHaveLength(2)
    expect(getSessionDraft('sidA')!.lastVersionHash).toBe('HA')
    expect(getSessionDraft('sidB')!.lastVersionHash).toBe('HB')
  })

  it('未存档项目用占位键,不与已存档串键', () => {
    stageSessionDraft('新', payload('n'), '')
    expect(sessionDraftKey(listSessionDrafts()[0])).toMatch(/^unsaved:/)
  })

  it('stageSessionDraft 失败(setItem 抛)返回 ok:false —— 不谎报成功', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    expect(stageSessionDraft('P', payload('a'), 'sid1').ok).toBe(false)
    spy.mockRestore()
  })

  it('clearSessionDraft 按键删除,不误删他项', () => {
    stageSessionDraft('A', payload('a'), 'sidA')
    stageSessionDraft('B', payload('b'), 'sidB')
    clearSessionDraft('sidA')
    expect(getSessionDraft('sidA')).toBeNull()
    expect(getSessionDraft('sidB')).not.toBeNull()
  })
})
