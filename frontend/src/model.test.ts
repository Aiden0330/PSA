import { describe, it, expect } from 'vitest'
import { addGate, updateNode, getFt } from './model'
import type { ModelJson } from './model'

const base: ModelJson = { model_data: { parameters: [] }, fault_trees: [{ name: 'FT', top: '', nodes: [] }] }

describe('gate label (intermediate event)', () => {
  it('addGate sets an editable label; updateNode changes it', () => {
    let m = addGate(base, 'FT', 'or')
    const gid = getFt(m, 'FT').nodes.find((n) => n.op === 'or')!.id
    expect(getFt(m, 'FT').nodes.find((n) => n.id === gid)!.label).toBeTypeOf('string')
    m = updateNode(m, 'FT', gid, { label: '中间事件A' })
    expect(getFt(m, 'FT').nodes.find((n) => n.id === gid)!.label).toBe('中间事件A')
  })
})

import { addFaultTree, deleteFaultTree } from './model'

const emptyM = (): ModelJson => ({ model_data: { parameters: [] }, fault_trees: [] })

describe('addFaultTree / deleteFaultTree', () => {
  it('addFaultTree 追加起始树(OR 门 top + 基本事件 + 参数)', () => {
    const m = addFaultTree(emptyM(), '我的树')
    expect(m.fault_trees).toHaveLength(1)
    const ft = m.fault_trees[0]
    expect(ft.name).toBe('我的树')
    expect(ft.nodes.find((n) => n.id === ft.top)!.op).toBe('or')
    expect(ft.nodes.some((n) => n.basic)).toBe(true)
    expect(m.model_data.parameters).toHaveLength(1)
  })
  it('addFaultTree name 去重(A → A_2)', () => {
    const m = addFaultTree(addFaultTree(emptyM(), 'A'), 'A')
    expect(m.fault_trees.map((f) => f.name)).toEqual(['A', 'A_2'])
  })
  it('addFaultTree 不改原对象', () => {
    const m0 = emptyM(); addFaultTree(m0, 'A'); expect(m0.fault_trees).toHaveLength(0)
  })
  it('deleteFaultTree 移除指定树 + 清理独占参数', () => {
    const m = deleteFaultTree(addFaultTree(emptyM(), 'A'), 'A')
    expect(m.fault_trees).toHaveLength(0)
    expect(m.model_data.parameters).toHaveLength(0)
  })
  it('deleteFaultTree 保留被其他树引用的共享参数', () => {
    const m0: ModelJson = {
      model_data: { parameters: [{ id: 'SH', kind: 'probability', value: 0.1 }] },
      fault_trees: [
        { name: 'A', top: 'GA', nodes: [{ id: 'SH', basic: true, param_ref: 'SH' }, { id: 'GA', op: 'or', args: ['SH'] }] },
        { name: 'B', top: 'GB', nodes: [{ id: 'SH', basic: true, param_ref: 'SH' }, { id: 'GB', op: 'or', args: ['SH'] }] },
      ],
    }
    const m = deleteFaultTree(m0, 'A')
    expect(m.fault_trees.map((f) => f.name)).toEqual(['B'])
    expect(m.model_data.parameters.map((p) => p.id)).toEqual(['SH'])
  })
  it('deleteFaultTree 删不存在 → 返回原对象', () => {
    const m = emptyM(); expect(deleteFaultTree(m, 'X')).toBe(m)
  })
  it('addFaultTree 空白名 → 默认「新建 FTA」', () => {
    expect(addFaultTree(emptyM(), '   ').fault_trees[0].name).toBe('新建 FTA')
  })
})

import { setBcSets } from './model'
import type { BcSetJson } from './model'

describe('setBcSets(命名边界条件集)', () => {
  const sets: BcSetJson[] = [{ name: '检修', house_states: { H_MAINT: true } }]
  it('非空 → 写入 boundary_condition_sets 键', () => {
    const m = setBcSets(emptyM(), sets)
    expect(m.boundary_condition_sets).toEqual(sets)
  })
  it('空数组 → 删除该键(保持从未用过 bc-set 的模型形状)', () => {
    const withSets = setBcSets(emptyM(), sets)
    const cleared = setBcSets(withSets, [])
    expect('boundary_condition_sets' in cleared).toBe(false)
  })
  it('不改原对象', () => {
    const m0 = emptyM()
    setBcSets(m0, sets)
    expect('boundary_condition_sets' in m0).toBe(false)
  })
})
