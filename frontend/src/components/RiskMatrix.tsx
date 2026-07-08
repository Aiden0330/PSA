import type { CSSProperties } from 'react'
import { FREQ_BANDS, SEVERITY_LABELS, CELLS, ZONE_COLORS, ZONE_LABEL, C_TO_LEVEL, freqBandOf, zoneOf } from '../riskmatrix'
import type { Zone } from '../riskmatrix'
import { formatEtaNumber } from '../etaNumberFormat'

const mono: CSSProperties = { fontFamily: 'var(--psa-font-mono)' }
const corner: CSSProperties = { padding: '4px 8px', fontSize: 9.5, color: 'var(--psa-faint)', textAlign: 'center', lineHeight: 1.2, fontWeight: 500 }
const colHead: CSSProperties = { padding: '4px 6px 9px', fontSize: 11, color: 'var(--psa-ink-2)', fontWeight: 600, textAlign: 'center', lineHeight: 1.15 }
const rowHead: CSSProperties = { padding: '4px 10px', fontSize: 11, color: 'var(--psa-muted)', fontWeight: 500, textAlign: 'right', whiteSpace: 'nowrap' }

/** 6×5 中电联安全矩阵:6 频率档(行)× 5 严重度(列), A/B/C 区域子等级。
 *  totals 为各后果类频率, 按 C_TO_LEVEL 汇到严重度列后落频率档高亮。 */
export function RiskMatrix({ totals }: { totals: Record<string, number> }) {
  const levelFreq: number[] = [0, 0, 0, 0, 0, 0]   // 索引 1..5
  for (const [c, lvl] of Object.entries(C_TO_LEVEL)) levelFreq[lvl] += totals[c] || 0
  const placedBand: (number | null)[] = [null, null, null, null, null, null]
  for (let lvl = 1; lvl <= 5; lvl++) placedBand[lvl] = levelFreq[lvl] > 0 ? freqBandOf(levelFreq[lvl]) : null
  const activeZones: Zone[] = []
  for (let lvl = 1; lvl <= 5; lvl++) if (placedBand[lvl]) activeZones.push(zoneOf(CELLS[placedBand[lvl]! - 1][lvl - 1]))
  const overall: Zone | null = activeZones.includes('A') ? 'A' : activeZones.includes('B') ? 'B' : activeZones.length ? 'C' : null

  return (
    <div>
      <table style={{ borderCollapse: 'separate', borderSpacing: 4 }}>
        <thead>
          <tr>
            <th style={corner}>频率＼<br />严重度</th>
            {SEVERITY_LABELS.map((s) => {
              const nm = s.replace(/\s*[（(][^）)]*[）)]\s*$/, '')
              const g = (s.match(/[（(]\s*([^）)]+)\s*[）)]/) || [])[1] ?? ''
              return (
                <th key={s} style={colHead}>
                  <div>{nm}</div>
                  <div style={{ fontSize: 10, color: 'var(--psa-faint)', fontFamily: 'var(--psa-font-mono)', marginTop: 1 }}>{g}</div>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {FREQ_BANDS.map((fb, ri) => (
            <tr key={ri}>
              <th style={rowHead}>
                <div>{fb.label}</div>
                <div style={{ fontSize: 9.5, color: 'var(--psa-faint)', fontFamily: 'var(--psa-font-mono)', fontWeight: 400 }}>{fb.gt == null ? '—' : '>' + formatEtaNumber(fb.gt)}</div>
              </th>
              {SEVERITY_LABELS.map((_, ci) => {
                const cell = CELLS[ri][ci]
                const z = zoneOf(cell)
                const here = placedBand[ci + 1] === ri + 1
                return (
                  <td key={ci} title={ZONE_LABEL[z]} style={{
                    width: 100, height: 44, borderRadius: 9, textAlign: 'center',
                    background: ZONE_COLORS[z], opacity: here ? 1 : 0.34,
                    border: '1px solid rgba(15,25,40,.08)',
                    fontSize: 11.5, fontWeight: here ? 700 : 500, color: 'var(--psa-ink)',
                    boxShadow: here ? 'inset 0 0 0 2px var(--psa-ink)' : 'none', lineHeight: 1.2,
                  }}>
                    {here
                      ? <span><b>{cell}</b><br /><span style={mono}>{formatEtaNumber(levelFreq[ci + 1])}</span></span>
                      : <span style={{ color: 'rgba(22,32,43,.7)' }}>{cell}</span>}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ fontSize: 11, marginTop: 10, display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        {(['A', 'B', 'C'] as Zone[]).map((z) => (
          <span key={z} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--psa-muted)' }}>
            <span style={{ display: 'inline-block', width: 13, height: 13, borderRadius: 3, background: ZONE_COLORS[z], border: '1px solid rgba(15,25,40,.15)' }} />
            {ZONE_LABEL[z]}
          </span>
        ))}
        {overall && <b style={{ color: 'var(--psa-ink)' }}>最终评价:{ZONE_LABEL[overall]}</b>}
      </div>
      <div style={{ fontSize: 10.5, color: '#8a5a00', background: '#fbf6e9', border: '1px solid #f0e2bd', padding: '7px 9px', borderRadius: 7, marginTop: 8, maxWidth: 560, lineHeight: 1.5 }}>
        ⚠ 6×5 安全矩阵(对齐中电联体系)频率档与子等级为示意默认,须按项目/法规校核。后果映射:0→I、I→II、II→III、III·IV→IV(无事故级不用)。
      </div>
    </div>
  )
}
