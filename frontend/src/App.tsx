import { Suspense, lazy, useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { getScenarios } from './api'
import type { ScenarioItem } from './api'
import { updateParam, setCcf } from './model'
import { buildScenarioTab } from './features/persistence/scenarioLoader'
import { ensureDefaultProject } from './features/persistence/bootstrap'
import { useProjectPersistence } from './features/persistence/useProjectPersistence'
import { useAiDraft } from './features/ai-draft/useAiDraft'
import { useLibrary } from './features/library/useLibrary'
import { useExampleModel } from './features/fta/useExampleModel'
import { EtaWorkbench } from './features/eta/EtaWorkbench'
import { computeSummaries, computeAggregateTotals } from './features/eta/summaries'
import { ProjectCockpit } from './features/home/ProjectCockpit'
import { MenuBar } from './features/shell/MenuBar'
import { ExplorerTree } from './features/shell/ExplorerTree'
import { StatusBar } from './features/shell/StatusBar'
import { CommandPalette } from './features/shell/CommandPalette'
import { LoginWall } from './features/shell/LoginWall'
import { AccountsPanel } from './features/shell/AccountsPanel'
import { SaveConflictDialog } from './features/shell/SaveConflictDialog'
import { ErrorBoundary } from './features/shell/ErrorBoundary'
import { useViewStore } from './stores/viewStore'
import { useActiveEta } from './stores/useActiveEta'
import { useAuthStore } from './stores/authStore'

const PortfolioTab = lazy(() => import('./features/portfolio/PortfolioTab').then((m) => ({ default: m.PortfolioTab })))
const CompareTab = lazy(() => import('./features/compare/CompareTab').then((m) => ({ default: m.CompareTab })))

// 启动关键路径(总览/ETA)不携带重库:FTA(reactflow)、参数库/FMEA(ag-grid)、
// 结果图(echarts)等页签按需分块加载 —— 新窗口只解析 ETA 所需代码(性能报障修复 2026-07-09)
const FtaWorkbench = lazy(() => import('./features/fta/FtaWorkbench').then((m) => ({ default: m.FtaWorkbench })))
const ParamLibrary = lazy(() => import('./components/ParamLibrary').then((m) => ({ default: m.ParamLibrary })))
const ReferenceLibrary = lazy(() => import('./components/ReferenceLibrary').then((m) => ({ default: m.ReferenceLibrary })))
const FmeaWorkbench = lazy(() => import('./components/FmeaWorkbench').then((m) => ({ default: m.FmeaWorkbench })))
const ConsequencesTab = lazy(() => import('./components/ConsequencesTab').then((m) => ({ default: m.ConsequencesTab })))
const ReportDossier = lazy(() => import('./features/report/ReportDossier').then((m) => ({ default: m.ReportDossier })))

function TabFallback() {
  return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--psa-faint)', fontSize: 13, background: '#fff' }}>载入模块…</div>
}

/**
 * 认证门(Phase 5 B4):PSA_AUTH=off 恒 needsLogin=false(约束 #0,含离线单文件 ——
 * getMe() 网络层异常时 authStore 同样保持 needsLogin=false,见 stores/authStore.ts);
 * local 模式未登录时,AppShell 及其数据获取 effects 一律不挂载,避免任何预登录网络噪音。
 */
export default function App() {
  // P4-C ⑤:三分支(loading / LoginWall / AppShell)统一包进最外层边界——此前根边界在
  // AppShell 内部,LoginWall/loading 渲染抛错仍是无兜底白屏。默认 fallback 可见可重试。
  return (
    <ErrorBoundary>
      <AppGate />
    </ErrorBoundary>
  )
}

function AppGate() {
  const status = useAuthStore((s) => s.status)
  const needsLogin = useAuthStore((s) => s.needsLogin)
  useEffect(() => { void useAuthStore.getState().refresh() }, [])

  if (status === 'loading') {
    return <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--psa-bg)', color: 'var(--psa-faint)', fontSize: 13 }}>加载中…</div>
  }
  if (needsLogin) return <LoginWall />
  return <AppShell />
}

/** App 壳(蓝图 §三):Provider/路由/全局 chrome;工作台与业务态在 features/。 */
function AppShell() {
  const tab = useViewStore((s) => s.tab)
  const setTab = useViewStore((s) => s.setTab)
  const setPaletteOpen = useViewStore((s) => s.setPaletteOpen)
  const { etaTabs, activeKey, checkedKeys, etaPfds, etModel, writeEtModel, P } = useActiveEta()

  const [scenarios, setScenarios] = useState<ScenarioItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [accountsOpen, setAccountsOpen] = useState(false)
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
    const wid = P().workspaceId   // R2-审 F9:await 期间切换项目 → 场景页签不落入别的项目
    try {
      const sid = val.slice(3)
      const t = await buildScenarioTab(sid, scenarios.find((s) => s.id === sid)?.name ?? '场景')
      if (P().workspaceId !== wid) return
      if (P().present.etas.some((x) => x.key === t.key)) { P().setActive(t.key) } else { P().addTab(t) }
      setTab('bess')
    } catch (e: any) { setError(String(e?.message ?? e)) }
  }

  return (
    // 最外层错误边界(白屏报障 2026-07-17):外壳(MenuBar/ExplorerTree/StatusBar)此前
    // 在 key={tab} 边界之外,任何外壳渲染抛错 = 整页白、无从定位。此层兜底:显示错误
    // 文本(报障自带定位)+ 重试;编辑内容已由 sessionDraft 暂存,刷新可恢复。
    <ErrorBoundary
      fallback={(reset, err) => (
        <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--exp-bg)' }}>
          <div className="psa-panel" style={{ padding: 24, maxWidth: 520 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>界面出现内部错误(已拦截,未白屏)</div>
            <div style={{ fontSize: 12, color: 'var(--psa-danger-strong)', fontFamily: 'var(--psa-font-mono)',
              background: 'var(--psa-danger-soft)', padding: 8, borderRadius: 6, marginBottom: 10,
              maxHeight: 120, overflow: 'auto', wordBreak: 'break-all' }}>{String(err?.message ?? err)}</div>
            <div style={{ fontSize: 12, color: 'var(--psa-muted)', lineHeight: 1.7, marginBottom: 12 }}>
              你的编辑已随会话草稿自动暂存,「重试」通常可继续;若反复出现,请刷新页面并把上面的错误文本发给开发者。
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="psa-btn psa-btn--primary" onClick={reset}>重试</button>
              <button type="button" className="psa-btn" onClick={() => window.location.reload()}>刷新页面</button>
            </div>
          </div>
        </div>
      )}>
    <div style={{ height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column', background: 'var(--exp-bg)' }}>
      <MenuBar persistence={persistence} setTab={setTab} onImportFile={persistence.onImportFile} onOpenAccounts={() => setAccountsOpen(true)} />

      {error && (
        <div style={errBar}>
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{error}</span>
          <button onClick={() => setError(null)} style={{ marginLeft: 'auto', border: 0, background: 'none', color: 'inherit', cursor: 'pointer', fontSize: 13 }}>✕</button>
        </div>
      )}

      {persistence.sessionDraft && (
        <div style={draftBar}>
          <span>会话过期时暂存的草稿「{persistence.sessionDraft.name}」({persistence.sessionDraft.at.slice(0, 19).replace('T', ' ')})—— 重新登录后可恢复,不会自动覆盖当前内容。</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexShrink: 0 }}>
            <button onClick={persistence.restoreSessionDraft} className="psa-btn psa-btn--primary" style={{ height: 24, fontSize: 11.5 }}>恢复草稿</button>
            <button onClick={() => { if (window.confirm('丢弃暂存草稿?此操作不可撤销。')) persistence.discardSessionDraft() }} className="psa-btn" style={{ height: 24, fontSize: 11.5 }}>丢弃</button>
          </div>
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
        <ExplorerTree persistence={persistence} tab={tab} setTab={setTab} />
        {/* 懒页签统一挂起点:总览/ETA 为即时组件,其余页签首次进入时按需拉块。
            FE-13:ErrorBoundary 包裹——chunk 加载失败不再留白屏/永久 loading;key={tab}
            使某页签失败不污染其他页签,切回即重试。 */}
        <ErrorBoundary key={tab}>
        <Suspense fallback={<TabFallback />}>
        {tab === 'home' ? (
          <ProjectCockpit summaries={summaries} aggregateTotals={aggregateTotals} scenarios={scenarios} persistence={persistence} onOpenScenario={openScenario} />
        ) : tab === 'portfolio' ? (
          <PortfolioTab persistence={persistence} setTab={setTab} />
        ) : tab === 'compare' ? (
          <CompareTab />
        ) : tab === 'ft' ? (
          <FtaWorkbench lib={lib} ai={ai} persistence={persistence} example={example} />
        ) : tab === 'params' ? (
          <div style={{ flex: 1, minHeight: 0, background: 'var(--exp-bg)', display: 'flex', flexDirection: 'column' }}>
            {/* FE-09:此页编辑的是全局示例模型,不进当前项目 / 报告 / 版本库——醒目告知,消除误改项目参数的错觉。 */}
            <div role="note" style={exampleBanner}>
              <span aria-hidden="true" style={{ fontSize: 14 }}>ⓘ</span>
              <span><strong style={{ fontWeight: 700 }}>示例模型</strong>：改动不进入当前项目与报告，也不随项目保存 —— 仅供参数库 / CCF 教学演示。</span>
            </div>
            {example.model && (
              <ParamLibrary
                model={example.model}
                onUpdateParam={(id, v) => example.set((prev) => (prev == null ? prev : updateParam(prev, id, v)))}
                onSetCcf={(groups) => example.set((prev) => (prev == null ? prev : setCcf(prev, groups)))}
              />
            )}
          </div>
        ) : tab === 'library' ? (
          <div style={{ flex: 1, minHeight: 0, background: 'var(--exp-bg)' }}>
            <ReferenceLibrary onLibraryChange={bump} />
          </div>
        ) : tab === 'cons' ? (
          <div style={{ flex: 1, minHeight: 0, background: 'var(--exp-bg)' }}>
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
        </Suspense>
        </ErrorBoundary>
      </div>

      <StatusBar tab={tab} persistence={persistence} />

      <CommandPalette scenarios={scenarios} summaries={summaries} persistence={persistence} onOpenScenario={openScenario} />
      <SaveConflictDialog persistence={persistence} onGoToDiff={() => setTab('report')} />
      {accountsOpen && <AccountsPanel onClose={() => setAccountsOpen(false)} />}
    </div>
    </ErrorBoundary>
  )
}

const errBar: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 16px', background: 'var(--psa-danger-soft)', color: 'var(--psa-danger-strong)', fontSize: 12.5, borderBottom: '1px solid rgba(220,38,38,.2)', flexShrink: 0 }
// FE-09 示例模型横幅(醒目琥珀条):区别于错误条(红)与草稿条(蓝)
const exampleBanner: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', background: '#fef3c7', color: '#92400e', fontSize: 12.5, borderBottom: '1px solid #fde68a', flexShrink: 0, fontWeight: 500 }
const draftBar: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 16px', background: 'var(--psa-primary-soft)', color: 'var(--psa-primary-strong)', fontSize: 12.5, borderBottom: '1px solid rgba(37,99,235,.2)', flexShrink: 0 }
