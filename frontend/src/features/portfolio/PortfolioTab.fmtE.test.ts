import { describe, it, expect } from 'vitest'
import { fmtE } from './portfolioFmt'

describe('PortfolioTab.fmtE — 零风险 ≠ 未量化', () => {
  it('合法 0 显示为科学计数(非 —)', () => {
    expect(fmtE(0)).toBe((0).toExponential(2))
    expect(fmtE(0)).not.toBe('—')
    expect(fmtE(0)).toMatch(/^0\.0+e\+0$/)
  })
  it('undefined / null 才显示 —', () => {
    expect(fmtE(undefined)).toBe('—')
    expect(fmtE(null)).toBe('—')
  })
  it('常规正数照常科学计数', () => {
    expect(fmtE(1.2e-3)).toBe('1.20e-3')
    expect(fmtE(5e-7)).toBe('5.00e-7')
  })
})
