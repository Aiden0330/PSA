import type { CSSProperties, ReactNode } from 'react'
import { riskSummary, ZONE_COLORS, ZONE_LABEL, C_COLOR } from '../riskmatrix'
import { gradeLabel } from '../eventtree'
import type { Zone } from '../riskmatrix'
import { formatEtaRate } from '../etaNumberFormat'

const mono = 'var(--psa-font-mono)'
const ZONE_VERDICT: Record<Zone, string> = { A: '需立即处置', B: '需控制', C: '可接受' }

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 11.5 }}>
      <span style={{ color: 'var(--psa-muted)' }}>{label}</span>{children}
    </div>
  )
}

const pill: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--psa-muted)', background: 'var(--psa-soft)', borderRadius: 5, padding: '2px 8px' }

export function RiskSummary({ totals, etaCount }: { totals: Record<string, number>; etaCount?: number }) {
  const s = riskSummary(totals)
  return (
    <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 9, paddingTop: 12, borderTop: '1px dashed var(--psa-line-2)' }}>
      <div style={{ fontSize: 11, color: 'var(--psa-muted)' }}>风险摘要{etaCount != null ? ` · ${etaCount} 个 ETA` : ''}</div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11.5, color: 'var(--psa-muted)' }}>最终评价</span>
        {s.overall ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13.5, fontWeight: 600, color: 'var(--psa-ink)' }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: ZONE_COLORS[s.overall], border: '1px solid rgba(15,25,40,.15)' }} />
            {ZONE_LABEL[s.overall]} · {ZONE_VERDICT[s.overall]}
          </span>
        ) : <span style={{ fontSize: 13, color: 'var(--psa-faint)' }}>—(无后果频率)</span>}
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {(['A', 'B', 'C'] as Zone[]).map((z) => (
          <span key={z} style={pill}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: ZONE_COLORS[z] }} />{z} 区 {s.zoneCounts[z]}
          </span>
        ))}
      </div>

      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Row label="最严重后果">
          {s.worstC
            ? <span style={{ fontFamily: mono, fontWeight: 700, color: C_COLOR[s.worstC] }}>{gradeLabel(s.worstC)} · {formatEtaRate(s.worstFreq)}</span>
            : <span style={{ color: 'var(--psa-faint)' }}>—</span>}
        </Row>
        <Row label="≥III 累计">
          <span style={{ fontFamily: mono, color: 'var(--psa-amber)' }}>{s.severe > 0 ? formatEtaRate(s.severe) : '—'}</span>
        </Row>
      </div>
    </div>
  )
}
