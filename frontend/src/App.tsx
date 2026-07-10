import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { getScenarios } from './api'
import type { ScenarioItem } from './api'
import { ConsequencesTab } from './components/ConsequencesTab'
import { FmeaWorkbench } from './components/FmeaWorkbench'
import { ParamLibrary } from './components/ParamLibrary'
import { ReferenceLibrary } from './components/ReferenceLibrary'
import { updateParam, setCcf } from './model'
import { buildScenarioTab } from './features/persistence/scenarioLoader'
import { ensureDefaultProject } from './features/persistence/bootstrap'
import { useProjectPersistence } from './features/persistence/useProjectPersistence'
import { useAiDraft } from './features/ai-draft/useAiDraft'
import { useLibrary } from './features/library/useLibrary'
import { useExampleModel } from './features/fta/useExampleModel'
import { FtaWorkbench } from './features/fta/FtaWorkbench'
import { EtaWorkbench } from './features/eta/EtaWorkbench'
import { computeSummaries, computeAggregateTotals } from './features/eta/summaries'
import { ProjectCockpit } from './features/home/ProjectCockpit'
import { ReportDossier } from './features/report/ReportDossier'
import { ProjectDrawer } from './features/shell/ProjectDrawer'
import { CommandPalette } from './features/shell/CommandPalette'
import { useViewStore } from './stores/viewStore'
import type { MainTab } from './stores/viewStore'
import { useActiveEta } from './stores/useActiveEta'

const TAB_LABELS: [MainTab, string][] = [
  ['home', '总览'], ['bess', '事件树（ETA）'], ['ft', '故障树（FTA）'], ['params', '参数库 / CCF'],
  ['library', '参考库'], ['cons', '后果'], ['fmea', 'FMEA'], ['report', '报告'],
]

/** App 壳(蓝图 §三):Provider/路由/全局 chrome;工作台与业务态在 features/。 */
export default function App() {
  const tab = useViewStore((s) => s.tab)
  const setTab = useViewStore((s) => s.setTab)
  const drawerOpen = useViewStore((s) => s.drawerOpen)
  const setDrawerOpen = useViewStore((s) => s.setDrawerOpen)
  const setPaletteOpen = useViewStore((s) => s.setPaletteOpen)
  const { etaTabs, activeKey, checkedKeys, etaPfds, etModel, writeEtModel, P } = useActiveEta()

  const [scenarios, setScenarios] = useState<ScenarioItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const { lib, bump } = useLibrary()
  const example = useExampleModel()
  const persistence = useProjectPersistence(setError, bump)

  const summaries = computeSummaries(etaTabs, activeKey, checkedKeys, etaPfds)
  const aggregateTotals = computeAggregateTotals(etaTabs, checkedKeys, etaPfds)
  const activeName = summaries.find((s) => s.active)?.name ?? 'ETA'
  const ai = useAiDraft(lib, persistence.buildPayload, activeName, persistence.projectUuid)
  // 惰性构造:buildPayload 深拷贝全部页签,若在每次渲染时求值,编辑器每击键都全量序列化(性能坑)
  const getReportContext = persistence.projectUuid
    ? () => ({ project_uuid: persistence.projectUuid, project_payload: persistence.buildPayload() })
    : undefined

  useEffect(() => { getScenarios().then(setScenarios).catch(() => {}) }, [])
  // 初次进入:默认级联作为第一个页签。竞态守护 + 失败兜底见 bootstrap.ts(2026-07-09 报障修复)
  useEffect(() => { void ensureDefaultProject(setError) }, [])
  // ⌘K / Ctrl+K 命令板
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen(!useViewStore.getState().paletteOpen)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setPaletteOpen])

  // 打开内置场景为新页签(驾驶舱/命令板共用;ETA 工作台有同款内部实现)
  const openScenario = async (val: string) => {
    if (!val) return
    if (etaTabs.some((t) => t.key === val)) { P().setActive(val); setTab('bess'); return }
    try {
      const sid = val.slice(3)
      const t = await buildScenarioTab(sid, scenarios.find((s) => s.id === sid)?.name ?? '场景')
      if (P().present.etas.some((x) => x.key === t.key)) { P().setActive(t.key) } else { P().addTab(t) }
      setTab('bess')
    } catch (e: any) { setError(String(e?.message ?? e)) }
  }

  return (
    <div style={{ height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column', background: '#eef1f4' }}>
      <header style={hdr}>
        <button onClick={() => setDrawerOpen(!drawerOpen)} title="项目树(抽屉)" style={drawerBtn}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 30, height: 30, borderRadius: 7, background: 'var(--psa-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.15)' }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M12 2c1 4-2 5-2 8a2 2 0 1 0 4 0c0-1 0-1.5.5-2 1 2 2.5 3 2.5 6a5 5 0 1 1-10 0c0-4 4-6 5-12z" fill="#fff" /></svg>
          </div>
          <div style={{ lineHeight: 1.05 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#fff', letterSpacing: '.3px' }}>BESS&nbsp;PSA</div>
            <div style={{ fontSize: 10.5, color: 'var(--psa-chrome-ink-dim)', marginTop: 1 }}>储能热失控定量风险评估</div>
          </div>
        </div>
        <nav style={{ display: 'flex', alignItems: 'center', gap: 2, background: 'rgba(0,0,0,.28)', padding: 3, borderRadius: 9, border: '1px solid rgba(255,255,255,.05)' }}>
          {TAB_LABELS.map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)} style={tabBtn(tab === t)}>{label}</button>
          ))}
        </nav>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14 }}>
          <button onClick={() => setPaletteOpen(true)} title="命令板(⌘K / Ctrl+K)" style={kbdBtn}>⌘K</button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--psa-chrome-ink)' }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--psa-ok)', boxShadow: '0 0 6px var(--psa-ok)' }} />引擎就绪</div>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--psa-chrome-2)', color: 'var(--psa-chrome-ink)', fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(255,255,255,.12)' }}>ZL</div>
        </div>
      </header>

      {error && (
        <div style={errBar}>
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{error}</span>
          <button onClick={() => setError(null)} style={{ marginLeft: 'auto', border: 0, background: 'none', color: 'inherit', cursor: 'pointer', fontSize: 13 }}>✕</button>
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
        <ProjectDrawer persistence={persistence} />
        {tab === 'home' ? (
          <ProjectCockpit summaries={summaries} aggregateTotals={aggregateTotals} scenarios={scenarios} persistence={persistence} onOpenScenario={openScenario} />
        ) : tab === 'ft' ? (
          <FtaWorkbench lib={lib} ai={ai} persistence={persistence} example={example} />
        ) : tab === 'params' ? (
          <div style={{ flex: 1, minHeight: 0, background: '#fff' }}>
            {example.model && (
              <ParamLibrary
                model={example.model}
                onUpdateParam={(id, v) => example.set(updateParam(example.model!, id, v))}
                onSetCcf={(groups) => example.set(setCcf(example.model!, groups))}
              />
            )}
          </div>
        ) : tab === 'library' ? (
          <div style={{ flex: 1, minHeight: 0, background: '#fff' }}>
            <ReferenceLibrary onLibraryChange={bump} />
          </div>
        ) : tab === 'cons' ? (
          <div style={{ flex: 1, minHeight: 0, background: '#fff' }}>
            {etModel ? <ConsequencesTab model={etModel} onChange={writeEtModel} /> : <p style={{ padding: 16 }}>加载中…</p>}
          </div>
        ) : tab === 'fmea' ? (
          <FmeaWorkbench
            etModel={etModel}
            lib={lib}
            rows={persistence.fmeaRows}
            onRowsChange={persistence.persistFmeaRows}
            mapping={persistence.fmeaMapping}
            onMappingChange={persistence.persistFmeaMapping}
          />
        ) : tab === 'report' ? (
          <ReportDossier persistence={persistence} />
        ) : (
          <EtaWorkbench lib={lib} ai={ai} persistence={persistence} scenarios={scenarios}
            summaries={summaries} aggregateTotals={aggregateTotals} activeName={activeName}
            onError={setError} getReportContext={getReportContext} />
        )}
      </div>

      <footer className="psa-statusbar">
        <span className="psa-dot" style={{ background: 'var(--psa-ok)' }} />引擎就绪<span>·</span>
        <span>{TAB_LABELS.find(([t]) => t === tab)?.[1] ?? ''}</span>
        {persistence.projectUuid && <span style={{ marginLeft: 10 }} className="psa-num">项目 {persistence.projectUuid.slice(0, 8)}</span>}
        <span style={{ marginLeft: 'auto' }} className="psa-num">v2.0</span>
      </footer>

      <CommandPalette scenarios={scenarios} summaries={summaries} persistence={persistence} onOpenScenario={openScenario} />
    </div>
  )
}

const hdr: CSSProperties = { display: 'flex', alignItems: 'center', gap: 14, padding: '0 16px', minHeight: 54, flexShrink: 0, background: 'var(--psa-chrome)', borderBottom: '1px solid #000' }
const tabBtn = (active: boolean): CSSProperties => ({ background: active ? 'var(--psa-primary)' : 'transparent', color: active ? '#fff' : 'var(--psa-chrome-ink)', border: 0, borderRadius: 6, padding: '6px 14px', fontSize: 13, fontWeight: active ? 500 : 400, cursor: 'pointer', whiteSpace: 'nowrap', boxShadow: active ? '0 1px 0 rgba(255,255,255,.2) inset,0 1px 3px rgba(0,0,0,.35)' : 'none' })
const drawerBtn: CSSProperties = { width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.28)', color: 'var(--psa-chrome-ink)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 7, cursor: 'pointer' }
const kbdBtn: CSSProperties = { height: 26, padding: '0 9px', background: 'rgba(0,0,0,.28)', color: 'var(--psa-chrome-ink)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 6, cursor: 'pointer', fontSize: 11.5, fontFamily: 'var(--psa-font-mono)' }
const errBar: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 16px', background: 'var(--psa-danger-soft)', color: 'var(--psa-danger-strong)', fontSize: 12.5, borderBottom: '1px solid rgba(220,38,38,.2)', flexShrink: 0 }
