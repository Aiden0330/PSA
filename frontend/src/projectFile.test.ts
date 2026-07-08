import { describe, it, expect } from 'vitest'
import { buildProjectFile, parseProjectFile } from './projectFile'
import type { ProjectPayload } from './project'

const payload: ProjectPayload = {
  v: 2,
  etas: [{
    key: 'a', name: 'A',
    model: { initEvent: 'IE', initFreq: 1e-3, functionalEvents: [], root: { kind: 'leaf', consequence: 'C1' } } as any,
    fts: { model_data: { parameters: [] }, fault_trees: [] }, pfds: {},
  }],
  activeKey: 'a', checkedKeys: { a: true },
}

describe('projectFile', () => {
  it('buildProjectFile 产出带 kind/version/ISO 时间戳的信封', () => {
    const f = buildProjectFile(payload)
    expect(f.kind).toBe('bess-psa-project')
    expect(f.version).toBe(2)
    expect(f.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(f.payload).toEqual(payload)
    expect(f.libraryOverlay).toBeUndefined()
  })

  it('buildProjectFile 可携带 libraryOverlay(透传)', () => {
    const ov = { upsert: {}, deleted: {} }
    expect(buildProjectFile(payload, ov).libraryOverlay).toEqual(ov)
  })

  it('parseProjectFile 解析信封 → payload', () => {
    expect(parseProjectFile(JSON.stringify(buildProjectFile(payload))).payload).toEqual(payload)
  })

  it('parseProjectFile 携带 overlay 时一并返回', () => {
    const ov = { upsert: {}, deleted: {} }
    expect(parseProjectFile(JSON.stringify(buildProjectFile(payload, ov))).libraryOverlay).toEqual(ov)
  })

  it('parseProjectFile 接受裸 v2 payload', () => {
    expect((parseProjectFile(JSON.stringify(payload)).payload as ProjectPayload).etas).toHaveLength(1)
  })

  it('parseProjectFile 接受旧单-ETA payload', () => {
    const legacy = { etModel: { initEvent: 'IE' }, fts: { model_data: { parameters: [] }, fault_trees: [] } }
    expect((parseProjectFile(JSON.stringify(legacy)).payload as any).etModel.initEvent).toBe('IE')
  })

  it('坏 JSON / 无法识别 → 抛可读错误', () => {
    expect(() => parseProjectFile('{not json')).toThrow(/JSON/)
    expect(() => parseProjectFile(JSON.stringify({ foo: 1 }))).toThrow(/无法识别/)
  })

  it('round-trip 等价', () => {
    expect(parseProjectFile(JSON.stringify(buildProjectFile(payload))).payload).toEqual(payload)
  })
})
