import { describe, it, expect } from 'vitest'
import { bgLevel, cGE3, worseCell } from './portfolioMath'

describe('bgLevel — 与后端 report_export._risk_level 同源(4/9/14 阈值)', () => {
  // 逐格锁死 5×5 可接受准则热区(sevRank 1..5 × freqRank 1..5),与后端矩阵一致。
  // 任何一处阈值被误改 → 此表失配 → CI 拦截口径漂移。
  // 域评审裁决 5:此表在后端有孪生镜像 tests/backend/test_portfolio.py::
  // test_risk_level_golden_table_all_25_cells(同一张字面金表锁 _risk_level)——
  // 单侧锁只防单侧漂移,两侧必须同步修改。
  const EXPECT: Record<string, string> = {
    '1,1': 'low', '2,1': 'low', '3,1': 'low', '4,1': 'low', '5,1': 'medium',
    '1,2': 'low', '2,2': 'low', '3,2': 'medium', '4,2': 'medium', '5,2': 'high',
    '1,3': 'low', '2,3': 'medium', '3,3': 'medium', '4,3': 'high', '5,3': 'extreme',
    '1,4': 'low', '2,4': 'medium', '3,4': 'high', '4,4': 'extreme', '5,4': 'extreme',
    '1,5': 'medium', '2,5': 'high', '3,5': 'extreme', '4,5': 'extreme', '5,5': 'extreme',
  }
  it('every cell matches the report matrix', () => {
    for (let sev = 1; sev <= 5; sev++) {
      for (let frq = 1; frq <= 5; frq++) {
        expect(bgLevel(sev, frq)).toBe(EXPECT[`${sev},${frq}`])
      }
    }
  })
})

describe('cGE3 — C3+C4+C5 端态频率求和', () => {
  it('sums the three severe end states, ignores C1/C2', () => {
    expect(cGE3({ C1: 1, C2: 1, C3: 2e-4, C4: 3e-5, C5: 6e-6 })).toBeCloseTo(2e-4 + 3e-5 + 6e-6, 12)
  })
  it('missing levels treated as 0', () => {
    expect(cGE3({ C5: 5e-6 })).toBe(5e-6)
    expect(cGE3({})).toBe(0)
  })
})

describe('worseCell — 评级优先,平手取更高后果级', () => {
  it('higher risk level wins', () => {
    expect(worseCell({ severity: 'C2', level: 'high' }, { severity: 'C5', level: 'low' })!.severity).toBe('C2')
  })
  it('tie on level → higher severity wins', () => {
    // C2@medium vs C4@medium → C4(否则低后果格被当成组合最劣,误导)
    expect(worseCell({ severity: 'C2', level: 'medium' }, { severity: 'C4', level: 'medium' })!.severity).toBe('C4')
  })
  it('null-safe reduce seed', () => {
    expect(worseCell(null, { severity: 'C3', level: 'high' })!.severity).toBe('C3')
    expect(worseCell({ severity: 'C3', level: 'high' }, null)!.severity).toBe('C3')
    expect(worseCell(null, null)).toBeNull()
  })
})
