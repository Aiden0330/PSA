/** 丢改动回归(报障 2026-07-17):FT 编辑处理器若用渲染期旧快照算新模型再整体覆写,
 *  同一拍(无重渲染间隔)连续两次编辑,后写会把前写整个冲掉——快速点击/逐键输入丢改动。
 *  修复口径:所有 FT 编辑调用点改传更新函数(prev => next),store 对当前状态应用。 */
import { beforeEach, describe, expect, it } from 'vitest'
import { useProjectStore, EMPTY_FTS } from './projectStore'
import { addBasic, addGate } from '../model'
import type { ModelJson } from '../model'

const P = () => useProjectStore.getState()

type FtNode = { id: string; op?: string; basic?: boolean }
function seedEta(key: string, fts: ModelJson) {
  const tab = { key, name: key, model: { initEvent: 'IE', initFreq: 1, initFreqSource: 'manual',
    functionalEvents: [], consequences: {} }, fts, pfds: {} }
  P().addTab(tab as unknown as Parameters<ReturnType<typeof useProjectStore.getState>['addTab']>[0], { activate: true })
}

const STARTER: ModelJson = { model_data: { parameters: [] }, fault_trees: [
  { name: 'B_X', top: 'B_X', nodes: [{ id: 'B_X', op: 'or', args: [] }] }] } as unknown as ModelJson

beforeEach(() => {
  useProjectStore.setState({ past: [], present: { v: 2 as const, etas: [], userFts: EMPTY_FTS }, future: [] } as unknown as Parameters<typeof useProjectStore.setState>[0])
})

describe('projectStore — 同拍双写(丢改动回归)', () => {
  it('函数式 updater:同一拍两次 setEtaFts 都落地(加事件 + 加门共存)', () => {
    seedEta('t1', STARTER)
    P().setEtaFts('t1', (prev) => addBasic(prev, 'B_X'))
    P().setEtaFts('t1', (prev) => addGate(prev, 'B_X', 'or'))
    const fts = P().present.etas.find((e) => e.key === 't1')!.fts!
    const nodes = fts.fault_trees[0].nodes
    expect(nodes.some((n: FtNode) => n.basic)).toBe(true)                       // 基本事件在
    expect(nodes.some((n: FtNode) => n.op === 'or' && n.id !== 'B_X')).toBe(true) // 新门也在
    expect(nodes.length).toBe(3)
  })

  it('值式覆写(旧口径,文档化):同快照两次写,后写冲前写——这就是为何必须函数式', () => {
    seedEta('t2', STARTER)
    const stale = P().present.etas.find((e) => e.key === 't2')!.fts!
    P().setEtaFts('t2', addBasic(stale, 'B_X'))
    P().setEtaFts('t2', addGate(stale, 'B_X', 'or'))   // 用同一旧快照 → 基本事件丢失
    const nodes = P().present.etas.find((e) => e.key === 't2')!.fts!.fault_trees[0].nodes
    expect(nodes.some((n: FtNode) => n.basic)).toBe(false)
    expect(nodes.length).toBe(2)
  })
})
