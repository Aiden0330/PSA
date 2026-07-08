import { describe, it, expect } from 'vitest'
import { betai, betaQuantile, posteriorPfd, gammaQuantile, posteriorRate } from './bayes'

describe('betai 正则化不完全 Beta', () => {
  it('边界与单调', () => {
    expect(betai(2, 5, 0)).toBe(0)
    expect(betai(2, 5, 1)).toBe(1)
    expect(betai(2, 5, 0.3)).toBeLessThan(betai(2, 5, 0.6))
  })
  it('对称:I_x(a,b) = 1 − I_{1−x}(b,a)', () => {
    expect(betai(3, 7, 0.4)).toBeCloseTo(1 - betai(7, 3, 0.6), 6)
  })
  it('Beta(1,1) 均匀:I_x = x', () => {
    expect(betai(1, 1, 0.37)).toBeCloseTo(0.37, 6)
  })
})

describe('betaQuantile 反函数', () => {
  it('黄金锚点 betaQuantile(0.9,1,22) ≈ 0.0994', () => {
    expect(betaQuantile(0.9, 1, 22)).toBeCloseTo(0.0994, 3)
  })
  it('与 betai 互逆', () => {
    const q = betaQuantile(0.8, 4, 9)
    expect(betai(4, 9, q)).toBeCloseTo(0.8, 4)
  })
  it('中位数 Beta(1,1) = 0.5', () => {
    expect(betaQuantile(0.5, 1, 1)).toBeCloseTo(0.5, 6)
  })
})

describe('posteriorPfd 屏障 PFD 更新', () => {
  it('Jeffreys 先验 + 0 失败:后验均值 < 先验数据 MLE 之上、上限有界', () => {
    const r = posteriorPfd({ pfd: 0.1, N: 22, k: 0, prior: 'jeffreys' })
    expect(r.mean).toBeGreaterThan(0)
    expect(r.mean).toBeLessThan(0.1)         // 22 次零失败应把 PFD 拉低
    expect(r.p95).toBeGreaterThan(r.mean)    // 95% 上限 > 均值
    expect(r.p95).toBeLessThan(0.2)
  })
  it('当前 PFD 为先验:无数据(N=k=0)后验均值≈先验 PFD', () => {
    const r = posteriorPfd({ pfd: 0.1, N: 0, k: 0, prior: 'current', n0: 2 })
    expect(r.mean).toBeCloseTo(0.1, 2)
  })
  it('失败多 → 后验均值上抬;k 被夹到 ≤ N', () => {
    const r = posteriorPfd({ pfd: 0.05, N: 10, k: 99, prior: 'jeffreys' })
    expect(r.alpha).toBeCloseTo(0.5 + 10, 6)  // k 夹到 10
    expect(r.mean).toBeGreaterThan(0.5)
  })
  it('p90 ≤ p95', () => {
    const r = posteriorPfd({ pfd: 0.1, N: 50, k: 3, prior: 'current' })
    expect(r.p90).toBeLessThanOrEqual(r.p95)
  })
})

describe('gammaQuantile Gamma 分位', () => {
  it('黄金锚点:gammaQuantile(0.9, 1, 1) ≈ 2.302585 (= −ln0.1)', () => {
    expect(gammaQuantile(0.9, 1, 1)).toBeCloseTo(-Math.log(0.1), 4)
  })
  it('边界:p=0 → 0, p=1 → Infinity', () => {
    expect(gammaQuantile(0, 2, 1)).toBe(0)
    expect(gammaQuantile(1, 2, 1)).toBe(Infinity)
  })
  it('Gamma(2,1) 中位数 ≈ 1.678(已知值)', () => {
    expect(gammaQuantile(0.5, 2, 1)).toBeCloseTo(1.6783, 3)
  })
  it('rate 缩放:gammaQuantile(p, a, r) = gammaQuantile(p, a, 1)/r', () => {
    const r = 5
    expect(gammaQuantile(0.75, 3, r)).toBeCloseTo(gammaQuantile(0.75, 3, 1) / r, 6)
  })
})

describe('posteriorRate Poisson-Gamma 现场更新', () => {
  it('无数据(T=0,k=0)后验均值 ≈ 先验均值(current)', () => {
    const rate = 1e-4
    const r = posteriorRate({ rate, T: 0, k: 0, prior: 'current', n0: 2 })
    expect(r.mean).toBeCloseTo(rate, 8)
  })
  it('Jeffreys 先验 + 有数据:后验均值 ≈ k/T', () => {
    // k=10, T=1000 → 后验约 10/1000=0.01(b0≈0)
    const r = posteriorRate({ rate: 1e-4, T: 1000, k: 10, prior: 'jeffreys' })
    expect(r.mean).toBeCloseTo(0.01, 3)
  })
  it('失效数多 → 后验均值上抬', () => {
    const low = posteriorRate({ rate: 1e-4, T: 100, k: 0, prior: 'current', n0: 2 })
    const high = posteriorRate({ rate: 1e-4, T: 100, k: 5, prior: 'current', n0: 2 })
    expect(high.mean).toBeGreaterThan(low.mean)
  })
  it('p90 ≤ p95', () => {
    const r = posteriorRate({ rate: 1e-3, T: 50, k: 2, prior: 'current' })
    expect(r.p90).toBeLessThanOrEqual(r.p95)
  })
})
