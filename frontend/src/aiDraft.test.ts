import { describe, expect, it } from 'vitest'
import { applyAiDraftToProject } from './aiDraft'
import type { AiDraftResponse } from './aiDraft'
import type { ProjectEta } from './project'
import type { ModelJson } from './model'

const emptyFts = (): ModelJson => ({ model_data: { parameters: [] }, fault_trees: [] })
const mkEta = (key: string): ProjectEta => ({
  key,
  name: key,
  renamed: false,
  model: {
    initEvent: key,
    initFreq: 1e-3,
    functionalEvents: [{ id: 'B1', label: 'BMS 隔离', failProb: 0.1 }],
    root: {
      kind: 'branch',
      feId: 'B1',
      success: { kind: 'leaf', consequence: 'C1' },
      failure: { kind: 'leaf', consequence: 'C3' },
    },
  } as any,
  fts: emptyFts(),
  pfds: {},
})

const draftEta: ProjectEta = {
  key: 'ai-key',
  name: 'AI 液冷泄漏 ETA',
  renamed: false,
  model: {
    initEvent: '电池舱液冷泄漏导致外短',
    initFreq: 0.001,
    functionalEvents: [{ id: 'D1', label: '泄漏检测', failProb: 0.05, source: 'AI 草案,待人工审核' }],
    root: {
      kind: 'branch',
      feId: 'D1',
      success: { kind: 'leaf', consequence: 'C1' },
      failure: { kind: 'leaf', consequence: 'C4' },
    },
  } as any,
  fts: emptyFts(),
  pfds: {},
}

const draftFts: ModelJson = {
  model_data: { parameters: [{ id: 'SENSOR', kind: 'probability', value: 0.02 }] },
  fault_trees: [{
    name: 'AI_SENSOR_FT',
    top: 'TOP',
    nodes: [
      { id: 'SENSOR', basic: true, param_ref: 'SENSOR' },
      { id: 'TOP', op: 'or', args: ['SENSOR'] },
    ],
  }],
}

const okDraft = (patch: Partial<AiDraftResponse> = {}): AiDraftResponse => ({
  draft_id: 'd1',
  summary: '草案',
  assumptions: ['待人工审核'],
  questions: [],
  etas: [draftEta],
  fts: draftFts,
  traceability: [{ item: 'D1', source: '参考库' }],
  warnings: ['AI 草案不能替代工程审查'],
  validation: { ok: true, errors: [], warnings: [] },
  ...patch,
})

describe('applyAiDraftToProject', () => {
  it('校验失败草案不能应用', () => {
    expect(() => applyAiDraftToProject({
      etaTabs: [mkEta('a')],
      activeKey: 'a',
      checkedKeys: { a: true },
      userFts: emptyFts(),
      draft: okDraft({ validation: { ok: false, errors: ['bad'], warnings: [] } }),
      mode: 'new_eta',
    })).toThrow(/校验失败/)
  })

  it('生成新 ETA 时追加页签、勾选并切换到草案', () => {
    const result = applyAiDraftToProject({
      etaTabs: [mkEta('a')],
      activeKey: 'a',
      checkedKeys: { a: true },
      userFts: emptyFts(),
      draft: okDraft(),
      mode: 'new_eta',
      makeKey: () => 'ai1',
    })

    expect(result.etaTabs.map((e) => e.key)).toEqual(['a', 'ai1'])
    expect(result.activeKey).toBe('ai1')
    expect(result.checkedKeys.ai1).toBe(true)
    expect(result.etaTabs[1].name).toBe('AI 液冷泄漏 ETA')
    expect(result.etaTabs[1].renamed).toBe(true)
    expect(result.etaTabs[1].model.initEvent).toBe('电池舱液冷泄漏导致外短')
  })

  it('为当前屏障生成 FTA 时合并到活动 ETA 并挂载该屏障', () => {
    const result = applyAiDraftToProject({
      etaTabs: [mkEta('a')],
      activeKey: 'a',
      checkedKeys: { a: true },
      userFts: emptyFts(),
      draft: okDraft({ etas: [] }),
      mode: 'fta_for_barrier',
      targetFeId: 'B1',
    })

    const active = result.etaTabs[0]
    expect(active.model.functionalEvents[0].linkFt).toBe('B1')
    expect(active.fts.fault_trees[0].name).toBe('B1')
    expect(active.fts.model_data.parameters[0].id).toBe('SENSOR')
    expect(result.userFts.fault_trees).toHaveLength(0)
  })

  it('为当前屏障生成 FTA 时若草案没有故障树则拒绝应用', () => {
    expect(() => applyAiDraftToProject({
      etaTabs: [mkEta('a')],
      activeKey: 'a',
      checkedKeys: { a: true },
      userFts: emptyFts(),
      draft: okDraft({ etas: [], fts: emptyFts() }),
      mode: 'fta_for_barrier',
      targetFeId: 'B1',
    })).toThrow(/未包含 FTA/)
  })

  it('独立 FTA 草案合并到 userFts 且名称冲突时去重', () => {
    const result = applyAiDraftToProject({
      etaTabs: [mkEta('a')],
      activeKey: 'a',
      checkedKeys: { a: true },
      userFts: { ...emptyFts(), fault_trees: [{ ...draftFts.fault_trees[0] }] },
      draft: okDraft({ etas: [] }),
      mode: 'standalone_fta',
    })

    expect(result.userFts.fault_trees.map((f) => f.name)).toEqual(['AI_SENSOR_FT', 'AI_SENSOR_FT_2'])
  })
})
