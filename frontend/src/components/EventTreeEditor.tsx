import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import type { EventTreeModel } from '../eventtree'
import { buildAnalysisRequest } from '../features/analysis/buildRequest'
import {
  addFe, layout, CONSEQUENCES,
  consequenceTotals, consLevel, consDef, reorderFe, isCascade, gradeLabel,
} from '../eventtree'
import type { PointerEvent as ReactPointerEvent } from 'react'
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
import { ETA_CANVAS_CONTENT_ATTR } from './eta/types'
import { Icon } from './icons'

// 懒加载:reactflow 只随故障树画布进入,ETA 关键路径不解析它(性能报障修复 2026-07-09)
const BarrierFtModal = lazy(() => import('./BarrierFtModal').then((m) => ({ default: m.BarrierFtModal })))

interface Linked { fault_trees: any[]; parameters: any[]; ccf_groups?: any[] }
interface Api { set: (m: any) => void; undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean }
export interface EtaSummary { key: string; name: string; leafCount: number; worstC: string; worstFreq: number; active: boolean; checked: boolean }

/**
 * 导出前重置画布缩放/平移(R4a):EtCanvas 把 pan/zoom 变换放在内容 <g data-eta-canvas-content>
 * 上,外层 <svg ref={svgRef}> 本身的像素宽高从未被缩放/平移影响(参见 EtCanvas 顶部注释)——
 * 但克隆前该 <g> 上仍带着"当前正在看"的 transform,若原样导出,PNG/SVG 会是缩放/平移后的裁剪画面,
 * 而不是缩放功能加入前那样的完整原图。这里克隆一份并把该 <g> 的 transform 属性清空,
 * 保证导出结果与用户当前的缩放/平移状态无关、与加缩放前的行为逐位一致。
 */
function prepareCanvasForExport(svg: SVGSVGElement): SVGSVGElement {
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.querySelector(`[${ETA_CANVAS_CONTENT_ATTR}]`)?.removeAttribute('transform')
  return clone
}

/**
 * ETA 工作台容器(§三拆分后):选中态/量化与导出副作用/序列行计算在此,
 * 画布(EtCanvas)、检视器(EtInspector)、KPI 条、汇总清单为纯展示子组件。
 */
export function EventTreeEditor(
  { model, onChange, linked, fts, ftsApi, pfds, onAttachFt, onDetachFt, onFtEdited, libBarriers, libComponents,
    etaSummaries = [], aggregateTotals, onSelectEta, onToggleEta, onAddBarrier, onEditInitFt, getReportContext, etEngineOptions }: {
    model: EventTreeModel; onChange: (m: EventTreeModel) => void; linked?: Linked
    fts?: any; ftsApi?: Api; pfds?: Record<string, number>
    onAttachFt?: (idx: number) => void; onDetachFt?: (idx: number) => void; onFtEdited?: (feId: string) => void
    libBarriers?: { id: string; name: string; pfd: number; source?: { citation?: string } }[]
    libComponents?: any[]
    etaSummaries?: EtaSummary[]; aggregateTotals?: Record<string, number>
    onSelectEta?: (key: string) => void; onToggleEta?: (key: string) => void; onAddBarrier?: () => void
    onEditInitFt?: () => void
    /** ADR-2 报告钉扎:随导出请求提交项目上下文 → 后端 auto-pin 版本 + 案例 + 证据页脚 */
    getReportContext?: () => { project_uuid: string; project_payload: unknown }
    /** 4c/Gap8:ETA 分析设置(house 覆盖 / 命名边界条件集)—— 套用到引擎精确量化与重要度;
     *  空对象即零扰动(不含 post 规则:那是 FTA 专属)。F-α 起导出/报告与量化同源消费(FE-01)。 */
    etEngineOptions?: { house_states?: Record<string, boolean>; boundary_condition_set?: string; boundary_condition_sets?: unknown[] }
  },
) {
  const [sel, setSel] = useState<string[] | null>(null)
  const [editingFt, setEditingFt] = useState<string | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [expBusy, setExpBusy] = useState(false)
  const [engineSeq, setEngineSeq] = useState<Record<string, number> | null>(null)
  // 序列级 LFT 集成回执(规格 2026-07-15):method='integrated' 时携带初因频率 ie_frequency,
  // 供「量化结果」页以「集成口径」呈现;非集成(单树)响应此值为 null,头条口径不变。
  const [engineMeta, setEngineMeta] = useState<{ method: string; ieFrequency: number | null } | null>(null)
  const [qBusy, setQBusy] = useState(false)
  const [qErr, setQErr] = useState<string | null>(null)
  const [imp, setImp] = useState<Record<string, { barrier: string; fv: number; raw: number }[]> | null>(null)
  const [impC, setImpC] = useState('C5')
  const [deepBusy, setDeepBusy] = useState(false)

  useEffect(() => { setEngineSeq(null); setEngineMeta(null); setQErr(null); setImp(null) }, [model])

  // 竖向分隔条:拖拽改变事件树画布高度,底部坞(事故序列/风险矩阵等)相应变矮;双击复位为自适应
  const treeRef = useRef<HTMLElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const treeH = useViewStore((s) => s.treeH)
  const setTreeH = useViewStore((s) => s.setTreeH)
  // R4a:画布为主导——事故序列/风险矩阵/ETA 清单默认折叠到底部窄条(展开态与折叠前逐位一致)
  const seqExpanded = useViewStore((s) => s.seqExpanded)
  const setSeqExpanded = useViewStore((s) => s.setSeqExpanded)
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
    // 初因源=故障树 ⇒ 经 withIeFaultTree 并入 ie_fault_tree 块走 integrated 通道(共享事件精确)。
    try {
      const res = await quantifyEventTree(buildAnalysisRequest(model, linked, etEngineOptions))
      setEngineSeq(res.sequences)
      setEngineMeta(res.method === 'integrated' ? { method: res.method, ieFrequency: res.ie_frequency ?? null } : null)
    }
    catch (e: any) { setQErr(String(e?.message ?? e)) }
    finally { setQBusy(false) }
  }
  const onDeepen = async () => {
    setDeepBusy(true); setQErr(null)
    // 4a4:携带项目上下文 → 重要度运行自动钉扎为分析案例(证据链);Gap8:同带边界条件设置
    // 初因源=故障树时同带 ie_fault_tree 块(重要度通道 v1 点估计;块使模型合并一致)。
    try { const im = await importanceEventTree({ ...buildAnalysisRequest(model, linked, etEngineOptions), ...(getReportContext?.() ?? {}) }); setImp(im.importance) }
    catch (e: any) { setQErr(String(e?.message ?? e)) }
    finally { setDeepBusy(false) }
  }
  const onExport = async (fmt: 'docx' | 'pdf' | 'csv') => {
    setExpBusy(true); setQErr(null)
    try {
      // FE-01(F-α):报告与屏幕量化同一构造——此前裸 toEngineRequest 丢集成块/CCF/
      // 边界设置,屏幕集成数、报告标量数,钉扎还按标量模型核验通过(错数带核验章)。
      const req = buildAnalysisRequest(model, linked, etEngineOptions)
      let png: string | undefined
      if (fmt !== 'csv' && svgRef.current) png = await svgToPng(prepareCanvasForExport(svgRef.current))
      await exportReport(fmt, {
        ...req, samples: 1000,
        consequence_defs: Object.fromEntries(CONSEQUENCES.map((c) => [c, consDef(model, c)])),
        labels: Object.fromEntries(model.functionalEvents.map((f) => [f.id, f.label])),
        ...(getReportContext?.() ?? {}),                     // ADR-2:钉扎版本 + 案例 + 证据页脚(点击时惰性构造)
      }, model.initEvent, png)
    } catch (e: any) { setQErr(String(e?.message ?? e)) }
    finally { setExpBusy(false) }
  }
  const onExportImage = async (fmt: 'png' | 'svg') => {
    if (!svgRef.current) return
    const prepared = prepareCanvasForExport(svgRef.current)   // 缩放/平移不应改变导出结果(见函数注释)
    let url: string
    if (fmt === 'png') url = await svgToPng(prepared)
    else url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(prepared)], { type: 'image/svg+xml' }))
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
    // FE-01(F-α):集成量化后 KPI 用响应的 Σλ·P(标「集成」),不再固定显示标量残值
    engineMeta?.method === 'integrated' && engineMeta.ieFrequency != null
      ? { label: '初因事件频率（总·集成）', value: formatEtaNumber(engineMeta.ieFrequency), unit: '/yr' }
      : { label: '初因事件频率（总）', value: formatEtaNumber(model.initFreq), unit: '/yr' },
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

        {/* ---- TREE PANEL: 画布为主导(R4a)——序列坞折叠时占满剩余空间;展开时保持原可拖拽比例 ---- */}
        <section ref={treeRef} className="psa-panel" style={{ flex: seqExpanded ? (treeH == null ? '4.5 1 0' : `0 0 ${treeH}px`) : '1 1 auto', minHeight: 180 }}>
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

        {/* ---- 竖向分隔条:仅展开态可拖拽(折叠态底栏定高,无需拖拽)---- */}
        {seqExpanded && (
          <div className="psa-vsplit" onPointerDown={onSplitDrag} onDoubleClick={() => setTreeH(null)} title="拖拽调整画布高度 · 双击复位"><i /></div>
        )}

        {/* ---- BOTTOM DOCK: 事故序列——默认折叠为窄条(~96px/3 行),展开后与折叠前完全一致
              (多 ETA 汇总矩阵 + ETA 勾选清单同时可见);折叠态状态持久于 viewStore.seqExpanded ---- */}
        <section className="psa-panel" style={{ flex: seqExpanded ? '4 1 0' : '0 0 auto', minHeight: seqExpanded ? 160 : undefined }}>
          <div className="psa-ch">
            <span className="t">事故序列（{leafCount}）</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="meta">{seqExpanded ? `${aggCount} 个 ETA 参与汇总` : '按频率 · 展开可见风险矩阵/ETA 清单'}</span>
              <button type="button" onClick={() => setSeqExpanded(!seqExpanded)} className="exp-collapse-toggle"
                title={seqExpanded ? '收起底栏' : '展开底栏(风险矩阵/ETA 清单)'}>
                <Icon name="chevron-down" size={12} style={{ transform: seqExpanded ? 'none' : 'rotate(180deg)' }} />
                {seqExpanded ? '收起' : '展开'}
              </button>
            </div>
          </div>
          {seqExpanded ? (
            <div ref={bottomRef} style={{ flex: 1, minHeight: 0, display: 'flex', gap: 12, alignItems: 'stretch', padding: 12 }}>
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
          ) : (
            <div style={{ maxHeight: 96, overflowY: 'auto' }}>
              <SequencePaths rows={seqRows} model={model} selKey={selKey} onSelect={setSel} />
            </div>
          )}
        </section>
      </div>

      {/* ============ INSPECTOR ============ */}
      <EtInspector
        model={model} onChange={onChange} sel={sel} onSelect={setSel} seqRows={seqRows}
        engineSeq={engineSeq} engineMeta={engineMeta} imp={imp} impC={impC} onImpCChange={setImpC}
        qBusy={qBusy} deepBusy={deepBusy} expBusy={expBusy} qErr={qErr}
        onEngineQuantify={onEngineQuantify} onDeepen={onDeepen} onExport={onExport} onExportImage={onExportImage}
        pfds={pfds} canEditFt={!!fts && !!ftsApi} onEditFt={setEditingFt}
        onAttachFt={onAttachFt} onDetachFt={onDetachFt} libBarriers={libBarriers}
        onAddBarrier={addBarrier} onMoveFe={moveFe} onEditInitFt={onEditInitFt}
      />

      {editingFt && fts && ftsApi && (
        <Suspense fallback={null}>
          <BarrierFtModal model={fts} ftName={editingFt} api={ftsApi} pfd={pfds?.[editingFt]} libComponents={libComponents}
            onClose={() => { const id = editingFt; setEditingFt(null); onFtEdited?.(id) }} />
        </Suspense>
      )}
    </div>
  )
}
