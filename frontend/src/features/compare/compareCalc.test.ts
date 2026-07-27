/** 系统对比纯计算层锁测(规格 2026-07-26 §1/§4)。
 *
 * 雷达分档规则是"披露的主观映射"(H 稿黄条口径):规则本身入锁,改档必须动测试——
 * 防止静默改档让两次报告的雷达不可比。CSV 是证据链外带产物,列结构入锁。
 */
import { describe, expect, it } from 'vitest'
import type { CompareAssembly, CompareMember } from '../../api'
import { buildCsv, consPlus, deltaPct, radarScores, RADAR_AXES } from './compareCalc'

const M = (over: Partial<CompareMember> = {}): CompareMember => ({
  project: { uuid: 'u1', name: '供应商A' },
  case: { id: 1, kind: 'report', created_at: 't', vid: 1, version_hash: 'f'.repeat(64) },
  consequences: { C1: 7.5e-4, C2: 6.1e-5, C3: 1.2e-5, C4: 1.6e-6, C5: 4.0e-8 },
  bands: { C4: { p05: 4.2e-7, p50: 1.6e-6, p95: 6.7e-6 } },
  grade_mix: { A: 0, B: 0, C: 1, D: 1, none: 0 },
  etas: [{ ref: 'sc:SC_ISC', name: '电芯内短', init_freq: 8.32e-4, fes: [
    { ref: 'B_OFFGAS', label: '早期离气探测+联动', pfd: 0.05, grade: 'D', citation: 'Sandia', url: null, note: null, category: 'warning' },
    { ref: 'B_BMS', label: 'BMS 三级切断', pfd: 0.10, grade: 'C', citation: null, url: null, note: null, category: null },
  ] }],
  ...over,
})

describe('consPlus 累计后果', () => {
  it('C3+/C4+/C5 为尾部求和', () => {
    const c = consPlus(M().consequences)
    expect(c.c3p).toBeCloseTo(1.2e-5 + 1.6e-6 + 4.0e-8, 12)
    expect(c.c4p).toBeCloseTo(1.6e-6 + 4.0e-8, 12)
    expect(c.c5).toBeCloseTo(4.0e-8, 12)
  })
  it('缺键按 0(旧案例可能只有部分级)', () => {
    expect(consPlus({ C4: 1e-6 }).c3p).toBeCloseTo(1e-6, 12)
  })
})

describe('deltaPct', () => {
  it('相对基准的百分比,基准为 0 或缺失 ⇒ null(不装数)', () => {
    expect(deltaPct(3.9e-6, 1.6e-6)).toBeCloseTo(143.75, 2)
    expect(deltaPct(1e-6, 0)).toBeNull()
    expect(deltaPct(null, 1e-6)).toBeNull()
  })
})

describe('radarScores 四轴分档(披露规则入锁)', () => {
  it('频率轴每十倍一档:C4+ 规则 <1e-7→5 … ≥1e-4→1;C3+ 整体高一个十倍档', () => {
    const r = radarScores(M())
    expect(r.c4p).toBe(3)     // 1.64e-6 ∈ [1e-6,1e-5) → 3
    expect(r.c3p).toBe(3)     // 1.365e-5 ∈ [1e-5,1e-4) → 3(C3+ 档表右移一个十倍)
  })
  it('带宽 p95/p50:≤2→5 ≤3→4 ≤5→3 ≤8→2 >8→1;无 bands ⇒ null', () => {
    expect(radarScores(M()).width).toBe(3)                                // 6.7e-6/1.6e-6 ≈ 4.2 → 3
    expect(radarScores(M({ bands: null })).width).toBeNull()
  })
  it('数据置信:A5/B4/C3/D1 加权平均取整', () => {
    expect(radarScores(M()).conf).toBe(2)                                 // (3+1)/2 = 2
    expect(radarScores(M({ grade_mix: { A: 2, B: 0, C: 0, D: 0, none: 0 } })).conf).toBe(5)
  })
  it('轴定义导出供 UI/报告同源', () => {
    expect(RADAR_AXES.map((a) => a.key)).toEqual(['c3p', 'c4p', 'width', 'conf'])
  })
})

describe('buildCsv', () => {
  it('汇总 + 逐屏障参数,含版本哈希与 ◇ 标记', () => {
    const asm: CompareAssembly = {
      members: [M(), M({ project: { uuid: 'u2', name: '供应商B' }, consequences: { C1: 9.7e-4, C2: 3.4e-5, C3: 1.4e-5, C4: 3.9e-6, C5: 9e-8 } })],
      base: 0,
      alignment: { matched: [{ ref: 'sc:SC_ISC', structural: 'divergent', fe_refs: [['B_OFFGAS', 'B_BMS'], ['B_OFFGAS']] }], unmatched: [] },
    }
    const csv = buildCsv(asm)
    const lines = csv.split('\n')
    expect(lines[0]).toBe('section,item,供应商A,供应商B,Δ%(供应商A·基准),Δ%(供应商B)')
    expect(csv).toContain('version_hash')
    expect(csv).toContain('ffffffff')
    expect(csv).toContain('C4+')
    expect(csv).toContain('◇')                      // divergent 标记随行
    expect(csv).toContain('B_BMS')                  // 差集屏障也要出现(成员缺失格为空)
  })
})

describe('矩阵落点档位(freqBandOf 1-based → CELLS 0-based)', () => {
  it('回归锁:8.94e-7 落"极少"下一档(几乎不可能,行 5);3.58e-4 落"偶尔"(行 2)', async () => {
    const { freqBandOf } = await import('../../riskmatrix')
    expect(freqBandOf(8.94e-7) - 1).toBe(5)
    expect(freqBandOf(3.58e-4) - 1).toBe(2)
    expect(freqBandOf(0) - 1).toBe(5)          // 零频率仍有落点,不得从图上消失
  })
})
