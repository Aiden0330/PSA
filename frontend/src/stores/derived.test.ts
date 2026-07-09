import { beforeEach, describe, expect, it } from 'vitest'
import { INIT_FREQ_KEY, composeModel, stripDerived } from './derived'
import { EMPTY_FTS, resetProjectStore, selectEtaPfds, useProjectStore } from './projectStore'
import type { EventTreeModel } from '../eventtree'
import { addFe } from '../eventtree'

const MODEL: EventTreeModel = {
  initEvent: 'IE', initFreq: 2e-3,
  functionalEvents: [
    { id: 'FE1', label: '挂载屏障', failProb: 0.1, linkFt: 'FE1' },
    { id: 'FE2', label: '直接屏障', failProb: 0.2 },
  ],
  root: {
    kind: 'branch', feId: 'FE1',
    success: { kind: 'leaf', consequence: 'C1' },
    failure: { kind: 'leaf', consequence: 'C2' },
  },
} as any

describe('derived compose/strip', () => {
  it('compose:linkFt 屏障取 pfds 覆盖,直接屏障不动;无差异返回原引用', () => {
    const m = composeModel(MODEL, { FE1: 0.05 })
    expect(m.functionalEvents[0].failProb).toBe(0.05)
    expect(m.functionalEvents[1].failProb).toBe(0.2)
    expect(composeModel(MODEL, { FE1: 0.1 })).toBe(MODEL)   // 值相同 → 原引用
    expect(composeModel(MODEL, undefined)).toBe(MODEL)
  })

  it('compose:FT 源 initFreq 取 __init__ 顶值;非 FT 源不覆盖', () => {
    const ft = { ...MODEL, initFreqSource: 'ft' as const }
    expect(composeModel(ft, { [INIT_FREQ_KEY]: 7e-4 }).initFreq).toBe(7e-4)
    expect(composeModel(MODEL, { [INIT_FREQ_KEY]: 7e-4 }).initFreq).toBe(2e-3)
  })

  it('strip:linkFt 屏障 failProb 恢复内容值(按 id,重排序安全);源切换 ft→manual 物化派生值', () => {
    const composed = composeModel({ ...MODEL, initFreqSource: 'ft' }, { FE1: 0.05, [INIT_FREQ_KEY]: 7e-4 })
    // 用户在合成模型上重排屏障后回写
    const reordered = { ...composed, functionalEvents: [composed.functionalEvents[1], composed.functionalEvents[0]] }
    const stripped = stripDerived(reordered, { ...MODEL, initFreqSource: 'ft' })
    expect(stripped.functionalEvents[1].failProb).toBe(0.1)   // FE1 恢复内容值
    expect(stripped.functionalEvents[0].failProb).toBe(0.2)
    expect(stripped.initFreq).toBe(2e-3)                       // 双 FT 源 → 恢复
    // ft → manual:保留合成值 = 物化
    const toManual = stripDerived({ ...composed, initFreqSource: 'manual' }, { ...MODEL, initFreqSource: 'ft' })
    expect(toManual.initFreq).toBe(7e-4)
  })
})

describe('撤销结构编辑后派生值一致性(蓝图验收)', () => {
  beforeEach(() => resetProjectStore())

  it('结构编辑 → 量化回写(quiet)→ 撤销结构:合成视图仍显示最新 PFD', () => {
    const S = useProjectStore.getState
    S().load([{ key: 't', name: 'T', renamed: false, model: MODEL, fts: EMPTY_FTS, pfds: { FE1: 0.1 } }], 't', { t: true })
    S().setEtaModel('t', (m) => addFe(m))                     // 结构编辑(进历史)
    S().setEtaPfd('t', 'FE1', 0.033)                           // FT 量化回写(不进历史)
    expect(S().past).toHaveLength(1)
    S().undo()                                                 // 撤销结构编辑
    const e = S().present.etas[0]
    expect(e.model.functionalEvents).toHaveLength(2)           // 结构回退了
    const view = composeModel(e.model, selectEtaPfds(S(), 't'))
    expect(view.functionalEvents[0].failProb).toBe(0.033)      // 派生值不随撤销回退(L425 之坑消解)
  })

  it('detachFt 物化当前派生 PFD 到内容层(改回直接 PFD 数值不跳变)', () => {
    const S = useProjectStore.getState
    S().load([{ key: 't', name: 'T', renamed: false, model: MODEL, fts: EMPTY_FTS, pfds: { FE1: 0.033 } }], 't', { t: true })
    S().detachFt('t', 0)
    const fe = S().present.etas[0].model.functionalEvents[0]
    expect(fe.linkFt).toBeUndefined()
    expect(fe.failProb).toBe(0.033)
  })
})
