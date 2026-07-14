// 组合总览的方法学纯函数(R5)。抽出以便锁测——尤其 bgLevel 复用了后端
// report_export._risk_level 的 4/9/14 阈值,单测锁死可接受准则热区避免口径漂移。

export type RiskLevel = 'low' | 'medium' | 'high' | 'extreme'
export const LEVEL_ORDER: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2, extreme: 3 }
export const SEV_RANK: Record<string, number> = { C1: 1, C2: 2, C3: 3, C4: 4, C5: 5 }

/** 可接受准则热区评级 —— 与 report_export._risk_level(sev_rank, freq_rank) 同一阈值。
 *  freqRank 为 1-based(F1=1 … F5=5),与报告矩阵一致。 */
export function bgLevel(sevRank: number, freqRank: number): RiskLevel {
  const s = sevRank * freqRank
  if (s <= 4) return 'low'
  if (s <= 9) return 'medium'
  if (s <= 14) return 'high'
  return 'extreme'
}

/** C≥3 累计 = C3+C4+C5 端态频率之和。事件树端态互斥,频率可直接相加(区别于概率:
 *  概率并集须 1−Π(1−q),频率并集是求和)。 */
export function cGE3(cons: Record<string, number>): number {
  return (cons.C3 || 0) + (cons.C4 || 0) + (cons.C5 || 0)
}

export interface WorstCell { severity: string; level: RiskLevel }

/** 两格取更劣:先比风险评级,平手取更高后果级(避免把低后果格当组合最劣)。 */
export function worseCell<T extends WorstCell>(a: T | null, b: T | null): T | null {
  if (!a) return b
  if (!b) return a
  if (LEVEL_ORDER[b.level] > LEVEL_ORDER[a.level]) return b
  if (LEVEL_ORDER[b.level] === LEVEL_ORDER[a.level] && SEV_RANK[b.severity] > SEV_RANK[a.severity]) return b
  return a
}
