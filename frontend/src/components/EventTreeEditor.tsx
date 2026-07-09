import { useEffect, useRef, useState } from 'react'
import type { EventTreeModel } from '../eventtree'
import {
  addFe, layout, toEngineRequest, CONSEQUENCES,
  consequenceTotals, consLevel, consDef, reorderFe, isCascade, gradeLabel,
} from '../eventtree'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { BarrierFtModal } from './BarrierFtModal'
import { RiskMatrix } from './RiskMatrix'
import { RiskSummary } from './RiskSummary'
import { SequencePaths } from './SequencePaths'
import { quantifyEventTree, importanceEventTree, exportReport } from '../api'
import { svgToPng } from '../util/svgToPng'
import { formatEtaNumber } from '../etaNumberFormat'
import { useViewStore } from '../stores/viewStore'
import { EtCanvas } from './eta/EtCanvas'
import { EtInspector } from './eta/EtInspector'
import { EtKpiStrip } from './eta/EtKpiStrip'
import { EtaSummaryList } from './eta/EtaSummaryList'
import type { SeqRow } from './eta/types'

interface Linked { fault_trees: any[]; parameters: any[]; ccf_groups?: any[] }
interface Api { set: (m: any) => void; undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean }
export interface EtaSummary { key: string; name: string; leafCount: number; worstC: string; worstFreq: number; active: boolean; checked: boolean }

/**
 * ETA 工作台容器(§三拆分后):选中态/量化与导出副作用/序列行计算在此,
 * 画布(EtCanvas)、检视器(EtInspector)、KPI 条、汇总清单为纯展示子组件。
 */
export function EventTreeEditor(
  { model, onChange, linked, fts, ftsApi, pfds, onAttachFt, onDetachFt, onFtEdited, libBarriers, libComponents,
    etaSummaries = [], aggregateTotals, onSelectEta, onToggleEta, onAddBarrier, onEditInitFt, reportContext }: {
    model: EventTreeModel; onChange: (m: EventTreeModel) => void; linked?: Linked
    fts?: any; ftsApi?: Api; pfds?: Record<string, number>
    onAttachFt?: (idx: number) => void; onDetachFt?: (idx: number) => void; onFtEdited?: (feId: string) => void
    libBarriers?: { id: string; name: string; pfd: number; source?: { citation?: string } }[]
    libComponents?: any[]
    etaSummaries?: EtaSummary[]; aggregateTotals?: Record<string, number>
    onSelectEta?: (key: string) => void; onToggleEta?: (key: string) => void; onAddBarrier?: () => void
    onEditInitFt?: () => void
    /** ADR-2 报告钉扎:随导出请求提交项目上下文 → 后端 auto-pin 版本 + 案例 + 证据页脚 */
    reportContext?: { project_uuid: string; project_payload: unknown }
  },
) {
  const [sel, setSel] = useState<string[] | null>(null)
  const [editingFt, setEditingFt] = useState<string | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [expBusy, setExpBusy] = useState(false)
  const [engineSeq, setEngineSeq] = useState<Record<string, number> | null>(null)
  const [qBusy, setQBusy] = useState(false)
  const [qErr, setQErr] = useState<string | null>(null)
  const [imp, setImp] = useState<Record<string, { barrier: string; fv: number; raw: number }[]> | null>(null)
  const [impC, setImpC] = useState('C5')
  const [deepBusy, setDeepBusy] = useState(false)

  useEffect(() => { setEngineSeq(null); setQErr(null); setImp(null) }, [model])

  // 竖向分隔条:拖拽改变事件树画布高度,底部坞(事故序列/风险矩阵等)相应变矮;双击复位为自适应
  const treeRef = useRef<HTMLElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const treeH = useViewStore((s) => s.treeH)
  const setTreeH = useViewStore((s) => s.setTreeH)
  const onSplitDrag = (e: ReactPointerEvent) => {
    const tree = treeRef.current, bottom = bottomRef.current
    if (!tree || !bottom) return
    const y0 = e.clientY, h0 = tree.offsetHeight
    const total = h0 + bottom.offsetHeight
    const min = 200, max = Math.max(min + 80, total - 170)
    let h = h0
    const move = (ev: PointerEvent) => {
      h = Math.max(min, Math.min(max, h0 + (ev.clientY - y0)))
      tree.style.flex = `0 0 ${h}px`
    }
    const up = () => {
      setTreeH(h)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'row-resize'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    e.preventDefault()
  }

  // 横向分隔条:鼠标左右拖拽改变风险矩阵区域宽度(固定事故序列列宽,矩阵列自适应填充);双击复位为比例
  const seqRef = useRef<HTMLElement>(null)
  const matrixRef = useRef<HTMLElement>(null)
  const seqW = useViewStore((s) => s.seqW)
  const setSeqW = useViewStore((s) => s.setSeqW)
  const onColDrag = (e: ReactPointerEvent) => {
    const seq = seqRef.current, matrix = matrixRef.current
    if (!seq || !matrix) return
    const x0 = e.clientX, w0 = seq.offsetWidth
    const total = w0 + matrix.offsetWidth
    const min = 150, max = Math.max(min + 80, total - 360)
    let w = w0
    const move = (ev: PointerEvent) => {
      w = Math.max(min, Math.min(max, w0 + (ev.clientX - x0)))
      seq.style.flex = `0 0 ${w}px`
    }
    const up = () => {
      setSeqW(w)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    e.preventDefault()
  }

  const { nodes, leafCount } = layout(model, 46, 64)   // 与 EtCanvas 同参 → 同一 DFS 叶序
  const selKey = sel ? sel.join('/') : ' '

  const onEngineQuantify = async () => {
    setQBusy(true); setQErr(null)
    try { setEngineSeq((await quantifyEventTree(toEngineRequest(model, linked))).sequences) }
    catch (e: any) { setQErr(String(e?.message ?? e)) }
    finally { setQBusy(false) }
  }
  const onDeepen = async () => {
    setDeepBusy(true); setQErr(null)
    try { const im = await importanceEventTree(toEngineRequest(model, linked)); setImp(im.importance) }
    catch (e: any) { setQErr(String(e?.message ?? e)) }
    finally { setDeepBusy(false) }
  }
  const onExport = async (fmt: 'docx' | 'pdf' | 'csv') => {
    setExpBusy(true); setQErr(null)
    try {
      const req = toEngineRequest(model, linked)
      let png: string | undefined
      if (fmt !== 'csv' && svgRef.current) png = await svgToPng(svgRef.current)
      await exportReport(fmt, {
        ...req, samples: 1000,
        consequence_defs: Object.fromEntries(CONSEQUENCES.map((c) => [c, consDef(model, c)])),
        labels: Object.fromEntries(model.functionalEvents.map((f) => [f.id, f.label])),
        ...(reportContext ?? {}),                            // ADR-2:钉扎版本 + 案例 + 证据页脚
      }, model.initEvent, png)
    } catch (e: any) { setQErr(String(e?.message ?? e)) }
    finally { setExpBusy(false) }
  }
  const onExportImage = async (fmt: 'png' | 'svg') => {
    if (!svgRef.current) return
    let url: string
    if (fmt === 'png') url = await svgToPng(svgRef.current)
    else url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svgRef.current)], { type: 'image/svg+xml' }))
    const a = document.createElement('a'); a.href = url; a.download = `event_tree.${fmt}`
    document.body.appendChild(a); a.click(); a.remove()
    if (fmt === 'svg') setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const addBarrier = onAddBarrier ?? (() => onChange(addFe(model)))
  const moveFe = (d: number, dir: -1 | 1) => {
    const t = d + dir
    if (t < 0 || t >= model.functionalEvents.length) return
    if (!isCascade(model) && !window.confirm('该 ETA 含自定义分支结构,调整屏障次序将重建为标准级联,继续?')) return
    onChange(reorderFe(model, d, t))
  }

  // ── 末态序列（叶按 DFS 成功优先 = 引擎 L0..Ln 同序）──
  const leaves = nodes.filter((n) => n.kind === 'leaf')
  const sevIdx = (c?: string) => CONSEQUENCES.indexOf(consLevel(model, c ?? 'C1'))
  const barrierPath = (path: string[]) => {
    const out: { feId: string; outcome: 'success' | 'failure' }[] = []
    let n = model.root
    for (const step of path) {
      if (n.kind !== 'branch') break
      out.push({ feId: n.feId, outcome: step as 'success' | 'failure' })
      n = step === 'success' ? n.success : n.failure
    }
    return out
  }
  const seqRows: SeqRow[] = leaves.map((lf, i) => {
    const feFreq = lf.freq ?? 0
    const engFreq = engineSeq?.[`L${i}`]
    const diff = engFreq !== undefined && Math.abs(engFreq - feFreq) > 1e-9 * Math.max(1, Math.abs(feFreq))
    return { i, seq: i + 1, lf, freq: engFreq ?? feFreq, c: lf.consequence ?? 'C1', path: barrierPath(lf.path), diff }
  })
  // KPI（当前 ETA）
  const totalSevere = seqRows.filter((r) => sevIdx(r.c) >= 3).reduce((a, r) => a + r.freq, 0)
  const worstSev = seqRows.reduce((mx, r) => (r.freq > 0 && sevIdx(r.c) > mx ? sevIdx(r.c) : mx), -1)
  const worstC = worstSev >= 0 ? CONSEQUENCES[worstSev] : '—'
  const worstFreq = worstSev >= 0 ? seqRows.filter((r) => sevIdx(r.c) === worstSev).reduce((a, r) => a + r.freq, 0) : 0
  const kpis = [
    { label: '初因事件频率（总）', value: formatEtaNumber(model.initFreq), unit: '/yr' },
    { label: '严重后果（≥III）累计', value: formatEtaNumber(totalSevere), unit: '/yr' },
    { label: `最严重后果（${gradeLabel(worstC)}）`, value: worstSev >= 0 ? formatEtaNumber(worstFreq) : '—', unit: '/yr' },
    { label: '后果序列 / 屏障', value: `${leafCount} / ${model.functionalEvents.length}`, unit: '条·个' },
  ]

  // 多 ETA 汇总(由 App 传入;独立使用时回退到当前 ETA)
  const aggTotals = aggregateTotals ?? consequenceTotals(model)
  const aggSevere = (aggTotals.C4 ?? 0) + (aggTotals.C5 ?? 0)
  const aggCount = etaSummaries.filter((s) => s.checked).length

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', gap: 12, alignItems: 'stretch' }}>
      {/* ============ WORKSPACE ============ */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>

        <EtKpiStrip kpis={kpis} />

        {/* ---- TREE PANEL: 树 + 末态表并排（画布最大、可横向滑窗）---- */}
        <section ref={treeRef} className="psa-panel" style={{ flex: treeH == null ? '4.5 1 0' : `0 0 ${treeH}px`, minHeight: 180 }}>
          <div className="psa-ch">
            <span className="t">事件树 · 纵深防御序列</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span className="psa-chip"><span className="sq" style={{ background: 'var(--psa-c1)', width: 18, height: 3, borderRadius: 2 }} />成功</span>
              <span className="psa-chip"><span className="sq" style={{ background: 'var(--psa-danger)', width: 18, height: 3, borderRadius: 2 }} />失效</span>
            </div>
            <span className="meta">{leafCount} 序列 · {engineSeq ? '引擎精确' : '前端积式'}</span>
          </div>
          <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
            <EtCanvas model={model} pfds={pfds} seqRows={seqRows} sel={sel} onSelect={setSel} onChange={onChange} svgRef={svgRef} />
          </div>
        </section>

        {/* ---- 竖向分隔条:拖拽改画布/底栏高度(双击复位)---- */}
        <div className="psa-vsplit" onPointerDown={onSplitDrag} onDoubleClick={() => setTreeH(null)} title="拖拽调整画布高度 · 双击复位"><i /></div>

        {/* ---- BOTTOM DOCK: 多 ETA 汇总矩阵 + ETA 勾选清单 ---- */}
        <div ref={bottomRef} style={{ flex: '4 1 0', minHeight: 160, display: 'flex', gap: 12, alignItems: 'stretch' }}>
          <section ref={seqRef} className="psa-panel" style={{ flex: seqW == null ? '1 1 0' : `0 0 ${seqW}px`, minWidth: 0 }}>
            <div className="psa-ch">
              <span className="t">事故序列路径图</span>
              <span className="meta">{leafCount} 序列 · 按频率</span>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
              <SequencePaths rows={seqRows} model={model} selKey={selKey} onSelect={setSel} />
            </div>
          </section>
          {/* ---- 横向分隔条:左右拖拽改风险矩阵宽度(双击复位)---- */}
          <div className="psa-hsplit" onPointerDown={onColDrag} onDoubleClick={() => setSeqW(null)} title="左右拖拽调整风险矩阵宽度 · 双击复位"><i /></div>
          <section ref={matrixRef} className="psa-panel" style={{ flex: '2 1 0', minWidth: 0 }}>
            <div className="psa-ch">
              <span className="t">风险矩阵 · 多 ETA 汇总</span>
              <span className="meta">{aggCount} 个 ETA</span>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <RiskMatrix totals={aggTotals} />
              <RiskSummary totals={aggTotals} etaCount={aggCount} />
            </div>
          </section>
          <EtaSummaryList etaSummaries={etaSummaries} aggSevere={aggSevere} onSelectEta={onSelectEta} onToggleEta={onToggleEta} />
        </div>
      </div>

      {/* ============ INSPECTOR ============ */}
      <EtInspector
        model={model} onChange={onChange} sel={sel} onSelect={setSel} seqRows={seqRows}
        engineSeq={engineSeq} imp={imp} impC={impC} onImpCChange={setImpC}
        qBusy={qBusy} deepBusy={deepBusy} expBusy={expBusy} qErr={qErr}
        onEngineQuantify={onEngineQuantify} onDeepen={onDeepen} onExport={onExport} onExportImage={onExportImage}
        pfds={pfds} canEditFt={!!fts && !!ftsApi} onEditFt={setEditingFt}
        onAttachFt={onAttachFt} onDetachFt={onDetachFt} libBarriers={libBarriers}
        onAddBarrier={addBarrier} onMoveFe={moveFe} onEditInitFt={onEditInitFt}
      />

      {editingFt && fts && ftsApi && (
        <BarrierFtModal model={fts} ftName={editingFt} api={ftsApi} pfd={pfds?.[editingFt]} libComponents={libComponents}
          onClose={() => { const id = editingFt; setEditingFt(null); onFtEdited?.(id) }} />
      )}
    </div>
  )
}
