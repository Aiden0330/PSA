/** 屏障库引用快照 + 手改失效锁测(规格 2026-07-25-barrier-snapshot-provenance)。
 *
 * 证据链声明:"从库引用时快照 grade;手改数值即清快照(按 D 计并标注)"。
 * 此前实现只快照 name/pfd/citation —— 用户在节点上看到的置信/口径警示为空,
 * F-1(H₂ 预警证伪)只能靠改条目名兜底。本测把声明钉进实现。
 */
import { describe, expect, it } from 'vitest'
import { addBarrierFromLib, applyFieldUpdate, newBlankEta, setFailProb } from './eventtree'
import type { LibBarrier } from './eventtree'

const FULL: LibBarrier = {
  id: 'B_GAS_DET', name: '气体探测(H₂/CO)—— 探测可靠性口径,非 TR 前预警', pfd: 0.07,
  grade: 'D', category: 'warning',
  source: { citation: 'UL 9540A 排气特性研究', url: 'https://www.ul.com/services/ul-9540a-test-method', note: 'pfd 为探测可靠性,非 TR 前预警能力' },
}

describe('addBarrierFromLib 快照', () => {
  it('grade/category/note/url/citation 全部随节点走', () => {
    const m = addBarrierFromLib(newBlankEta('测试'), FULL)
    const fe = m.functionalEvents[m.functionalEvents.length - 1]
    expect(fe.failProb).toBe(0.07)
    expect(fe.grade).toBe('D')
    expect(fe.category).toBe('warning')
    expect(fe.note).toBe('pfd 为探测可靠性,非 TR 前预警能力')
    expect(fe.url).toBe('https://www.ul.com/services/ul-9540a-test-method')
    expect(fe.source).toBe('UL 9540A 排气特性研究')
  })

  it('库条目缺省字段 ⇒ 节点不落 undefined 键(JSON 边界一致性)', () => {
    const m = addBarrierFromLib(newBlankEta('测试'), { id: 'B_X', name: '裸条目', pfd: 0.1 })
    const fe = m.functionalEvents[m.functionalEvents.length - 1]
    for (const k of ['grade', 'category', 'note', 'url', 'source']) {
      expect(Object.prototype.hasOwnProperty.call(fe, k), k).toBe(false)
    }
  })
})

describe('setFailProb 手改失效', () => {
  const base = () => {
    const m = addBarrierFromLib(newBlankEta('测试'), FULL)
    return { m, idx: m.functionalEvents.length - 1 }
  }

  it('值变化且有 grade ⇒ D + 标注,出处字段保留', () => {
    const { m, idx } = base()
    const out = setFailProb(m, idx, 0.2)
    const fe = out.functionalEvents[idx]
    expect(fe.failProb).toBe(0.2)
    expect(fe.grade).toBe('D')
    expect(fe.evidence).toContain('手改数值')
    expect(fe.evidence).toContain('0.07')          // 原值入标注
    expect(fe.source).toBe(FULL.source!.citation)  // 出处不因手改消失
    expect(fe.url).toBe(FULL.source!.url)
    expect(fe.note).toBe(FULL.source!.note)
  })

  it('高置信快照被手改 ⇒ 降 D 且标注原 grade', () => {
    const m0 = addBarrierFromLib(newBlankEta('测试'), { ...FULL, grade: 'C' })
    const idx = m0.functionalEvents.length - 1
    const fe = setFailProb(m0, idx, 0.11).functionalEvents[idx]
    expect(fe.grade).toBe('D')
    expect(fe.evidence).toContain('C')
  })

  it('值未变 ⇒ 恒等(不误标)', () => {
    const { m, idx } = base()
    const fe = setFailProb(m, idx, 0.07).functionalEvents[idx]
    expect(fe.grade).toBe('D')
    expect(fe.evidence).toBeUndefined()
  })

  it('无 grade 的普通屏障 ⇒ 只改值,不生标注', () => {
    const m0 = addBarrierFromLib(newBlankEta('测试'), { id: 'B_X', name: '裸条目', pfd: 0.1 })
    const idx = m0.functionalEvents.length - 1
    const fe = setFailProb(m0, idx, 0.3).functionalEvents[idx]
    expect(fe.failProb).toBe(0.3)
    expect(fe.grade).toBeUndefined()
    expect(fe.evidence).toBeUndefined()
  })

  it('钳位后与原值相同(>1 → 1 → 与原值 1 相同)不触发失效', () => {
    const m0 = addBarrierFromLib(newBlankEta('测试'), { ...FULL, pfd: 1 })
    const idx = m0.functionalEvents.length - 1
    const fe = setFailProb(m0, idx, 7).functionalEvents[idx]
    expect(fe.failProb).toBe(1)
    expect(fe.evidence).toBeUndefined()
  })

  it('贝叶斯 applyFieldUpdate 路径不受扰(仍可设 A + 证据)', () => {
    const { m, idx } = base()
    const fe = applyFieldUpdate(m, idx, { failProb: 0.03, grade: 'A', evidence: '现场 N=200/k=5' })
      .functionalEvents[idx]
    expect(fe.grade).toBe('A')
    expect(fe.evidence).toBe('现场 N=200/k=5')
  })
})
