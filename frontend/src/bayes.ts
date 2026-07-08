// 现场数据贝叶斯更新(屏障 PFD,Beta-二项共轭)。纯前端、可离线。
// 由需求次数 N 与失败次数 k,在 Beta 先验上得后验,给出后验均值与单侧上限。

/** ln Γ(x),Lanczos 近似。 */
function gammaln(x: number): number {
  const cof = [76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5]
  let y = x
  let tmp = x + 5.5
  tmp -= (x + 0.5) * Math.log(tmp)
  let ser = 1.000000000190015
  for (let j = 0; j < 6; j++) { y++; ser += cof[j] / y }
  return -tmp + Math.log(2.5066282746310005 * ser / x)
}

/** 连分式(Numerical Recipes betacf),供正则化不完全 Beta 用。 */
function betacf(a: number, b: number, x: number): number {
  const MAXIT = 200, EPS = 3e-12, FPMIN = 1e-300
  const qab = a + b, qap = a + 1, qam = a - 1
  let c = 1
  let d = 1 - qab * x / qap
  if (Math.abs(d) < FPMIN) d = FPMIN
  d = 1 / d
  let h = d
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2))
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d; h *= d * c
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    const del = d * c; h *= del
    if (Math.abs(del - 1) < EPS) break
  }
  return h
}

/** 正则化不完全 Beta 函数 I_x(a,b) = P(Beta(a,b) ≤ x)。 */
export function betai(a: number, b: number, x: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const bt = Math.exp(gammaln(a + b) - gammaln(a) - gammaln(b) + a * Math.log(x) + b * Math.log(1 - x))
  return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b
}

/** Beta(a,b) 的 p 分位(I_x 的反函数,二分)。 */
export function betaQuantile(p: number, a: number, b: number): number {
  if (p <= 0) return 0
  if (p >= 1) return 1
  let lo = 0, hi = 1
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2
    if (betai(a, b, mid) < p) lo = mid; else hi = mid
  }
  return (lo + hi) / 2
}

export type BayesPrior = 'current' | 'jeffreys'
export interface BayesInput { pfd: number; N: number; k: number; prior: BayesPrior; n0?: number }
export interface BayesResult { a0: number; b0: number; alpha: number; beta: number; mean: number; p90: number; p95: number }

// ── Poisson-Gamma 共轭(器件失效率 / 初因频率) ──────────────────────────────

/** 正则化不完全 Gamma 函数 P(a, x) = gammp(a, x),级数展开(x < a+1)。 */
function gammaSeries(a: number, x: number): number {
  if (x <= 0) return 0
  let ap = a, sum = 1 / a, del = 1 / a
  for (let n = 1; n <= 300; n++) {
    ap++; del *= x / ap; sum += del
    if (Math.abs(del) < Math.abs(sum) * 3e-12) break
  }
  return sum * Math.exp(-x + a * Math.log(x) - gammaln(a))
}

/** 正则化不完全 Gamma 函数 P(a, x) 的连分式(x >= a+1,计算 1−Q)。 */
function gammaCF(a: number, x: number): number {
  const FPMIN = 1e-300
  let b = x + 1 - a, c = 1 / FPMIN, d = 1 / b, h = d
  for (let i = 1; i <= 300; i++) {
    const an = -i * (i - a); b += 2
    d = an * d + b; if (Math.abs(d) < FPMIN) d = FPMIN
    c = b + an / c; if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d; const del = d * c; h *= del
    if (Math.abs(del - 1) < 3e-12) break
  }
  return 1 - Math.exp(-x + a * Math.log(x) - gammaln(a)) * h
}

/** P(a, x) = P(Gamma(a,1) ≤ x):正则化不完全 Gamma。 */
function gammp(a: number, x: number): number {
  if (x < 0 || a <= 0) return 0
  if (x === 0) return 0
  return x < a + 1 ? gammaSeries(a, x) : gammaCF(a, x)
}

/** Gamma(shape, rate) 分布的 p 分位(二分求逆 gammp)。
 *  shape = α, rate = β → 均值 α/β;等价于对 Gamma(α,1)/β 求分位。 */
export function gammaQuantile(p: number, shape: number, rate: number): number {
  if (p <= 0) return 0
  if (p >= 1) return Infinity
  // 对 X = Gamma(shape,1) 二分,然后除以 rate
  let lo = 0, hi = shape / rate * 10 + 20 / rate
  // 宽化 hi 保证覆盖
  for (let i = 0; i < 10; i++) { if (gammp(shape, hi * rate) < p) hi *= 4; else break }
  for (let i = 0; i < 120; i++) {
    const mid = (lo + hi) / 2
    if (gammp(shape, mid * rate) < p) lo = mid; else hi = mid
    if ((hi - lo) < 1e-14 * (1 + lo)) break
  }
  return (lo + hi) / 2
}

export interface RateInput { rate: number; T: number; k: number; prior: BayesPrior; n0?: number }
export interface RateResult { alpha: number; beta: number; mean: number; p90: number; p95: number }

/** 失效率/频率的 Poisson-Gamma 后验。
 *  prior='current':α0=rate*n0, β0=n0(先验均值=rate, n0 为等效先验曝露长度)。
 *  prior='jeffreys':α0=0.5, β0≈1e-9(无信息先验)。
 *  数据:曝露 T 内发生 k 次 → 后验 Gamma(α0+k, β0+T)。 */
export function posteriorRate(inp: RateInput): RateResult {
  const n0 = inp.n0 != null && inp.n0 > 0 ? inp.n0 : 2
  let a0: number, b0: number
  if (inp.prior === 'jeffreys') {
    a0 = 0.5; b0 = 1e-9
  } else {
    const r = Math.max(1e-15, inp.rate)
    a0 = r * n0; b0 = n0
  }
  const T = Math.max(0, inp.T)
  const k = Math.max(0, Math.floor(inp.k))
  const alpha = a0 + k
  const beta = b0 + T
  const mean = alpha / beta
  return { alpha, beta, mean, p90: gammaQuantile(0.90, alpha, beta), p95: gammaQuantile(0.95, alpha, beta) }
}

/** 屏障 PFD 的 Beta-二项后验。
 *  prior='current':以当前 PFD 为先验均值、强度 n0(等效伪样本)→ Beta(pfd·n0,(1−pfd)·n0)。
 *  prior='jeffreys':无信息先验 Beta(0.5,0.5)。
 *  数据:N 次需求中 k 次失败 → 后验 Beta(a0+k, b0+N−k)。 */
export function posteriorPfd(inp: BayesInput): BayesResult {
  const n0 = inp.n0 != null && inp.n0 > 0 ? inp.n0 : 2
  let a0: number, b0: number
  if (inp.prior === 'jeffreys') { a0 = 0.5; b0 = 0.5 } else {
    const p = Math.min(0.999, Math.max(1e-6, inp.pfd))
    a0 = Math.max(p * n0, 1e-3); b0 = Math.max((1 - p) * n0, 1e-3)
  }
  const N = Math.max(0, Math.floor(inp.N))
  const k = Math.max(0, Math.min(Math.floor(inp.k), N))
  const alpha = a0 + k, beta = b0 + (N - k)
  return { a0, b0, alpha, beta, mean: alpha / (alpha + beta), p90: betaQuantile(0.90, alpha, beta), p95: betaQuantile(0.95, alpha, beta) }
}
