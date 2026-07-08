import type { EventTreeModel } from '../eventtree'
import { consLevel, consText, gradeLabel } from '../eventtree'
import { C_COLOR } from '../riskmatrix'
import { formatEtaRate } from '../etaNumberFormat'

const mono = 'var(--psa-font-mono)'

export interface SeqRow {
  i: number
  seq: number
  lf: { path: string[] }
  freq: number
  c: string
  path: { feId: string; outcome: 'success' | 'failure' }[]
  diff?: boolean
}

export function SequencePaths({ rows, model, selKey, onSelect }: {
  rows: SeqRow[]
  model: EventTreeModel
  selKey: string
  onSelect: (path: string[]) => void
}) {
  const sorted = [...rows].sort((a, b) => b.freq - a.freq)
  const label = (feId: string) => model.functionalEvents.find((f) => f.id === feId)?.label ?? feId
  if (sorted.length === 0) return <div style={{ fontSize: 12, color: 'var(--psa-faint)', padding: 12 }}>暂无序列。</div>
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {sorted.map((r) => {
        const lvl = consLevel(model, r.c)
        const cc = C_COLOR[lvl] || '#64748b'
        const active = selKey === r.lf.path.join('/')
        return (
          <div key={r.i} onClick={() => onSelect(r.lf.path)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', borderBottom: '1px solid var(--psa-line)', cursor: 'pointer', background: active ? 'var(--psa-primary-soft)' : 'transparent' }}>
            <span style={{ width: 20, height: 20, borderRadius: 5, background: cc, color: '#fff', fontFamily: mono, fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{r.seq}</span>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4, fontSize: 11.5, color: 'var(--psa-faint)' }}>
              初因
              {r.path.length === 0 && <span style={{ color: 'var(--psa-muted)' }}>· 直接末态</span>}
              {r.path.map((p) => (
                <span key={p.feId} className="psa-chip" title={label(p.feId)}>
                  <span style={{ color: p.outcome === 'failure' ? '#dc2626' : '#16a34a', fontWeight: 700 }}>{p.outcome === 'failure' ? '✗' : '✓'}</span>
                  <span style={{ maxWidth: 84, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label(p.feId)}</span>
                </span>
              ))}
            </div>
            <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="psa-chip"><span className="sq" style={{ background: cc }} />{gradeLabel(lvl)}</span>
              <span className="psa-num" style={{ fontSize: 11, color: 'var(--psa-ink)' }} title={consText(model, r.c)}>{r.diff ? '▶ ' : ''}{formatEtaRate(r.freq)}</span>
            </span>
          </div>
        )
      })}
    </div>
  )
}
