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

describe('parseProjectFile — 严格信封 + 深校验(FE-10)', () => {
  const envelope = (p: unknown, version: unknown = 2) => JSON.stringify({ kind: 'bess-psa-project', version, exportedAt: 'x', payload: p })
  it('信封 version!==2 点名拒绝', () => {
    expect(() => parseProjectFile(envelope(payload, 3))).toThrow(/版本/)
    expect(() => parseProjectFile(JSON.stringify({ kind: 'bess-psa-project', payload }))).toThrow(/版本/) // 缺 version
  })
  it('缺 payload 拒绝', () => {
    expect(() => parseProjectFile(JSON.stringify({ kind: 'bess-psa-project', version: 2 }))).toThrow(/payload/)
  })
  it('initFreq 非有限(Infinity 序列化成 null)点名拒绝', () => {
    const bad = { ...payload, etas: [{ ...payload.etas[0], model: { ...payload.etas[0].model, initFreq: null } }] }
    expect(() => parseProjectFile(envelope(bad))).toThrow(/initFreq/)
  })
  it('畸形树(branch 缺 failure)带路径拒绝', () => {
    const bad = { ...payload, etas: [{ ...payload.etas[0], model: { ...payload.etas[0].model, root: { kind: 'branch', feId: 'B1', success: { kind: 'leaf', consequence: 'C1' } } } }] }
    expect(() => parseProjectFile(envelope(bad))).toThrow(/畸形|root/)
  })
  it('未知节点 kind 拒绝', () => {
    const bad = { ...payload, etas: [{ ...payload.etas[0], model: { ...payload.etas[0].model, root: { kind: 'weird' } } }] }
    expect(() => parseProjectFile(envelope(bad))).toThrow(/kind|畸形/)
  })
  it('fts 形状非法(fault_trees 非数组)拒绝', () => {
    const bad = { ...payload, etas: [{ ...payload.etas[0], fts: { model_data: {}, fault_trees: {} } }] }
    expect(() => parseProjectFile(envelope(bad))).toThrow(/fts/)
  })
  it('eta 缺 key 拒绝', () => {
    const bad = { ...payload, etas: [{ name: 'A', model: payload.etas[0].model, fts: payload.etas[0].fts, pfds: {} }] }
    expect(() => parseProjectFile(envelope(bad))).toThrow(/key/)
  })
  it('裸 v2 亦深校验', () => {
    const bad = { ...payload, etas: [{ ...payload.etas[0], model: { ...payload.etas[0].model, functionalEvents: 'nope' } }] }
    expect(() => parseProjectFile(JSON.stringify(bad))).toThrow(/functionalEvents/)
  })
  it('校验失败即抛错,绝不半载入(无返回值)', () => {
    const bad = { ...payload, etas: [{ ...payload.etas[0], model: { ...payload.etas[0].model, initFreq: NaN } }] }
    let result: unknown = 'untouched'
    try { result = parseProjectFile(envelope(bad)) } catch { /* expected */ }
    expect(result).toBe('untouched')
  })
})
