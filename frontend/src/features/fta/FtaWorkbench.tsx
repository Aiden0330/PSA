import { useEffect, useState } from 'react'
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
import { addGate, addBasic, connect, deleteNode, updateNode, updateParam, setTop, getFt, activatedNodes, addBasicFromLib, renameNode, addFaultTree, deleteFaultTree } from '../../model'
import { Icon } from '../../components/icons'
import { formatEtaNumber } from '../../etaNumberFormat'
import { useViewStore } from '../../stores/viewStore'
import { useActiveEta, etaDisplayName } from '../../stores/useActiveEta'
import { composeModel, INIT_FREQ_KEY } from '../../stores/derived'
import { EMPTY_FTS } from '../../stores/projectStore'
import { AiAppliedPill } from '../ai-draft/AiAppliedPill'
import type { AiDraftState } from '../ai-draft/useAiDraft'
import type { ProjectPersistence } from '../persistence/useProjectPersistence'
import type { ExampleModelState } from './useExampleModel'

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

  const { examples, current, setCurrent, ftName, setFtName, model, set, reset, undo, redo, canUndo, canRedo } = example
  const [result, setResult] = useState<QuantifyResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [highlight, setHighlight] = useState<Set<string>>(new Set())
  const [ftPos, setFtPos] = useState<Record<string, Record<string, { x: number; y: number }>>>({})

  // 示例切换 → 清选中与结果(与旧行为一致)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setSelected(null); setResult(null); setError(null) }, [current])
  useEffect(() => { setHighlight(new Set()) }, [model])

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
  const etaSet = async (m: ModelJson) => {
    if (!ftEtaKey) return
    P().setEtaFts(ftEtaKey, m)
    if (!ftEtaName) return
    const target = P().present.etas.find((e) => e.key === ftEtaKey)
    if (!target) return
    try {
      if (ftEtaName === '__init__') {
        if (target.model.initFreqSource === 'ft') {
          const top = (await quantify(m, '__init__')).probability
          P().setEtaPfd(ftEtaKey, INIT_FREQ_KEY, top)          // 派生量入缓存,不进内容历史
        }
      } else {
        // C1 守护:若该屏障已 detach(linkFt 已清空),不覆盖用户手动填写的 PFD
        const fe = target.model.functionalEvents.find((f) => f.id === ftEtaName)
        if (!fe?.linkFt) return
        const prob = (await quantify(m, ftEtaName)).probability
        P().setEtaPfd(ftEtaKey, ftEtaName, prob)               // 派生量入缓存,不进内容历史
      }
    } catch {}
  }
  const cvSet     = ftIsStandalone ? (m: ModelJson) => P().setUserFts(m) : ftIsEta ? etaSet : set
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
    try { setResult(await quantify(cvModel, cvFtName)) }
    catch (e: any) { setError(String(e?.message ?? e)); setResult(null) }
    finally { setBusy(false) }
  }

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
                  return (
                    <div key={row.etaKey + ':' + row.name}
                      style={ftSidebarRow(ftIsEta && ftEtaName === row.name && ftEtaKey === row.etaKey, justGenerated)}
                      onClick={() => { if (row.etaKey !== activeKey) selectEta(row.etaKey); setFtEditTarget({ src: 'eta', etaKey: row.etaKey, name: row.name }); setSelected(null); setResult(null); setError(null) }}
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
        {examples.map((e) => (
          <div key={e.id}
            style={ftSidebarRow(!ftIsEta && !ftIsStandalone && current === e.id)}
            onClick={() => { setCurrent(e.id); setFtEditTarget({ src: 'model' }); setSelected(null); setResult(null); setError(null) }}
            title={e.name}
          >
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</span>
          </div>
        ))}
        <div style={{ ...ftSidebarGroup, marginTop: 10 }}>自建 FTA</div>
        <button onClick={onAddFt} className="psa-btn" style={{ margin: '4px 10px', width: 'calc(100% - 20px)', justifyContent: 'center', fontSize: 12 }}><Icon name="plus" size={13} />新增 FTA</button>
        {userFtsModel.fault_trees.map((ft) => (
          <div key={'u:' + ft.name}
            style={{ ...ftSidebarRow(ftIsStandalone && ftStandaloneName === ft.name, aiAppliedResult?.kind === 'standalone_fta' && aiAppliedResult.treeName === ft.name), flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
            onClick={() => { setFtEditTarget({ src: 'standalone', name: ft.name }); setSelected(null); setResult(null); setError(null) }}
            title={ft.name}
          >
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ft.name}</span>
            {aiAppliedResult?.kind === 'standalone_fta' && aiAppliedResult.treeName === ft.name && <span style={ftAiTag}>刚生成</span>}
            <span onClick={(e) => { e.stopPropagation(); onDeleteFt(ft.name) }} title="删除" style={{ color: 'var(--psa-faint)', fontSize: 13, flexShrink: 0, paddingLeft: 6 }}>✕</span>
          </div>
        ))}
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
          {cvModel && <Palette onAddGate={(op) => cvSet(addGate(cvModel, cvFtName, op))} onAddBasic={() => cvSet(addBasic(cvModel, cvFtName))} />}
          {cvModel && lib && (
            <LibPicker label="＋从库加基本事件" items={lib.component_failure_rates.map((c) => ({ id: c.id, name: c.name, unit: c.unit }))}
              onPick={(id) => { const c = lib.component_failure_rates.find((x) => x.id === id); if (c && cvModel) cvSet(addBasicFromLib(cvModel, cvFtName, c)) }} />
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
          <button onClick={cvUndo} disabled={!cvCanUndo} title="撤销" className="psa-btn" style={{ width: 30, padding: 0, justifyContent: 'center' }}><Icon name="undo" size={15} /></button>
          <button onClick={cvRedo} disabled={!cvCanRedo} title="重做" className="psa-btn" style={{ width: 30, padding: 0, justifyContent: 'center' }}><Icon name="redo" size={15} /></button>
          <button onClick={onQuantify} disabled={busy || !cvTreeExists} className="psa-btn psa-btn--dark"><Icon name="bolt" size={14} />{busy ? '计算中…' : '量化'}</button>
          <label style={{ fontSize: 12 }} title="按基本事件 FV 着色"><input type="checkbox" checked={heatOn} onChange={(e) => setHeatOn(e.target.checked)} disabled={!result} /> 重要度热力</label>
          {!ftIsEta && !ftIsStandalone && (
            <button onClick={() => setFtPos((m) => ({ ...m, [ftName]: {} }))} className="psa-btn" title="重置自动布局"><Icon name="arrow-up" size={13} />重置布局</button>
          )}
          <div style={{ width: 1, height: 20, background: 'var(--psa-line)', margin: '0 4px' }} />
          <button onClick={persistence.onSaveWorkspace} disabled={!etModel} className="psa-btn psa-btn--dark" title={persistence.savedId ? '更新当前项目存档（原地保存，含自建 FTA 工作区）' : '保存为新项目存档（含自建 FTA 工作区）'}><Icon name="save" size={14} />保存项目</button>
          <button onClick={persistence.onExportFile} disabled={!etModel} className="psa-btn" title="导出项目为文件（.psaproj.json，离线可用）"><Icon name="download" size={14} />导出文件</button>
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          {cvTreeExists ? (
            <FaultTreeCanvas
              nodes={cvGraph.nodes}
              edges={cvGraph.edges}
              editable
              highlight={highlight}
              heat={heatOn && result ? buildHeat(result.importance as any) : undefined}
              onConnectNodes={(s, t) => cvModel && cvSet(connect(cvModel, cvFtName, s, t))}
              onDeleteNodes={(ids) => {
                if (!cvModel) return
                let m = cvModel; for (const id of ids) m = deleteNode(m, cvFtName, id)
                cvSet(m); setSelected(null)
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
      </div>

      {/* 右侧属性/结果面板 */}
      <div style={{ width: 'var(--psa-inspector-w)', borderLeft: '1px solid var(--psa-line)', background: 'var(--psa-surface)', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        <div style={{ borderBottom: '1px solid var(--psa-line)' }}>
          <div className="psa-ch"><span className="t">属性</span></div>
          {cvModel && (
            <Inspector
              model={cvModel} ftName={cvFtName} selected={selected}
              onUpdateNode={(id, patch) => cvSet(updateNode(cvModel, cvFtName, id, patch))}
              onUpdateParam={(id, v) => cvSet(updateParam(cvModel, id, v))}
              onSetTop={(id) => cvSet(setTop(cvModel, cvFtName, id))}
              onDelete={(id) => { cvSet(deleteNode(cvModel, cvFtName, id)); setSelected(null) }}
              onRenameNode={(o, n) => { if (cvModel) { cvSet(renameNode(cvModel, cvFtName, o, n)); setSelected(n) } }}
            />
          )}
        </div>
        <div>
          <div className="psa-ch"><span className="t">量化结果</span></div>
          {error && <div style={{ margin: 14, padding: 10, background: 'var(--psa-danger-soft)', color: 'var(--psa-danger-strong)', borderRadius: 6, fontSize: 12 }}>量化失败:{error}</div>}
          <ResultsPanel result={result} onCutsetClick={onCutsetClick} />
        </div>
      </div>
    </div>
  )
}

const toolbar: CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 10, rowGap: 8, padding: '8px 14px', borderBottom: '1px solid var(--psa-line)', background: 'var(--psa-surface)' }
const ftSidebar: CSSProperties = { width: 192, flexShrink: 0, borderRight: '1px solid var(--psa-line)', background: 'var(--psa-soft)', overflowY: 'auto', display: 'flex', flexDirection: 'column', paddingBottom: 12 }
const ftSidebarGroup: CSSProperties = { padding: '8px 10px 4px', fontSize: 10.5, fontWeight: 700, color: 'var(--psa-muted)', textTransform: 'uppercase', letterSpacing: '.5px', borderBottom: '1px solid var(--psa-line)', background: 'var(--psa-soft)' }
const ftSidebarSubhead: CSSProperties = { padding: '6px 10px 3px', fontSize: 11.5, fontWeight: 700, color: 'var(--psa-ink-2)', background: 'var(--psa-primary-soft)', borderBottom: '1px solid var(--psa-line)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
const ftSidebarEmpty: CSSProperties = { padding: '8px 12px', fontSize: 11.5, color: 'var(--psa-faint)', fontStyle: 'italic' }
const ftSidebarRow = (active: boolean, marked = false): CSSProperties => ({ display: 'flex', flexDirection: 'column', gap: 2, padding: '6px 12px', cursor: 'pointer', fontSize: 12, background: active || marked ? 'var(--psa-primary-soft)' : 'transparent', borderLeft: active || marked ? '3px solid var(--psa-primary)' : '3px solid transparent', color: active || marked ? 'var(--psa-primary-strong)' : 'var(--psa-ink-2)', transition: 'background .12s' })
const ftTreeNameText: CSSProperties = { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--psa-faint)', fontSize: 10.5, fontFamily: 'var(--psa-font-mono)' }
const ftAiTag: CSSProperties = { alignSelf: 'flex-start', border: '1px solid rgba(37,99,235,.22)', borderRadius: 5, padding: '1px 5px', background: 'rgba(255,255,255,.75)', color: 'var(--psa-primary-strong)', fontSize: 10.5, fontWeight: 700 }
