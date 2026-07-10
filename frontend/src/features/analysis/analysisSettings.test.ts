import { describe, expect, it } from 'vitest'
import {
  EMPTY_SETTINGS, listHouseEvents, newPostRule, settingsActive,
  toQuantifyOptions, validatePostRules,
} from './analysisSettings'
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

  it('settingsActive', () => {
    expect(settingsActive(EMPTY_SETTINGS)).toBe(false)
    expect(settingsActive({ houseOverrides: { H: true }, postRules: [] })).toBe(true)
    expect(settingsActive({ houseOverrides: {}, postRules: [newPostRule('delete_contains')] })).toBe(true)
  })
})
