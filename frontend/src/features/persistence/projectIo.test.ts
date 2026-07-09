import { describe, expect, it, vi } from 'vitest'
import { importProjectText, loadProjectArchive } from './projectIo'
import { loadSaved } from '../../api'
import { buildProjectFile } from '../../projectFile'
import type { ProjectPayload } from '../../project'

vi.mock('../../api', () => ({ loadSaved: vi.fn() }))

const MODEL = {
  initEvent: 'IE', initFreq: 1e-3,
  functionalEvents: [{ id: 'FE1', label: '屏障一', failProb: 0.1 }],
  root: {
    kind: 'branch', feId: 'FE1',
    success: { kind: 'leaf', consequence: 'C1' },
    failure: { kind: 'leaf', consequence: 'C2' },
  },
}

function v2Payload(activeKey = 't1'): ProjectPayload {
  return {
    v: 2,
    etas: [{ key: 't1', name: 'T1', renamed: false, model: MODEL as any, fts: { model_data: { parameters: [] }, fault_trees: [] }, pfds: {} }],
    activeKey,
    checkedKeys: { t1: true },
    fmeaRows: [],
  }
}

describe('projectIo', () => {
  it('loadProjectArchive:v2 存档完整还原(名称/页签/勾选/FMEA 字段透传)', async () => {
    vi.mocked(loadSaved).mockResolvedValue({ id: 'x1', name: '项目甲', saved_at: '', payload: v2Payload() })
    const p = await loadProjectArchive('x1')
    expect(p.name).toBe('项目甲')
    expect(p.tabs).toHaveLength(1)
    expect(p.tabs[0].model.functionalEvents[0].id).toBe('FE1')
    expect(p.activeKey).toBe('t1')
    expect(p.checkedKeys).toEqual({ t1: true })
    expect(p.fmeaRows).toEqual([])
  })

  it('loadProjectArchive:旧版单 ETA 存档包成 1 页签,名称取存档名', async () => {
    vi.mocked(loadSaved).mockResolvedValue({ id: 'x2', name: '旧档', saved_at: '', payload: { etModel: MODEL, fts: { model_data: { parameters: [] }, fault_trees: [] } } })
    const p = await loadProjectArchive('x2')
    expect(p.tabs).toHaveLength(1)
    expect(p.tabs[0].name).toBe('旧档')
    expect(p.activeKey).toBe(p.tabs[0].key)
  })

  it('importProjectText:非法 activeKey 回落到首页签;覆盖层原样带回', () => {
    const file = buildProjectFile(v2Payload('不存在的键'), { component_failure_rates: [] } as any)
    const p = importProjectText(JSON.stringify(file), 'f')
    expect(p.activeKey).toBe('t1')
    expect(p.libraryOverlay).toEqual({ component_failure_rates: [] })
  })
})
