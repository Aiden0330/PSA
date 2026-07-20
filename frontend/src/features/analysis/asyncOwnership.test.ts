/** F-β 锚点(规格 2026-07-17-fe-async-ownership-runkey §3):槽定向派生写三路语义 +
 *  乱序代序守卫 + 失效依赖源码级锁。 */
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { useProjectStore } from '../../stores/projectStore'
import { makeStaleGuard } from './staleGuard'

const S = () => useProjectStore.getState()

beforeEach(() => {
  // 重置到单一新槽(newProject 语义:closeProject 到只剩空槽)
  const s = S()
  for (const wid of [...s.openOrder]) s.closeProject?.(wid)
})

function openSecondProject(): { widA: string; widB: string } {
  const widA = S().workspaceId
  S().openProject('wid-B-test', {
    etas: S().present.etas.map((e: any) => ({ ...e })),
    activeKey: S().activeKey, checkedKeys: {},
    identity: { savedId: '', projectUuid: '', displayName: 'B' },
  })
  return { widA, widB: S().workspaceId }
}

describe('setEtaPfdFor — 槽定向派生写(W1-W3)', () => {
  it('W-3 发起槽仍活动 → 顶层生效(旧行为零扰动)', () => {
    const wid = S().workspaceId
    const key = S().activeKey
    S().setEtaPfdFor(wid, key, 'FE_X', 0.123)
    expect(S().pfds[key]?.FE_X).toBe(0.123)
  })

  it('W-1 切槽后写回 → 落发起槽(停放),当前槽逐位不变', () => {
    const { widA, widB } = openSecondProject()
    expect(S().workspaceId).toBe(widB)
    const keyA = S().parked[widA] ? Object.keys(S().parked[widA].pfds)[0] ?? S().parked[widA].activeKey : ''
    const beforeB = JSON.stringify(S().pfds)
    S().setEtaPfdFor(widA, keyA || 'k', 'FE_X', 0.777)          // A 的慢响应此刻返回
    expect(JSON.stringify(S().pfds)).toBe(beforeB)               // B(当前)逐位不变
    expect(S().parked[widA].pfds[keyA || 'k']?.FE_X).toBe(0.777) // A 停放槽收到
  })

  it('W-2 槽已关闭 → 丢弃(任何槽不变)', () => {
    const { widA } = openSecondProject()
    S().closeProject(widA)
    const snap = JSON.stringify({ p: S().pfds, parked: S().parked })
    S().setEtaPfdFor(widA, 'k', 'FE_X', 0.9)
    expect(JSON.stringify({ p: S().pfds, parked: S().parked })).toBe(snap)
  })
})

describe('staleGuard — 乱序 last-write-wins(W4)', () => {
  it('W-4 旧代序失效,新代序有效', () => {
    const g = makeStaleGuard()
    const t1 = g.begin()
    const t2 = g.begin()
    expect(g.isCurrent(t1)).toBe(false)
    expect(g.isCurrent(t2)).toBe(true)
  })
})

describe('失效依赖源码级锁(R1/R2)', () => {
  it('R-1 EventTreeEditor 结果失效依赖含 linked 与 etEngineOptions', () => {
    const src = readFileSync('src/components/EventTreeEditor.tsx', 'utf-8')
    // P4-A ③后形状:失效 effect 含结果清空 + 在途作废两段,锁改为两事实独立断言
    // (依赖数组含完整分析上下文;effect 体内既清结果也 begin 作废在途)。
    expect(src).toMatch(/setEngineSeq\(null\)[\s\S]{0,200}\[model, linked, etEngineOptions\]/)
    expect(src).toMatch(/quantGuard\.begin\(\); impGuard\.begin\(\)/)
  })

  it('R-2 EtaWorkbench 设置重置依赖含 workspaceId', () => {
    const src = readFileSync('src/features/eta/EtaWorkbench.tsx', 'utf-8')
    expect(src).toMatch(/setSettings\(EMPTY_SETTINGS\)[\s\S]{0,80}\[wsId, activeKey\]/)
  })
})
