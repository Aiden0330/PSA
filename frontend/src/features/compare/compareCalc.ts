/** 系统对比纯计算层(规格 2026-07-26 §1)。
 *
 * 雷达四轴 v1 全部客观量映射;分档规则**显式披露**(H 稿黄条口径:分数是辅助形状
 * 语言,不进证据链)——规则常量在此单源,UI 与 CSV 同读,改档必过锁测。
 * "CCF 暴露 / 可加固性"两轴依赖站级模型与主观准则,推迟(规格 §1 偏离记录)。
 */
import type { CompareAssembly, CompareMember } from '../../api'

export function consPlus(c: Record<string, number>): { c3p: number; c4p: number; c5: number } {
  const g = (k: string) => c[k] ?? 0
  return { c3p: g('C3') + g('C4') + g('C5'), c4p: g('C4') + g('C5'), c5: g('C5') }
}

/** 相对基准的 Δ%;基准 0/缺失时返回 null——绝不用假分母装出一个百分比。 */
export function deltaPct(v: number | null | undefined, base: number | null | undefined): number | null {
  if (v == null || base == null || base === 0) return null
  return ((v - base) / base) * 100
}

/** 频率 → 1..5 档:thresholds 为降序十倍档上界,≥首档→1,依次 +1,低于末档→5。 */
function freqScore(f: number, thresholds: number[]): number {
  for (let i = 0; i < thresholds.length; i++) if (f >= thresholds[i]) return i + 1
  return thresholds.length + 1
}

export const RADAR_AXES = [
  { key: 'c3p', label: 'C3+ 频率', rule: '≥10⁻³→1 · 10⁻⁴→2 · 10⁻⁵→3 · 10⁻⁶→4 · <10⁻⁶→5' },
  { key: 'c4p', label: 'C4+ 频率', rule: '≥10⁻⁴→1 · 10⁻⁵→2 · 10⁻⁶→3 · 10⁻⁷→4 · <10⁻⁷→5' },
  { key: 'width', label: '不确定带宽', rule: 'p95/p50 ≤2→5 · ≤3→4 · ≤5→3 · ≤8→2 · >8→1' },
  { key: 'conf', label: '数据置信', rule: 'A5/B4/C3/D1 按屏障快照构成加权平均取整' },
] as const

export interface RadarScore { c3p: number; c4p: number; width: number | null; conf: number }

export function radarScores(m: CompareMember): RadarScore {
  const c = consPlus(m.consequences)
  const c3p = freqScore(c.c3p, [1e-3, 1e-4, 1e-5, 1e-6])
  const c4p = freqScore(c.c4p, [1e-4, 1e-5, 1e-6, 1e-7])
  let width: number | null = null
  const b4 = m.bands?.C4
  if (b4 && b4.p50 > 0) {
    const r = b4.p95 / b4.p50
    width = r <= 2 ? 5 : r <= 3 ? 4 : r <= 5 ? 3 : r <= 8 ? 2 : 1
  }
  const W: Record<string, number> = { A: 5, B: 4, C: 3, D: 1, none: 1 }
  let n = 0, s = 0
  for (const [k, cnt] of Object.entries(m.grade_mix)) { n += cnt; s += (W[k] ?? 1) * cnt }
  const conf = n === 0 ? 1 : Math.min(5, Math.max(1, Math.round(s / n)))
  return { c3p, c4p, width, conf }
}

const fmt = (v: number | null | undefined) => (v == null ? '' : v.toExponential(3))

/** 证据链外带 CSV:汇总(含版本哈希/Δ%)+ 对齐门标记 + 逐屏障参数(并集行,缺席留空)。 */
export function buildCsv(asm: CompareAssembly): string {
  const ms = asm.members
  const base = ms[asm.base]
  const names = ms.map((m) => m.project.name ?? m.project.uuid.slice(0, 8))
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  const rows: string[][] = []
  // Δ 逐成员一列(基准列恒空)——单 Δ 列在 3–4 成员时会指代不明
  const dcols = names.map((n, i) => (i === asm.base ? `Δ%(${n}·基准)` : `Δ%(${n})`))
  rows.push(['section', 'item', ...names, ...dcols])
  const pad = () => ms.map(() => '')
  rows.push(['meta', 'version_hash', ...ms.map((m) => m.case.version_hash), ...pad()])
  rows.push(['meta', 'case_id', ...ms.map((m) => String(m.case.id)), ...pad()])
  const plus = ms.map((m) => consPlus(m.consequences))
  const bp = consPlus(base.consequences)
  for (const [k, get] of [['C3+', (p: ReturnType<typeof consPlus>) => p.c3p],
                          ['C4+', (p: ReturnType<typeof consPlus>) => p.c4p],
                          ['C5', (p: ReturnType<typeof consPlus>) => p.c5]] as const) {
    const ds = ms.map((_m, i) => {
      if (i === asm.base) return ''
      const dv = deltaPct(get(plus[i]), get(bp))
      return dv == null ? '' : dv.toFixed(1)
    })
    rows.push(['summary', k, ...plus.map((p) => fmt(get(p))), ...ds])
  }
  for (const g of ['A', 'B', 'C', 'D'] as const) {
    rows.push(['grade_mix', g, ...ms.map((m) => String(m.grade_mix[g] ?? 0)), ...pad()])
  }
  for (const al of asm.alignment.matched) {
    const mark = al.structural === 'divergent' ? ' ◇' : ''
    const union: string[] = []
    for (const refs of al.fe_refs) for (const r of refs) if (!union.includes(r)) union.push(r)
    for (const feRef of union) {
      const vals = ms.map((m) => {
        const t = m.etas.find((e) => e.ref === al.ref)
        const fe = t?.fes.find((f) => f.ref === feRef)
        return fe?.pfd == null ? '' : String(fe.pfd)
      })
      rows.push([`params:${al.ref}${mark}`, feRef, ...vals, ''])
    }
  }
  for (const u of asm.alignment.unmatched) {
    rows.push(['unmatched ◇', `${names[u.member]}:${u.ref}`, ...ms.map(() => ''), ''])
  }
  return rows.map((r) => r.map(esc).join(',')).join('\n')
}
