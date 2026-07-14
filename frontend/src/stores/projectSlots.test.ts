import { describe, it, expect, beforeEach } from 'vitest'
import { useProjectStore, resetProjectStore, selectOpenProjects } from './projectStore'
import type { ProjectEta } from '../project'
import type { ModelJson } from '../model'

/**
 * R2 多项目状态层(规格 2026-07-13-explorer-redesign §1):
 * 顶层即活动槽 + 停放注册表(方案 C)。隔离是结构给的——本文件把它锁死:
 * undo 历史 / pfds 缓存 / 身份(savedId/projectUuid/lastVersionHash)随槽整体迁移,
 * 任何跨项目串染对监管工具都是溯源违规级缺陷。
 */

const EMPTY_FTS: ModelJson = { model_data: { parameters: [] }, fault_trees: [] }

const eta = (key: string, initEvent: string): ProjectEta => ({
  key, name: initEvent, renamed: false,
  model: {
    initEvent, initFreq: 1e-3,
    functionalEvents: [{ id: 'FE1', label: '屏障一', failProb: 0.1 }],
    root: { kind: 'branch', feId: 'FE1',
      success: { kind: 'leaf', consequence: 'C1' },
      failure: { kind: 'leaf', consequence: 'C2' } },
  } as any,
  fts: EMPTY_FTS, pfds: {},
})

const P = useProjectStore.getState

const openA = () => {
  P().load([eta('a1', '项目A事件')], 'a1', { a1: true })
  P().setIdentity({ savedId: 'sidA', projectUuid: 'uuidA', lastVersionHash: 'hashA', displayName: '项目A' })
}
const openB = () => {
  P().openProject('sidB', {
    etas: [eta('b1', '项目B事件')], activeKey: 'b1', checkedKeys: { b1: true },
    identity: { savedId: 'sidB', projectUuid: 'uuidB', lastVersionHash: 'hashB', displayName: '项目B' },
  })
}

beforeEach(() => resetProjectStore())

describe('R2 槽注册表:打开/切换/关闭', () => {
  it('openProject 停放当前、载入新槽;switchProject 双向切换,文档逐位保留', () => {
    openA()
    P().setEtaModel('a1', (m) => ({ ...m, initEvent: '项目A事件·已编辑' }))   // A 产生 1 条历史
    expect(P().past.length).toBe(1)

    openB()
    // 现在活动 = B:顶层形状即 B 的内容,历史清零(新槽)
    expect(P().present.etas[0].model.initEvent).toBe('项目B事件')
    expect(P().past.length).toBe(0)
    expect(P().identity.savedId).toBe('sidB')

    P().switchProject(P().openOrder.find((w) => w !== P().workspaceId)!)
    // 切回 A:编辑与撤销栈原样(隔离铁证)
    expect(P().present.etas[0].model.initEvent).toBe('项目A事件·已编辑')
    expect(P().past.length).toBe(1)
    expect(P().identity).toMatchObject({ savedId: 'sidA', lastVersionHash: 'hashA' })
  })

  it('A 的 undo 绝不波及 B;B 的编辑绝不出现在 A', () => {
    openA()
    P().setEtaModel('a1', (m) => ({ ...m, initEvent: 'A改' }))
    openB()
    P().setEtaModel('b1', (m) => ({ ...m, initEvent: 'B改' }))
    const widA = P().openOrder.find((w) => w !== P().workspaceId)!
    P().switchProject(widA)
    P().undo()                                                    // A 回到未编辑
    expect(P().present.etas[0].model.initEvent).toBe('项目A事件')
    P().switchProject('sidB')
    expect(P().present.etas[0].model.initEvent).toBe('B改')       // B 不受 A 的 undo 影响
    expect(P().past.length).toBe(1)                               // B 自己的历史完好
  })

  it('pfds 派生缓存随槽隔离', () => {
    openA()
    P().setEtaPfd('a1', 'FE1', 0.42)
    openB()
    P().setEtaPfd('b1', 'FE1', 0.07)
    expect(P().pfds.a1).toBeUndefined()                           // B 槽看不到 A 的缓存
    const widA = P().openOrder.find((w) => w !== P().workspaceId)!
    P().switchProject(widA)
    expect(P().pfds.a1.FE1).toBe(0.42)
    expect(P().pfds.b1).toBeUndefined()
  })

  it('同 savedId 重复 open 只聚焦,绝不重载(未保存编辑受保护)', () => {
    openA(); openB()
    const widA = P().openOrder.find((w) => w !== P().workspaceId)!
    P().switchProject(widA)
    P().setEtaModel('a1', (m) => ({ ...m, initEvent: 'A未保存编辑' }))
    P().switchProject('sidB')
    // 再次"打开"A(如树上点击)—— 传入陈旧内容,必须被忽略,只切换
    P().openProject('sidA-new-wid', {
      etas: [eta('a1', '来自服务器的旧内容')], activeKey: 'a1', checkedKeys: { a1: true },
      identity: { savedId: 'sidA', projectUuid: 'uuidA', displayName: '项目A' },
    })
    expect(P().present.etas[0].model.initEvent).toBe('A未保存编辑')
    expect(P().openOrder.length).toBe(2)                          // 没有第三个槽
  })

  it('closeProject:关停放槽只移除;关活动槽回退到下一个;全关 = 新草稿', () => {
    openA(); openB()
    const widA = P().openOrder.find((w) => w !== P().workspaceId)!
    P().closeProject(widA)                                        // 关停放的 A
    expect(P().openOrder.length).toBe(1)
    expect(P().identity.savedId).toBe('sidB')                     // 活动不变
    P().closeProject(P().workspaceId)                             // 关活动的 B → 空 → 新草稿
    expect(P().openOrder.length).toBe(1)
    expect(P().workspaceId.startsWith('draft:')).toBe(true)
    expect(P().identity.savedId).toBe('')
    expect(P().present.etas.length).toBe(0)
  })

  it('selectOpenProjects 给出树可用的打开集(顺序 + 活动标记 + 身份)', () => {
    openA(); openB()
    const open = selectOpenProjects(useProjectStore.getState())
    expect(open.map((o) => o.identity.displayName)).toEqual(['项目A', '项目B'])
    expect(open.filter((o) => o.isActive).map((o) => o.identity.savedId)).toEqual(['sidB'])
  })

  it('FMEA 行/映射随槽隔离(修复既有的 hook 级全局串染)', () => {
    openA()
    P().setFmea([{ id: 'ra', object: 'A件', mode: 'A模式', S: 9, O: 3, D: 6 } as any], undefined)
    openB()
    expect(P().fmeaRows).toEqual([])                              // B 是干净槽,看不到 A 的行
    P().setFmea([{ id: 'rb', object: 'B件', mode: 'B模式', S: 5, O: 2, D: 4 } as any], undefined)
    const widA = P().openOrder.find((w) => w !== P().workspaceId)!
    P().switchProject(widA)
    expect(P().fmeaRows.map((r: any) => r.id)).toEqual(['ra'])
    P().switchProject('sidB')
    expect(P().fmeaRows.map((r: any) => r.id)).toEqual(['rb'])
  })

  it('load() 语义不变:替换活动槽内容并清历史,不触碰停放槽', () => {
    openA(); openB()
    P().load([eta('b2', 'B重载')], 'b2', { b2: true })
    expect(P().present.etas[0].key).toBe('b2')
    expect(P().past.length).toBe(0)
    const widA = P().openOrder.find((w) => w !== P().workspaceId)!
    P().switchProject(widA)
    expect(P().present.etas[0].model.initEvent).toBe('项目A事件') // A 安然无恙
  })
})
