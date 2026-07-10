import { useEffect, useState } from 'react'
import { EChart } from './EChart'
import type { QuantifyResult } from '../api'

interface Props {
  result: QuantifyResult | null
  onCutsetClick?: (events: string[]) => void
}

export function ResultsPanel({ result, onCutsetClick }: Props) {
  const [active, setActive] = useState<number | null>(null)
  useEffect(() => { setActive(null) }, [result])

  if (!result) {
    return (
      <div style={{ padding: 16, color: 'var(--psa-muted)', fontSize: 12, lineHeight: 1.6 }}>
        选择算例后点击「量化」查看顶事件概率、最小割集与重要度。
      </div>
    )
  }
  const fv = Object.entries(result.importance)
    .map(([k, v]) => [k, v.fv] as [string, number])
    .sort((a, b) => a[1] - b[1])
  const total = result.cutsets.reduce((s, c) => s + c.probability, 0) || 1

  const tornado = {
    grid: { left: 150, right: 24, top: 8, bottom: 28 },
    xAxis: { type: 'value', name: 'Fussell-Vesely' },
    yAxis: { type: 'category', data: fv.map((x) => x[0]) },
    tooltip: { trigger: 'axis' },
    series: [{ type: 'bar', data: fv.map((x) => x[1]), itemStyle: { color: 'var(--psa-primary)' } }],
  }

  return (
    <div>
      {/* KPI: top-event probability */}
      <div style={{ padding: '12px 14px', display: 'flex', gap: 10 }}>
        <div className="psa-kpi" style={{ flex: 1 }}>
          <span className="l">顶事件概率（精确 BDD）</span>
          <span className="v">{result.probability.toExponential(3)}</span>
        </div>
        <div className="psa-kpi" style={{ flex: 'none', minWidth: 72 }}>
          <span className="l">最小割集</span>
          <span className="v">{result.cutsets.length}<small>个</small></span>
        </div>
      </div>

      {/* 4a3 后处理段:精确顶值 vs 后处理 MCS 估计,并列以免误读 */}
      {result.post && (
        <>
          <div className="psa-ch"><span className="t">后处理（MCS 级）</span><span className="meta">精确顶值不受影响</span></div>
          <div style={{ padding: '8px 14px', fontSize: 12, color: 'var(--psa-ink-2)', display: 'flex', flexWrap: 'wrap', gap: 14 }}>
            <span>删除 <b className="psa-num">{result.post.removed}</b> 条</span>
            <span>恢复 <b className="psa-num">{result.post.recovered}</b> 条</span>
            <span>REA <b className="psa-num">{result.post.probability_rea.toExponential(2)}</b></span>
            <span>MCUB <b className="psa-num">{result.post.probability_mcub.toExponential(2)}</b></span>
          </div>
        </>
      )}

      {/* Cut-set section header */}
      <div className="psa-ch">
        <span className="t">最小割集{result.post ? '（后处理后）' : ''}</span>
        <span className="meta">点击行在树上高亮</span>
      </div>

      {/* Cut-set list */}
      <div style={{ overflowX: 'auto' }}>
        {result.cutsets.map((c, i) => {
          const pct = (100 * c.probability) / total
          return (
            <div key={i}
              onClick={() => { setActive(i); onCutsetClick?.(c.events) }}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '6px 14px', cursor: 'pointer', fontSize: 12,
                borderBottom: '1px solid var(--psa-line)',
                background: active === i ? '#fff7ed' : 'transparent',
              }}>
              {/* Events */}
              <span className="psa-num" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11.5, color: 'var(--psa-ink-2)' }}>
                {'{' + c.events.join(' · ') + '}'}
              </span>
              {/* Order badge */}
              <span className="psa-tag" style={{ flexShrink: 0 }}>阶{c.order}</span>
              {/* Contribution bar + probability */}
              <div style={{ flexShrink: 0, width: 72, display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ flex: 1, height: 5, borderRadius: 3, background: 'var(--psa-line)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.min(100, pct)}%`, background: 'var(--psa-primary)', borderRadius: 3 }} />
                </div>
              </div>
              <span className="psa-num" style={{ flexShrink: 0, fontSize: 11, color: 'var(--psa-faint)', width: 38, textAlign: 'right' }}>
                {pct.toFixed(1)}%
              </span>
              <span className="psa-num" style={{ flexShrink: 0, fontSize: 11, color: 'var(--psa-ink-2)', width: 68, textAlign: 'right' }}>
                {c.probability.toExponential(2)}
              </span>
            </div>
          )
        })}
      </div>

      {/* Importance section */}
      <div className="psa-ch" style={{ marginTop: 4 }}>
        <span className="t">重要度</span>
        <span className="meta">Fussell-Vesely</span>
      </div>
      <div style={{ padding: '10px 14px' }}>
        <EChart option={tornado} height={40 + 26 * fv.length} />
      </div>
    </div>
  )
}
