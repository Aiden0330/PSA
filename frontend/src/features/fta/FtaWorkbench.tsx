import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { quantify, importMef } from '../../api'
import type { QuantifyResult, LibraryData } from '../../api'
import { LibPicker } from '../../components/LibPicker'
import { layoutFaultTree } from '../../layout'
import { FaultTreeCanvas } from '../../components/FaultTreeCanvas'
import { ResultsPanel } from '../../components/ResultsPanel'
import { Palette } from '../../components/Palette'
import { Inspector } from '../../components/Inspector'
import type { ModelJson } from '../../model'
import { addGate, addBasic, connect, deleteNode, updateNode, updateParam, setTop, getFt, activatedNodes, addBasicFromLib, renameNode, addFaultTree, deleteFaultTree, setBcSets } from '../../model'
import { Icon } from '../../components/icons'
import { formatEtaNumber } from '../../etaNumberFormat'
import { useViewStore } from '../../stores/viewStore'
import { useActiveEta, etaDisplayName } from '../../stores/useActiveEta'
import { composeModel } from '../../stores/derived'
import { deriveLinkedValue } from './linkedDerive'
import { makeKeyedStaleGuard } from '../analysis/staleGuard'
import { EMPTY_FTS } from '../../stores/projectStore'
import { AiAppliedPill } from '../ai-draft/AiAppliedPill'
import type { AiDraftState } from '../ai-draft/useAiDraft'
import type { ProjectPersistence } from '../persistence/useProjectPersistence'
import type { ExampleModelState } from './useExampleModel'
import { AnalysisSettingsPanel } from '../analysis/AnalysisSettingsPanel'
import { EMPTY_SETTINGS, listHouseEvents, settingsActive, toQuantifyOptions } from '../analysis/analysisSettings'
import type { AnalysisSettings } from '../analysis/analysisSettings'
import { activateOnKey } from '../shell/a11y'

function buildHeat(importance: Record<string, { fv: number }>): Record<string, number> {
  const max = Math.max(...Object.values(importance).map((v) => v.fv), 1e-12)
  const h: Record<string, number> = {}
  for (const [k, v] of Object.entries(importance)) h[k] = v.fv / max
  return h
}

/** FTA 工作台:左侧目标树(ETA 挂载/示例/自建)+ 画布 + 属性/结果面板(蓝图 §三 features/fta)。 */
export function FtaWorkbench({ lib, ai, persistence, example }: { lib: LibraryData | null; ai: AiDraftState; persistence: ProjectPersistence; example: ExampleModelState }) {
  const { etaTabs, userFtsModel, activeKey, etaPfds, etModel, P } = useActiveEta()
  const { docUndo, docRedo, docCanUndo, docCanRedo } = useActiveEta()
  const selected = useViewStore((s) => s.selected)
  const setSelected = useViewStore((s) => s.setSelected)
  const heatOn = useViewStore((s) => s.heatOn)
  const setHeatOn = useViewStore((s) => s.setHeatOn)
  const ftEditTarget = useViewStore((s) => s.ftEditTarget)
  const setFtEditTarget = useViewStore((s) => s.setFtEditTarget)
  // R4b:量化结果坞(割集/重要度)展开态,持久于 viewStore——同 R4a EventTreeEditor 的 seqExpanded 模式
  const ftaResultsExpanded = useViewStore((s) => s.ftaResultsExpanded)
  const setFtaResultsExpanded = useViewStore((s) => s.setFtaResultsExpanded)

  const { examples, current, setCurrent, ftName, setFtName, model, set, reset, undo, redo, canUndo, canRedo } = example
  const [result, setResult] = useState<QuantifyResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [highlight, setHighlight] = useState<Set<string>>(new Set())
  const [ftPos, setFtPos] = useState<Record<string, Record<string, { x: number; y: number }>>>({})
  const [settings, setSettings] = useState<AnalysisSettings>(EMPTY_SETTINGS)
  const deriveGuard = useRef(makeKeyedStaleGuard()).current
  // R4b:「⚙ 分析设置」ribbon 弹出面板的展开态——纯展示态,不影响 settings 本身的读写路径
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsPopRef = useRef<HTMLDivElement>(null)
  // 重置布局纪元:自增即让画布放弃拖拽粘滞、回自动布局(所有分支通用;model 分支另清持久位置)
  const [layoutEpoch, setLayoutEpoch] = useState(0)

  // 示例切换 → 清选中与结果(与旧行为一致)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setSelected(null); setResult(null); setError(null) }, [current])
  useEffect(() => { setHighlight(new Set()) }, [model])
  // F-β R-2:重置键 = workspaceId + 目标全身份(src/etaKey/树名/示例 current)——
  // 只按 src/current 会让 A 的设置带到 B 或另一棵同名树(FE-05)。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setSettings(EMPTY_SETTINGS) },
    [P().workspaceId, ftEditTarget.src, (ftEditTarget as any).etaKey, (ftEditTarget as any).name, current])
  // 弹出面板外点击关闭(与 MenuBar 下拉菜单相同的既有模式)
  useEffect(() => {
    if (!settingsOpen) return
    const onDoc = (e: MouseEvent) => { if (settingsPopRef.current && !settingsPopRef.current.contains(e.target as Node)) setSettingsOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [settingsOpen])

  const selectEta = (key: string) => { if (key !== activeKey && etaTabs.some((t) => t.key === key)) P().setActive(key) }
  const onAddFt = () => {
    const n = userFtsModel.fault_trees.length + 1
    const name = window.prompt('新建 FTA 名称', '我的故障树 ' + n)
    if (!name || !name.trim()) return
    const m2 = addFaultTree(userFtsModel, name.trim())
    P().setUserFts(m2)
    const created = m2.fault_trees[m2.fault_trees.length - 1].name
    setFtEditTarget({ src: 'standalone', name: created }); setSelected(null); setResult(null); setError(null)
  }
  const onDeleteFt = (name: string) => {
    if (!window.confirm(`删除自建 FTA「${name}」?`)) return
    P().setUserFts(deleteFaultTree(userFtsModel, name))
    if (ftEditTarget.src === 'standalone' && ftEditTarget.name === name) { setFtEditTarget({ src: 'model' }); setSelected(null); setResult(null); setError(null) }
  }

  // ── 活动目标派生变量 ──
  const ftIsEta = ftEditTarget.src === 'eta'
  const ftIsStandalone = ftEditTarget.src === 'standalone'
  const ftEtaKey = ftIsEta ? (ftEditTarget as { src: 'eta'; etaKey: string; name: string }).etaKey : ''
  const ftEtaName = ftIsEta ? (ftEditTarget as { src: 'eta'; etaKey: string; name: string }).name : ''
  const ftStandaloneName = ftIsStandalone ? (ftEditTarget as { src: 'standalone'; name: string }).name : ''
  const ftEtaTab = ftIsEta ? etaTabs.find((t) => t.key === ftEtaKey) : undefined
  const cvModel  = ftIsStandalone ? userFtsModel : ftIsEta ? (ftEtaTab?.fts ?? EMPTY_FTS) : model
  const cvFtName = ftIsStandalone ? ftStandaloneName : ftIsEta ? ftEtaName : ftName
  // etaSet: 结构性 FT 编辑写入文档(单历史);派生 PFD/initFreq 用新模型即时量化回写。
  // 目标可为任意页签(单一来源,无活动页限制)。
  // set 必须传更新函数(prev => next):值式覆写来自渲染期旧快照,同一拍两次编辑
  // 会后写冲前写(丢改动报障 2026-07-17)。派生量化用写后的 store 状态,不再用入参。
  const etaSet = async (m: ModelJson | ((prev: ModelJson) => ModelJson)) => {
    if (!ftEtaKey) return
    P().setEtaFts(ftEtaKey, m)
    if (!ftEtaName) return
    const target = P().present.etas.find((e) => e.key === ftEtaKey)
    if (!target) return
    // FE-03(F-α):初因树只准频率端点(此前调概率端点 + 空 catch——r2 typed 直传后
    // 频率参数被引擎响亮拒,400 被吞成静默保留旧初频)。分派收敛到 deriveLinkedValue
    // (与 EtaWorkbench 正确先例同口径:共享事件 → 序列级集成情形,不做两段式);错误可见。
    try {
      if (ftEtaName !== '__init__') {
        // C1 守护:若该屏障已 detach(linkFt 已清空),不覆盖用户手动填写的 PFD
        const fe = target.model.functionalEvents.find((f) => f.id === ftEtaName)
        if (!fe?.linkFt) return
      }
      const wid = P().workspaceId                            // F-β W1/W4:发起槽 + 代序
      const tok = deriveGuard.begin(`${wid}:${ftEtaKey}:${ftEtaName}`)
      const d = await deriveLinkedValue(target.fts ?? EMPTY_FTS, ftEtaName, target.model.initFreqSource)
      if (!deriveGuard.isCurrent(`${wid}:${ftEtaKey}:${ftEtaName}`, tok)) return
      if (d.kind === 'value') P().setEtaPfdFor(wid, ftEtaKey, d.key, d.value)   // W2:槽定向派生写
      else if (d.kind === 'integrated') {
        setError(`初因树与屏障共享基本事件(${d.shared.join(', ')})→ 序列级精确集成情形:`
          + '初因频率头条不由两段式更新,请在 ETA 页用「引擎精确量化」。')
      }
    } catch (e: any) {
      setError(`挂树派生值更新失败(旧值已过期,请修正后重试):${String(e?.message ?? e)}`)
    }
  }
  // 统一显式签名:三分支(项目自建/ETA 挂载/示例)均收值或更新函数;联合函数类型的
  // 参数在 TS 里会交集化导致调用报错,故在此处收敛为单一可调用类型。
  const cvSet: (u: ModelJson | ((prev: ModelJson) => ModelJson)) => void | Promise<void> =
    ftIsStandalone ? (u) => P().setUserFts(u)
    : ftIsEta ? etaSet
    // 示例分支:useModel 的 prev 可为 null(示例未载入),null 原样透传、非空才应用更新函数
    : (u) => set(typeof u === 'function' ? (prev) => (prev == null ? prev : u(prev)) : u)
  const cvUndo    = (ftIsStandalone || ftIsEta) ? docUndo : undo
  const cvRedo    = (ftIsStandalone || ftIsEta) ? docRedo : redo
  const cvCanUndo = (ftIsStandalone || ftIsEta) ? docCanUndo : canUndo
  const cvCanRedo = (ftIsStandalone || ftIsEta) ? docCanRedo : canRedo
  // ETA 挂载的故障树行(侧边栏用):所有页签同源,无实时/快照之分
  const etaFtRows: { etaKey: string; etaName: string; name: string; label: string }[] = []
  for (const t of etaTabs) {
    if (t.fts?.fault_trees?.some((f: any) => f.name === '__init__')) {
      etaFtRows.push({ etaKey: t.key, etaName: etaDisplayName(t, t.model), name: '__init__', label: '初始事件' })
    }
    for (const fe of t.model.functionalEvents) {
      if (fe.linkFt) etaFtRows.push({ etaKey: t.key, etaName: etaDisplayName(t, t.model), name: fe.id, label: fe.label || fe.id })
    }
  }
  // I2:当已选 ETA 行不再存在时(屏障被删除/detach,或活动 ETA 切换),重置为独立目标
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (ftIsEta && !etaFtRows.some((r) => r.etaKey === ftEtaKey && r.name === ftEtaName)) {
      setFtEditTarget({ src: 'model' }); setSelected(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ftIsEta, ftEtaKey, ftEtaName, etaFtRows.map((r) => r.etaKey + ':' + r.name).join(',')])
  // P4-B ④:standalone 目标同样会悬空(切项目后 userFts 换人/树被删)——同口径重置,
  // 否则编辑入口经失效树名走 mutator(现为 no-op)= 按钮点了没反应的哑态。
  useEffect(() => {
    if (ftIsStandalone && !(userFtsModel?.fault_trees ?? []).some((f: { name: string }) => f.name === ftStandaloneName)) {
      setFtEditTarget({ src: 'model' }); setSelected(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ftIsStandalone, ftStandaloneName, (userFtsModel?.fault_trees ?? []).map((f: { name: string }) => f.name).join(',')])
  // M1:安全计算画布图形——目标故障树不存在时返回空图(避免 layoutFaultTree 在 ft.nodes 上抛出)
  const cvTreeExists = (ftIsEta || ftIsStandalone) ? !!(cvModel?.fault_trees?.some((f: any) => f.name === cvFtName)) : !!cvModel
  const cvGraph = cvTreeExists
    ? layoutFaultTree(cvModel!, cvFtName, (ftIsEta || ftIsStandalone) ? undefined : ftPos[cvFtName])
    : { nodes: [], edges: [] }

  const onCutsetClick = (events: string[]) => {
    if (cvModel && cvTreeExists) setHighlight(activatedNodes(getFt(cvModel, cvFtName), new Set(events)))
  }
  const onQuantify = async () => {
    if (!cvModel || !cvTreeExists) return
    setBusy(true); setError(null)
    try { setResult(await quantify(cvModel, cvFtName, 'exact', toQuantifyOptions(settings))) }
    catch (e: any) { setError(String(e?.message ?? e)); setResult(null) }
    finally { setBusy(false) }
  }
  const houses = listHouseEvents(cvModel, cvFtName)
  const cvBasics = (cvModel?.fault_trees?.find((f: any) => f.name === cvFtName)?.nodes ?? [])
    .filter((n: any) => n.basic).map((n: any) => n.id)

  const aiAppliedResult = ai.aiAppliedResult

  return (
    <div style={{ flex: 1, overflow: 'hidden', display: 'flex', minHeight: 0, background: '#fff' }}>
      {/* 左侧边栏 */}
      <div style={ftSidebar}>
        <div style={ftSidebarGroup}>ETA 挂载 FTA</div>
        {etaFtRows.length === 0
          ? <div style={ftSidebarEmpty}>（无挂载故障树）</div>
          : Object.entries(
              etaFtRows.reduce((acc, r) => {
                (acc[r.etaKey] ??= { name: r.etaName, rows: [] }).rows.push(r)
                return acc
              }, {} as Record<string, { name: string; rows: typeof etaFtRows }>),
            ).map(([etaKey, grp]) => (
              <div key={etaKey}>
                <div style={ftSidebarSubhead} title={grp.name}>{grp.name}</div>
                {grp.rows.map((row) => {
                  const justGenerated = aiAppliedResult?.kind === 'fta'
                    && aiAppliedResult.etaKey === row.etaKey
                    && aiAppliedResult.treeName === row.name
                  const pickRow = () => { if (row.etaKey !== activeKey) selectEta(row.etaKey); setFtEditTarget({ src: 'eta', etaKey: row.etaKey, name: row.name }); setSelected(null); setResult(null); setError(null) }
                  return (
                    <div key={row.etaKey + ':' + row.name} className="psa-focus-row" role="button" tabIndex={0}
                      aria-label={`故障树 ${row.etaName} / ${row.label}`}
                      style={ftSidebarRow(ftIsEta && ftEtaName === row.name && ftEtaKey === row.etaKey, justGenerated)}
                      onClick={pickRow} onKeyDown={activateOnKey(pickRow)}
                      title={`${row.etaName} / ${row.label}`}
                    >
                      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.label}</span>
                      {row.name !== '__init__' && <span style={ftTreeNameText}>故障树: {row.name}</span>}
                      {justGenerated && <span style={ftAiTag}>刚生成</span>}
                    </div>
                  )
                })}
              </div>
            ))
        }
        <div style={{ ...ftSidebarGroup, marginTop: 10 }}>示例模型</div>
        {examples.map((e) => {
          const pickExample = () => { setCurrent(e.id); setFtEditTarget({ src: 'model' }); setSelected(null); setResult(null); setError(null) }
          return (
          <div key={e.id} className="psa-focus-row" role="button" tabIndex={0} aria-label={`示例模型 ${e.name}`}
            style={ftSidebarRow(!ftIsEta && !ftIsStandalone && current === e.id)}
            onClick={pickExample} onKeyDown={activateOnKey(pickExample)}
            title={e.name}
          >
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</span>
          </div>
          )
        })}
        <div style={{ ...ftSidebarGroup, marginTop: 10 }}>自建 FTA</div>
        <button onClick={onAddFt} className="psa-btn" style={{ margin: '4px 10px', width: 'calc(100% - 20px)', justifyContent: 'center', fontSize: 12 }}><Icon name="plus" size={13} />新增 FTA</button>
        {userFtsModel.fault_trees.map((ft) => {
          const pickStandalone = () => { setFtEditTarget({ src: 'standalone', name: ft.name }); setSelected(null); setResult(null); setError(null) }
          return (
          <div key={'u:' + ft.name} className="psa-focus-row" role="button" tabIndex={0} aria-label={`自建故障树 ${ft.name}`}
            style={{ ...ftSidebarRow(ftIsStandalone && ftStandaloneName === ft.name, aiAppliedResult?.kind === 'standalone_fta' && aiAppliedResult.treeName === ft.name), flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
            onClick={pickStandalone} onKeyDown={activateOnKey(pickStandalone)}
            title={ft.name}
          >
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ft.name}</span>
            {aiAppliedResult?.kind === 'standalone_fta' && aiAppliedResult.treeName === ft.name && <span style={ftAiTag}>刚生成</span>}
            <span onClick={(e) => { e.stopPropagation(); onDeleteFt(ft.name) }} title="删除" style={{ color: 'var(--psa-faint)', fontSize: 13, flexShrink: 0, paddingLeft: 6 }}>✕</span>
          </div>
          )
        })}
      </div>

      {/* 画布区 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={toolbar}>
          {!ftIsEta && (
            <select value={current} onChange={(e) => setCurrent(e.target.value)}>
              {examples.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          )}
          {ftIsEta && (
            <span style={{ fontSize: 12, color: 'var(--psa-ink-2)', fontWeight: 500, padding: '0 4px' }}>
              ETA 故障树: <strong>{ftEtaName === '__init__' ? '初始事件' : (ftEtaTab?.model.functionalEvents.find((f) => f.id === ftEtaName)?.label ?? ftEtaName)}</strong>
              {ftEtaName !== '__init__' && (
                <span style={{ marginLeft: 8, color: 'var(--psa-faint)' }}>
                  PFD = {formatEtaNumber(ftEtaTab && etaPfds(ftEtaTab)[ftEtaName])}
                </span>
              )}
              {ftEtaName === '__init__' && ftEtaTab && (
                <span style={{ marginLeft: 8, color: 'var(--psa-faint)' }}>
                  freq = {formatEtaNumber(composeModel(ftEtaTab.model, etaPfds(ftEtaTab)).initFreq)}
                </span>
              )}
              {/* M2:来源非 FTA 时提示编辑无效 */}
              {ftEtaName === '__init__' && ftEtaTab?.model.initFreqSource !== 'ft' && (
                <span style={{ marginLeft: 10, color: 'var(--psa-amber)', fontSize: 11, fontStyle: 'italic' }}>
                  初始事件来源非「FTA」,此处编辑不影响初始频率(切到 ETA 页改来源)
                </span>
              )}
            </span>
          )}
          {cvModel && cvTreeExists && <Palette onAddGate={(op) => cvSet((prev: ModelJson) => addGate(prev, cvFtName, op))} onAddBasic={() => cvSet((prev: ModelJson) => addBasic(prev, cvFtName))} />}
          {cvModel && cvTreeExists && lib && (
            <LibPicker label="＋从库加基本事件" items={lib.component_failure_rates.map((c) => ({ id: c.id, name: c.name, unit: c.unit }))}
              onPick={(id) => { const c = lib.component_failure_rates.find((x) => x.id === id); if (c && cvModel) cvSet((prev: ModelJson) => addBasicFromLib(prev, cvFtName, c)) }} />
          )}
          <AiAppliedPill ai={ai} />
          {!ftIsEta && !ftIsStandalone && (
            <label className="psa-btn" style={{ cursor: 'pointer' }}>
              <Icon name="upload" size={13} />导入 MEF
              <input type="file" accept=".xml" style={{ display: 'none' }} onChange={async (e) => {
                const f = e.target.files?.[0]; if (!f) return
                try { const d = await importMef(await f.text()); reset(d.model as ModelJson); setFtName(d.fault_tree); setSelected(null); setResult(null); setError(null) }
                catch (err: any) { setError(String(err?.message ?? err)) }
                e.currentTarget.value = ''
              }} />
            </label>
          )}
          <div style={{ flex: 1 }} />
          {/* R4b:AnalysisSettingsPanel 移入 ribbon 弹出面板(原内联右栏位置)——组件/props/handlers 不变,只改召唤方式 */}
          {cvTreeExists && (
            <div ref={settingsPopRef} style={{ position: 'relative' }}>
              <button type="button" onClick={() => setSettingsOpen((v) => !v)} className="psa-btn" title="边界条件(house 覆盖)与割集后处理规则">
                ⚙ 分析设置{settingsActive(settings) && <span style={settingsDot} />}
              </button>
              {settingsOpen && (
                <div className="exp-popover">
                  <AnalysisSettingsPanel houses={houses} basicEvents={cvBasics} settings={settings} onChange={setSettings}
                    bcSets={cvModel?.boundary_condition_sets ?? []}
                    onBcSetsChange={(sets) => { if (cvModel) cvSet((prev: ModelJson) => setBcSets(prev, sets)) }} />
                </div>
              )}
            </div>
          )}
          <button onClick={cvUndo} disabled={!cvCanUndo} title="撤销" className="psa-btn" style={{ width: 30, padding: 0, justifyContent: 'center' }}><Icon name="undo" size={15} /></button>
          <button onClick={cvRedo} disabled={!cvCanRedo} title="重做" className="psa-btn" style={{ width: 30, padding: 0, justifyContent: 'center' }}><Icon name="redo" size={15} /></button>
          <button onClick={onQuantify} disabled={busy || !cvTreeExists} className="psa-btn psa-btn--dark"><Icon name="bolt" size={14} />{busy ? '计算中…' : '量化'}</button>
          <label style={{ fontSize: 12, opacity: result ? 1 : 0.55, cursor: result ? 'pointer' : 'not-allowed' }}
            title={result ? '按基本事件 FV 着色' : '先点「量化」运行分析,得到重要度后才能着色(热力=FV 重要度)'}>
            <input type="checkbox" checked={heatOn} onChange={(e) => setHeatOn(e.target.checked)} disabled={!result} /> 重要度热力</label>
          <button onClick={() => { setLayoutEpoch((e) => e + 1); if (!ftIsEta && !ftIsStandalone) setFtPos((m) => ({ ...m, [ftName]: {} })) }}
            className="psa-btn" title="重置自动布局(清除本会话拖拽位置)"><Icon name="arrow-up" size={13} />重置布局</button>
          <div style={{ width: 1, height: 20, background: 'var(--psa-line)', margin: '0 4px' }} />
          <button onClick={persistence.onSaveWorkspace} disabled={!etModel} className="psa-btn psa-btn--dark" title={persistence.savedId ? '更新当前项目存档（原地保存，含自建 FTA 工作区）' : '保存为新项目存档（含自建 FTA 工作区）'}><Icon name="save" size={14} />保存项目</button>
          <button onClick={persistence.onExportFile} disabled={!etModel} className="psa-btn" title="导出项目为文件（.psaproj.json，离线可用）"><Icon name="download" size={14} />导出文件</button>
        </div>
        {/* 画布(psa-panel 卡片,占满剩余空间)+ 量化结果坞(默认折叠 ~96px peek,⌃ 展开;
            持久于 viewStore.ftaResultsExpanded——同 R4a EventTreeEditor 的 seqExpanded 折叠模式) */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 8, padding: 8 }}>
          <section className="psa-panel" style={{ flex: '1 1 auto', minHeight: 220 }}>
            <div style={{ flex: 1, minHeight: 0 }}>
              {cvTreeExists ? (
                <FaultTreeCanvas
                  key={`${ftIsEta ? ftEtaKey + ':' : ''}${cvFtName}`}
                  nodes={cvGraph.nodes}
                  edges={cvGraph.edges}
                  editable
                  fitKey={`${ftIsEta ? ftEtaKey + ':' : ''}${cvFtName}`}
                  layoutEpoch={layoutEpoch}
                  zoomToolbar
                  highlight={highlight}
                  heat={heatOn && result ? buildHeat(result.importance as any) : undefined}
                  onConnectNodes={(s, t) => cvModel && cvSet((prev: ModelJson) => connect(prev, cvFtName, s, t))}
                  onDeleteNodes={(ids) => {
                    if (!cvModel) return
                    cvSet((prev: ModelJson) => ids.reduce((acc, id) => deleteNode(acc, cvFtName, id), prev)); setSelected(null)
                  }}
                  onSelect={setSelected}
                  onNodeDragStop={(!ftIsEta && !ftIsStandalone) ? (id, x, y) => setFtPos((m) => ({ ...m, [ftName]: { ...(m[ftName] ?? {}), [id]: { x, y } } })) : undefined}
                />
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--psa-faint)', fontSize: 13 }}>
                  {ftIsEta ? '该 ETA 尚未挂载故障树' : ftIsStandalone ? '（自建故障树不存在）' : '加载中…'}
                </div>
              )}
            </div>
          </section>

          <section className="psa-panel" style={{ flexShrink: 0, ...(ftaResultsExpanded ? { flex: '0 0 340px' } : { flex: '0 0 auto' }) }}>
            <div className="psa-ch">
              <span className="t">量化结果{result ? `（割集 ${result.cutsets.length}）` : ''}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="meta">{ftaResultsExpanded ? '顶值 · 割集 · 重要度' : (result ? '展开查看完整割集与重要度' : '点击「量化」运行分析')}</span>
                <button type="button" onClick={() => setFtaResultsExpanded(!ftaResultsExpanded)} className="exp-collapse-toggle"
                  title={ftaResultsExpanded ? '收起量化结果' : '展开量化结果(割集/重要度)'}>
                  <Icon name="chevron-down" size={12} style={{ transform: ftaResultsExpanded ? 'none' : 'rotate(180deg)' }} />
                  {ftaResultsExpanded ? '收起' : '展开'}
                </button>
              </div>
            </div>
            {error && <div style={{ margin: 14, padding: 10, background: 'var(--psa-danger-soft)', color: 'var(--psa-danger-strong)', borderRadius: 6, fontSize: 12 }}>量化失败:{error}</div>}
            <div style={ftaResultsExpanded ? { flex: 1, minHeight: 0, overflowY: 'auto' } : { maxHeight: 96, overflowY: 'auto' }}>
              <ResultsPanel result={result} onCutsetClick={onCutsetClick} />
            </div>
          </section>
        </div>
      </div>

      {/* 右侧检视器(R4b:290px 定宽,复用 --exp-eta-inspector-w——分析设置已移入 ribbon 弹出面板,
          量化结果已移入底部坞,此栏现在只放节点属性) */}
      <div style={{ width: 'var(--exp-eta-inspector-w)', flexShrink: 0, borderLeft: '1px solid var(--psa-line)', background: 'var(--psa-surface)', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        <div className="psa-ch"><span className="t">属性</span></div>
        {cvModel && (
          <Inspector
            model={cvModel} ftName={cvFtName} selected={selected}
            onUpdateNode={(id, patch) => cvSet((prev: ModelJson) => updateNode(prev, cvFtName, id, patch))}
            onUpdateParam={(id, v) => cvSet((prev: ModelJson) => updateParam(prev, id, v))}
            onSetTop={(id) => cvSet((prev: ModelJson) => setTop(prev, cvFtName, id))}
            onDelete={(id) => { cvSet((prev: ModelJson) => deleteNode(prev, cvFtName, id)); setSelected(null) }}
            onRenameNode={(o, n) => { if (cvModel) { cvSet((prev: ModelJson) => renameNode(prev, cvFtName, o, n)); setSelected(n) } }}
            onConnectChild={(g, c) => cvSet((prev: ModelJson) => connect(prev, cvFtName, g, c))}
          />
        )}
      </div>
    </div>
  )
}

// R4b:borderBottom 对齐 R4a 的 etaToolbar(--psa-line-2);background 已是 --psa-surface,无需改(FTA 本就是白底 ribbon)
const toolbar: CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 10, rowGap: 8, padding: '8px 14px', borderBottom: '1px solid var(--psa-line-2)', background: 'var(--psa-surface)' }
const settingsDot: CSSProperties = { display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'var(--psa-primary)', marginLeft: 6, verticalAlign: 'middle' }
const ftSidebar: CSSProperties = { width: 192, flexShrink: 0, borderRight: '1px solid var(--psa-line)', background: 'var(--psa-soft)', overflowY: 'auto', display: 'flex', flexDirection: 'column', paddingBottom: 12 }
const ftSidebarGroup: CSSProperties = { padding: '8px 10px 4px', fontSize: 10.5, fontWeight: 700, color: 'var(--psa-muted)', textTransform: 'uppercase', letterSpacing: '.5px', borderBottom: '1px solid var(--psa-line)', background: 'var(--psa-soft)' }
const ftSidebarSubhead: CSSProperties = { padding: '6px 10px 3px', fontSize: 11.5, fontWeight: 700, color: 'var(--psa-ink-2)', background: 'var(--psa-primary-soft)', borderBottom: '1px solid var(--psa-line)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
const ftSidebarEmpty: CSSProperties = { padding: '8px 12px', fontSize: 11.5, color: 'var(--psa-faint)', fontStyle: 'italic' }
const ftSidebarRow = (active: boolean, marked = false): CSSProperties => ({ display: 'flex', flexDirection: 'column', gap: 2, padding: '6px 12px', cursor: 'pointer', fontSize: 12, background: active || marked ? 'var(--psa-primary-soft)' : 'transparent', borderLeft: active || marked ? '3px solid var(--psa-primary)' : '3px solid transparent', color: active || marked ? 'var(--psa-primary-strong)' : 'var(--psa-ink-2)', transition: 'background .12s' })
const ftTreeNameText: CSSProperties = { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--psa-faint)', fontSize: 10.5, fontFamily: 'var(--psa-font-mono)' }
const ftAiTag: CSSProperties = { alignSelf: 'flex-start', border: '1px solid rgba(37,99,235,.22)', borderRadius: 5, padding: '1px 5px', background: 'rgba(255,255,255,.75)', color: 'var(--psa-primary-strong)', fontSize: 10.5, fontWeight: 700 }
