import { C_COLOR } from '../../riskmatrix'
import { gradeLabel } from '../../eventtree'
import { formatEtaNumber, formatEtaRate } from '../../etaNumberFormat'
import type { EtaSummary } from '../EventTreeEditor'

const mono = 'var(--psa-font-mono)'

/** 参与汇总的 ETA 勾选清单 + ≥III 累计页脚(纯展示,勾选/切换上抛)。 */
export function EtaSummaryList(
  { etaSummaries, aggSevere, onSelectEta, onToggleEta }: {
    etaSummaries: EtaSummary[]
    aggSevere: number
    onSelectEta?: (key: string) => void
    onToggleEta?: (key: string) => void
  },
) {
  return (
    <section className="psa-panel" style={{ width: 'var(--psa-side-w)', flexShrink: 0 }}>
      <div className="psa-ch">
        <span className="t">参与汇总的 ETA</span>
        <span className="meta">勾选计入矩阵</span>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 8 }}>
        {etaSummaries.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--psa-faint)', padding: 8 }}>暂无其他 ETA。新建后将在此勾选汇总。</div>
        ) : etaSummaries.map((e) => {
          const wc = C_COLOR[e.worstC] || '#94a3b8'
          return (
            <div key={e.key} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 10px', border: `1px solid ${e.active ? '#bcd4f5' : 'var(--psa-line)'}`, borderRadius: 8, marginBottom: 7, background: e.active ? 'var(--psa-primary-soft)' : 'var(--psa-surface)' }}>
              <span onClick={() => onToggleEta?.(e.key)} title="计入汇总矩阵"
                style={{ width: 18, height: 18, borderRadius: 5, border: `1.5px solid ${e.checked ? 'var(--psa-primary)' : 'var(--psa-line-strong)'}`, background: e.checked ? 'var(--psa-primary)' : 'var(--psa-surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
                {e.checked && <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M5 12l5 5 9-11" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>}
              </span>
              <div onClick={() => onSelectEta?.(e.key)} style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 12.5, fontWeight: e.active ? 600 : 500, color: 'var(--psa-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.name}</span>
                  {e.active && <span style={{ fontSize: 9, color: 'var(--psa-primary)', background: 'var(--psa-primary-soft)', padding: '0 5px', borderRadius: 4, flexShrink: 0 }}>当前</span>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                  <span className="psa-chip"><span className="sq" style={{ background: wc }} />{gradeLabel(e.worstC)}</span>
                  <span className="psa-num" style={{ fontSize: 10.5, color: 'var(--psa-ink-2)' }}>{e.worstFreq > 0 ? formatEtaRate(e.worstFreq) : '—'}</span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
      <div style={{ flexShrink: 0, borderTop: '1px solid var(--psa-line)', background: 'var(--psa-soft-2)', padding: '9px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, color: 'var(--psa-muted)' }}>汇总 ≥III 累计</span>
        <span style={{ fontFamily: mono, fontSize: 13, fontWeight: 600, color: 'var(--psa-amber)' }}>{aggSevere > 0 ? formatEtaNumber(aggSevere) : '—'} <span style={{ fontSize: 10, color: 'var(--psa-faint)' }}>/yr</span></span>
      </div>
    </section>
  )
}
