export interface EtKpi { label: string; value: string; unit: string }

/** 当前 ETA 的 KPI 条(纯展示)。 */
export function EtKpiStrip({ kpis }: { kpis: EtKpi[] }) {
  return (
    <div style={{ flexShrink: 0, display: 'flex', gap: 10 }}>
      {kpis.map((k, i) => (
        <div key={i} className="psa-kpi">
          <span className="l">{k.label}</span>
          <span className="v">{k.value}<small>{k.unit}</small></span>
        </div>
      ))}
    </div>
  )
}
