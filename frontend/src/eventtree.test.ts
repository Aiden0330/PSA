import { describe, it, expect } from 'vitest'
import {
  delFe, withDerivedPfds,
  newBlankEta, normalizeEta, defaultConsequences, consEntries, consLevel, consText,
  addConsequence, updateConsequence, delConsequence, consequenceTotals, toEngineRequest,
  setInitFreqSource, setProduct, computeProductFreq, setConsequence,
  isCascade, cascadeConsequences, reorderFe, addFe, buildCascade, collapseNode,
} from './eventtree'

describe('consequence entries', () => {
  it('default 5 entries id=level=C1..C5', () => {
    const d = defaultConsequences()
    expect(d.map((e) => e.id)).toEqual(['C1', 'C2', 'C3', 'C4', 'C5'])
    expect(d.every((e) => e.id === e.level)).toBe(true)
  })

  it('old consequenceDefs migrates to 5 entries; old leaf "C1" still resolves', () => {
    const old = { initEvent: 'IE', initFreq: 1e-3, functionalEvents: [],
      root: { kind: 'leaf', consequence: 'C2' }, consequenceDefs: { C2: '自定义二级' } } as any
    const m = normalizeEta(old)
    expect(consEntries(m)).toHaveLength(5)
    expect(consText(m, 'C2')).toBe('自定义二级')
    expect(consLevel(m, 'C2')).toBe('C2')
  })

  it('add a second consequence under C3; level can repeat', () => {
    let m = newBlankEta('x')
    m = addConsequence(m, '额外三级后果', 'C3')
    const c3 = consEntries(m).filter((e) => e.level === 'C3')
    expect(c3).toHaveLength(2)
    const added = c3.find((e) => e.desc === '额外三级后果')!
    expect(consLevel(m, added.id)).toBe('C3')
  })

  it('default 5 are locked: cannot delete, level immutable, desc editable', () => {
    let m = newBlankEta('x')
    m = delConsequence(m, 'C1')
    expect(consEntries(m).some((e) => e.id === 'C1')).toBe(true)
    m = updateConsequence(m, 'C1', { desc: '改写', level: 'C5' })
    expect(consText(m, 'C1')).toBe('改写')
    expect(consLevel(m, 'C1')).toBe('C1')
  })

  it('leaf bound to a custom entry bins by that entry level', () => {
    let m = newBlankEta('x')
    m = addConsequence(m, '特定后果', 'C4')
    const eid = consEntries(m).find((e) => e.desc === '特定后果')!.id
    m = setConsequence(m, ['failure', 'failure'], eid)
    const totals = consequenceTotals(m)
    expect(totals.C4).toBeGreaterThan(0)
    const req = toEngineRequest(m)
    expect(Object.values(req.consequence_bins)).toContain('C4')
  })
})

describe('init freq sources', () => {
  it('product freq = rate × cellsPerPack × packsPerSystem', () => {
    let m = newBlankEta('x')
    m = setInitFreqSource(m, 'product')
    m = setProduct(m, { cellsPerPack: 100, packsPerSystem: 20, cellFailureRate: 1e-7 })
    expect(computeProductFreq(m)).toBeCloseTo(2e-4, 12)
  })

  it('normalizeEta defaults source to manual', () => {
    const m = normalizeEta({ initEvent: 'IE', initFreq: 1, functionalEvents: [],
      root: { kind: 'leaf', consequence: 'C1' } } as any)
    expect(m.initFreqSource).toBe('manual')
  })

  it('computeProductFreq uses default dims when product is undefined (no stale fallback)', () => {
    const m = newBlankEta('x')           // no product set
    expect(computeProductFreq(m)).toBeCloseTo(100 * 20 * 1e-7, 12)
  })

  it('normalizeEta seeds product when source is product', () => {
    const m = normalizeEta({ initEvent: 'IE', initFreq: 1, functionalEvents: [],
      root: { kind: 'leaf', consequence: 'C1' }, initFreqSource: 'product' } as any)
    expect(m.product).toBeTruthy()
    expect(m.product!.cellsPerPack).toBe(100)
  })
})

import { branchFeOptions, setBranchFe, applyFieldUpdate } from './eventtree'
import type { EventTreeModel } from './eventtree'

const mk3 = (): EventTreeModel => {
  const fes = [
    { id: 'FE1', label: '屏障A', failProb: 0.1 },
    { id: 'FE2', label: '屏障B', failProb: 0.2, linkFt: 'FE2' },
    { id: 'FE3', label: '屏障C', failProb: 0.3 },
  ]
  return { initEvent: 'IE', initFreq: 1e-3, functionalEvents: fes, root: buildCascade(fes, ['C1', 'C2', 'C3', 'C4']) }
}

describe('isCascade / cascadeConsequences / reorderFe', () => {
  it('isCascade: 默认级联为真', () => {
    expect(isCascade(mk3())).toBe(true)
    expect(isCascade(newBlankEta('x'))).toBe(true)
  })
  it('isCascade: 折叠某分支后为假', () => {
    expect(isCascade(collapseNode(mk3(), ['failure']))).toBe(false)
  })
  it('cascadeConsequences: 级联树返回各深度后果 + 末端(长度 n+1)', () => {
    expect(cascadeConsequences(mk3())).toEqual(['C1', 'C2', 'C3', 'C4'])
  })
  it('reorderFe: 移动屏障后次序变、树重建为级联', () => {
    const m = reorderFe(mk3(), 2, 0)
    expect(m.functionalEvents.map((f) => f.id)).toEqual(['FE3', 'FE1', 'FE2'])
    expect(isCascade(m)).toBe(true)
  })
  it('reorderFe: 后果按深度(位置)保留', () => {
    expect(cascadeConsequences(reorderFe(mk3(), 2, 0))).toEqual(['C1', 'C2', 'C3', 'C4'])
  })
  it('reorderFe: 屏障属性随屏障移动(label/failProb/linkFt), id 不变', () => {
    const m = reorderFe(mk3(), 2, 0)
    expect(m.functionalEvents[0]).toMatchObject({ id: 'FE3', label: '屏障C', failProb: 0.3 })
    expect(m.functionalEvents[2]).toMatchObject({ id: 'FE2', linkFt: 'FE2' })
  })
  it('reorderFe: 越界 / 同位 → 返回原对象', () => {
    const m = mk3()
    expect(reorderFe(m, 0, 0)).toBe(m)
    expect(reorderFe(m, -1, 0)).toBe(m)
    expect(reorderFe(m, 0, 5)).toBe(m)
  })
  it('addFe: 新屏障默认中文名 屏障N, id 仍 FEN', () => {
    const last = addFe(newBlankEta('x')).functionalEvents.slice(-1)[0]
    expect(last.id).toBe('FE3')
    expect(last.label).toBe('屏障3')
  })
  it('isCascade: 跳过式(root 直接判定 FE2)结构为假', () => {
    const fes = [{ id: 'FE1', label: 'A', failProb: 0.1 }, { id: 'FE2', label: 'B', failProb: 0.1 }]
    const m: EventTreeModel = {
      initEvent: 'IE', initFreq: 1e-3, functionalEvents: fes,
      root: { kind: 'branch', feId: 'FE2', success: { kind: 'leaf', consequence: 'C1' }, failure: { kind: 'leaf', consequence: 'C2' } },
    }
    expect(isCascade(m)).toBe(false)
  })
  it('reorderFe: 非级联(折叠)树重排后产出合法完整级联', () => {
    const fes = [{ id: 'FE1', label: 'A', failProb: 0.1 }, { id: 'FE2', label: 'B', failProb: 0.1 }, { id: 'FE3', label: 'C', failProb: 0.1 }]
    const m: EventTreeModel = {
      initEvent: 'IE', initFreq: 1e-3, functionalEvents: fes,
      root: { kind: 'branch', feId: 'FE1', success: { kind: 'leaf', consequence: 'C1' }, failure: { kind: 'leaf', consequence: 'C3' } },
    }
    expect(isCascade(m)).toBe(false)
    const m2 = reorderFe(m, 2, 0)
    expect(m2.functionalEvents.map((f) => f.id)).toEqual(['FE3', 'FE1', 'FE2'])
    expect(isCascade(m2)).toBe(true)
  })
})

describe('applyFieldUpdate', () => {
  it('sets failProb, grade, evidence on the target fe; others unchanged', () => {
    const m = newBlankEta('x')
    const m2 = applyFieldUpdate(m, 0, { failProb: 0.42, grade: 'A', evidence: '现场更新 N=10、k=2' })
    expect(m2.functionalEvents[0].failProb).toBeCloseTo(0.42)
    expect(m2.functionalEvents[0].grade).toBe('A')
    expect(m2.functionalEvents[0].evidence).toBe('现场更新 N=10、k=2')
    expect(m2.functionalEvents[1]).toBe(m.functionalEvents[1])
  })

  it('clamps failProb to [0,1] and is a no-op for out-of-range idx', () => {
    const m = newBlankEta('x')
    expect(applyFieldUpdate(m, 0, { failProb: 1.5 }).functionalEvents[0].failProb).toBe(1)
    expect(applyFieldUpdate(m, 0, { failProb: -0.3 }).functionalEvents[0].failProb).toBe(0)
    expect(applyFieldUpdate(m, 99, { failProb: 0.5 })).toBe(m)
  })
})

const mk = (root: any): EventTreeModel => ({
  initEvent: 'IE', initFreq: 1e-3,
  functionalEvents: [
    { id: 'FE1', label: 'B1', failProb: 0.1 }, { id: 'FE2', label: 'B2', failProb: 0.1 },
    { id: 'FE3', label: 'B3', failProb: 0.1 }, { id: 'FE4', label: 'B4', failProb: 0.1 },
  ],
  root,
})
const leaf = (c = 'C1') => ({ kind: 'leaf', consequence: c })

describe('branchFeOptions / setBranchFe', () => {
  it('both-leaf-children branch → options are all subsequent FEs', () => {
    const m = mk({ kind: 'branch', feId: 'FE2', success: leaf(), failure: leaf('C3') })
    expect(branchFeOptions(m, []).map((f) => f.id)).toEqual(['FE1', 'FE2', 'FE3', 'FE4'])
  })
  it('options bounded below by ancestors and above by subtree min', () => {
    const m = mk({ kind: 'branch', feId: 'FE1', success: leaf(),
      failure: { kind: 'branch', feId: 'FE3', success: leaf(), failure: leaf('C4') } })
    expect(branchFeOptions(m, []).map((f) => f.id)).toEqual(['FE1', 'FE2'])
  })
  it('setBranchFe reassigns to a valid FE', () => {
    const m = mk({ kind: 'branch', feId: 'FE2', success: leaf(), failure: leaf('C3') })
    expect((setBranchFe(m, [], 'FE4').root as any).feId).toBe('FE4')
  })
  it('setBranchFe rejects an out-of-order FE (no-op, same ref)', () => {
    const m = mk({ kind: 'branch', feId: 'FE1', success: leaf(),
      failure: { kind: 'branch', feId: 'FE3', success: leaf(), failure: leaf('C4') } })
    expect(setBranchFe(m, [], 'FE3')).toBe(m)
  })
  it('setBranchFe no-op on a leaf path or unknown id', () => {
    const m = mk({ kind: 'branch', feId: 'FE2', success: leaf(), failure: leaf('C3') })
    expect(setBranchFe(m, ['success'], 'FE3')).toBe(m)
    expect(setBranchFe(m, [], 'NOPE')).toBe(m)
  })
})

describe('typed params ride the engine request (F3 收口二轮 F-2b)', () => {
  // 锁迁移 2026-07-30(影蔽修复):参数只随**被纳入请求的树引用**转发——本锁守的是
  // 参数**形状**逐位,故把 P1/X 挂进 FT1 的引用;未被引用参数的"不转发"由
  // buildRequest.test 影蔽锁把守。
  const linked = {
    fault_trees: [{ name: 'FT1', top: 'TOP', nodes: [
      { id: 'R1', basic: true },
      { id: 'B_P1', basic: true, param_ref: 'P1' },
      { id: 'B_X', basic: true, param_ref: 'X' },
      { id: 'TOP', op: 'or', args: ['R1', 'B_P1', 'B_X'], label: '中间事件' }] }],
    parameters: [
      { id: 'R1', kind: 'rate', value: 1e-5, mttr: 24, note: '杂散注记不进请求' },
      { id: 'P1', kind: 'probability', value: 0.02 },
      { id: 'X', value: 0.3 },                       // 无 kind 旧形状
    ],
  }
  const withLink = () => {
    let m = newBlankEta('x')
    m = { ...m, functionalEvents: m.functionalEvents.map((fe, i) =>
      i === 0 ? { ...fe, linkFt: 'FT1' } : fe) }
    return m
  }

  it('probability / kind-less params keep the historical {value} shape bit-for-bit', () => {
    const req = toEngineRequest(withLink(), linked as any)
    expect(req.parameters.P1).toEqual({ value: 0.02 })
    expect(req.parameters.X).toEqual({ value: 0.3 })
  })

  it('typed kinds pass kind + typed fields (rate λ·MTTR no longer flattened to λ)', () => {
    const req = toEngineRequest(withLink(), linked as any)
    expect(req.parameters.R1).toEqual({ kind: 'rate', value: 1e-5, mttr: 24 })
  })

  it('stray keys on typed params never enter the request (whitelist emission)', () => {
    const req = toEngineRequest(withLink(), linked as any)
    expect('note' in req.parameters.R1).toBe(false)
  })
})


describe('withDerivedPfds(闪变修复 2026-07-30)', () => {
  it('挂链屏障被侧表覆写;未挂链绝不被残值覆写;无变化返回原引用', () => {
    let m = newBlankEta('x')
    m = { ...m, functionalEvents: [
      { id: 'FE1', label: 'a', failProb: 0.7, linkFt: 'FE1' },
      { id: 'FE2', label: 'b', failProb: 0.3 },
    ] }
    const out = withDerivedPfds(m, { FE1: 0.01, FE2: 0.9 })
    expect(out.functionalEvents[0].failProb).toBe(0.01)      // 挂链 → 派生覆写
    expect(out.functionalEvents[1].failProb).toBe(0.3)       // 未挂链 → 残值不覆写
    expect(withDerivedPfds(m, undefined)).toBe(m)            // 无侧表 → 原引用
    expect(withDerivedPfds(m, { FE1: 0.7 })).toBe(m)         // 同值 → 原引用(memo 友好)
  })
})


describe('delFe 拼接语义(报障 2026-07-30:删中间屏障不得毁下游)', () => {
  const leafC = (c: string) => ({ kind: 'leaf', consequence: c }) as const
  // 级联 FE1→FE2→FE3(成功=末态,失效=下探,与画布约定一致)
  const cascade = () => ({
    initEvent: 'IE', initFreq: 1e-3,
    functionalEvents: [
      { id: 'FE1', label: '屏障一', failProb: 0.7 },
      { id: 'FE2', label: '屏障二', failProb: 0.3 },
      { id: 'FE3', label: '屏障三', failProb: 0.1 },
    ],
    root: { kind: 'branch', feId: 'FE1',
      success: leafC('C1'),
      failure: { kind: 'branch', feId: 'FE2',
        success: leafC('C2'),
        failure: { kind: 'branch', feId: 'FE3',
          success: leafC('C3'), failure: leafC('C4') } } },
  }) as never

  it('删中间屏障:下游链原值原样上提接入上级(失效子树存活)', () => {
    const m = delFe(cascade(), 1)
    expect(m.functionalEvents.map((f: { id: string }) => f.id)).toEqual(['FE1', 'FE3'])
    const r = m.root as never as { feId: string; success: unknown; failure: { feId: string; failProb?: number; success: { consequence: string }; failure: { consequence: string } } }
    expect(r.feId).toBe('FE1')
    expect(r.failure.feId).toBe('FE3')                     // FE2 节点被拼接掉,FE3 直连
    expect(r.failure.success.consequence).toBe('C3')       // 下游端态原值原样
    expect(r.failure.failure.consequence).toBe('C4')
    expect((m.functionalEvents[1] as { failProb: number }).failProb).toBe(0.1)   // 概率不动
  })

  it('删第一个屏障:根被其失效子树整体替换', () => {
    const m = delFe(cascade(), 0)
    const r = m.root as never as { feId: string }
    expect(r.feId).toBe('FE2')
    expect(m.functionalEvents.map((f: { id: string }) => f.id)).toEqual(['FE2', 'FE3'])
  })

  it('删末屏障:上级失效侧落到其失效端态(不再折叠整棵为最严重叶)', () => {
    const m = delFe(cascade(), 2)
    const r = m.root as never as { failure: { feId: string; failure: { kind: string; consequence: string } } }
    expect(r.failure.feId).toBe('FE2')
    expect(r.failure.failure).toEqual({ kind: 'leaf', consequence: 'C4' })
  })

  it('成功侧为子树(非级联)时:随屏障移除,失效侧仍存活', () => {
    const m0 = cascade() as never as { root: { failure: { success: unknown } } }
    m0.root.failure.success = { kind: 'branch', feId: 'FE3',
      success: leafC('C2'), failure: leafC('C3') }         // FE2 成功侧挂了子树
    const m = delFe(m0 as never, 1)
    const r = m.root as never as { failure: { feId: string } }
    expect(r.failure.feId).toBe('FE3')                     // 失效子树上提;成功侧子树随删
  })
})
