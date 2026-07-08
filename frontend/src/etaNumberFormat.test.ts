import { describe, expect, it } from 'vitest'
import { formatEtaNumber } from './etaNumberFormat'

describe('formatEtaNumber', () => {
  it('普通量级固定保留 6 位小数', () => {
    expect(formatEtaNumber(1)).toBe('1.000000')
    expect(formatEtaNumber(0.1234567)).toBe('0.123457')
    expect(formatEtaNumber(0.000001)).toBe('0.000001')
  })

  it('小于 1e-6 的非零数使用科学计数法', () => {
    expect(formatEtaNumber(1e-7)).toBe('1.000000e-7')
    expect(formatEtaNumber(2.3456789e-8)).toBe('2.345679e-8')
    expect(formatEtaNumber(-9e-9)).toBe('-9.000000e-9')
  })

  it('零和非法数值使用稳定展示', () => {
    expect(formatEtaNumber(0)).toBe('0.000000')
    expect(formatEtaNumber(Number.NaN)).toBe('—')
    expect(formatEtaNumber(Number.POSITIVE_INFINITY)).toBe('—')
  })
})
