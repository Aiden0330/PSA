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
