// 中电联「安全矩阵」(对齐 D:/ETA_claude DEFAULT_MATRIX): 6 频率档 × 5 严重度, 单元 A/B/C 子等级。
export const FREQ_BANDS: { label: string; gt: number | null }[] = [
  { label: '频发', gt: 1e-2 },
  { label: '经常', gt: 1e-3 },
  { label: '偶尔', gt: 1e-4 },
  { label: '罕见', gt: 1e-5 },
  { label: '极少', gt: 1e-6 },
  { label: '几乎不可能', gt: null },
]
export const SEVERITY_LABELS = ['无事故(0)', '部件级碳化(I)', 'Pack起火(II)', '箱级起火(III)', '电站起火(IV)']
export const CELLS: string[][] = [
  ['C1', 'B3', 'A1', 'A2', 'A3'],
  ['C1', 'B2', 'B3', 'A1', 'A2'],
  ['C1', 'B1', 'B2', 'B3', 'A1'],
  ['C1', 'C3', 'B1', 'B2', 'B3'],
  ['C1', 'C2', 'C3', 'B1', 'B2'],
  ['C1', 'C1', 'C2', 'C3', 'B1'],
]
export type Zone = 'A' | 'B' | 'C'
export const ZONE_COLORS: Record<Zone, string> = { A: '#ef9a9a', B: '#ffcc80', C: '#a5d6a7' }
export const ZONE_LABEL: Record<Zone, string> = { A: 'A 不可接受', B: 'B 风险缓解', C: 'C 可接受' }
export const C_COLOR: Record<string, string> = { C1: '#16a34a', C2: '#65a30d', C3: '#d97706', C4: '#ea580c', C5: '#dc2626' }
// 我的后果类 → 参考严重度级(1-based; 1=无事故 不用)
export const C_TO_LEVEL: Record<string, number> = { C1: 2, C2: 3, C3: 4, C4: 5, C5: 5 }

/** 频率落档(1-based): 首个 gt!==null 且 f>gt 的档; 否则末档(几乎不可能)。 */
export function freqBandOf(f: number): number {
  for (let i = 0; i < FREQ_BANDS.length; i++) {
    const gt = FREQ_BANDS[i].gt
    if (gt !== null && f > gt) return i + 1
  }
  return FREQ_BANDS.length
}
export function zoneOf(cell: string): Zone {
  return cell[0] as Zone
}

export interface RiskSummaryData {
  overall: Zone | null
  zoneCounts: Record<Zone, number>
  worstC: string | null
  worstFreq: number
  severe: number
}

/** 由后果频率汇总出风险摘要,与 RiskMatrix 同口径(severity 列 → 频率档 → 区域)。 */
export function riskSummary(totals: Record<string, number>): RiskSummaryData {
  const levelFreq = [0, 0, 0, 0, 0, 0]   // index 1..5
  for (const [c, lvl] of Object.entries(C_TO_LEVEL)) levelFreq[lvl] += totals[c] || 0
  const zoneCounts: Record<Zone, number> = { A: 0, B: 0, C: 0 }
  for (let lvl = 1; lvl <= 5; lvl++) {
    if (levelFreq[lvl] > 0) zoneCounts[zoneOf(CELLS[freqBandOf(levelFreq[lvl]) - 1][lvl - 1])]++
  }
  const overall: Zone | null = zoneCounts.A > 0 ? 'A' : zoneCounts.B > 0 ? 'B' : zoneCounts.C > 0 ? 'C' : null
  let worstC: string | null = null
  let worstFreq = 0
  for (const c of ['C5', 'C4', 'C3', 'C2', 'C1']) {
    if ((totals[c] || 0) > 0) { worstC = c; worstFreq = totals[c]; break }
  }
  const severe = (totals.C4 || 0) + (totals.C5 || 0)
  return { overall, zoneCounts, worstC, worstFreq, severe }
}
