/** F-α(前端评审 FE-01):分析请求唯一构造器契约。
 *
 * 病:屏幕量化走 withIeFaultTree+etEngineOptions,报告导出走裸 toEngineRequest——
 * 集成 LFT/CCF/边界设置在报告里被静默丢弃;F3 后端已支持集成报告,错数反而带着
 * "绑定已核验"章。修:量化/重要度/报告导出只准消费 buildAnalysisRequest。
 */
import { describe, it, expect } from 'vitest'
import { buildAnalysisRequest } from './buildRequest'
import { toEngineRequest, withIeFaultTree } from '../../eventtree'
import type { EventTreeModel } from '../../eventtree'

const ftModel: EventTreeModel = {
  initEvent: '过充', initFreq: 0.001, initFreqSource: 'ft',
  functionalEvents: [{ id: 'FE_B', label: '屏障', failProb: 0.1, linkFt: 'B_TOP' }],
  root: { kind: 'branch', feId: 'FE_B',
    success: { kind: 'leaf', consequence: 'C1' },
    failure: { kind: 'leaf', consequence: 'C3' } },
} as any

const linked = {
  fault_trees: [
    { name: '__init__', top: 'IE_TOP', nodes: [
      { id: 'I', basic: true, param_ref: 'I' },
      { id: 'S', basic: true, param_ref: 'S' },
      { id: 'IE_TOP', op: 'and', args: ['I', 'S'] }] },
    { name: 'B_TOP', top: 'B_T', nodes: [
      { id: 'S', basic: true, param_ref: 'S' },
      { id: 'X', basic: true, param_ref: 'X' },
      { id: 'B_T', op: 'or', args: ['S', 'X'] }] },
  ],
  parameters: [
    { id: 'I', kind: 'frequency', value: 1e-3 },
    { id: 'S', kind: 'probability', value: 0.2 },
    { id: 'X', kind: 'probability', value: 0.1 },
  ],
  ccf_groups: [{ id: 'G', members: ['S', 'X'], model: 'beta', factors: { beta: 0.1 } }],
}

const opts = { house_states: { H: true }, boundary_condition_set: '维护工况',
  boundary_condition_sets: [{ name: '维护工况', house_states: { H: true } }] }

describe('buildAnalysisRequest — 单一请求构造(FE-01)', () => {
  it('与屏幕量化路径逐字段同源(withIeFaultTree + etEngineOptions)', () => {
    const built = buildAnalysisRequest(ftModel, linked, opts)
    const screen = { ...withIeFaultTree(toEngineRequest(ftModel, linked), ftModel, linked), ...opts }
    expect(built).toEqual(screen)
  })

  it('ft 模式携带 ie_fault_tree(报告不得再丢集成块)', () => {
    const built = buildAnalysisRequest(ftModel, linked, undefined)
    expect(built.ie_fault_tree).toBeTruthy()
    expect(built.ie_fault_tree!.parameters).toEqual([{ id: 'I', kind: 'frequency', value: 1e-3 }])
    expect(built.parameters.I).toBeUndefined()          // ie 独占参数已分流出无类型映射
  })

  it('CCF 组随 linked 携带(ReportDossier 此前连 ccf 都漏)', () => {
    const built = buildAnalysisRequest(ftModel, linked, undefined)
    expect(built.ccf_groups).toEqual(linked.ccf_groups)
  })

  it('边界设置合入且不改基础请求形(无设置时逐字节同 withIeFaultTree)', () => {
    const bare = buildAnalysisRequest(ftModel, linked, undefined)
    expect(JSON.stringify(bare)).toBe(
      JSON.stringify(withIeFaultTree(toEngineRequest(ftModel, linked), ftModel, linked)))
    const withOpts = buildAnalysisRequest(ftModel, linked, opts)
    expect(withOpts.house_states).toEqual({ H: true })
    expect(withOpts.boundary_condition_set).toBe('维护工况')
  })
})


describe('参数影蔽修复(报障 2026-07-30:场景残留参数覆写手输 PFD)', () => {
  // 复刻用户存档 5d6520ef 形态:linkFt 全空 + 页签 fts 带同名树与参数(B_OFFGAS=0.01…)
  const scenarioModel = {
    initEvent: 'IE_COOLANT', initFreq: 1e-3, initFreqSource: 'manual',
    functionalEvents: [
      { id: 'B_OFFGAS', label: '早期离气探测+联动', failProb: 0.7 },
      { id: 'B_BMS', label: 'BMS 切断/隔离', failProb: 0.3 },
    ],
    root: { kind: 'branch', feId: 'B_OFFGAS',
      success: { kind: 'leaf', consequence: 'C1' },
      failure: { kind: 'branch', feId: 'B_BMS',
        success: { kind: 'leaf', consequence: 'C2' },
        failure: { kind: 'leaf', consequence: 'C3' } } },
  } as unknown as Parameters<typeof toEngineRequest>[0]
  const scenarioLinked = {
    fault_trees: [
      { name: 'B_OFFGAS', top: 'B_OFFGAS', nodes: [
        { id: 'B_OFFGAS_E', basic: true, param_ref: 'B_OFFGAS' },
        { id: 'B_OFFGAS', op: 'null', args: ['B_OFFGAS_E'] }] },
      { name: 'B_BMS', top: 'B_BMS', nodes: [
        { id: 'B_BMS_E', basic: true, param_ref: 'B_BMS' },
        { id: 'B_BMS', op: 'null', args: ['B_BMS_E'] }] },
    ],
    parameters: [
      { id: 'B_OFFGAS', kind: 'probability', value: 0.01 },
      { id: 'B_BMS', kind: 'probability', value: 0.1 },
    ],
  }

  it('未挂载(linkFt 空):残留参数绝不进请求,fe 走手输 pfd——引擎与前端积式同源', () => {
    const req = toEngineRequest(scenarioModel, scenarioLinked)
    expect(req.functional_events).toEqual([
      { id: 'B_OFFGAS', pfd: 0.7 }, { id: 'B_BMS', pfd: 0.3 }])
    expect(req.fault_trees).toEqual({})
    expect(req.parameters).toEqual({})                       // 影蔽源头清零
  })

  it('挂载的树:其引用参数照常转发(不误伤)', () => {
    const m2 = { ...scenarioModel, functionalEvents: [
      { id: 'B_OFFGAS', label: 'x', failProb: 0.7, linkFt: 'B_OFFGAS' },
      { id: 'B_BMS', label: 'y', failProb: 0.3 },
    ] } as unknown as Parameters<typeof toEngineRequest>[0]
    const req = toEngineRequest(m2, scenarioLinked)
    expect(req.functional_events[0]).toEqual({ id: 'B_OFFGAS', link_ft: 'B_OFFGAS' })
    expect(req.parameters.B_OFFGAS).toBeDefined()            // 被纳入树引用 → 转发
    expect(req.parameters.B_BMS).toBeUndefined()             // 未纳入树 → 不转发
  })
})
