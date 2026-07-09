import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { getExamples, getModel, quantify, getScenarios, listSaved, saveWorkspace, deleteSaved, getLibrary, importMef, wasSavedOffline, draftAiModel } from './api'
import type { ExampleItem, QuantifyResult, ScenarioItem, SavedItem, LibraryData } from './api'
import { LibPicker } from './components/LibPicker'
import { layoutFaultTree } from './layout'
import { FaultTreeCanvas } from './components/FaultTreeCanvas'
import { ResultsPanel } from './components/ResultsPanel'
import { EventTreeEditor } from './components/EventTreeEditor'
import type { EtaSummary } from './components/EventTreeEditor'
import { ReferenceLibrary } from './components/ReferenceLibrary'
import { FmeaWorkbench } from './components/FmeaWorkbench'
import { ConsequencesTab } from './components/ConsequencesTab'
import { newBlankEta, setLinkFt, addFe, branchLeaf, setConsequence, consequenceTotals, layout, CONSEQUENCES, consLevel } from './eventtree'
import type { EventTreeModel } from './eventtree'
import { serializeProject, duplicateProjectEta } from './project'
import { buildScenarioTab } from './features/persistence/scenarioLoader'
import { loadProjectArchive, importProjectText } from './features/persistence/projectIo'
import type { FmeaRow, MappingConfig } from './fmea'
import { loadRows, saveRows } from './fmeaStore'
import { loadMapping, saveMapping } from './mappingStore'
import { Palette } from './components/Palette'
import { Inspector } from './components/Inspector'
import { ParamLibrary } from './components/ParamLibrary'
import { useModel, useHistory } from './useModel'
import type { ModelJson } from './model'
import { addGate, addBasic, connect, deleteNode, updateNode, updateParam, setTop, setCcf, getFt, activatedNodes, attachStarterFt, addBasicFromLib, renameNode, addFaultTree, deleteFaultTree } from './model'
import { BarrierFtModal } from './components/BarrierFtModal'
import { buildProjectFile, downloadProjectFile } from './projectFile'
import { applyOverlay, getOverlay, mergeOverlay } from './libraryStore'
import { Icon } from './components/icons'
import { formatEtaNumber } from './etaNumberFormat'
import { AiDraftPanel } from './components/AiDraftPanel'
import { applyAiDraftToProject } from './aiDraft'
import type { AiApplyMode, AiDraftResponse, AiDraftTarget } from './aiDraft'
import { useViewStore } from './stores/viewStore'
import type { FtEditTarget } from './stores/viewStore'

function buildHeat(importance: Record<string, { fv: number }>): Record<string, number> {
  const max = Math.max(...Object.values(importance).map((v) => v.fv), 1e-12)
  const h: Record<string, number> = {}
  for (const [k, v] of Object.entries(importance)) h[k] = v.fv / max
  return h
}

const C_COLOR: Record<string, string> = { C1: '#16a34a', C2: '#65a30d', C3: '#d97706', C4: '#ea580c', C5: '#dc2626' }
const EMPTY_FTS: ModelJson = { model_data: { parameters: [] }, fault_trees: [] }

interface EtaTab { key: string; name: string; renamed?: boolean; model: EventTreeModel; fts: ModelJson; pfds: Record<string, number> }
type AiAppliedResult =
  | { kind: 'eta'; mode: 'new_eta' | 'complete_eta'; etaKey: string; etaName: string; at: number }
  | { kind: 'fta'; etaKey: string; etaName: string; treeName: string; barrierId: string; barrierLabel: string; at: number }
  | { kind: 'standalone_fta'; treeName: string; at: number }
type AiDraftContext = {
  mode: AiApplyMode
  etaKey: string
  etaName: string
  targetFeId?: string
  targetFeLabel?: string
}

/** 页签显示名:未手动改名则跟随初始事件名(实时), 否则用手动名。 */
function etaDisplayName(t: EtaTab, m: EventTreeModel | null): string {
  return t.renamed ? t.name : (m?.initEvent?.trim() || t.name)
}

function compactLibraryContext(lib: LibraryData | null): Record<string, unknown> | undefined {
  if (!lib) return undefined
  return {
    initiating_events: lib.initiating_events.map((x) => ({
      id: x.id, label: x.label, category: x.category, freq_prior: x.freq_prior, source: x.source?.citation,
    })),
    barrier_effectiveness: lib.barrier_effectiveness.map((x) => ({
      id: x.id, name: x.name, category: x.category, pfd: x.pfd, grade: x.grade, source: x.source?.citation,
    })),
    component_failure_rates: lib.component_failure_rates.map((x) => ({
      id: x.id, name: x.name, failure_mode: x.failure_mode, rate: x.rate, unit: x.unit, grade: x.grade, source: x.source?.citation,
    })),
  }
}

function aiTargetForMode(mode: AiApplyMode): AiDraftTarget {
  return mode === 'fta_for_barrier' || mode === 'standalone_fta' ? 'fta' : 'eta'
}

export default function App() {
  const [examples, setExamples] = useState<ExampleItem[]>([])
  const [current, setCurrent] = useState('bms_ft')
  const [ftName, setFtName] = useState('BMS')
  const { model, set, reset, undo, redo, canUndo, canRedo } = useModel(null)
  const etFts = useModel(null)                       // 活动 ETA 各屏障故障树 (ModelJson)
  const userFts = useModel(EMPTY_FTS)             // 自建独立故障树工作区(一份模型多棵树)
  const selected = useViewStore((s) => s.selected)
  const setSelected = useViewStore((s) => s.setSelected)
  const [result, setResult] = useState<QuantifyResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const etHist = useHistory<EventTreeModel>(null)    // 活动 ETA 模型 + 撤销/重做
  const etModel = etHist.model
  const [pfds, setPfds] = useState<Record<string, number>>({})
  const tab = useViewStore((s) => s.tab)
  const setTab = useViewStore((s) => s.setTab)
  const [busy, setBusy] = useState(false)
  const [highlight, setHighlight] = useState<Set<string>>(new Set())
  const [scenarios, setScenarios] = useState<ScenarioItem[]>([])
  const [saved, setSaved] = useState<SavedItem[]>([])
  const [savedId, setSavedId] = useState<string>('')
  const [archiveLocal, setArchiveLocal] = useState(false)
  const [libBase, setLibBase] = useState<LibraryData | null>(null)
  const [lib, setLib] = useState<LibraryData | null>(null)
  const [libVersion, setLibVersion] = useState(0)
  const heatOn = useViewStore((s) => s.heatOn)
  const setHeatOn = useViewStore((s) => s.setHeatOn)
  const [ftPos, setFtPos] = useState<Record<string, Record<string, { x: number; y: number }>>>({})
  const [fmeaRows, setFmeaRows] = useState<FmeaRow[]>(() => loadRows())
  const [fmeaMapping, setFmeaMapping] = useState<MappingConfig>(() => loadMapping())

  // ── FTA 页编辑目标:'model' = 独立示例; 'eta' = ETA 挂载的屏障故障树 ──
  const ftEditTarget: FtEditTarget = useViewStore((s) => s.ftEditTarget)
  const setFtEditTarget = useViewStore((s) => s.setFtEditTarget)

  // ── 多 ETA 页签 ──
  const [etaTabs, setEtaTabs] = useState<EtaTab[]>([])
  const [activeKey, setActiveKey] = useState('')
  const [checkedKeys, setCheckedKeys] = useState<Record<string, boolean>>({})
  const [aiOpen, setAiOpen] = useState(false)
  const [aiGoal, setAiGoal] = useState('电池舱液冷泄漏导致外短')
  const [aiMode, setAiMode] = useState<AiApplyMode>('new_eta')
  const [aiTargetFeId, setAiTargetFeId] = useState('')
  const [aiDraft, setAiDraft] = useState<AiDraftResponse | null>(null)
  const [aiDraftContext, setAiDraftContext] = useState<AiDraftContext | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiNotice, setAiNotice] = useState<string | null>(null)
  const [aiAppliedResult, setAiAppliedResult] = useState<AiAppliedResult | null>(null)

  const persistFmeaRows = (next: FmeaRow[]) => {
    setFmeaRows(next)
    try { saveRows(next) } catch (e: any) { setError(String(e?.message ?? e)) }
  }
  const persistFmeaMapping = (next: MappingConfig) => {
    setFmeaMapping(next)
    try { saveMapping(next) } catch (e: any) { setError(String(e?.message ?? e)) }
  }
  const buildPayload = () =>
    serializeProject(snapshotActive(etaTabs), activeKey, checkedKeys, userFts.model ?? EMPTY_FTS, fmeaRows, fmeaMapping)
  const applyProjectFmea = (proj: { fmeaRows?: FmeaRow[]; fmeaMapping?: MappingConfig }) => {
    if (proj.fmeaRows) persistFmeaRows(proj.fmeaRows)
    if (proj.fmeaMapping) persistFmeaMapping(proj.fmeaMapping)
  }

  useEffect(() => { getExamples().then(setExamples).catch(() => {}) }, [])
  useEffect(() => { getScenarios().then(setScenarios).catch(() => {}) }, [])
  useEffect(() => { listSaved().then((s) => { setSaved(s); setArchiveLocal(wasSavedOffline()) }).catch(() => {}) }, [])
  useEffect(() => { getLibrary().then(setLibBase).catch(() => {}) }, [])
  useEffect(() => { if (libBase) setLib(applyOverlay(libBase, getOverlay())) }, [libBase, libVersion])
  useEffect(() => {
    getModel(current).then((env) => {
      reset(env.model as ModelJson)
      setFtName(env.fault_tree)
      setSelected(null); setResult(null); setError(null)
    }).catch(() => {})
  }, [current, reset])

  useEffect(() => { setHighlight(new Set()) }, [model])
  useEffect(() => {
    if (!etModel?.functionalEvents.length) return
    if (!aiTargetFeId || !etModel.functionalEvents.some((fe) => fe.id === aiTargetFeId)) {
      setAiTargetFeId(etModel.functionalEvents[0].id)
    }
  }, [etModel, aiTargetFeId])

  // 把当前活动编辑态写回其页签快照(切换/新增前调用)
  const snapshotActive = (list: EtaTab[]): EtaTab[] =>
    list.map((t) => (t.key === activeKey && etModel ? { ...t, model: etModel, fts: etFts.model ?? EMPTY_FTS, pfds } : t))
  const loadIntoActive = (t: EtaTab) => { etHist.reset(t.model); etFts.reset(t.fts); setPfds(t.pfds); setActiveKey(t.key) }

  const selectEta = (key: string) => {
    if (key === activeKey) return
    const tgt = etaTabs.find((t) => t.key === key); if (!tgt) return
    setEtaTabs((list) => snapshotActive(list)); loadIntoActive(tgt)
  }
  const onToggleEta = (key: string) => setCheckedKeys((c) => ({ ...c, [key]: !c[key] }))
  const onAddEta = () => {
    const key = 'c' + Date.now().toString(36)
    const name = '自定义 ETA ' + (etaTabs.length + 1)
    const m = newBlankEta(name)
    const tab: EtaTab = { key, name, renamed: false, model: m, fts: EMPTY_FTS, pfds: {} }
    setEtaTabs((list) => [...snapshotActive(list), tab])
    loadIntoActive(tab)
    setCheckedKeys((c) => ({ ...c, [key]: true }))
  }
  const onCopyEta = (key: string) => {
    const source = etaTabs.find((x) => x.key === key)
    if (!source) return
    const snap = snapshotActive(etaTabs)
    const displayName = etaDisplayName(source, key === activeKey ? etModel : source.model)
    const nextKey = 'cp' + Date.now().toString(36)
    const duplicated = duplicateProjectEta(snap, key, nextKey, displayName)
    if (!duplicated) return
    setEtaTabs(duplicated.etas)
    loadIntoActive(duplicated.eta)
    setCheckedKeys((c) => ({ ...c, [nextKey]: true }))
  }
  const onDeleteEta = (key: string) => {
    if (etaTabs.length <= 1) return                       // 仅剩 1 个不允许删
    const t = etaTabs.find((x) => x.key === key); if (!t) return
    const nm = etaDisplayName(t, t.key === activeKey ? etModel : t.model)
    if (!window.confirm(`删除 ETA「${nm}」?此操作不可撤销。`)) return
    const snap = snapshotActive(etaTabs)                  // 先固化活动页实时编辑
    const remaining = snap.filter((x) => x.key !== key)
    setEtaTabs(remaining)
    setCheckedKeys((c) => { const n = { ...c }; delete n[key]; return n })
    if (key === activeKey) {
      const idx = snap.findIndex((x) => x.key === key)
      loadIntoActive(remaining[Math.min(idx, remaining.length - 1)])
    }
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
    etHist.set(m3)
  }
  // 打开内置场景为新页签(已打开则切换)
  const openEta = async (val: string) => {
    if (!val) return
    const exist = etaTabs.find((t) => t.key === val)
    if (exist) { selectEta(val); return }
    try {
      const sid = val.slice(3)
      const t = await buildScenarioTab(sid, scenarios.find((s) => s.id === sid)?.name ?? '场景')
      if (etaTabs.some((x) => x.key === t.key)) { selectEta(t.key); return }
      setEtaTabs((list) => [...snapshotActive(list), t]); loadIntoActive(t)
      setCheckedKeys((c) => ({ ...c, [t.key]: true }))
    } catch (e: any) { setError(String(e?.message ?? e)) }
  }
  // 保存项目:已载入存档(savedId 命中)→ 原地更新(沿用原名, 不再追问);否则新建并记住其 id
  const onSaveWorkspace = async () => {
    if (!etModel) return
    const payload = buildPayload()  // 并入活动页实时编辑 + FMEA 工作台
    const existing = saved.find((s) => s.id === savedId)
    if (savedId && existing) {
      await saveWorkspace(existing.name, payload, savedId)   // 更新当前项目, 不新建副本
    } else {
      const at = etaTabs.find((t) => t.key === activeKey)
      const dflt = (at ? etaDisplayName(at, etModel) : '') || etModel.initEvent || 'ETA 项目'
      const name = window.prompt('项目存档名称', dflt)
      if (!name) return
      const rec = await saveWorkspace(name, payload)        // 新建
      setSavedId(rec.id)                                     // 记住新 id → 后续「保存项目」即原地更新它
    }
    setSaved(await listSaved()); setArchiveLocal(wasSavedOffline())
  }
  // 另存为新项目:总是新建一份副本, 并把当前项目切换为该副本
  const onSaveAs = async () => {
    if (!etModel) return
    const at = etaTabs.find((t) => t.key === activeKey)
    const base = saved.find((s) => s.id === savedId)?.name || (at ? etaDisplayName(at, etModel) : '') || 'ETA 项目'
    const name = window.prompt('另存为新项目名称', base + ' 副本')
    if (!name) return
    const rec = await saveWorkspace(name, buildPayload())
    setSavedId(rec.id)
    setSaved(await listSaved()); setArchiveLocal(wasSavedOffline())
  }
  // 读取项目存档:完整还原全部 ETA(替换当前所有页签)。兼容旧版单 ETA 存档。
  const loadProject = async (id: string) => {
    try {
      const proj = await loadProjectArchive(id); setArchiveLocal(wasSavedOffline())
      if (!proj.tabs.length) return
      setEtaTabs(proj.tabs)
      setCheckedKeys(proj.checkedKeys)
      loadIntoActive(proj.tabs.find((t) => t.key === proj.activeKey) ?? proj.tabs[0])
      userFts.reset(proj.userFts ?? EMPTY_FTS)
      applyProjectFmea(proj)
    } catch (e: any) { setError(String(e?.message ?? e)) }
  }
  // 导出项目为文件(含参考库覆盖层, 离线可用)
  const onExportFile = () => {
    if (!etModel) return
    const payload = buildPayload()
    const active = etaTabs.find((t) => t.key === activeKey)
    const name = active ? etaDisplayName(active, etModel) : 'bess-psa-project'
    downloadProjectFile(buildProjectFile(payload, getOverlay()), name)
  }
  // 从文件导入项目(替换全部页签);若文件携带参考库覆盖层则非破坏并入
  const onImportFile = async (file: File) => {
    try {
      const proj = importProjectText(await file.text(), file.name.replace(/\.[^.]+$/, ''))
      if (!proj.tabs.length) return
      if (proj.libraryOverlay) { mergeOverlay(proj.libraryOverlay as any); setLibVersion((n) => n + 1) }
      setEtaTabs(proj.tabs); setCheckedKeys(proj.checkedKeys); setSavedId('')
      loadIntoActive(proj.tabs.find((t) => t.key === proj.activeKey) ?? proj.tabs[0])
      userFts.reset(proj.userFts ?? EMPTY_FTS)
      applyProjectFmea(proj)
    } catch (e: any) { setError(String(e?.message ?? e)) }
  }
  const onDeleteSaved = async () => {
    if (!savedId) return
    await deleteSaved(savedId); setSavedId(''); setSaved(await listSaved()); setArchiveLocal(wasSavedOffline())
  }
  const onAddFt = () => {
    const n = (userFts.model?.fault_trees.length ?? 0) + 1
    const name = window.prompt('新建 FTA 名称', '我的故障树 ' + n)
    if (!name || !name.trim()) return
    const m2 = addFaultTree(userFts.model ?? EMPTY_FTS, name.trim())
    userFts.set(m2)
    const created = m2.fault_trees[m2.fault_trees.length - 1].name
    setFtEditTarget({ src: 'standalone', name: created }); setSelected(null); setResult(null); setError(null)
  }
  const onDeleteFt = (name: string) => {
    if (!window.confirm(`删除自建 FTA「${name}」?`)) return
    userFts.set(deleteFaultTree(userFts.model ?? EMPTY_FTS, name))
    if (ftEditTarget.src === 'standalone' && ftEditTarget.name === name) { setFtEditTarget({ src: 'model' }); setSelected(null); setResult(null); setError(null) }
  }
  // ── 初始事件 FTA (`__init__`) ──
  const [initFtOpen, setInitFtOpen] = useState(false)
  const onEditInitFt = () => {
    if (!etModel) return
    const fts = etFts.model ?? EMPTY_FTS
    const hasFt = (fts.fault_trees ?? []).some((f: any) => f.name === '__init__')
    if (!hasFt) etFts.set(attachStarterFt(fts, '__init__', etModel.initFreq))
    setInitFtOpen(true)
  }
  const onInitFtClose = async () => {
    setInitFtOpen(false)
    if (!etFts.model || etModel?.initFreqSource !== 'ft') return
    try {
      const top = (await quantify(etFts.model, '__init__')).probability
      etHist.set((m) => (m ? { ...m, initFreq: top } : m))
    } catch {}
  }

  const onAttachFt = (idx: number) => {
    if (!etModel) return
    const fe = etModel.functionalEvents[idx]
    etFts.set(attachStarterFt(etFts.model ?? EMPTY_FTS, fe.id, fe.failProb))
    etHist.set(setLinkFt(etModel, idx, fe.id))
  }
  const onDetachFt = (idx: number) => { if (etModel) etHist.set(setLinkFt(etModel, idx, undefined)) }
  const onFtEdited = async (feId: string) => {
    if (!etFts.model) return
    try {
      const prob = (await quantify(etFts.model, feId)).probability
      setPfds((x) => ({ ...x, [feId]: prob }))
      etHist.set((m) => (m ? { ...m, functionalEvents: m.functionalEvents.map((f) => (f.id === feId ? { ...f, failProb: prob } : f)) } : m))
    } catch {}
  }

  // 初次进入:默认级联作为第一个页签
  useEffect(() => { (async () => {
    try {
      const t = await buildScenarioTab('', '默认热失控级联')
      setEtaTabs([t]); setCheckedKeys({ [t.key]: true }); loadIntoActive(t)
    } catch {}
  })() }, [])

  // 页签摘要 + 多 ETA 汇总(活动页签用实时模型,其余用快照)
  const summaries: EtaSummary[] = etaTabs.map((t) => {
    const m = t.key === activeKey && etModel ? etModel : t.model
    const totals = consequenceTotals(m)
    const leafCount = layout(m, 1, 0).leafCount
    let worstC = '—', worstFreq = 0
    for (let i = CONSEQUENCES.length - 1; i >= 0; i--) { const c = CONSEQUENCES[i]; if ((totals[c] ?? 0) > 0) { worstC = c; worstFreq = totals[c]; break } }
    return { key: t.key, name: etaDisplayName(t, m), leafCount, worstC, worstFreq, active: t.key === activeKey, checked: !!checkedKeys[t.key] }
  })
  const aggregateTotals: Record<string, number> = {}
  for (const t of etaTabs) {
    if (!checkedKeys[t.key]) continue
    const m = t.key === activeKey && etModel ? etModel : t.model
    const tt = consequenceTotals(m)
    for (const c of Object.keys(tt)) aggregateTotals[c] = (aggregateTotals[c] ?? 0) + tt[c]
  }
  const activeName = summaries.find((s) => s.active)?.name ?? 'ETA'

  // ── FTA 页:活动目标派生变量 ──
  const ftIsEta = ftEditTarget.src === 'eta'
  const ftIsStandalone = ftEditTarget.src === 'standalone'
  const ftEtaKey = ftIsEta ? (ftEditTarget as { src: 'eta'; etaKey: string; name: string }).etaKey : ''
  const ftEtaName = ftIsEta ? (ftEditTarget as { src: 'eta'; etaKey: string; name: string }).name : ''
  const ftStandaloneName = ftIsStandalone ? (ftEditTarget as { src: 'standalone'; name: string }).name : ''
  const ftEtaTab = ftIsEta ? etaTabs.find((t) => t.key === ftEtaKey) : undefined
  const cvModel  = ftIsStandalone ? (userFts.model ?? EMPTY_FTS) : ftIsEta ? (ftEtaKey === activeKey ? (etFts.model ?? EMPTY_FTS) : (ftEtaTab?.fts ?? EMPTY_FTS)) : model
  const cvFtName = ftIsStandalone ? ftStandaloneName : ftIsEta ? ftEtaName : ftName
  // etaSet: 写入 etFts 并用新模型直接量化同步 PFD/initFreq(避免 React 异步 state 读旧值)。
  // 设计说明:结构性 FT 编辑写入 etFts 历史;派生的 PFD/initFreq 回写写入 etHist(投影派生),
  // 与 onFtEdited/onInitFtClose 保持一致。撤销结构编辑可能暂时留下过期派生 PFD,
  // 下次量化时自动更新。
  const etaSet = async (m: ModelJson) => {
    if (ftEtaKey && ftEtaKey !== activeKey) return
    etFts.set(m)
    if (!ftEtaName) return
    try {
      if (ftEtaName === '__init__') {
        if (etModel?.initFreqSource === 'ft') {
          const top = (await quantify(m, '__init__')).probability
          etHist.set((em) => (em ? { ...em, initFreq: top } : em))
        }
      } else {
        // C1 守护:若该屏障已 detach(linkFt 已清空),不覆盖用户手动填写的 PFD
        const fe = etModel?.functionalEvents.find((f) => f.id === ftEtaName)
        if (!fe?.linkFt) return
        const prob = (await quantify(m, ftEtaName)).probability
        setPfds((x) => ({ ...x, [ftEtaName]: prob }))
        etHist.set((em) => (em ? { ...em, functionalEvents: em.functionalEvents.map((f) => (f.id === ftEtaName ? { ...f, failProb: prob } : f)) } : em))
      }
    } catch {}
  }
  const cvSet     = ftIsStandalone ? userFts.set : ftIsEta ? etaSet : set
  const cvUndo    = ftIsStandalone ? userFts.undo : ftIsEta ? etFts.undo : undo
  const cvRedo    = ftIsStandalone ? userFts.redo : ftIsEta ? etFts.redo : redo
  const cvCanUndo = ftIsStandalone ? userFts.canUndo : ftIsEta ? etFts.canUndo : canUndo
  const cvCanRedo = ftIsStandalone ? userFts.canRedo : ftIsEta ? etFts.canRedo : canRedo
  // ETA 挂载的故障树行(侧边栏用)
  // 跨所有 ETA 页签列出挂载的故障树;活动 ETA 用实时 etModel/etFts, 其余用页签快照
  const etaFtRows: { etaKey: string; etaName: string; name: string; label: string }[] = []
  for (const t of etaTabs) {
    const isActive = t.key === activeKey
    const m = isActive && etModel ? etModel : t.model
    const fts = isActive ? etFts.model : t.fts
    if (!m) continue
    if (fts?.fault_trees?.some((f: any) => f.name === '__init__')) {
      etaFtRows.push({ etaKey: t.key, etaName: etaDisplayName(t, m), name: '__init__', label: '初始事件' })
    }
    for (const fe of m.functionalEvents) {
      if (fe.linkFt) etaFtRows.push({ etaKey: t.key, etaName: etaDisplayName(t, m), name: fe.id, label: fe.label || fe.id })
    }
  }
  // I2:当已选 ETA 行不再存在时(屏障被删除/detach,或活动 ETA 切换),重置为独立目标
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (ftIsEta && !etaFtRows.some((r) => r.etaKey === ftEtaKey && r.name === ftEtaName)) {
      setFtEditTarget({ src: 'model' }); setSelected(null)
    }
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

  const onGenerateAiDraft = async () => {
    if (!etModel) return
    if (aiMode === 'fta_for_barrier' && !aiTargetFeId) {
      setAiError('请先选择一个屏障')
      return
    }
    const targetFe = etModel.functionalEvents.find((fe) => fe.id === aiTargetFeId)
    const context: AiDraftContext = {
      mode: aiMode,
      etaKey: activeKey,
      etaName: activeName,
      targetFeId: aiMode === 'fta_for_barrier' ? aiTargetFeId : undefined,
      targetFeLabel: aiMode === 'fta_for_barrier' ? (targetFe?.label ?? aiTargetFeId) : undefined,
    }
    setAiBusy(true); setAiError(null); setAiNotice(null); setAiDraft(null); setAiDraftContext(context)
    try {
      const draft = await draftAiModel({
        goal: aiGoal,
        target: aiTargetForMode(aiMode),
        current_project: buildPayload() as unknown as Record<string, unknown>,
        active_eta_key: activeKey,
        user_context: {
          mode: aiMode,
          target_fe_id: aiMode === 'fta_for_barrier' ? aiTargetFeId : undefined,
          target_fe_label: aiMode === 'fta_for_barrier' ? (targetFe?.label ?? aiTargetFeId) : undefined,
          library: compactLibraryContext(lib),
        },
      })
      setAiDraft(draft)
    } catch (e: any) {
      setAiError(String(e?.message ?? e))
    } finally {
      setAiBusy(false)
    }
  }

  const onApplyAiDraft = () => {
    if (!aiDraft) return
    try {
      let seq = 0
      const applyEtaKey = (aiMode === 'fta_for_barrier' || aiMode === 'complete_eta')
        ? (aiDraftContext?.etaKey ?? activeKey)
        : activeKey
      const applyTargetFeId = aiMode === 'fta_for_barrier'
        ? (aiDraftContext?.targetFeId ?? aiTargetFeId)
        : aiTargetFeId
      const result = applyAiDraftToProject({
        etaTabs: snapshotActive(etaTabs),
        activeKey: applyEtaKey,
        checkedKeys,
        userFts: userFts.model ?? EMPTY_FTS,
        draft: aiDraft,
        mode: aiMode,
        targetFeId: applyTargetFeId,
        makeKey: () => `ai${Date.now().toString(36)}${(seq++).toString(36)}`,
      })
      const tabs = result.etaTabs as EtaTab[]
      setEtaTabs(tabs)
      setCheckedKeys(result.checkedKeys)
      if (aiMode === 'standalone_fta') userFts.reset(result.userFts)
      const active = tabs.find((t) => t.key === result.activeKey) ?? tabs[0]
      if (active) loadIntoActive(active)
      if (aiMode === 'fta_for_barrier' && applyTargetFeId) {
        setFtEditTarget({ src: 'eta', etaKey: result.activeKey, name: applyTargetFeId })
        setTab('ft')
        const targetFe = active?.model.functionalEvents.find((fe) => fe.id === applyTargetFeId)
        const etaName = active ? etaDisplayName(active, active.model) : '当前 ETA'
        const barrierLabel = aiDraftContext?.targetFeLabel || targetFe?.label || applyTargetFeId
        setAiAppliedResult({ kind: 'fta', etaKey: result.activeKey, etaName, treeName: applyTargetFeId, barrierId: applyTargetFeId, barrierLabel, at: Date.now() })
        setAiNotice(`AI 已打开 FTA: ${barrierLabel}`)
      } else if (aiMode === 'standalone_fta') {
        const incomingCount = aiDraft.fts?.fault_trees?.length ?? 0
        const mergedTrees = result.userFts.fault_trees ?? []
        const firstNewIdx = Math.max(0, mergedTrees.length - incomingCount)
        const openedName = mergedTrees[firstNewIdx]?.name ?? mergedTrees[mergedTrees.length - 1]?.name ?? 'AI_FTA'
        setTab('ft')
        setFtEditTarget({ src: 'standalone', name: openedName })
        setAiAppliedResult({ kind: 'standalone_fta', treeName: openedName, at: Date.now() })
        setAiNotice(`AI 已打开自建 FTA: ${openedName}`)
      } else {
        setTab('bess')
        const etaName = active ? etaDisplayName(active, active.model) : 'AI 草案'
        setAiAppliedResult({ kind: 'eta', mode: aiMode === 'complete_eta' ? 'complete_eta' : 'new_eta', etaKey: result.activeKey, etaName, at: Date.now() })
        setAiNotice(`${aiMode === 'complete_eta' ? 'AI 已补全并切换到 ETA' : 'AI 已新增并切换到 ETA'}: ${etaName}`)
      }
      setAiDraft(null)
      setAiDraftContext(null)
      setAiError(null)
      setAiOpen(false)
    } catch (e: any) {
      setAiError(String(e?.message ?? e))
    }
  }

  const openAiAppliedResult = () => {
    if (!aiAppliedResult) return
    if (aiAppliedResult.kind === 'eta') {
      if (aiAppliedResult.etaKey !== activeKey) selectEta(aiAppliedResult.etaKey)
      setTab('bess')
      return
    }
    if (aiAppliedResult.kind === 'fta') {
      if (aiAppliedResult.etaKey !== activeKey) selectEta(aiAppliedResult.etaKey)
      setFtEditTarget({ src: 'eta', etaKey: aiAppliedResult.etaKey, name: aiAppliedResult.treeName })
      setTab('ft')
      setSelected(null); setResult(null); setError(null)
      return
    }
    setFtEditTarget({ src: 'standalone', name: aiAppliedResult.treeName })
    setTab('ft')
    setSelected(null); setResult(null); setError(null)
  }

  const aiAppliedNotice = aiAppliedResult ? (
    <button type="button" style={aiResultPill} onClick={openAiAppliedResult}>
      <Icon name="check" size={13} />
      {aiAppliedResult.kind === 'eta'
        ? `${aiAppliedResult.mode === 'complete_eta' ? 'AI 已补全 ETA' : 'AI 已新增 ETA'}: ${aiAppliedResult.etaName}`
        : aiAppliedResult.kind === 'fta'
          ? `AI 已打开 FTA: ${aiAppliedResult.barrierLabel}`
          : `AI 已打开自建 FTA: ${aiAppliedResult.treeName}`}
    </button>
  ) : aiNotice ? <span style={aiNoticePill}>{aiNotice}</span> : null

  return (
    <div style={{ height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column', background: '#eef1f4' }}>
      <header style={hdr}>
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
          <button onClick={() => setTab('bess')} style={tabBtn(tab === 'bess')}>事件树（ETA）</button>
          <button onClick={() => setTab('ft')} style={tabBtn(tab === 'ft')}>故障树（FTA）</button>
          <button onClick={() => setTab('params')} style={tabBtn(tab === 'params')}>参数库 / CCF</button>
          <button onClick={() => setTab('library')} style={tabBtn(tab === 'library')}>参考库</button>
          <button onClick={() => setTab('cons')} style={tabBtn(tab === 'cons')}>后果</button>
          <button onClick={() => setTab('fmea')} style={tabBtn(tab === 'fmea')}>FMEA</button>
        </nav>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--psa-chrome-ink)' }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--psa-ok)', boxShadow: '0 0 6px var(--psa-ok)' }} />引擎就绪</div>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--psa-chrome-2)', color: 'var(--psa-chrome-ink)', fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(255,255,255,.12)' }}>ZL</div>
        </div>
      </header>

      {tab === 'ft' ? (
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
            {(userFts.model?.fault_trees ?? []).map((ft) => (
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
                  ETA 故障树: <strong>{ftEtaName === '__init__' ? '初始事件' : (etModel?.functionalEvents.find((f) => f.id === ftEtaName)?.label ?? ftEtaName)}</strong>
                  {ftEtaName !== '__init__' && (
                    <span style={{ marginLeft: 8, color: 'var(--psa-faint)' }}>
                      PFD = {formatEtaNumber(pfds[ftEtaName])}
                    </span>
                  )}
                  {ftEtaName === '__init__' && etModel && (
                    <span style={{ marginLeft: 8, color: 'var(--psa-faint)' }}>
                      freq = {formatEtaNumber(etModel.initFreq)}
                    </span>
                  )}
                  {/* M2:来源非 FTA 时提示编辑无效 */}
                  {ftEtaName === '__init__' && etModel?.initFreqSource !== 'ft' && (
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
              {aiAppliedNotice}
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
              <button onClick={onSaveWorkspace} disabled={!etModel} className="psa-btn psa-btn--dark" title={savedId ? '更新当前项目存档（原地保存，含自建 FTA 工作区）' : '保存为新项目存档（含自建 FTA 工作区）'}><Icon name="save" size={14} />保存项目</button>
              <button onClick={onExportFile} disabled={!etModel} className="psa-btn" title="导出项目为文件（.psaproj.json，离线可用）"><Icon name="download" size={14} />导出文件</button>
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
      ) : tab === 'params' ? (
        <div style={{ flex: 1, minHeight: 0, background: '#fff' }}>
          {model && (
            <ParamLibrary
              model={model}
              onUpdateParam={(id, v) => set(updateParam(model, id, v))}
              onSetCcf={(groups) => set(setCcf(model, groups))}
            />
          )}
        </div>
      ) : tab === 'library' ? (
        <div style={{ flex: 1, minHeight: 0, background: '#fff' }}>
          <ReferenceLibrary onLibraryChange={() => setLibVersion((n) => n + 1)} />
        </div>
      ) : tab === 'cons' ? (
        <div style={{ flex: 1, minHeight: 0, background: '#fff' }}>
          {etModel ? <ConsequencesTab model={etModel} onChange={etHist.set} /> : <p style={{ padding: 16 }}>加载中…</p>}
        </div>
      ) : tab === 'fmea' ? (
        <FmeaWorkbench
          etModel={etModel}
          lib={lib}
          rows={fmeaRows}
          onRowsChange={persistFmeaRows}
          mapping={fmeaMapping}
          onMappingChange={persistFmeaMapping}
        />
      ) : (
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', position: 'relative', display: 'flex', flexDirection: 'column' }}>
          {/* ETA 工具栏 ribbon */}
          <div style={etaToolbar}>
            <span style={{ fontSize: 11, color: 'var(--psa-muted)', fontWeight: 500 }}>当前 ETA</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--psa-ink)', maxWidth: 220, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{activeName}</span>
            <div style={ribbonDiv} />
            <button onClick={onAddBarrier} disabled={!etModel} className="psa-btn psa-btn--primary"><Icon name="plus" size={14} />添加屏障</button>
            <button onClick={() => setAiOpen((v) => !v)} disabled={!etModel} className="psa-btn" title="打开 AI 建模助手"><Icon name="bolt" size={14} />AI 建模助手</button>
            {aiAppliedNotice}
            <button onClick={etHist.undo} disabled={!etHist.canUndo} title="撤销" className="psa-btn" style={{ width: 30, padding: 0, justifyContent: 'center' }}><Icon name="undo" size={15} /></button>
            <button onClick={etHist.redo} disabled={!etHist.canRedo} title="重做" className="psa-btn" style={{ width: 30, padding: 0, justifyContent: 'center' }}><Icon name="redo" size={15} /></button>
            <div style={ribbonDiv} />
            <button onClick={onSaveWorkspace} disabled={!etModel} className="psa-btn psa-btn--dark" title={savedId ? '更新当前项目存档(原地保存, 不新建副本)' : '保存为新项目存档'}><Icon name="save" size={14} />保存项目</button>
            <button onClick={onSaveAs} disabled={!etModel} className="psa-btn" title="另存为一份新的项目存档(副本)"><Icon name="download" size={14} />另存为</button>
            <button onClick={onExportFile} disabled={!etModel} className="psa-btn" title="导出项目为文件(.psaproj.json, 离线可用)"><Icon name="download" size={14} />导出文件</button>
            <label className="psa-btn" title="从文件导入项目" style={{ cursor: 'pointer' }}><Icon name="upload" size={14} />导入文件
              <input type="file" accept=".json,.psaproj.json" style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onImportFile(f); e.currentTarget.value = '' }} />
            </label>
            <select value="" onChange={(e) => { if (e.target.value) { openEta(e.target.value); e.currentTarget.value = '' } }} style={ribbonSelect} title="打开内置场景为新页签">
              <option value="">打开场景…</option>
              {scenarios.map((s) => <option key={s.id} value={'sc:' + s.id}>{s.name}</option>)}
            </select>
            <span style={{ fontSize: 12, color: 'var(--psa-muted)' }}>存档</span>
            <select value={savedId} onChange={(e) => { setSavedId(e.target.value); if (e.target.value) loadProject(e.target.value) }} style={ribbonSelect}>
              <option value="">—</option>
              {saved.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button onClick={onDeleteSaved} disabled={!savedId} className="psa-btn psa-btn--danger"><Icon name="trash" size={14} />删除</button>
            {archiveLocal && <span style={{ fontSize: 11.5, color: 'var(--psa-faint)' }} title="后端不可达,存档保存在此浏览器(localStorage)">离线存档</span>}
            <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--psa-faint)' }}>前端积式实时;引擎精确量化按需</span>
          </div>

          {aiOpen && (
            <AiDraftPanel
              goal={aiGoal}
              mode={aiMode}
              targetEtaName={aiDraftContext?.etaName ?? activeName}
              targetFeId={aiDraftContext?.targetFeId ?? aiTargetFeId}
              targetFeLabel={aiDraftContext?.targetFeLabel}
              functionalEvents={etModel?.functionalEvents ?? []}
              draft={aiDraft}
              busy={aiBusy}
              error={aiError}
              onGoalChange={(goal) => { setAiGoal(goal); if (aiDraft) { setAiDraft(null); setAiDraftContext(null) } }}
              onModeChange={(mode) => { setAiMode(mode); setAiDraft(null); setAiDraftContext(null); setAiError(null) }}
              onTargetFeIdChange={(id) => { setAiTargetFeId(id); setAiDraft(null); setAiDraftContext(null); setAiError(null) }}
              onGenerate={onGenerateAiDraft}
              onApply={onApplyAiDraft}
              onClose={() => setAiOpen(false)}
            />
          )}

          {/* ETA 页签 */}
          <div style={etaTabsRow}>
            {summaries.map((s) => {
              const aiEtaTag = aiAppliedResult?.kind === 'eta' && aiAppliedResult.etaKey === s.key
                ? (aiAppliedResult.mode === 'complete_eta' ? 'AI 补全' : 'AI 新增')
                : ''
              return (
                <div key={s.key} onClick={() => selectEta(s.key)}
                  onDoubleClick={() => {
                    const t = etaTabs.find((x) => x.key === s.key); if (!t) return
                    const cur = etaDisplayName(t, s.key === activeKey ? etModel : t.model)
                    const name = window.prompt('ETA 名称', cur)
                    if (name && name.trim()) setEtaTabs((list) => list.map((x) => x.key === s.key ? { ...x, name: name.trim(), renamed: true } : x))
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
              <EventTreeEditor model={etModel} onChange={etHist.set}
                linked={{ fault_trees: etFts.model?.fault_trees ?? [], parameters: etFts.model?.model_data.parameters ?? [] }}
                fts={etFts.model} ftsApi={{ set: etFts.set, undo: etFts.undo, redo: etFts.redo, canUndo: etFts.canUndo, canRedo: etFts.canRedo }}
                pfds={pfds} onAttachFt={onAttachFt} onDetachFt={onDetachFt} onFtEdited={onFtEdited}
                libBarriers={lib?.barrier_effectiveness ?? []} libComponents={lib?.component_failure_rates ?? []}
                etaSummaries={summaries} aggregateTotals={aggregateTotals}
                onSelectEta={selectEta} onToggleEta={onToggleEta} onAddBarrier={onAddBarrier}
                onEditInitFt={onEditInitFt} />
            )}
          </div>
        </div>
      )}
      <footer className="psa-statusbar"><span className="psa-dot" style={{ background: 'var(--psa-ok)' }} />引擎就绪<span>·</span><span>{tab === 'bess' ? '事件树（ETA）' : tab === 'ft' ? '故障树（FTA）' : tab === 'params' ? '参数库 / CCF' : tab === 'library' ? '参考库' : tab === 'fmea' ? 'FMEA / RPN 工作台' : '后果'}</span><span style={{ marginLeft: 'auto' }} className="psa-num">v2.0</span></footer>
      {/* 初始事件 FTA 模态 */}
      {initFtOpen && etFts.model && (
        <BarrierFtModal
          model={etFts.model}
          ftName="__init__"
          api={{ set: etFts.set, undo: etFts.undo, redo: etFts.redo, canUndo: etFts.canUndo, canRedo: etFts.canRedo }}
          pfd={etModel?.initFreq}
          libComponents={lib?.component_failure_rates ?? []}
          onClose={onInitFtClose}
        />
      )}
    </div>
  )
}

const hdr: CSSProperties = { display: 'flex', alignItems: 'center', gap: 18, padding: '0 16px', minHeight: 54, flexShrink: 0, background: 'var(--psa-chrome)', borderBottom: '1px solid #000' }
const toolbar: CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 10, rowGap: 8, padding: '8px 14px', borderBottom: '1px solid var(--psa-line)', background: 'var(--psa-surface)' }
const tabBtn = (active: boolean): CSSProperties => ({ background: active ? 'var(--psa-primary)' : 'transparent', color: active ? '#fff' : 'var(--psa-chrome-ink)', border: 0, borderRadius: 6, padding: '6px 14px', fontSize: 13, fontWeight: active ? 500 : 400, cursor: 'pointer', whiteSpace: 'nowrap', boxShadow: active ? '0 1px 0 rgba(255,255,255,.2) inset,0 1px 3px rgba(0,0,0,.35)' : 'none' })

const etaToolbar: CSSProperties = { minHeight: 46, flexShrink: 0, background: 'var(--psa-soft-2)', borderBottom: '1px solid var(--psa-line-2)', display: 'flex', alignItems: 'center', padding: '0 14px', gap: 10, flexWrap: 'wrap' }
const ribbonSelect: CSSProperties = { height: 30, border: '1px solid var(--psa-line-strong)', borderRadius: 7, padding: '0 8px', fontSize: 12.5, color: 'var(--psa-ink)', background: 'var(--psa-surface)' }
const ribbonDiv: CSSProperties = { width: 1, height: 22, background: 'var(--psa-line-2)' }
const aiNoticePill: CSSProperties = { maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', border: '1px solid rgba(22,163,74,.22)', borderRadius: 7, background: 'rgba(22,163,74,.1)', color: 'var(--psa-ok)', padding: '5px 9px', fontSize: 12, fontWeight: 600 }
const aiResultPill: CSSProperties = { maxWidth: 460, minHeight: 30, display: 'inline-flex', alignItems: 'center', gap: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', border: '1px solid rgba(37,99,235,.25)', borderRadius: 7, background: 'var(--psa-primary-soft)', color: 'var(--psa-primary-strong)', padding: '5px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }

const etaTabsRow: CSSProperties = { minHeight: 42, flexShrink: 0, background: 'var(--psa-bg)', borderBottom: '1px solid var(--psa-line-2)', display: 'flex', alignItems: 'flex-end', padding: '0 12px', gap: 3, flexWrap: 'wrap' }
const etaTabStyle = (active: boolean): CSSProperties => ({ display: 'flex', alignItems: 'center', gap: 7, height: 34, padding: '0 10px 0 14px', borderRadius: '8px 8px 0 0', background: active ? 'var(--psa-surface)' : 'var(--psa-line)', border: `1px solid ${active ? 'var(--psa-line-2)' : 'transparent'}`, borderBottom: active ? '1px solid var(--psa-surface)' : '1px solid transparent', fontSize: 12.5, fontWeight: active ? 600 : 400, color: active ? 'var(--psa-ink)' : 'var(--psa-muted)', cursor: 'pointer', position: 'relative', top: 1, maxWidth: 248 })
const etaAiTag: CSSProperties = { flexShrink: 0, border: '1px solid rgba(37,99,235,.22)', borderRadius: 5, padding: '1px 5px', background: 'var(--psa-primary-soft)', color: 'var(--psa-primary-strong)', fontSize: 10.5, fontWeight: 700 }
const etaTabActionBtn: CSSProperties = { width: 22, height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 0, borderRadius: 5, background: 'transparent', color: 'var(--psa-faint)', cursor: 'pointer', padding: 0, flexShrink: 0 }
const etaAddBtn: CSSProperties = { width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: '1px dashed var(--psa-faint)', borderRadius: 8, color: 'var(--psa-muted)', cursor: 'pointer', marginLeft: 4, marginBottom: 1 }

const ftSidebar: CSSProperties = { width: 192, flexShrink: 0, borderRight: '1px solid var(--psa-line)', background: 'var(--psa-soft)', overflowY: 'auto', display: 'flex', flexDirection: 'column', paddingBottom: 12 }
const ftSidebarGroup: CSSProperties = { padding: '8px 10px 4px', fontSize: 10.5, fontWeight: 700, color: 'var(--psa-muted)', textTransform: 'uppercase', letterSpacing: '.5px', borderBottom: '1px solid var(--psa-line)', background: 'var(--psa-soft)' }
const ftSidebarSubhead: CSSProperties = { padding: '6px 10px 3px', fontSize: 11.5, fontWeight: 700, color: 'var(--psa-ink-2)', background: 'var(--psa-primary-soft)', borderBottom: '1px solid var(--psa-line)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
const ftSidebarEmpty: CSSProperties = { padding: '8px 12px', fontSize: 11.5, color: 'var(--psa-faint)', fontStyle: 'italic' }
const ftSidebarRow = (active: boolean, marked = false): CSSProperties => ({ display: 'flex', flexDirection: 'column', gap: 2, padding: '6px 12px', cursor: 'pointer', fontSize: 12, background: active || marked ? 'var(--psa-primary-soft)' : 'transparent', borderLeft: active || marked ? '3px solid var(--psa-primary)' : '3px solid transparent', color: active || marked ? 'var(--psa-primary-strong)' : 'var(--psa-ink-2)', transition: 'background .12s' })
const ftTreeNameText: CSSProperties = { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--psa-faint)', fontSize: 10.5, fontFamily: 'var(--psa-font-mono)' }
const ftAiTag: CSSProperties = { alignSelf: 'flex-start', border: '1px solid rgba(37,99,235,.22)', borderRadius: 5, padding: '1px 5px', background: 'rgba(255,255,255,.75)', color: 'var(--psa-primary-strong)', fontSize: 10.5, fontWeight: 700 }
