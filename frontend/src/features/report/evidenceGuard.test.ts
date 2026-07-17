/** FE-06 锚点(核心守卫):证据链查询的"仍属当前项目 + 同类乱序 last-write-wins"守卫。
 *  切项目后的迟到响应不得提交(否则 A 的台账渲染进 B);同项目同类的旧响应不得覆盖新响应。 */
import { describe, it, expect } from 'vitest'
import { makeEvidenceGuard } from './evidenceGuard'

describe('makeEvidenceGuard', () => {
  it('切项目:A 的迟到响应作废,B 的响应有效(A 慢 B 快 → 只显 B)', () => {
    const g = makeEvidenceGuard('A')
    const hA = g.begin('A', 'versions')     // A 发起(慢)
    g.setActive('B')                        // 切到 B
    const hB = g.begin('B', 'versions')     // B 发起(快)
    expect(g.isCurrent(hB)).toBe(true)      // B 先回:提交
    expect(g.isCurrent(hA)).toBe(false)     // A 后回:作废(不串项目)
  })

  it('同项目同类乱序:旧代序作废,新代序有效', () => {
    const g = makeEvidenceGuard('A')
    const h1 = g.begin('A', 'cases')
    const h2 = g.begin('A', 'cases')
    expect(g.isCurrent(h1)).toBe(false)
    expect(g.isCurrent(h2)).toBe(true)
  })

  it('不同查询类互不误伤(各自代序)', () => {
    const g = makeEvidenceGuard('A')
    const hv = g.begin('A', 'versions')
    const hc = g.begin('A', 'cases')
    expect(g.isCurrent(hv)).toBe(true)
    expect(g.isCurrent(hc)).toBe(true)
  })

  it('切回同一项目仍作废旧句柄(pu 相同但代序已推进)', () => {
    const g = makeEvidenceGuard('A')
    const h1 = g.begin('A', 'reviews')
    g.setActive('B'); g.setActive('A')      // 离开又回来
    const h2 = g.begin('A', 'reviews')
    expect(g.isCurrent(h1)).toBe(false)     // 期间已重发,旧的作废
    expect(g.isCurrent(h2)).toBe(true)
  })

  it('pu=null(未关联版本库)句柄不冒充任何项目', () => {
    const g = makeEvidenceGuard(null)
    const h = g.begin(null, 'versions')
    expect(g.isCurrent(h)).toBe(true)
    g.setActive('A')
    expect(g.isCurrent(h)).toBe(false)
  })
})
