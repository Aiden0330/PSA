import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { listProjectCases, listProjectVersions } from '../../api'
import type { CaseInfo, ScenarioItem, VersionInfo } from '../../api'
import type { EtaSummary } from '../../components/EventTreeEditor'
import { RiskMatrix } from '../../components/RiskMatrix'
import { RiskSummary } from '../../components/RiskSummary'
import { Icon } from '../../components/icons'
import { gradeLabel } from '../../eventtree'
import { formatEtaNumber, formatEtaRate } from '../../etaNumberFormat'
import { C_COLOR } from '../../riskmatrix'
import { useViewStore } from '../../stores/viewStore'
import { useActiveEta } from '../../stores/useActiveEta'
import type { ProjectPersistence } from '../persistence/useProjectPersistence'

const mono = 'var(--psa-font-mono)'

/**
 * 项目驾驶舱(外壳决策记录 B → 项目落地页):KPI 带 + ETA 卡片网格 + 汇总矩阵
 * + 版本/案例活动流(ADR-2 数据)。多 ETA 汇总视图的演进形。
 */
export function ProjectCockpit(
  { summaries, aggregateTotals, scenarios, persistence, onOpenScenario }: {
    summaries: EtaSummary[]
    aggregateTotals: Record<string, number>
    scenarios: ScenarioItem[]
    persistence: ProjectPersistence
    onOpenScenario: (val: string) => void
  },
) {
  const setTab = useViewStore((s) => s.setTab)
  const { P } = useActiveEta()
  const [versions, setVersions] = useState<VersionInfo[]>([])
  const [cases, setCases] = useState<CaseInfo[]>([])
  const pu = persistence.projectUuid
  useEffect(() => {
    if (!pu) { setVersions([]); setCases([]); return }
    listProjectVersions(pu).then(setVersions).catch(() => setVersions([]))
    listProjectCases(pu).then(setCases).catch(() => setCases([]))
  }, [pu])

  const aggSevere = (aggregateTotals.C4 ?? 0) + (aggregateTotals.C5 ?? 0)
  const checkedCount = summaries.filter((s) => s.checked).length
  const projName = persistence.saved.find((s) => s.id === persistence.savedId)?.name ?? '未存档项目'
  const openEta = (key: string) => { P().setActive(key); setTab('bess') }

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: 'var(--psa-bg)', padding: 18 }}>
      {/* 抬头 + 快捷动作 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--psa-ink)' }}>{projName}</div>
          <div style={{ fontSize: 11.5, color: 'var(--psa-faint)', fontFamily: mono }}>
            {pu ? `项目 ${pu.slice(0, 8)} · ${versions.length} 版本 · ${cases.length} 分析案例` : '保存项目后进入版本库(版本/案例/审计)'}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => setTab('bess')} className="psa-btn psa-btn--primary"><Icon name="bolt" size={14} />进入 ETA 画布</button>
          <button onClick={persistence.onSaveWorkspace} className="psa-btn psa-btn--dark"><Icon name="save" size={14} />保存项目</button>
          <select value="" onChange={(e) => { if (e.target.value) { onOpenScenario(e.target.value); e.currentTarget.value = '' } }} style={sel} title="打开内置场景为新页签">
            <option value="">打开场景…</option>
            {scenarios.map((s) => <option key={s.id} value={'sc:' + s.id}>{s.name}</option>)}
          </select>
          <select value={persistence.savedId} onChange={(e) => { if (e.target.value) persistence.loadProject(e.target.value) }} style={sel} title="打开项目存档">
            <option value="">打开存档…</option>
            {persistence.saved.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </div>

      {/* KPI 带 */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        {[
          { label: '事件树(ETA)', value: String(summaries.length), unit: '个' },
          { label: '汇总中', value: String(checkedCount), unit: '个' },
          { label: '严重后果(≥IV)累计', value: aggSevere > 0 ? formatEtaNumber(aggSevere) : '—', unit: '/yr' },
          { label: '模型版本', value: pu ? String(versions.length) : '—', unit: '' },
          { label: '分析案例', value: pu ? String(cases.length) : '—', unit: '' },
        ].map((k, i) => (
          <div key={i} className="psa-kpi" style={{ minWidth: 150 }}>
            <span className="l">{k.label}</span>
            <span className="v">{k.value}<small>{k.unit}</small></span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* ETA 卡片网格 */}
        <div style={{ flex: '2 1 420px', minWidth: 320 }}>
          <div style={secHead}>事件树</div>
          {summaries.length === 0 && (
            <div className="psa-panel" style={{ padding: 14, fontSize: 12.5, color: 'var(--psa-muted)', marginBottom: 10 }}>
              正在载入默认场景…(若后端未就绪会自动创建空白 ETA 并在顶部提示)
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 10 }}>
            {summaries.map((s) => (
              <div key={s.key} onClick={() => openEta(s.key)} className="psa-panel" style={{ padding: 12, cursor: 'pointer', border: s.active ? '1px solid var(--psa-primary)' : undefined }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: C_COLOR[s.worstC] ?? '#94a3b8', flexShrink: 0 }} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--psa-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</span>
                  {s.active && <span style={{ fontSize: 9, color: 'var(--psa-primary)', background: 'var(--psa-primary-soft)', padding: '0 5px', borderRadius: 4, flexShrink: 0 }}>当前</span>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 11, color: 'var(--psa-muted)' }}>
                  <span>{s.leafCount} 序列</span>
                  <span className="psa-chip"><span className="sq" style={{ background: C_COLOR[s.worstC] ?? '#94a3b8' }} />{gradeLabel(s.worstC)}</span>
                  <span className="psa-num" style={{ marginLeft: 'auto', color: 'var(--psa-ink-2)' }}>{s.worstFreq > 0 ? formatEtaRate(s.worstFreq) : '—'}</span>
                </div>
              </div>
            ))}
          </div>

          <div style={{ ...secHead, marginTop: 16 }}>版本 / 案例活动(证据链)</div>
          {!pu ? (
            <div className="psa-panel" style={{ padding: 14, fontSize: 12, color: 'var(--psa-muted)' }}>
              保存项目后,每次保存成为一个内容寻址版本,每次报告导出自动钉扎为分析案例——报告页脚可回溯到确切模型版本。
            </div>
          ) : (
            <div className="psa-panel" style={{ padding: 8, fontSize: 12 }}>
              {[...cases.map((c) => ({ t: c.created_at, node: `分析案例 #${c.id} · ${c.kind} · 引擎 ${c.engine_version}${pinBindingLabel(c.settings_json)}` })),
                ...versions.map((v) => ({ t: v.created_at, node: `版本 ${v.content_hash.slice(0, 8)} · ${v.origin === 'auto_pin' ? '报告钉扎' : v.origin === 'import' ? '导入' : '保存'}` }))]
                .sort((a, b) => (a.t < b.t ? 1 : -1)).slice(0, 8)
                .map((r, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, padding: '5px 8px', borderBottom: '1px solid var(--psa-line)', alignItems: 'center' }}>
                    <span style={{ fontFamily: mono, fontSize: 10.5, color: 'var(--psa-faint)', flexShrink: 0 }}>{r.t.slice(0, 19).replace('T', ' ')}</span>
                    <span style={{ color: 'var(--psa-ink-2)' }}>{r.node}</span>
                  </div>
                ))}
              <button onClick={() => setTab('report')} className="psa-btn" style={{ margin: 8 }}>查看报告与证据 →</button>
            </div>
          )}
        </div>

        {/* 汇总矩阵 */}
        <div style={{ flex: '1 1 340px', minWidth: 300 }}>
          <div style={secHead}>风险矩阵 · 多 ETA 汇总({checkedCount} 个)</div>
          <div className="psa-panel" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <RiskMatrix totals={aggregateTotals} />
            <RiskSummary totals={aggregateTotals} etaCount={checkedCount} />
          </div>
        </div>
      </div>
    </div>
  )
}

/** F3 收口二轮 D-2:绑定强度在台账可辨——硬核验(request_hash_verified)/仅落卷
 *  (recorded_only,checked_set 聚合)/F3 之前的历史案例(无标记)三态不混同。 */
function pinBindingLabel(settingsJson?: string): string {
  if (!settingsJson) return ''
  try {
    const b = JSON.parse(settingsJson)?.pin_binding
    if (b === 'request_hash_verified') return ' · 绑定已核验'
    if (b === 'recorded_only') return ' · 绑定仅记录'
  } catch { /* 旧案例/异形 settings:不标注,不臆造 */ }
  return ''
}

const secHead: CSSProperties = { fontSize: 12, fontWeight: 700, color: 'var(--psa-muted)', textTransform: 'uppercase', letterSpacing: '.5px', margin: '0 0 8px 2px' }
const sel: CSSProperties = { height: 30, border: '1px solid var(--psa-line-strong)', borderRadius: 7, padding: '0 8px', fontSize: 12.5, color: 'var(--psa-ink)', background: 'var(--psa-surface)' }
