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

describe('mutator 严格守卫 — 缺树 no-op(误写回归)', () => {
  it('全部 8 个 mutator 对缺树返回原模型,不写 fault_trees[0]、不抛', async () => {
    const { addBasic, addGate, connect, deleteNode, updateNode, setTop, renameNode, addBasicFromLib } = await import('./model')
    const m: ModelJson = { model_data: { parameters: [] }, fault_trees: [
      { name: 'OTHER', top: 'T', nodes: [{ id: 'T', op: 'or', args: [] }] }] } as unknown as ModelJson
    const before = JSON.stringify(m)
    const results = [
      addBasic(m, 'MISSING'), addGate(m, 'MISSING', 'or'), connect(m, 'MISSING', 'a', 'b'),
      deleteNode(m, 'MISSING', 'T'), updateNode(m, 'MISSING', 'T', { label: 'x' }),
      setTop(m, 'MISSING', 'T'), renameNode(m, 'MISSING', 'T', 'U'),
      addBasicFromLib(m, 'MISSING', { id: 'c1', name: 'n', rate: 0.1 } as never),
    ]
    for (const r of results) expect(JSON.stringify(r)).toBe(before)   // 全 no-op,OTHER 树零扰动
  })

  it('空 fault_trees 也不抛(此前 getFt 回退 undefined 即崩)', async () => {
    const { addBasic } = await import('./model')
    const empty: ModelJson = { model_data: { parameters: [] }, fault_trees: [] }
    expect(() => addBasic(empty, 'ANY')).not.toThrow()
    expect(addBasic(empty, 'ANY').fault_trees.length).toBe(0)
  })
})

describe('libKindForUnit — 库单位→量纲推断(初因树导入)', () => {
  it('速率单位(·yr / /yr 结尾)→ frequency;/demand 与未知 → probability', async () => {
    const { libKindForUnit } = await import('./model')
    expect(libKindForUnit('/unit·yr')).toBe('frequency')
    expect(libKindForUnit('/cell·yr')).toBe('frequency')
    expect(libKindForUnit('/yr')).toBe('frequency')
    expect(libKindForUnit('/demand')).toBe('probability')
    expect(libKindForUnit('PFD')).toBe('probability')
    expect(libKindForUnit(undefined)).toBe('probability')
  })

  it('addBasicFromLib 缺省仍 probability(屏障树零扰动);显式 frequency 生效', async () => {
    const { addBasicFromLib } = await import('./model')
    const m = { model_data: { parameters: [] }, fault_trees: [
      { name: 'T', top: 'G', nodes: [{ id: 'G', op: 'or', args: [] }] }] }
    const c = { id: 'CFR_PCS', name: 'PCS', rate: 1e-2, unit: '/unit·yr', source: { citation: 'test' } }
    const m1 = addBasicFromLib(m as never, 'T', c as never)
    expect((m1 as never as { model_data: { parameters: { kind: string }[] } }).model_data.parameters[0].kind).toBe('probability')
    const m2 = addBasicFromLib(m as never, 'T', c as never, 'frequency')
    expect((m2 as never as { model_data: { parameters: { kind: string }[] } }).model_data.parameters[0].kind).toBe('frequency')
  })
})
