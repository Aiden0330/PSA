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

describe('connectableChildren — 「添加子节点」下拉候选集(特性 1)', () => {
  it('排除自身、已是其 args 的子节点、以及祖先(两层环);允许共享(同一 BE 连两个门)', async () => {
    const { connectableChildren } = await import('./model')
    // 树形:TOP(or) -> [G1, BE1]; G1(and) -> [BE2]; BE3 孤立(可连任意门)
    const m: ModelJson = { model_data: { parameters: [] }, fault_trees: [
      { name: 'T', top: 'TOP', nodes: [
        { id: 'TOP', op: 'or', args: ['G1', 'BE1'] },
        { id: 'G1', op: 'and', args: ['BE2'] },
        { id: 'BE1', basic: true, param_ref: 'BE1' },
        { id: 'BE2', basic: true, param_ref: 'BE2' },
        { id: 'BE3', basic: true, param_ref: 'BE3' },
      ] }] }
    // 给 G1 添加子节点:候选应排除 G1 自身、已是其子的 BE2、以及祖先 TOP(两层:TOP->G1 成环)
    const forG1 = connectableChildren(m, 'T', 'G1')
    expect(forG1).not.toContain('G1')
    expect(forG1).not.toContain('BE2')
    expect(forG1).not.toContain('TOP')
    expect(forG1).toContain('BE1')
    expect(forG1).toContain('BE3')
    // 共享子树合法:BE1 已是 TOP 的子节点,仍可再连到 G1(不因已有父而被排除)
    expect(connectableChildren(m, 'T', 'G1')).toContain('BE1')
    // 给 TOP 添加子节点:候选排除 TOP 自身、已是其子的 G1/BE1;BE2/BE3 仍可连(共享合法)
    const forTop = connectableChildren(m, 'T', 'TOP')
    expect(forTop).not.toContain('TOP')
    expect(forTop).not.toContain('G1')
    expect(forTop).not.toContain('BE1')
    expect(forTop).toContain('BE2')
    expect(forTop).toContain('BE3')
  })

  it('两层祖先环:候选出发沿 args 两跳可达 gateId 同样排除', async () => {
    const { connectableChildren } = await import('./model')
    // A(or)->[B]; B(or)->[C]; C(or)->[] —— 给 C 添加子节点时,A 和 B 都是祖先,须排除
    const m: ModelJson = { model_data: { parameters: [] }, fault_trees: [
      { name: 'T', top: 'A', nodes: [
        { id: 'A', op: 'or', args: ['B'] },
        { id: 'B', op: 'or', args: ['C'] },
        { id: 'C', op: 'or', args: [] },
      ] }] }
    const forC = connectableChildren(m, 'T', 'C')
    expect(forC).not.toContain('A')
    expect(forC).not.toContain('B')
    expect(forC).not.toContain('C')
  })

  it('命名树不存在,或 gateId 不存在 → []', async () => {
    const { connectableChildren } = await import('./model')
    const m: ModelJson = { model_data: { parameters: [] }, fault_trees: [
      { name: 'T', top: 'G', nodes: [{ id: 'G', op: 'or', args: [] }] }] }
    expect(connectableChildren(m, 'MISSING', 'G')).toEqual([])
    expect(connectableChildren(m, 'T', 'NOPE')).toEqual([])
    const empty: ModelJson = { model_data: { parameters: [] }, fault_trees: [] }
    expect(connectableChildren(empty, 'T', 'G')).toEqual([])
  })
})
