import { describe, expect, it } from 'vitest'
import {
  EMPTY_SETTINGS, listHouseEvents, listHouseEventsUnion, newPostRule, settingsActive,
  toQuantifyOptions, toEtEngineOptions, validatePostRules,
  addBcSet, renameBcSet, deleteBcSet, setBcSetMember,
} from './analysisSettings'
import type { BcSetJson } from './analysisSettings'
import type { ModelJson } from '../../model'

const MODEL: ModelJson = {
  model_data: { parameters: [{ id: 'A', kind: 'probability', value: 0.1 }] },
  fault_trees: [{
    name: 'T', top: 'TOP', nodes: [
      { id: 'A', basic: true, param_ref: 'A' },
      { id: 'H_MAINT', house: true, state: false, label: '检修工况' },
      { id: 'H_BYPASS', house: true, state: true },
      { id: 'TOP', op: 'and', args: ['A', 'H_MAINT'] },
    ],
  }],
}

describe('analysisSettings', () => {
  it('listHouseEvents 抽 house 节点(含声明状态与显示名回退)', () => {
    expect(listHouseEvents(MODEL, 'T')).toEqual([
      { id: 'H_MAINT', label: '检修工况', state: false },
      { id: 'H_BYPASS', label: 'H_BYPASS', state: true },
    ])
    expect(listHouseEvents(MODEL, '不存在')).toEqual([])
    expect(listHouseEvents(null, 'T')).toEqual([])
  })

  it('validatePostRules 与引擎同规则', () => {
    expect(validatePostRules([
      { kind: 'mutually_exclusive', events: ['M1', 'M2'] },
      { kind: 'mutually_exclusive', events: ['M1'] },
      { kind: 'delete_contains', events: [] },
      { kind: 'recovery', events: ['A'], add_event: 'REC', prob: 0.1 },
      { kind: 'recovery', events: ['A'], add_event: '', prob: 0.1 },
      { kind: 'recovery', events: ['A'], add_event: 'R', prob: 1.5 },
    ])).toEqual([null, '互斥组需 ≥2 个成员', '删除规则需 ≥1 个成员', null, '恢复规则需填恢复事件名', '恢复概率需在 [0,1]'])
  })

  it('newPostRule 默认', () => {
    expect(newPostRule('mutually_exclusive')).toEqual({ kind: 'mutually_exclusive', events: [] })
    expect(newPostRule('recovery')).toEqual({ kind: 'recovery', events: [], add_event: 'REC', prob: 0.1 })
  })

  it('toQuantifyOptions 空省略键、非空透传、剔除非法规则', () => {
    expect(toQuantifyOptions(EMPTY_SETTINGS)).toEqual({})
    expect(toQuantifyOptions({ houseOverrides: { H_MAINT: true }, postRules: [] }))
      .toEqual({ house_states: { H_MAINT: true } })
    const opts = toQuantifyOptions({
      houseOverrides: {},
      postRules: [
        { kind: 'mutually_exclusive', events: ['M1', 'M2'] },
        { kind: 'mutually_exclusive', events: ['M1'] },   // 非法 → 剔除
      ],
    })
    expect(opts).toEqual({ post_rules: [{ kind: 'mutually_exclusive', events: ['M1', 'M2'] }] })
  })

  it('toQuantifyOptions 带命名边界条件集(按名引用;定义随 model)', () => {
    expect(toQuantifyOptions({ houseOverrides: {}, boundaryConditionSet: '检修', postRules: [] }))
      .toEqual({ boundary_condition_set: '检修' })
    // house 覆盖与命名集并存(显式覆盖优先由后端裁决)
    expect(toQuantifyOptions({ houseOverrides: { H: true }, boundaryConditionSet: '检修', postRules: [] }))
      .toEqual({ house_states: { H: true }, boundary_condition_set: '检修' })
  })

  it('settingsActive', () => {
    expect(settingsActive(EMPTY_SETTINGS)).toBe(false)
    expect(settingsActive({ houseOverrides: { H: true }, postRules: [] })).toBe(true)
    expect(settingsActive({ houseOverrides: {}, boundaryConditionSet: '检修', postRules: [] })).toBe(true)
    expect(settingsActive({ houseOverrides: {}, postRules: [newPostRule('delete_contains')] })).toBe(true)
  })
})

describe('toEtEngineOptions(ETA 侧)', () => {
  const sets: BcSetJson[] = [{ name: '检修', house_states: { H_MAINT: true } }]
  it('空设置 → 省略所有键(与既有 ET 请求逐字节一致)', () => {
    expect(toEtEngineOptions(EMPTY_SETTINGS, [])).toEqual({})
    expect(toEtEngineOptions(EMPTY_SETTINGS, sets)).toEqual({})
  })
  it('仅 house 覆盖 → 只带 house_states(不含 post 规则:FTA 专属)', () => {
    expect(toEtEngineOptions({ houseOverrides: { H_MAINT: true }, postRules: [] }, sets))
      .toEqual({ house_states: { H_MAINT: true } })
  })
  it('选中命名集 → 同时透传集合定义(后端按名解析)', () => {
    expect(toEtEngineOptions({ houseOverrides: {}, boundaryConditionSet: '检修', postRules: [] }, sets))
      .toEqual({ boundary_condition_set: '检修', boundary_condition_sets: sets })
  })
  it('选中集合已不存在(被删)→ 整体省略,避免后端 400', () => {
    expect(toEtEngineOptions({ houseOverrides: {}, boundaryConditionSet: '幽灵', postRules: [] }, sets)).toEqual({})
  })
})

describe('listHouseEventsUnion(跨屏障树并集)', () => {
  const fts: ModelJson = {
    model_data: { parameters: [] },
    fault_trees: [
      { name: 'B1', top: 'T1', nodes: [{ id: 'H_MAINT', house: true, state: false, label: '检修' }, { id: 'T1', op: 'or', args: [] }] },
      { name: 'B2', top: 'T2', nodes: [{ id: 'H_MAINT', house: true, state: true }, { id: 'H_BYPASS', house: true, state: true }, { id: 'T2', op: 'or', args: [] }] },
      { name: 'B3', top: 'T3', nodes: [{ id: 'H_OTHER', house: true, state: false }, { id: 'T3', op: 'or', args: [] }] },
    ],
  }
  it('按 id 去重(首现为准),仅并入给定树名', () => {
    expect(listHouseEventsUnion(fts, ['B1', 'B2'])).toEqual([
      { id: 'H_MAINT', label: '检修', state: false },   // 首现 B1 的声明(state=false)
      { id: 'H_BYPASS', label: 'H_BYPASS', state: true },
    ])
  })
  it('未在给定树名内的 house 事件不并入;空名 → 空', () => {
    expect(listHouseEventsUnion(fts, ['B1']).map((h) => h.id)).toEqual(['H_MAINT'])
    expect(listHouseEventsUnion(fts, [])).toEqual([])
    expect(listHouseEventsUnion(null, ['B1'])).toEqual([])
  })
})

describe('命名边界条件集编辑(纯函数)', () => {
  it('addBcSet 追加空集合 + 名称唯一化', () => {
    const s1 = addBcSet([], '检修')
    expect(s1).toEqual([{ name: '检修', house_states: {} }])
    const s2 = addBcSet(s1, '检修')
    expect(s2.map((x) => x.name)).toEqual(['检修', '检修_2'])
    expect(addBcSet([], '   ')[0].name).toBe('边界条件集')
  })
  it('renameBcSet 空名/重名/越界 → 不改', () => {
    const sets: BcSetJson[] = [{ name: 'A', house_states: {} }, { name: 'B', house_states: {} }]
    expect(renameBcSet(sets, 0, 'C').map((x) => x.name)).toEqual(['C', 'B'])
    expect(renameBcSet(sets, 0, 'B')).toBe(sets)      // 重名 → 原数组
    expect(renameBcSet(sets, 0, '  ')).toBe(sets)     // 空名 → 原数组
    expect(renameBcSet(sets, 9, 'X')).toBe(sets)      // 越界 → 原数组
  })
  it('deleteBcSet 移除指定项', () => {
    const sets: BcSetJson[] = [{ name: 'A', house_states: {} }, { name: 'B', house_states: {} }]
    expect(deleteBcSet(sets, 0).map((x) => x.name)).toEqual(['B'])
  })
  it('setBcSetMember 设置/移出成员;不改原数组', () => {
    const sets: BcSetJson[] = [{ name: 'A', house_states: {} }]
    const s1 = setBcSetMember(sets, 0, 'H_MAINT', true)
    expect(s1[0].house_states).toEqual({ H_MAINT: true })
    expect(sets[0].house_states).toEqual({})          // 原数组不变
    const s2 = setBcSetMember(s1, 0, 'H_MAINT', undefined)
    expect(s2[0].house_states).toEqual({})            // undefined → 移出
    expect(setBcSetMember(sets, 9, 'X', true)).toBe(sets)  // 越界 → 原数组
  })
})
