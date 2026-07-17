/** 屏障挂树→重编辑白屏回归(BarrierFtModal 无 ErrorBoundary 时 layoutFaultTree 抛→整页白屏):
 *  缺树/空 fault_trees 时 layoutFaultTree 必返回空图,绝不抛。 */
import { describe, it, expect } from 'vitest'
import { layoutFaultTree } from './layout'
import type { ModelJson } from './model'

describe('layoutFaultTree — 缺树容错(白屏回归)', () => {
  it('fault_trees 为空 → 空图,不抛', () => {
    const empty: ModelJson = { model_data: { parameters: [] }, fault_trees: [] }
    expect(() => layoutFaultTree(empty, 'B_BMS')).not.toThrow()
    expect(layoutFaultTree(empty, 'B_BMS')).toEqual({ nodes: [], edges: [] })
  })

  it('命名树不存在(且有其它树)→ 不抛(退化为首树或空)', () => {
    const m: ModelJson = { model_data: { parameters: [] },
      fault_trees: [{ name: 'OTHER', top: 'g', nodes: [{ id: 'g', op: 'or', args: [] }] }] }
    expect(() => layoutFaultTree(m, 'B_BMS')).not.toThrow()
  })

  it('正常树仍逐节点布局(零扰动)', () => {
    const m: ModelJson = { model_data: { parameters: [] },
      fault_trees: [{ name: 'B_BMS', top: 'T', nodes: [
        { id: 'A', basic: true, param_ref: 'A' },
        { id: 'T', op: 'or', args: ['A'] }] }] }
    const g = layoutFaultTree(m, 'B_BMS')
    expect(g.nodes.length).toBe(2)
  })
})
