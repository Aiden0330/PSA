import { useState } from 'react'
import type { CSSProperties } from 'react'
import { quantify } from '../../api'
import type { ScenarioItem, LibraryData } from '../../api'
import { EventTreeEditor } from '../../components/EventTreeEditor'
import type { EtaSummary } from '../../components/EventTreeEditor'
import { BarrierFtModal } from '../../components/BarrierFtModal'
import { AiDraftPanel } from '../../components/AiDraftPanel'
import { Icon } from '../../components/icons'
import { newBlankEta, addFe, branchLeaf, setConsequence, CONSEQUENCES, consLevel } from '../../eventtree'
import { attachStarterFt } from '../../model'
import { duplicateProjectEta } from '../../project'
import { buildScenarioTab } from '../persistence/scenarioLoader'
import { useActiveEta, etaDisplayName } from '../../stores/useActiveEta'
import { INIT_FREQ_KEY } from '../../stores/derived'
import { EMPTY_FTS } from '../../stores/projectStore'
import { AiAppliedPill } from '../ai-draft/AiAppliedPill'
import type { AiDraftState } from '../ai-draft/useAiDraft'
import type { ProjectPersistence } from '../persistence/useProjectPersistence'

const C_COLOR: Record<string, string> = { C1: '#16a34a', C2: '#65a30d', C3: '#d97706', C4: '#ea580c', C5: '#dc2626' }

/** ETA 工作台:工具带 + AI 面板 + 页签行 + 编辑器 + 初始事件 FTA 模态(蓝图 §三 features/eta)。 */
export function EtaWorkbench(
  { lib, ai, persistence, scenarios, summaries, aggregateTotals, activeName, onError, reportContext }: {
    lib: LibraryData | null
    ai: AiDraftState
    persistence: ProjectPersistence
    scenarios: ScenarioItem[]
    summaries: EtaSummary[]
    aggregateTotals: Record<string, number>
    activeName: string
    onError: (msg: string) => void
    reportContext?: { project_uuid: string; project_payload: unknown }
  },
) {
  const { etaTabs, activeKey, checkedKeys, etModel, etFtsModel, pfds, writeEtModel, activeEta, P, docUndo, docRedo, docCanUndo, docCanRedo } = useActiveEta()

  const selectEta = (key: string) => { if (key !== activeKey && etaTabs.some((t) => t.key === key)) P().setActive(key) }
  const onToggleEta = (key: string) => P().toggleChecked(key)
  const onAddEta = () => {
    const key = 'c' + Date.now().toString(36)
    const name = '自定义 ETA ' + (etaTabs.length + 1)
    P().addTab({ key, name, renamed: false, model: newBlankEta(name), fts: EMPTY_FTS, pfds: {} })
  }
  const onCopyEta = (key: string) => {
    const source = etaTabs.find((x) => x.key === key)
    if (!source) return
    const nextKey = 'cp' + Date.now().toString(36)
    const duplicated = duplicateProjectEta(etaTabs, key, nextKey, etaDisplayName(source, source.model))
    if (!duplicated) return
    P().applyProject({ etas: duplicated.etas, checkedKeys: { ...checkedKeys, [nextKey]: true }, activeKey: nextKey })
  }
  const onDeleteEta = (key: string) => {
    if (etaTabs.length <= 1) return                       // 仅剩 1 个不允许删
    const t = etaTabs.find((x) => x.key === key); if (!t) return
    if (!window.confirm(`删除 ETA「${etaDisplayName(t, t.model)}」?(可撤销)`)) return
    P().removeTab(key)
  }
  // 添加屏障 = 延长级联:追加功能事件,把"全失败"末态分支到它(成功维持原后果、失败升一级);画布即刻变化
  const onAddBarrier = () => {
    if (!etModel) return
    const m2 = addFe(etModel)
    const newId = m2.functionalEvents[m2.functionalEvents.length - 1].id
    const path: string[] = []
    let n: any = m2.root
    while (n && n.kind === 'branch') { path.push('failure'); n = n.failure }
    const oldCons: string = n && n.kind === 'leaf' ? n.consequence : 'C4'
    let m3 = branchLeaf(m2, path, newId)
    const worse = CONSEQUENCES[Math.min(CONSEQUENCES.indexOf(consLevel(m2, oldCons)) + 1, CONSEQUENCES.length - 1)]
    m3 = setConsequence(m3, [...path, 'failure'], worse)
    writeEtModel(m3)
  }
  // 打开内置场景为新页签(已打开则切换)
  const openEta = async (val: string) => {
    if (!val) return
    if (etaTabs.some((t) => t.key === val)) { selectEta(val); return }
    try {
      const sid = val.slice(3)
      const t = await buildScenarioTab(sid, scenarios.find((s) => s.id === sid)?.name ?? '场景')
      if (P().present.etas.some((x) => x.key === t.key)) { selectEta(t.key); return }
      P().addTab(t)
    } catch (e: any) { onError(String(e?.message ?? e)) }
  }
  // ── 初始事件 FTA (`__init__`) ──
  const [initFtOpen, setInitFtOpen] = useState(false)
  const onEditInitFt = () => {
    if (!etModel) return
    const hasFt = (etFtsModel.fault_trees ?? []).some((f: any) => f.name === '__init__')
    if (!hasFt) P().setEtaFts(activeKey, attachStarterFt(etFtsModel, '__init__', etModel.initFreq))
    setInitFtOpen(true)
  }
  const onInitFtClose = async () => {
    setInitFtOpen(false)
    const active = P().present.etas.find((e) => e.key === P().activeKey)
    if (!active || active.model.initFreqSource !== 'ft') return
    try {
      const top = (await quantify(active.fts, '__init__')).probability
      P().setEtaPfd(active.key, INIT_FREQ_KEY, top)            // 派生量入缓存,不进内容历史
    } catch {}
  }
  const onAttachFt = (idx: number) => { if (etModel) P().attachFt(activeKey, idx) }
  const onDetachFt = (idx: number) => { if (etModel) P().detachFt(activeKey, idx) }
  const onFtEdited = async (feId: string) => {
    const active = P().present.etas.find((e) => e.key === P().activeKey)
    if (!active) return
    try {
      const prob = (await quantify(active.fts, feId)).probability
      P().setEtaPfd(active.key, feId, prob)                    // 派生量入缓存,不进内容历史
    } catch {}
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', position: 'relative', display: 'flex', flexDirection: 'column' }}>
      {/* ETA 工具栏 ribbon */}
      <div style={etaToolbar}>
        <span style={{ fontSize: 11, color: 'var(--psa-muted)', fontWeight: 500 }}>当前 ETA</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--psa-ink)', maxWidth: 220, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{activeName}</span>
        <div style={ribbonDiv} />
        <button onClick={onAddBarrier} disabled={!etModel} className="psa-btn psa-btn--primary"><Icon name="plus" size={14} />添加屏障</button>
        <button onClick={() => ai.setAiOpen(!ai.aiOpen)} disabled={!etModel} className="psa-btn" title="打开 AI 建模助手"><Icon name="bolt" size={14} />AI 建模助手</button>
        <AiAppliedPill ai={ai} />
        <button onClick={docUndo} disabled={!docCanUndo} title="撤销" className="psa-btn" style={{ width: 30, padding: 0, justifyContent: 'center' }}><Icon name="undo" size={15} /></button>
        <button onClick={docRedo} disabled={!docCanRedo} title="重做" className="psa-btn" style={{ width: 30, padding: 0, justifyContent: 'center' }}><Icon name="redo" size={15} /></button>
        <div style={ribbonDiv} />
        <button onClick={persistence.onSaveWorkspace} disabled={!etModel} className="psa-btn psa-btn--dark" title={persistence.savedId ? '更新当前项目存档(原地保存, 不新建副本)' : '保存为新项目存档'}><Icon name="save" size={14} />保存项目</button>
        <button onClick={persistence.onSaveAs} disabled={!etModel} className="psa-btn" title="另存为一份新的项目存档(副本)"><Icon name="download" size={14} />另存为</button>
        <button onClick={persistence.onExportFile} disabled={!etModel} className="psa-btn" title="导出项目为文件(.psaproj.json, 离线可用)"><Icon name="download" size={14} />导出文件</button>
        <label className="psa-btn" title="从文件导入项目" style={{ cursor: 'pointer' }}><Icon name="upload" size={14} />导入文件
          <input type="file" accept=".json,.psaproj.json" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) persistence.onImportFile(f); e.currentTarget.value = '' }} />
        </label>
        <select value="" onChange={(e) => { if (e.target.value) { openEta(e.target.value); e.currentTarget.value = '' } }} style={ribbonSelect} title="打开内置场景为新页签">
          <option value="">打开场景…</option>
          {scenarios.map((s) => <option key={s.id} value={'sc:' + s.id}>{s.name}</option>)}
        </select>
        <span style={{ fontSize: 12, color: 'var(--psa-muted)' }}>存档</span>
        <select value={persistence.savedId} onChange={(e) => { if (e.target.value) persistence.loadProject(e.target.value) }} style={ribbonSelect}>
          <option value="">—</option>
          {persistence.saved.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button onClick={persistence.onDeleteSaved} disabled={!persistence.savedId} className="psa-btn psa-btn--danger"><Icon name="trash" size={14} />删除</button>
        {persistence.archiveLocal && <span style={{ fontSize: 11.5, color: 'var(--psa-faint)' }} title="后端不可达,存档保存在此浏览器(localStorage)">离线存档</span>}
        <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--psa-faint)' }}>前端积式实时;引擎精确量化按需</span>
      </div>

      {ai.aiOpen && (
        <AiDraftPanel
          goal={ai.aiGoal}
          mode={ai.aiMode}
          targetEtaName={ai.aiDraftContext?.etaName ?? activeName}
          targetFeId={ai.aiDraftContext?.targetFeId ?? ai.aiTargetFeId}
          targetFeLabel={ai.aiDraftContext?.targetFeLabel}
          functionalEvents={etModel?.functionalEvents ?? []}
          draft={ai.aiDraft}
          busy={ai.aiBusy}
          error={ai.aiError}
          onGoalChange={(goal) => { ai.setAiGoal(goal); if (ai.aiDraft) { ai.setAiDraft(null); ai.setAiDraftContext(null) } }}
          onModeChange={(mode) => { ai.setAiMode(mode); ai.setAiDraft(null); ai.setAiDraftContext(null); ai.setAiError(null) }}
          onTargetFeIdChange={(id) => { ai.setAiTargetFeId(id); ai.setAiDraft(null); ai.setAiDraftContext(null); ai.setAiError(null) }}
          onGenerate={ai.onGenerateAiDraft}
          onApply={ai.onApplyAiDraft}
          onClose={() => ai.setAiOpen(false)}
        />
      )}

      {/* ETA 页签 */}
      <div style={etaTabsRow}>
        {summaries.map((s) => {
          const aiEtaTag = ai.aiAppliedResult?.kind === 'eta' && ai.aiAppliedResult.etaKey === s.key
            ? (ai.aiAppliedResult.mode === 'complete_eta' ? 'AI 补全' : 'AI 新增')
            : ''
          return (
            <div key={s.key} onClick={() => selectEta(s.key)}
              onDoubleClick={() => {
                const t = etaTabs.find((x) => x.key === s.key); if (!t) return
                const name = window.prompt('ETA 名称', etaDisplayName(t, t.model))
                if (name && name.trim()) P().renameTab(s.key, name.trim())
              }}
              title={s.name} style={etaTabStyle(s.active)}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: C_COLOR[s.worstC] ?? '#94a3b8', flexShrink: 0 }} />
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{s.name}</span>
              {aiEtaTag && <span style={etaAiTag}>{aiEtaTag}</span>}
              <span style={{ fontFamily: 'var(--psa-font-mono)', fontSize: 10, color: 'var(--psa-faint)' }}>({s.leafCount})</span>
              <button
                onClick={(e) => { e.stopPropagation(); onCopyEta(s.key) }}
                onDoubleClick={(e) => e.stopPropagation()}
                title="复制此 ETA"
                style={etaTabActionBtn}
              >
                <Icon name="copy" size={12} />
              </button>
              {etaTabs.length > 1 && (
                <span onClick={(e) => { e.stopPropagation(); onDeleteEta(s.key) }} title="删除此 ETA"
                  style={{ marginLeft: 2, color: 'var(--psa-faint)', fontSize: 13, lineHeight: 1, padding: '0 3px', borderRadius: 4 }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--psa-danger)')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--psa-faint)')}>✕</span>
              )}
            </div>
          )
        })}
        <button onClick={onAddEta} title="新建 ETA" style={etaAddBtn}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="#6b7888" strokeWidth="2.2" strokeLinecap="round" /></svg>
        </button>
      </div>

      {/* ETA 主体 */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', padding: 12, display: 'flex' }}>
        {!etModel ? <p style={{ padding: 12 }}>加载中…</p> : (
          <EventTreeEditor model={etModel} onChange={writeEtModel}
            linked={{ fault_trees: etFtsModel.fault_trees ?? [], parameters: etFtsModel.model_data.parameters ?? [] }}
            fts={etFtsModel} ftsApi={{ set: (m) => P().setEtaFts(activeKey, m), undo: docUndo, redo: docRedo, canUndo: docCanUndo, canRedo: docCanRedo }}
            pfds={pfds} onAttachFt={onAttachFt} onDetachFt={onDetachFt} onFtEdited={onFtEdited}
            libBarriers={lib?.barrier_effectiveness ?? []} libComponents={lib?.component_failure_rates ?? []}
            etaSummaries={summaries} aggregateTotals={aggregateTotals}
            onSelectEta={selectEta} onToggleEta={onToggleEta} onAddBarrier={onAddBarrier}
            onEditInitFt={onEditInitFt} reportContext={reportContext} />
        )}
      </div>

      {/* 初始事件 FTA 模态 */}
      {initFtOpen && activeEta && (
        <BarrierFtModal
          model={etFtsModel}
          ftName="__init__"
          api={{ set: (m) => P().setEtaFts(activeKey, m), undo: docUndo, redo: docRedo, canUndo: docCanUndo, canRedo: docCanRedo }}
          pfd={etModel?.initFreq}
          libComponents={lib?.component_failure_rates ?? []}
          onClose={onInitFtClose}
        />
      )}
    </div>
  )
}

const etaToolbar: CSSProperties = { minHeight: 46, flexShrink: 0, background: 'var(--psa-soft-2)', borderBottom: '1px solid var(--psa-line-2)', display: 'flex', alignItems: 'center', padding: '0 14px', gap: 10, flexWrap: 'wrap' }
const ribbonSelect: CSSProperties = { height: 30, border: '1px solid var(--psa-line-strong)', borderRadius: 7, padding: '0 8px', fontSize: 12.5, color: 'var(--psa-ink)', background: 'var(--psa-surface)' }
const ribbonDiv: CSSProperties = { width: 1, height: 22, background: 'var(--psa-line-2)' }
const etaTabsRow: CSSProperties = { minHeight: 42, flexShrink: 0, background: 'var(--psa-bg)', borderBottom: '1px solid var(--psa-line-2)', display: 'flex', alignItems: 'flex-end', padding: '0 12px', gap: 3, flexWrap: 'wrap' }
const etaTabStyle = (active: boolean): CSSProperties => ({ display: 'flex', alignItems: 'center', gap: 7, height: 34, padding: '0 10px 0 14px', borderRadius: '8px 8px 0 0', background: active ? 'var(--psa-surface)' : 'var(--psa-line)', border: `1px solid ${active ? 'var(--psa-line-2)' : 'transparent'}`, borderBottom: active ? '1px solid var(--psa-surface)' : '1px solid transparent', fontSize: 12.5, fontWeight: active ? 600 : 400, color: active ? 'var(--psa-ink)' : 'var(--psa-muted)', cursor: 'pointer', position: 'relative', top: 1, maxWidth: 248 })
const etaAiTag: CSSProperties = { flexShrink: 0, border: '1px solid rgba(37,99,235,.22)', borderRadius: 5, padding: '1px 5px', background: 'var(--psa-primary-soft)', color: 'var(--psa-primary-strong)', fontSize: 10.5, fontWeight: 700 }
const etaTabActionBtn: CSSProperties = { width: 22, height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 0, borderRadius: 5, background: 'transparent', color: 'var(--psa-faint)', cursor: 'pointer', padding: 0, flexShrink: 0 }
const etaAddBtn: CSSProperties = { width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: '1px dashed var(--psa-faint)', borderRadius: 8, color: 'var(--psa-muted)', cursor: 'pointer', marginLeft: 4, marginBottom: 1 }
