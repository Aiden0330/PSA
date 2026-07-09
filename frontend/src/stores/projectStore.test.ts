import { beforeEach, describe, expect, it } from 'vitest'
import { EMPTY_FTS, resetProjectStore, selectActiveEta, useProjectStore } from './projectStore'
import { serializeProject } from '../project'
import type { ProjectEta } from '../project'

function eta(key: string, failProb = 0.1): ProjectEta {
  return {
    key, name: key.toUpperCase(), renamed: false,
    model: {
      initEvent: 'IE-' + key, initFreq: 1e-3,
      functionalEvents: [{ id: 'FE1', label: '屏障', failProb }],
      root: {
        kind: 'branch', feId: 'FE1',
        success: { kind: 'leaf', consequence: 'C1' },
        failure: { kind: 'leaf', consequence: 'C2' },
      },
    } as any,
    fts: EMPTY_FTS,
    pfds: {},
  }
}

const S = () => useProjectStore.getState()

describe('projectStore(双真相消解)', () => {
  beforeEach(() => {
    resetProjectStore()
    S().load([eta('a'), eta('b')], 'a', { a: true, b: true })
  })

  it('编辑页签 A 后切到 B 再切回:编辑仍在(无需 snapshotActive)', () => {
    S().setEtaModel('a', (m) => ({ ...m, initEvent: '改过的初因' }))
    S().setActive('b')
    S().setActive('a')
    expect(selectActiveEta(S())!.model.initEvent).toBe('改过的初因')
  })

  it('文档级单历史:跨页签编辑按时间序撤销;load 清空历史', () => {
    S().setEtaModel('a', (m) => ({ ...m, initEvent: 'A1' }))
    S().setEtaModel('b', (m) => ({ ...m, initEvent: 'B1' }))
    S().undo()  // 撤销 b 的编辑
    expect(S().present.etas[1].model.initEvent).toBe('IE-b')
    expect(S().present.etas[0].model.initEvent).toBe('A1')
    S().undo()
    expect(S().present.etas[0].model.initEvent).toBe('IE-a')
    S().redo()
    expect(S().present.etas[0].model.initEvent).toBe('A1')
    S().load([eta('c')], 'c', { c: true })
    expect(S().past).toHaveLength(0)
    expect(S().future).toHaveLength(0)
  })

  it('attachFt 单条历史:一次 undo 同时回退 linkFt 与 starter 故障树', () => {
    S().attachFt('a', 0)
    const e = S().present.etas[0]
    expect(e.model.functionalEvents[0].linkFt).toBe('FE1')
    expect(e.fts.fault_trees.length).toBeGreaterThan(0)
    S().undo()
    const e2 = S().present.etas[0]
    expect(e2.model.functionalEvents[0].linkFt).toBeUndefined()
    expect(e2.fts.fault_trees).toHaveLength(0)
  })

  it('setEtaPfd 是派生量写入:不产生历史条目', () => {
    const depth = S().past.length
    S().setEtaPfd('a', 'FE1', 0.042)
    expect(S().present.etas[0].pfds).toEqual({ FE1: 0.042 })
    expect(S().past).toHaveLength(depth)
  })

  it('removeTab:仅剩 1 个不允许删;删活动页转邻位;可撤销恢复', () => {
    S().removeTab('a')
    expect(S().present.etas.map((e) => e.key)).toEqual(['b'])
    expect(S().activeKey).toBe('b')
    expect(S().checkedKeys.a).toBeUndefined()
    S().removeTab('b')                                 // 仅剩 1 个 → 拒绝
    expect(S().present.etas).toHaveLength(1)
    S().undo()                                         // 内容可恢复(activeKey 非历史态,不回滚)
    expect(S().present.etas.map((e) => e.key)).toEqual(['a', 'b'])
  })

  it('applyProject 整体替换 = 一条历史', () => {
    S().applyProject({ etas: [eta('x')], checkedKeys: { x: true }, activeKey: 'x' })
    expect(S().present.etas.map((e) => e.key)).toEqual(['x'])
    S().undo()
    expect(S().present.etas.map((e) => e.key)).toEqual(['a', 'b'])
  })

  it('payload 契约不变:serializeProject 直接吃 store 字段', () => {
    const s = S()
    const payload = serializeProject(s.present.etas, s.activeKey, s.checkedKeys, s.present.userFts)
    expect(payload.v).toBe(2)
    expect(payload.etas.map((e) => e.key)).toEqual(['a', 'b'])
    expect(payload.activeKey).toBe('a')
    expect(payload.checkedKeys).toEqual({ a: true, b: true })
  })
})
