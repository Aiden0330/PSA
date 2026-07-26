import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { quantify, ftFrequency } from '../../api'
import type { ScenarioItem, LibraryData } from '../../api'
import { EventTreeEditor } from '../../components/EventTreeEditor'
import type { EtaSummary } from '../../components/EventTreeEditor'
import { AiDraftPanel } from '../../components/AiDraftPanel'
import { Icon } from '../../components/icons'
import { newBlankEta, addFe, branchLeaf, setConsequence, CONSEQUENCES, consLevel } from '../../eventtree'
import { attachStarterFt, sharedIeBarrierEvents, setBcSets } from '../../model'
import { AnalysisSettingsPanel } from '../analysis/AnalysisSettingsPanel'
import { EMPTY_SETTINGS, settingsActive, listHouseEventsUnion, toEtEngineOptions } from '../analysis/analysisSettings'
import type { AnalysisSettings } from '../analysis/analysisSettings'
import { duplicateProjectEta } from '../../project'
import { buildScenarioTab } from '../persistence/scenarioLoader'
import { getTemplate, listTemplates, templateToEtaModel } from '../templates/etaTemplates'
import { useActiveEta, etaDisplayName } from '../../stores/useActiveEta'
import { INIT_FREQ_KEY } from '../../stores/derived'
import { makeKeyedStaleGuard } from '../analysis/staleGuard'
import { EMPTY_FTS } from '../../stores/projectStore'
import { AiAppliedPill } from '../ai-draft/AiAppliedPill'
import type { AiDraftState } from '../ai-draft/useAiDraft'
import type { ProjectPersistence } from '../persistence/useProjectPersistence'
import { ErrorBoundary } from '../shell/ErrorBoundary'

const BarrierFtModal = lazy(() => import('../../components/BarrierFtModal').then((m) => ({ default: m.BarrierFtModal })))

const C_COLOR: Record<string, string> = { C1: '#16a34a', C2: '#65a30d', C3: '#d97706', C4: '#ea580c', C5: '#dc2626' }

/** ETA 工作台:工具带 + AI 面板 + 页签行 + 编辑器 + 初始事件 FTA 模态(蓝图 §三 features/eta)。 */
export function EtaWorkbench(
  { lib, ai, persistence, scenarios, summaries, aggregateTotals, activeName, onError, getReportContext }: {
    lib: LibraryData | null
    ai: AiDraftState
    persistence: ProjectPersistence
    scenarios: ScenarioItem[]
    summaries: EtaSummary[]
    aggregateTotals: Record<string, number>
    activeName: string
    onError: (msg: string) => void
    getReportContext?: () => { project_uuid: string; project_payload: unknown }
  },
) {
  const { etaTabs, activeKey, checkedKeys, etModel, etFtsModel, pfds, writeEtModel, activeEta, P, docUndo, docRedo, docCanUndo, docCanRedo } = useActiveEta()
  const [templateNotice, setTemplateNotice] = useState<string | null>(null)
  // 序列级 LFT 集成(规格 2026-07-15 §6):初因树与屏障共享基本事件不再是错误,而是集成通道的
  // 工作情形——以信息提示(非报错)告知已启用「引擎精确量化」序列级精确集成。
  const [sharedNotice, setSharedNotice] = useState<string | null>(null)

  // Gap8:ETA 分析设置(house 覆盖 / 命名边界条件集)—— 复用 FTA 的 AnalysisSettingsPanel(隐藏后处理规则)。
  // house 事件 = 各屏障 linkFt 故障树的 house 节点并集(引擎合并 PDAG 后按 id 全局覆盖);
  // 命名集定义随 etFtsModel(bcSets),选择/house 覆盖是分析设置(每 ETA 独立,切页重置)。
  const [settings, setSettings] = useState<AnalysisSettings>(EMPTY_SETTINGS)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsPopRef = useRef<HTMLDivElement>(null)
  const linkedFtNames = (etModel?.functionalEvents ?? []).map((fe) => fe.linkFt).filter((n): n is string => !!n)
  const etaHouses = listHouseEventsUnion(etFtsModel, linkedFtNames)
  // F-β R-1:linked/etEngineOptions 引用稳定化——EventTreeEditor 结果失效依赖它们,
  // 内联字面量每渲染新引用即失效风暴(规格 2026-07-17-fe-async-ownership-runkey)。
  const etEngineOptions = useMemo(
    () => toEtEngineOptions(settings, etFtsModel.boundary_condition_sets ?? []),
    [settings, etFtsModel])
  const linked = useMemo(
    () => ({ fault_trees: etFtsModel.fault_trees ?? [], parameters: etFtsModel.model_data.parameters ?? [],
             ccf_groups: etFtsModel.ccf_groups ?? [] }),
    [etFtsModel])
  const etaBcSets = useMemo(() => etFtsModel.boundary_condition_sets ?? [], [etFtsModel])
  const deriveGuard = useRef(makeKeyedStaleGuard()).current
  // F-β R-2:重置键 = workspaceId + activeKey——不同项目常共享同一场景 key,
  // 只按 activeKey 会把 A 的 house 覆盖带进 B(FE-05)。
  const wsId = P().workspaceId
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setSettings(EMPTY_SETTINGS); setSettingsOpen(false); setSharedNotice(null) }, [wsId, activeKey])
  // 弹出面板外点击关闭(与 FtaWorkbench/MenuBar 同款既有模式)
  useEffect(() => {
    if (!settingsOpen) return
    const onDoc = (e: MouseEvent) => { if (settingsPopRef.current && !settingsPopRef.current.contains(e.target as Node)) setSettingsOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [settingsOpen])

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
  // P4-A ④:三步复合(addFe→branchLeaf→setConsequence)整体走函数式——此前从渲染
  // 快照 etModel 起算再值式覆写,双击「添加屏障」第二击在旧树上重算,净少一个屏障。
  const onAddBarrier = () => {
    if (!etModel) return
    writeEtModel((prev) => {
      const m2 = addFe(prev)
      const newId = m2.functionalEvents[m2.functionalEvents.length - 1].id
      const path: string[] = []
      let n: any = m2.root
      while (n && n.kind === 'branch') { path.push('failure'); n = n.failure }
      const oldCons: string = n && n.kind === 'leaf' ? n.consequence : 'C4'
      let m3 = branchLeaf(m2, path, newId)
      const worse = CONSEQUENCES[Math.min(CONSEQUENCES.indexOf(consLevel(m2, oldCons)) + 1, CONSEQUENCES.length - 1)]
      m3 = setConsequence(m3, [...path, 'failure'], worse)
      return m3
    })
  }
  // 从预置模板新建 ETA 页签(4c2:前身模板迁移;模板是可编辑起点,量化前应按项目实测替换)
  const openTemplate = (id: string) => {
    const tpl = getTemplate(id)
    if (!tpl) return
    const key = 'tpl' + Date.now().toString(36)
    P().addTab({ key, name: tpl.name, renamed: true, model: templateToEtaModel(tpl), fts: EMPTY_FTS, pfds: {} })
    setTemplateNotice(tpl.name)
  }
  // 打开内置场景为新页签(已打开则切换)
  const openEta = async (val: string) => {
    if (!val) return
    if (etaTabs.some((t) => t.key === val)) { selectEta(val); return }
    try {
      const sid = val.slice(3)
      const wid = P().workspaceId                              // F-β W1:发起槽先捕获
      const t = await buildScenarioTab(sid, scenarios.find((s) => s.id === sid)?.name ?? '场景')
      if (P().workspaceId !== wid) return                      // W3:切槽后丢弃文档变更,绝不写别的项目
      if (P().present.etas.some((x) => x.key === t.key)) { selectEta(t.key); return }
      P().addTab(t)
    } catch (e: any) { onError(String(e?.message ?? e)) }
  }
  // ── 初始事件 FTA (`__init__`) ──
  // 跨项目污染修复(报障 2026-07-20):打开态携带「打开时的槽+ETA」令牌;删除/切换项目后
  // 令牌失配,模态自动隐藏——绝不跟随新活动项目的同名树(否则继续编辑会改到别的项目)。
  const [initFtToken, setInitFtToken] = useState<string | null>(null)
  const initFtOpen = initFtToken === `${wsId}:${activeKey}`
  const setInitFtOpen = (v: boolean) => setInitFtToken(v ? `${wsId}:${activeKey}` : null)
  const onEditInitFt = () => {
    if (!etModel) return
    const hasFt = (etFtsModel.fault_trees ?? []).some((f: any) => f.name === '__init__')
    // 种子 = 单频率事件 = 当前手动值 → 挂树瞬间 F 与切换前逐位一致(迁移零意外)
    if (!hasFt) P().setEtaFts(activeKey, attachStarterFt(etFtsModel, '__init__', etModel.initFreq, 'frequency'))
    setInitFtOpen(true)
  }
  const onInitFtClose = async () => {
    setInitFtOpen(false)
    const active = P().present.etas.find((e) => e.key === P().activeKey)
    if (!active || active.model.initFreqSource !== 'ft') return
    // 独立性 lint 翻转(规格 2026-07-15 §6):初因树与屏障共享基本事件时,两段式
    // (F_IE × P_path)的独立性假设不成立 —— 但这不再是错误,而是**序列级精确集成的工作情形**。
    // 不在此以两段式(/api/ft/frequency)更新初因频率(那对共享事件是错的);改由「引擎精确量化」
    // 按 Σλ_i·P(E_i∧Path) 逐序列精确求值。仅信息提示,不阻断、不报错。
    const shared = sharedIeBarrierEvents(active.fts)
    if (shared.length) {
      setSharedNotice(`初因树与屏障共享基本事件(${shared.join(', ')})→ 已启用序列级精确集成:请用「引擎精确量化」按序列精确计算(两段式独立近似不适用于共享事件,故初因频率头条不由其更新)。`)
      return
    }
    setSharedNotice(null)
    try {
      // 频率通道(每割集恰好一个频率事件,F = Σ 率×Π使能概率)—— 不是概率端点
      const wid = P().workspaceId                              // F-β W1/W4:发起槽 + 代序
      const tok = deriveGuard.begin(`${wid}:${active.key}:${INIT_FREQ_KEY}`)
      const { frequency } = await ftFrequency(active.fts, '__init__')
      if (!deriveGuard.isCurrent(`${wid}:${active.key}:${INIT_FREQ_KEY}`, tok)) return
      P().setEtaPfdFor(wid, active.key, INIT_FREQ_KEY, frequency)   // W2:槽定向派生写
    } catch (e: any) {
      onError(String(e?.message ?? e))                          // 规则违规等 400:响亮,不静默
    }
  }
  const onAttachFt = (idx: number) => { if (etModel) P().attachFt(activeKey, idx) }
  const onDetachFt = (idx: number) => { if (etModel) P().detachFt(activeKey, idx) }
  const onFtEdited = async (feId: string) => {
    const active = P().present.etas.find((e) => e.key === P().activeKey)
    if (!active) return
    // 独立性 lint 双侧生效,但已翻转为信息提示(规格 2026-07-15 §6):屏障树编辑可能事后
    // 引入与初因树的共享事件;屏障 PFD 照常更新,共享则提示改走「引擎精确量化」序列级集成(不报错)。
    if (active.model.initFreqSource === 'ft') {
      const shared = sharedIeBarrierEvents(active.fts)
      setSharedNotice(shared.length
        ? `屏障树与初因树共享基本事件(${shared.join(', ')})→ 已启用序列级精确集成:初因频率将在「引擎精确量化」中按序列精确求值。`
        : null)
    }
    try {
      const wid = P().workspaceId                              // F-β W1/W4
      const tok = deriveGuard.begin(`${wid}:${active.key}:${feId}`)
      const prob = (await quantify(active.fts, feId)).probability
      if (!deriveGuard.isCurrent(`${wid}:${active.key}:${feId}`, tok)) return
      P().setEtaPfdFor(wid, active.key, feId, prob)            // W2:槽定向派生写
    } catch (e: any) {
      onError(String(e?.message ?? e))                          // review F3:不再静默吞错
    }
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
        {/* Gap8:分析设置弹出面板(house 覆盖 / 命名边界条件集)—— 套用到「引擎精确量化」与「深化分析」重要度 */}
        <div ref={settingsPopRef} style={{ position: 'relative' }}>
          <button type="button" onClick={() => setSettingsOpen((v) => !v)} disabled={!etModel} className="psa-btn"
            title="边界条件(house 覆盖)与命名边界条件集——套用到引擎精确量化 / 重要度">
            ⚙ 分析设置{settingsActive(settings) && <span style={settingsDot} />}
          </button>
          {settingsOpen && (
            <div className="exp-popover">
              <AnalysisSettingsPanel houses={etaHouses} basicEvents={[]} settings={settings} onChange={setSettings}
                bcSets={etaBcSets} onBcSetsChange={(sets) => P().setEtaFts(activeKey, setBcSets(etFtsModel, sets))}
                showPostRules={false} />
            </div>
          )}
        </div>
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
        <select value="" onChange={(e) => { if (e.target.value) { openTemplate(e.target.value); e.currentTarget.value = '' } }} style={ribbonSelect} title="从预置模板新建 ETA（可编辑起点，量化前请按项目实测替换取值）">
          <option value="">从模板…</option>
          {listTemplates().map((t) => <option key={t.id} value={t.id}>{t.category} · {t.name}</option>)}
        </select>
        <select value="" onChange={(e) => { if (e.target.value) { openEta(e.target.value); e.currentTarget.value = '' } }} style={ribbonSelect} title="打开内置场景为新页签">
          <option value="">打开场景…</option>
          {scenarios.map((s) => <option key={s.id} value={'sc:' + s.id}>{s.name}</option>)}
        </select>
        <span style={{ fontSize: 12, color: 'var(--psa-muted)' }}>存档</span>
        <select value={persistence.savedId} disabled={persistence.loading}
          onChange={(e) => { if (e.target.value) persistence.loadProject(e.target.value) }} style={ribbonSelect}
          title={persistence.loading ? '存档载入中…' : '选择即载入该项目存档'}>
          <option value="">—</option>
          {persistence.saved.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button onClick={persistence.onDeleteSaved} disabled={!persistence.savedId} className="psa-btn psa-btn--danger"
          title="删除整个项目存档(单删某个 ETA 用其页签上的 ✕)"><Icon name="trash" size={14} />删除项目</button>
        {persistence.archiveLocal && <span style={{ fontSize: 11.5, color: 'var(--psa-faint)' }} title="后端不可达,存档保存在此浏览器(localStorage)">离线存档</span>}
        <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--psa-faint)' }}>前端积式实时;引擎精确量化按需</span>
      </div>

      {/* 序列级 LFT 集成提示(规格 2026-07-15 §6):共享事件已由「引擎精确量化」序列级集成处理——
          信息提示,非报错(既往此处为整体拒绝);服务端合并护栏的 400 仍在检视器错误区响亮呈现。 */}
      {sharedNotice && (
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px', background: 'var(--psa-primary-soft)', borderBottom: '1px solid var(--psa-line-2)', fontSize: 11.5, color: 'var(--psa-primary-strong)' }}>
          <Icon name="bolt" size={13} />
          <span style={{ flex: 1 }}>{sharedNotice}</span>
          <button onClick={() => setSharedNotice(null)} style={{ border: 0, background: 'none', color: 'inherit', cursor: 'pointer', fontSize: 13 }}>✕</button>
        </div>
      )}

      {/* 4c2:模板为可编辑起点,数据多为示例/文献推断(C/D 级)——量化前须按项目实测替换 */}
      {templateNotice && (
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px', background: 'var(--psa-primary-soft)', borderBottom: '1px solid var(--psa-line-2)', fontSize: 11.5, color: 'var(--psa-primary-strong)' }}>
          <Icon name="bolt" size={13} />
          <span style={{ flex: 1 }}>已从模板「{templateNotice}」新建 ETA。模板取值为示例/文献推断(C/D 级,见检视器逐条来源),<b>量化前请按本项目实测替换</b>。</span>
          <button onClick={() => setTemplateNotice(null)} style={{ border: 0, background: 'none', color: 'inherit', cursor: 'pointer', fontSize: 13 }}>✕</button>
        </div>
      )}

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
          elements={ai.elements}
          acceptedIds={ai.acceptedIds}
          onToggleElement={ai.toggleElement}
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
        {/* P4-A ⑧:key=activeKey —— 切 ETA 页签即重挂,局部态(选中路径/在途结果)不跨树残留 */}
        {!etModel ? <p style={{ padding: 12 }}>加载中…</p> : (
          <EventTreeEditor key={`${wsId}:${activeKey}`} model={etModel} onChange={writeEtModel}
            linked={linked}
            fts={etFtsModel} ftsApi={{ set: (m) => P().setEtaFts(activeKey, m), undo: docUndo, redo: docRedo, canUndo: docCanUndo, canRedo: docCanRedo }}
            pfds={pfds} onAttachFt={onAttachFt} onDetachFt={onDetachFt} onFtEdited={onFtEdited}
            libBarriers={lib?.barrier_effectiveness ?? []} libComponents={lib?.component_failure_rates ?? []}
            etaSummaries={summaries} aggregateTotals={aggregateTotals}
            onSelectEta={selectEta} onToggleEta={onToggleEta} onAddBarrier={onAddBarrier}
            onEditInitFt={onEditInitFt} getReportContext={getReportContext}
            onExported={() => { void persistence.syncBaselineAfterPin(P().workspaceId) }} etEngineOptions={etEngineOptions} />
        )}
      </div>

      {/* 初始事件 FTA 模态 —— 与 EventTreeEditor 的屏障模态同款防御(白屏报障 2026-07-17):
          懒模态包 ErrorBoundary(渲染抛错兜底为可安全关闭的对话框,不再整页白)+ 可见加载态 */}
      {initFtOpen && activeEta && (
        <ErrorBoundary
          fallback={(reset) => (
            <div role="alertdialog" aria-label="故障树编辑器出错" style={{ position: 'fixed', inset: 0, zIndex: 60,
              background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              onClick={() => { reset(); onInitFtClose() }}>
              <div className="psa-panel" style={{ padding: 20, maxWidth: 380, textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>故障树编辑器打开失败</div>
                <div style={{ fontSize: 12, color: 'var(--psa-muted)', lineHeight: 1.6, marginBottom: 12 }}>
                  初因事件故障树无法渲染(可能是空树或数据不一致)。已安全关闭编辑器,你的事件树未受影响。
                </div>
                <button type="button" className="psa-btn" onClick={() => { reset(); onInitFtClose() }}>关闭</button>
              </div>
            </div>
          )}>
          <Suspense fallback={<div style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 13 }}>载入故障树编辑器…</div>}>
            <BarrierFtModal
              model={etFtsModel}
              ftName="__init__"
              api={{ set: (m) => P().setEtaFts(activeKey, m), undo: docUndo, redo: docRedo, canUndo: docCanUndo, canRedo: docCanRedo }}
              pfd={etModel?.initFreq}
              libComponents={lib?.component_failure_rates ?? []}
              onClose={onInitFtClose}
              frequencyMode
            />
          </Suspense>
        </ErrorBoundary>
      )}
    </div>
  )
}

// padding 上下 8px 是有意的:ribbon 用 flex-wrap,窄视口/出现滚动条时会换行;若上下 padding 为 0,
// 换行后第一行按钮会紧贴顶部深色 header(gap=0)。8px 上下留白 + rowGap 让单行/多行都有呼吸空间
// (单行时 minHeight 46 − 16 padding = 30 恰好容纳按钮,视觉与原先一致)。与 FTA 工具栏口径统一。
// R4a:ribbon 背景改纯白(与 mockup .ribbon{background:#fff} 对齐;.psa-btn 本身已是浅色,无需换皮)
const etaToolbar: CSSProperties = { minHeight: 46, flexShrink: 0, background: 'var(--psa-surface)', borderBottom: '1px solid var(--psa-line-2)', display: 'flex', alignItems: 'center', padding: '8px 14px', columnGap: 10, rowGap: 8, flexWrap: 'wrap' }
const ribbonSelect: CSSProperties = { height: 30, border: '1px solid var(--psa-line-strong)', borderRadius: 7, padding: '0 8px', fontSize: 12.5, color: 'var(--psa-ink)', background: 'var(--psa-surface)' }
const settingsDot: CSSProperties = { display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'var(--psa-primary)', marginLeft: 6, verticalAlign: 'middle' }
const ribbonDiv: CSSProperties = { width: 1, height: 22, background: 'var(--psa-line-2)' }
const etaTabsRow: CSSProperties = { minHeight: 42, flexShrink: 0, background: 'var(--psa-bg)', borderBottom: '1px solid var(--psa-line-2)', display: 'flex', alignItems: 'flex-end', padding: '0 12px', gap: 3, flexWrap: 'wrap' }
const etaTabStyle = (active: boolean): CSSProperties => ({ display: 'flex', alignItems: 'center', gap: 7, height: 34, padding: '0 10px 0 14px', borderRadius: '8px 8px 0 0', background: active ? 'var(--psa-surface)' : 'var(--psa-line)', border: `1px solid ${active ? 'var(--psa-line-2)' : 'transparent'}`, borderBottom: active ? '1px solid var(--psa-surface)' : '1px solid transparent', fontSize: 12.5, fontWeight: active ? 600 : 400, color: active ? 'var(--psa-ink)' : 'var(--psa-muted)', cursor: 'pointer', position: 'relative', top: 1, maxWidth: 248 })
const etaAiTag: CSSProperties = { flexShrink: 0, border: '1px solid rgba(37,99,235,.22)', borderRadius: 5, padding: '1px 5px', background: 'var(--psa-primary-soft)', color: 'var(--psa-primary-strong)', fontSize: 10.5, fontWeight: 700 }
const etaTabActionBtn: CSSProperties = { width: 22, height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 0, borderRadius: 5, background: 'transparent', color: 'var(--psa-faint)', cursor: 'pointer', padding: 0, flexShrink: 0 }
const etaAddBtn: CSSProperties = { width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: '1px dashed var(--psa-faint)', borderRadius: 8, color: 'var(--psa-muted)', cursor: 'pointer', marginLeft: 4, marginBottom: 1 }
