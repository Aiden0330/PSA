import { describe, it, expect } from 'vitest'
import { serializeProject, deserializeProject, duplicateProjectEta } from './project'
import type { ProjectEta } from './project'
import type { ModelJson } from './model'
import { DEFAULT_MAPPING } from './fmea'
import type { FmeaRow, MappingConfig } from './fmea'

const mkEta = (key: string, name: string): ProjectEta => ({
  key,
  name,
  model: { initEvent: 'IE', initFreq: 1e-3, functionalEvents: [], root: { kind: 'leaf', consequence: 'C1' } } as any,
  fts: { model_data: { parameters: [] }, fault_trees: [] },
  pfds: {},
})

describe('project 存档序列化(多 ETA 往返)', () => {
  it('保存多个 ETA → 反序列化保留个数、名称、活动页与勾选', () => {
    const tabs = [mkEta('a', '热失控级联'), mkEta('b', '过充场景'), mkEta('c', '自定义 ETA 3')]
    const payload = serializeProject(tabs, 'b', { a: true, b: true, c: false })
    const got = deserializeProject(payload, '存档名(应被忽略)')

    expect(got.etas).toHaveLength(3)
    expect(got.etas.map((e) => e.name)).toEqual(['热失控级联', '过充场景', '自定义 ETA 3'])
    expect(got.etas.map((e) => e.key)).toEqual(['a', 'b', 'c'])
    expect(got.activeKey).toBe('b')
    expect(got.checkedKeys).toEqual({ a: true, b: true, c: false })
  })

  it('payload 是引用安全的:序列化后改原数组不影响已存 payload', () => {
    const tabs = [mkEta('a', 'A')]
    const payload = serializeProject(tabs, 'a', { a: true })
    tabs.push(mkEta('b', 'B'))
    expect(payload.etas).toHaveLength(1)
  })

  it('旧版单 ETA {etModel, fts} → 1 个 ETA, 名称取存档名', () => {
    const legacy = {
      etModel: { initEvent: 'IE', initFreq: 1e-3, functionalEvents: [], root: { kind: 'leaf', consequence: 'C1' } },
      fts: { model_data: { parameters: [] }, fault_trees: [] },
    }
    const got = deserializeProject(legacy, '我的旧存档')
    expect(got.etas).toHaveLength(1)
    expect(got.etas[0].name).toBe('我的旧存档')
    expect(got.etas[0].model).toEqual(legacy.etModel)
    expect(got.activeKey).toBe(got.etas[0].key)
    expect(got.checkedKeys[got.etas[0].key]).toBe(true)
  })

  it('activeKey 指向不存在的页 → 回落到第一个;缺 checkedKeys → 全勾选', () => {
    const tabs = [mkEta('a', 'A'), mkEta('b', 'B')]
    const raw = { v: 2, etas: tabs, activeKey: 'zzz' } // 故意缺 checkedKeys、activeKey 非法
    const got = deserializeProject(raw, 'x')
    expect(got.activeKey).toBe('a')
    expect(got.checkedKeys).toEqual({ a: true, b: true })
  })
})

describe('project userFts 字段', () => {
  const uf: ModelJson = {
    model_data: { parameters: [{ id: 'X', kind: 'probability', value: 0.2 }] },
    fault_trees: [{ name: 'T', top: 'G', nodes: [{ id: 'G', op: 'or', args: ['X'] }, { id: 'X', basic: true, param_ref: 'X' }] }],
  }
  it('userFts 往返保留', () => {
    const got = deserializeProject(serializeProject([mkEta('a', 'A')], 'a', { a: true }, uf), 'x')
    expect(got.userFts?.fault_trees.map((f) => f.name)).toEqual(['T'])
  })
  it('不传 userFts → payload 无该键', () => {
    expect('userFts' in serializeProject([mkEta('a', 'A')], 'a', { a: true })).toBe(false)
  })
  it('旧 payload 缺 userFts → deserialize 得 undefined', () => {
    const got = deserializeProject({ v: 2, etas: [mkEta('a', 'A')], activeKey: 'a', checkedKeys: { a: true } }, 'x')
    expect(got.userFts).toBeUndefined()
  })
})

describe('project renamed 字段', () => {
  it('renamed 往返保留', () => {
    const tabs: ProjectEta[] = [{ ...mkEta('a', 'A'), renamed: true }, { ...mkEta('b', 'B'), renamed: false }]
    const got = deserializeProject(serializeProject(tabs, 'a', { a: true, b: true }), 'x')
    expect(got.etas.map((e) => e.renamed)).toEqual([true, false])
  })
  it('v2 缺 renamed → 默认 false(跟随初因名)', () => {
    const got = deserializeProject({ v: 2, etas: [mkEta('a', 'A')], activeKey: 'a', checkedKeys: { a: true } }, 'x')
    expect(got.etas[0].renamed).toBe(false)
  })
  it('旧单-ETA → renamed true(保留存档名)', () => {
    const got = deserializeProject({ etModel: { initEvent: 'IE' }, fts: { model_data: { parameters: [] }, fault_trees: [] } }, '我的旧存档')
    expect(got.etas[0].renamed).toBe(true)
  })
})

describe('project FMEA 字段', () => {
  const rows: FmeaRow[] = [
    { id: 'f1', object: '电芯', mode: '内短路', S: 9, O: 3, D: 6, source: 'FMEA' },
    { id: 'f2', object: 'BMS', mode: '误判', S: 6, O: 4, D: 4 },
  ]
  const mapping: MappingConfig = {
    ...DEFAULT_MAPPING,
    consequenceToS: { ...DEFAULT_MAPPING.consequenceToS, C5: 9 },
    freqFloorO: 1,
  }

  it('fmeaRows 与 fmeaMapping 随项目 payload 往返保留', () => {
    const payload = serializeProject([mkEta('a', 'A')], 'a', { a: true }, undefined, rows, mapping)
    const got = deserializeProject(payload, 'x')

    expect(got.fmeaRows).toEqual(rows)
    expect(got.fmeaMapping?.consequenceToS.C5).toBe(9)
    expect(got.fmeaMapping?.freqFloorO).toBe(1)
  })

  it('旧 payload 缺 FMEA 字段 → deserialize 得 undefined', () => {
    const got = deserializeProject({ v: 2, etas: [mkEta('a', 'A')], activeKey: 'a', checkedKeys: { a: true } }, 'x')
    expect(got.fmeaRows).toBeUndefined()
    expect(got.fmeaMapping).toBeUndefined()
  })
})

describe('project ETA 复制', () => {
  it('复制指定 ETA 到原页签后方并深拷贝运行数据', () => {
    const src = mkEta('a', 'ETA A')
    src.model.functionalEvents = [{ id: 'B1', label: 'B1', failProb: 0.1 }]
    src.fts.fault_trees = [{ name: 'B1', top: 'TOP', nodes: [{ id: 'TOP', op: 'or', args: [] }] }]
    src.pfds = { B1: 0.1 }
    const tabs = [src, mkEta('b', 'ETA B')]

    const duplicated = duplicateProjectEta(tabs, 'a', 'copy-1', 'ETA A')

    expect(duplicated?.eta.key).toBe('copy-1')
    expect(duplicated?.eta.name).toBe('ETA A 副本')
    expect(duplicated?.eta.renamed).toBe(false)
    expect(duplicated?.eta.model.initEvent).toBe('ETA A 副本')
    expect(duplicated?.etas.map((e) => e.key)).toEqual(['a', 'copy-1', 'b'])
    expect(duplicated?.eta.model).toEqual({ ...src.model, initEvent: 'ETA A 副本' })
    expect(duplicated?.eta.fts).toEqual(src.fts)
    expect(duplicated?.eta.pfds).toEqual(src.pfds)

    duplicated!.eta.model.functionalEvents[0].failProb = 0.9
    duplicated!.eta.fts.fault_trees[0].nodes[0].id = 'CHANGED'
    duplicated!.eta.pfds.B1 = 0.9
    expect(src.model.functionalEvents[0].failProb).toBe(0.1)
    expect(src.fts.fault_trees[0].nodes[0].id).toBe('TOP')
    expect(src.pfds.B1).toBe(0.1)
  })

  it('连续复制时生成不冲突的副本名称', () => {
    const tabs = [mkEta('a', 'ETA A'), mkEta('c1', 'ETA A 副本')]
    const duplicated = duplicateProjectEta(tabs, 'a', 'c2', 'ETA A')
    expect(duplicated?.eta.name).toBe('ETA A 副本 2')
  })
})
