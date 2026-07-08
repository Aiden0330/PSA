import { describe, it, expect } from 'vitest'
import { riskSummary } from './riskmatrix'

describe('riskSummary', () => {
  it('空 totals → overall null, severe 0, worstC null, 计数全 0', () => {
    const s = riskSummary({})
    expect(s.overall).toBeNull()
    expect(s.severe).toBe(0)
    expect(s.worstC).toBeNull()
    expect(s.zoneCounts).toEqual({ A: 0, B: 0, C: 0 })
  })
  it('仅 C1 中低频 → C 区, worstC C1, severe 0', () => {
    const s = riskSummary({ C1: 1e-5 })  // C1→col2, freq 1e-5 → band5 → CELLS[4][1]='C2' → zone C
    expect(s.overall).toBe('C')
    expect(s.worstC).toBe('C1')
    expect(s.severe).toBe(0)
  })
  it('C5 高频 → A 区, worstC C5, severe 含 C5', () => {
    const s = riskSummary({ C5: 1e-1 })  // C5→col5, freq 0.1 → band1 → CELLS[0][4]='A3' → zone A
    expect(s.overall).toBe('A')
    expect(s.worstC).toBe('C5')
    expect(s.severe).toBeCloseTo(1e-1)
  })
  it('worstC 取最严重有频率类(C4 高于 C2);severe=C4+C5', () => {
    const s = riskSummary({ C2: 1e-3, C4: 1e-6 })
    expect(s.worstC).toBe('C4')
    expect(s.severe).toBeCloseTo(1e-6)
  })
  it('overall 优先级 A>B>C', () => {
    const s = riskSummary({ C5: 1e-1, C1: 1e-5 })  // A from C5, C from C1
    expect(s.overall).toBe('A')
    expect(s.zoneCounts.A).toBeGreaterThan(0)
    expect(s.zoneCounts.C).toBeGreaterThan(0)
  })
  it('C4+C5 同时存在 → worstC C5、worstFreq 仅 C5,severe=C4+C5(两行区分)', () => {
    const s = riskSummary({ C4: 2e-7, C5: 3e-8 })
    expect(s.worstC).toBe('C5')
    expect(s.worstFreq).toBeCloseTo(3e-8)
    expect(s.severe).toBeCloseTo(2.3e-7)
  })
  it('C5=0 时 worstC 落到 C4', () => {
    expect(riskSummary({ C4: 1e-6 }).worstC).toBe('C4')
  })
  it('Zone B 可达(C3 中频 5e-5 → B2)', () => {
    const s = riskSummary({ C3: 5e-5 })
    expect(s.overall).toBe('B')
    expect(s.zoneCounts.B).toBeGreaterThan(0)
  })
})
