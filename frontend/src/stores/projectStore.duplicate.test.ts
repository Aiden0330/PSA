/** 项目复制锁测(规格 2026-07-29-project-duplicate §3)。
 *
 * 语义:复制 = 新草稿槽 + 深克隆文档 + 身份三清零(savedId/projectUuid/
 * lastVersionHash)——首存开新档案新证据链,绝无覆写源档;改副本不触源
 * (跨项目串染 = 溯源违规级缺陷);撤销历史不带;派生 PFD 物化进副本。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { resetProjectStore, useProjectStore } from './projectStore'
import type { ProjectEta } from '../project'

const mkEta = (key: string, name: string): ProjectEta => ({
  key, name, renamed: false,
  model: {
    initEvent: name, initFreq: 1e-3,
    functionalEvents: [{ id: 'FE1', label: '屏障一', failProb: 0.1 }],
    root: { kind: 'branch', feId: 'FE1',
      success: { kind: 'leaf', consequence: 'C1' },
      failure: { kind: 'leaf', consequence: 'C2' } },
  } as never,
  fts: { model_data: { parameters: [] }, fault_trees: [] },
  pfds: {},
})

function seedSource() {
  const S = useProjectStore.getState()
  S.load([mkEta('e1', '内短树')], 'e1', { e1: true })
  S.setIdentity({ savedId: 'sv-1', projectUuid: 'uuid-1', displayName: '源项目', lastVersionHash: 'h'.repeat(64) })
  S.setFmea([{ id: 'f1' } as never])
  S.setEtaPfd('e1', 'FE1', 0.123)                     // 活动侧表派生值(D-3 物化对象)
}

describe('duplicateActiveProject(规格 2026-07-29 D-1..D-6)', () => {
  beforeEach(() => resetProjectStore())

  it('D-1/D-4/D-5/D-6:新草稿槽、身份三清零、源槽停放原样、历史清零、顺序与激活', () => {
    seedSource()
    const srcWid = useProjectStore.getState().workspaceId
    useProjectStore.getState().duplicateActiveProject('源项目 副本')
    const s = useProjectStore.getState()
    expect(s.workspaceId).not.toBe(srcWid)
    expect(s.workspaceId.startsWith('draft:')).toBe(true)
    expect(s.identity).toEqual({ savedId: '', projectUuid: '', displayName: '源项目 副本' })
    expect('lastVersionHash' in s.identity && s.identity.lastVersionHash).toBeFalsy()   // D-6 CAS 基线不泄漏
    // 源槽停放,身份逐字段原样
    const src = s.parked[srcWid]
    expect(src).toBeTruthy()
    expect(src.identity).toEqual({ savedId: 'sv-1', projectUuid: 'uuid-1', displayName: '源项目', lastVersionHash: 'h'.repeat(64) })
    // D-4 历史清零;D-5 顺序:源在前副本在后且激活
    expect(s.past).toEqual([])
    expect(s.future).toEqual([])
    expect(s.openOrder.indexOf(srcWid)).toBeLessThan(s.openOrder.indexOf(s.workspaceId))
    expect(s.activeKey).toBe('e1')
  })

  it('D-2:深隔离——改副本 ETA/FMEA,源停放槽逐位不动且引用不等', () => {
    seedSource()
    const srcWid = useProjectStore.getState().workspaceId
    const srcEtaRef = useProjectStore.getState().present.etas[0]
    useProjectStore.getState().duplicateActiveProject('副本')
    const s1 = useProjectStore.getState()
    expect(s1.present.etas[0]).not.toBe(srcEtaRef)                       // 引用不等(深克隆)
    // 改副本:重命名页签 + 改 FMEA
    s1.renameTab('e1', '改名后')
    useProjectStore.getState().setFmea([{ id: 'f2' } as never, { id: 'f3' } as never])
    const src = useProjectStore.getState().parked[srcWid]
    expect(src.present.etas[0].name).toBe('内短树')                      // 源逐位不动
    expect(src.fmeaRows).toEqual([{ id: 'f1' }])
    expect(useProjectStore.getState().present.etas[0].name).toBe('改名后')
  })

  it('D-3:派生 PFD 物化——源侧表值进副本 etas 静态 pfds 与副本侧表', () => {
    seedSource()
    useProjectStore.getState().duplicateActiveProject('副本')
    const s = useProjectStore.getState()
    expect(s.present.etas[0].pfds?.FE1).toBe(0.123)
    expect(s.pfds.e1?.FE1).toBe(0.123)
  })

  it('默认名:未传名时为「{原名} 副本」', () => {
    seedSource()
    useProjectStore.getState().duplicateActiveProject()
    expect(useProjectStore.getState().identity.displayName).toBe('源项目 副本')
  })
})
