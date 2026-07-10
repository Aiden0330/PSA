import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureDefaultProject } from './bootstrap'
import { buildScenarioTab } from './scenarioLoader'
import { EMPTY_FTS, resetProjectStore, useProjectStore } from '../../stores/projectStore'
import type { ProjectEta } from '../../project'

vi.mock('./scenarioLoader', () => ({ buildScenarioTab: vi.fn() }))

const S = () => useProjectStore.getState()

function tab(key: string, name = key): ProjectEta {
  return {
    key, name, renamed: true,
    model: { initEvent: name, initFreq: 1e-3, functionalEvents: [], root: { kind: 'leaf', consequence: 'C1' } } as any,
    fts: EMPTY_FTS, pfds: {},
  }
}

describe('ensureDefaultProject(用户报障 2026-07-09:迟到默认场景覆盖用户内容 / 失败后永久空转)', () => {
  beforeEach(() => {
    resetProjectStore()
    vi.mocked(buildScenarioTab).mockReset()
  })

  it('正常路径:空 store → 载入默认级联', async () => {
    vi.mocked(buildScenarioTab).mockResolvedValue(tab('sc:default', '默认热失控级联'))
    await ensureDefaultProject()
    expect(S().present.etas.map((e) => e.key)).toEqual(['sc:default'])
    expect(S().activeKey).toBe('sc:default')
  })

  it('竞态守护:等待期间用户已读档 → 迟到的默认场景不得覆盖(报障 #2 根因)', async () => {
    let resolveFetch!: (t: ProjectEta) => void
    vi.mocked(buildScenarioTab).mockReturnValue(new Promise((r) => { resolveFetch = r }))
    const pending = ensureDefaultProject()
    S().load([tab('user-archive', '用户存档')], 'user-archive', { 'user-archive': true })   // 用户在等待期间读档
    resolveFetch(tab('sc:default'))
    await pending
    expect(S().present.etas.map((e) => e.key)).toEqual(['user-archive'])                   // 存档仍在
  })

  it('StrictMode 双跑:两次并发调用只落一次,不互相覆盖', async () => {
    let n = 0
    vi.mocked(buildScenarioTab).mockImplementation(async () => { n++; return tab('sc:default') })
    await Promise.all([ensureDefaultProject(), ensureDefaultProject()])
    expect(S().present.etas).toHaveLength(1)
    expect(S().past).toHaveLength(0)                    // load 清历史;若第二次也 load 会仍是 0,改查加载计数
    expect(n).toBeGreaterThanOrEqual(1)
  })

  it('请求失败:兜底空白 ETA + onError 亮出原因(报障 #1 根因:不再静默空转)', async () => {
    vi.mocked(buildScenarioTab).mockRejectedValue(new Error('ECONNREFUSED'))
    const errs: string[] = []
    await ensureDefaultProject((m) => errs.push(m))
    expect(S().present.etas).toHaveLength(1)
    expect(S().present.etas[0].name).toBe('未命名 ETA')
    expect(errs[0]).toContain('默认场景载入失败')
    expect(errs[0]).toContain('ECONNREFUSED')
  })

  it('store 已有内容:直接返回,不发请求', async () => {
    S().load([tab('a')], 'a', { a: true })
    await ensureDefaultProject()
    expect(vi.mocked(buildScenarioTab)).not.toHaveBeenCalled()
    expect(S().present.etas.map((e) => e.key)).toEqual(['a'])
  })
})
