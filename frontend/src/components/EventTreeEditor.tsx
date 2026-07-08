import { useEffect, useRef, useState } from 'react'
import type { EventTreeModel } from '../eventtree'
import {
  branchLeaf, collapseNode, setConsequence, setFailProb, renameFe, addFe, addBarrierFromLib,
  branchesUsingFe, delFe, nodeAt, layout, toEngineRequest, subsequentFes, CONSEQUENCES,
  setInitEvent, setInitFreq, setInitFreqSource, setProduct, computeProductFreq,
  consequenceTotals, consEntries, consLevel, consText, consDef,
  branchFeOptions, setBranchFe, reorderFe, isCascade,
  gradeLabel, consGrade, applyFieldUpdate,
} from '../eventtree'
import { posteriorPfd } from '../bayes'
import type { BayesPrior } from '../bayes'
import { LibPicker } from './LibPicker'
import type { CSSProperties, PointerEvent as ReactPointerEvent, UIEvent as ReactUIEvent } from 'react'
import { BarrierFtModal } from './BarrierFtModal'
import { RiskMatrix } from './RiskMatrix'
import { RiskSummary } from './RiskSummary'
import { SequencePaths } from './SequencePaths'
import { quantifyEventTree, importanceEventTree, exportReport } from '../api'
import { svgToPng } from '../util/svgToPng'
import { C_COLOR } from '../riskmatrix'
import { Icon } from './icons'
import { formatEtaNumber, formatEtaRate } from '../etaNumberFormat'
const cell: CSSProperties = { border: '1px solid var(--psa-line)', padding: '2px 6px' }
const moveBtn: CSSProperties = { width: 20, height: 22, border: '1px solid var(--psa-line-strong)', borderRadius: 5, background: 'var(--psa-surface)', color: 'var(--psa-muted)', cursor: 'pointer', fontSize: 11, lineHeight: 1, padding: 0, flexShrink: 0 }
const h4s: CSSProperties = { margin: '16px 0 8px', fontSize: 12, fontWeight: 600, color: 'var(--psa-ink-2)', paddingLeft: 8, borderLeft: '2px solid var(--psa-primary)' }
const mono = 'var(--psa-font-mono)'

interface Linked { fault_trees: any[]; parameters: any[] }
interface Api { set: (m: any) => void; undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean }
export interface EtaSummary { key: string; name: string; leafCount: number; worstC: string; worstFreq: number; active: boolean; checked: boolean }

export function EventTreeEditor(
  { model, onChange, linked, fts, ftsApi, pfds, onAttachFt, onDetachFt, onFtEdited, libBarriers, libComponents,
    etaSummaries = [], aggregateTotals, onSelectEta, onToggleEta, onAddBarrier, onEditInitFt }: {
    model: EventTreeModel; onChange: (m: EventTreeModel) => void; linked?: Linked
    fts?: any; ftsApi?: Api; pfds?: Record<string, number>
    onAttachFt?: (idx: number) => void; onDetachFt?: (idx: number) => void; onFtEdited?: (feId: string) => void
    libBarriers?: { id: string; name: string; pfd: number; source?: { citation?: string } }[]
    libComponents?: any[]
    etaSummaries?: EtaSummary[]; aggregateTotals?: Record<string, number>
    onSelectEta?: (key: string) => void; onToggleEta?: (key: string) => void; onAddBarrier?: () => void
    onEditInitFt?: () => void
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
  const [tab, setTab] = useState<'attr' | 'quant' | 'imp'>('attr')
  const [bayesOpen, setBayesOpen] = useState(false)
  const [bayesIn, setBayesIn] = useState<{ N: number; k: number; prior: BayesPrior; n0: number }>({ N: 0, k: 0, prior: 'current', n0: 2 })

  useEffect(() => { setEngineSeq(null); setQErr(null); setImp(null) }, [model])
  useEffect(() => { setBayesOpen(false); setBayesIn({ N: 0, k: 0, prior: 'current', n0: 2 }) }, [sel])

  // 竖向分隔条:拖拽改变事件树画布高度,底部坞(事故序列/风险矩阵等)相应变矮;双击复位为自适应
  const treeRef = useRef<HTMLElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const [treeH, setTreeH] = useState<number | null>(null)
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
  const [seqW, setSeqW] = useState<number | null>(null)
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

  const rowH = 46, headerH = 64, colW = 150, LEFT = 240
  const IE_RIGHT = 188
  const { nodes, leafCount, maxDepth } = layout(model, rowH, headerH)
  const colX = (d: number) => LEFT + d * colW
  const rightX = colX(maxDepth) + 18
  const width = rightX + 176
  const height = headerH + leafCount * rowH + 24
  const rootY = nodes.find((n) => n.path.length === 0)?.y ?? headerH
  const selNode = sel ? nodeAt(model.root, sel) : null
  const selKey = sel ? sel.join('/') : ' '

  const onEngineQuantify = async () => {
    setQBusy(true); setQErr(null)
    try { setEngineSeq((await quantifyEventTree(toEngineRequest(model, linked))).sequences) }
    catch (e: any) { setQErr(String(e?.message ?? e)) }
    finally { setQBusy(false) }
  }
  const onDeepen = async () => {
    setDeepBusy(true); setQErr(null)
    try { const im = await importanceEventTree(toEngineRequest(model, linked)); setImp(im.importance); setTab('imp') }
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

  const selFeId = selNode?.kind === 'branch' ? selNode.feId : undefined
  const selFe = selFeId ? model.functionalEvents.find((f) => f.id === selFeId) : undefined
  const selIdx = selFe ? model.functionalEvents.indexOf(selFe) : -1
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
  const seqRows = leaves.map((lf, i) => {
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

  // 冻结表头:树画布纵向下滑时,屏障列头(事件序列)固定可视;横向滚动则与列同步平移(直接改 DOM,免逐帧重渲染)
  const scrollXRef = useRef(0)
  const headerSvgRef = useRef<SVGSVGElement>(null)
  const onTreeScroll = (e: ReactUIEvent<HTMLDivElement>) => {
    scrollXRef.current = e.currentTarget.scrollLeft
    if (headerSvgRef.current) headerSvgRef.current.style.transform = `translateX(${-scrollXRef.current}px)`
  }
  // 屏障列头（名称 + PFD）+「序列/频率」表头文字;在主 SVG(供导出)与冻结表头层各渲染一次
  const renderColumnHeadings = () => (
    <>
      {model.functionalEvents.slice(0, maxDepth).map((fe, d) => {
        const nm = fe.label || fe.id
        const p = Math.max(0, Math.min(1, pfds?.[fe.id] ?? fe.failProb ?? 0))
        return (
          <g key={d}>
            <text x={colX(d)} y={28} fontSize={11.5} fontWeight={600} textAnchor="middle" fill="var(--psa-ink-2)">
              {nm.length > 11 ? nm.slice(0, 11) + '…' : nm}
              <title>{nm}（{fe.id}）</title>
            </text>
            <text x={colX(d)} y={44} fontSize={9.5} fill="var(--psa-faint)" textAnchor="middle" fontFamily={mono}>PFD {formatEtaNumber(p)}</text>
          </g>
        )
      })}
      <text x={rightX} y={28} fontSize={10.5} fontWeight={600} fill="var(--psa-faint)">序列 / 频率</text>
    </>
  )

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', gap: 12, alignItems: 'stretch' }}>
      {/* ============ WORKSPACE ============ */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* ---- KPI strip (current ETA) ---- */}
        <div style={{ flexShrink: 0, display: 'flex', gap: 10 }}>
          {kpis.map((k, i) => (
            <div key={i} className="psa-kpi">
              <span className="l">{k.label}</span>
              <span className="v">{k.value}<small>{k.unit}</small></span>
            </div>
          ))}
        </div>

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
            {/* tree canvas — 横向滚动; 外层 relative 承载冻结表头 */}
            <div style={{ flex: 1, minWidth: 0, position: 'relative', overflow: 'hidden' }}>
              <div onScroll={onTreeScroll} style={{ position: 'absolute', inset: 0, overflow: 'auto', backgroundImage: 'radial-gradient(circle at 1px 1px,var(--psa-line) 1.2px,transparent 0)', backgroundSize: '20px 20px' }}>
              <svg ref={svgRef} width={width} height={height} style={{ display: 'block', fontFamily: '"IBM Plex Sans","Noto Sans SC",sans-serif' }}>
                {/* 初始事件（浅色节点）*/}
                <rect x={8} y={rootY - 26} width={IE_RIGHT - 8} height={52} rx={8} fill="var(--psa-soft)" stroke="var(--psa-line-2)" />
                <rect x={8} y={rootY - 26} width={4} height={52} rx={2} fill="var(--psa-accent)" />
                <text x={22} y={rootY - 8} fontSize={9} fill="var(--psa-muted)">初始事件</text>
                <text x={22} y={rootY + 6} fontSize={12} fontWeight={600} fill="var(--psa-ink)">
                  {model.initEvent.length > 12 ? model.initEvent.slice(0, 12) + '…' : model.initEvent}
                  <title>{model.initEvent}</title>
                </text>
                <text x={22} y={rootY + 20} fontSize={9.5} fill="var(--psa-faint)" fontFamily={mono}>{formatEtaNumber(model.initFreq)} /yr</text>
                <line x1={IE_RIGHT} y1={rootY} x2={colX(0)} y2={rootY} stroke="var(--psa-ink-2)" strokeWidth={1.6} />

                {/* 屏障列竖向虚线（结构线;表头文字见 renderColumnHeadings,随冻结表头固定）*/}
                {model.functionalEvents.slice(0, maxDepth).map((_fe, d) => (
                  <line key={d} x1={colX(d)} y1={headerH - 6} x2={colX(d)} y2={height - 12} stroke="var(--psa-line)" strokeDasharray="3 3" />
                ))}
                {renderColumnHeadings()}

                {/* 直角连接器（结构线灰 + 裸概率标签）*/}
                {nodes.filter((n) => n.kind === 'branch').map((b, i) => {
                  const x = colX(b.depth)
                  const xs = colX(b.successCol ?? b.depth + 1)
                  const xf = colX(b.failureCol ?? b.depth + 1)
                  const fe = model.functionalEvents[b.depth]
                  const pfd = Math.max(0, Math.min(1, pfds?.[fe?.id ?? ''] ?? fe?.failProb ?? 0))
                  return (
                    <g key={'b' + i}>
                      <line x1={x} y1={b.successY} x2={x} y2={b.failureY} stroke="var(--psa-faint)" strokeWidth={1.4} />
                      <line x1={x} y1={b.successY} x2={xs} y2={b.successY} stroke="#16a34a" strokeWidth={1.8} />
                      <text x={x + 7} y={b.successY! - 4} fontSize={9.5} fill="#16a34a" fontFamily={mono}>{formatEtaNumber(1 - pfd)}</text>
                      <line x1={x} y1={b.failureY} x2={xf} y2={b.failureY} stroke="#dc2626" strokeWidth={1.8} />
                      <text x={x + 7} y={b.failureY! - 4} fontSize={9.5} fill="#dc2626" fontFamily={mono}>{formatEtaNumber(pfd)}</text>
                    </g>
                  )
                })}

                {/* 叶: 后果方块 + Cn·名称 + 频率（整列右对齐）*/}
                {leaves.map((lf, i) => {
                  const lvl = consLevel(model, lf.consequence!)
                  const cc = C_COLOR[lvl] || '#64748b'
                  const nm = consText(model, lf.consequence!)
                  const on = selKey === lf.path.join('/')
                  const r = seqRows[i]
                  const branchCol = lf.path.length && lf.path[lf.path.length - 1] === 'failure' ? '#dc2626' : '#16a34a'
                  return (
                    <g key={'l' + i} style={{ cursor: 'pointer' }} onClick={() => setSel(lf.path)}>
                      <line x1={colX(lf.depth)} y1={lf.y} x2={rightX} y2={lf.y} stroke={branchCol} strokeWidth={1.5} />
                      {on && <rect x={rightX - 7} y={lf.y - 10} width={158} height={20} rx={5} fill={cc} opacity={0.12} />}
                      <rect x={rightX - 5} y={lf.y - 5.5} width={11} height={11} rx={2.5} fill={cc} />
                      <text x={rightX + 14} y={lf.y - 1} fontSize={11.5} fontWeight={600}>
                        <tspan fill={cc} fontFamily={mono}>{gradeLabel(lvl)}</tspan>
                        <tspan dx={5} fill="var(--psa-ink)">· {nm.length > 8 ? nm.slice(0, 8) + '…' : nm}</tspan>
                        <title>{gradeLabel(lvl)} — {nm}</title>
                      </text>
                      <text x={rightX + 14} y={lf.y + 11} fontSize={10} fill="var(--psa-faint)" fontFamily={mono}>
                        {r?.diff ? '▶ ' : ''}{formatEtaNumber(r?.freq ?? 0)} /yr
                      </text>
                    </g>
                  )
                })}

                {/* 分支锚点 */}
                {nodes.filter((n) => n.kind === 'branch').map((n, i) => (
                  <circle key={'a' + i} cx={colX(n.depth)} cy={n.y} r={4.5}
                    fill={selKey === n.path.join('/') ? '#f59e0b' : 'var(--psa-surface)'} stroke="var(--psa-primary)" strokeWidth={1.4}
                    style={{ cursor: 'pointer' }} onClick={() => setSel(n.path)} />
                ))}

                {/* 选中可继续的叶 → 后续屏障 */}
                {(() => {
                  if (selNode?.kind !== 'leaf' || !sel) return null
                  const lf = nodes.find((n) => n.kind === 'leaf' && n.path.join('/') === selKey)
                  if (!lf) return null
                  const subs = subsequentFes(model, sel)
                  if (subs.length === 0) return null
                  const mx = rightX + 178, mw = 160, ih = 18
                  return (
                    <g>
                      <rect x={mx} y={lf.y - 14} width={mw} height={18 + subs.length * ih} rx={6} fill="var(--psa-surface)" stroke="#f59e0b" strokeWidth={1} />
                      <text x={mx + 8} y={lf.y - 1} fontSize={9} fontWeight={700} fill="var(--psa-warn)">＋继续到屏障:</text>
                      {subs.map((f, k) => (
                        <g key={f.id} style={{ cursor: 'pointer' }} onClick={() => { onChange(branchLeaf(model, lf.path, f.id)); setSel(null) }}>
                          <rect x={mx + 5} y={lf.y + 4 + k * ih} width={mw - 10} height={ih - 2} rx={4} fill="var(--psa-soft)" />
                          <text x={mx + 10} y={lf.y + 4 + k * ih + 12} fontSize={10} fill="var(--psa-ink-2)">{(f.label || f.id).slice(0, 16)}<title>{f.label || f.id}（{f.id}）</title></text>
                        </g>
                      ))}
                    </g>
                  )
                })()}
              </svg>
              </div>
              {/* 冻结表头:纵向下滑时屏障列头(事件序列)固定可视 */}
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: headerH, overflow: 'hidden', pointerEvents: 'none', background: 'var(--psa-surface)', borderBottom: '1px solid var(--psa-line)' }}>
                <svg ref={headerSvgRef} width={width} height={headerH} style={{ display: 'block', transform: `translateX(${-scrollXRef.current}px)` }}>
                  {renderColumnHeadings()}
                </svg>
              </div>
            </div>
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
          <section className="psa-panel" style={{ width: 'var(--psa-side-w)', flexShrink: 0 }}>
            <div className="psa-ch">
              <span className="t">参与汇总的 ETA</span>
              <span className="meta">勾选计入矩阵</span>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 8 }}>
              {etaSummaries.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--psa-faint)', padding: 8 }}>暂无其他 ETA。新建后将在此勾选汇总。</div>
              ) : etaSummaries.map((e) => {
                const wc = C_COLOR[e.worstC] || '#94a3b8'
                return (
                  <div key={e.key} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 10px', border: `1px solid ${e.active ? '#bcd4f5' : 'var(--psa-line)'}`, borderRadius: 8, marginBottom: 7, background: e.active ? 'var(--psa-primary-soft)' : 'var(--psa-surface)' }}>
                    <span onClick={() => onToggleEta?.(e.key)} title="计入汇总矩阵"
                      style={{ width: 18, height: 18, borderRadius: 5, border: `1.5px solid ${e.checked ? 'var(--psa-primary)' : 'var(--psa-line-strong)'}`, background: e.checked ? 'var(--psa-primary)' : 'var(--psa-surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
                      {e.checked && <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M5 12l5 5 9-11" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                    </span>
                    <div onClick={() => onSelectEta?.(e.key)} style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 12.5, fontWeight: e.active ? 600 : 500, color: 'var(--psa-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.name}</span>
                        {e.active && <span style={{ fontSize: 9, color: 'var(--psa-primary)', background: 'var(--psa-primary-soft)', padding: '0 5px', borderRadius: 4, flexShrink: 0 }}>当前</span>}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                        <span className="psa-chip"><span className="sq" style={{ background: wc }} />{gradeLabel(e.worstC)}</span>
                        <span className="psa-num" style={{ fontSize: 10.5, color: 'var(--psa-ink-2)' }}>{e.worstFreq > 0 ? formatEtaRate(e.worstFreq) : '—'}</span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
            <div style={{ flexShrink: 0, borderTop: '1px solid var(--psa-line)', background: 'var(--psa-soft-2)', padding: '9px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, color: 'var(--psa-muted)' }}>汇总 ≥III 累计</span>
              <span style={{ fontFamily: mono, fontSize: 13, fontWeight: 600, color: 'var(--psa-amber)' }}>{aggSevere > 0 ? formatEtaNumber(aggSevere) : '—'} <span style={{ fontSize: 10, color: 'var(--psa-faint)' }}>/yr</span></span>
            </div>
          </section>
        </div>
      </div>

      {/* ============ INSPECTOR ============ */}
      <aside style={{ width: 'var(--psa-inspector-w)', flexShrink: 0, alignSelf: 'stretch', background: 'var(--psa-surface)', border: '1px solid var(--psa-line-2)', borderRadius: 9, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 1px 2px rgba(15,25,40,.04)' }}>
        <div style={{ flexShrink: 0, padding: 14, borderBottom: '1px solid var(--psa-line)', background: 'var(--psa-soft-2)' }}>
          <button onClick={onEngineQuantify} disabled={qBusy} className="psa-btn psa-btn--primary" style={{ width: '100%', justifyContent: 'center' }}>
            <Icon name="bolt" size={14} />{qBusy ? '引擎计算中…' : '引擎精确量化（当前 ETA）'}
          </button>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button onClick={onDeepen} disabled={deepBusy} className="psa-btn" style={{ flex: 1, justifyContent: 'center' }}>
              <Icon name="bolt" size={14} />{deepBusy ? '分析中…' : '重要度 FV/RAW'}
            </button>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: 'var(--psa-muted)' }}>导出</span>
            {(['docx', 'pdf', 'csv'] as const).map((f) => (
              <button key={f} onClick={() => onExport(f)} disabled={expBusy} className="psa-btn">
                <Icon name="download" size={13} />{f === 'docx' ? 'Word' : f.toUpperCase()}
              </button>
            ))}
            <button onClick={() => onExportImage('png')} className="psa-btn"><Icon name="download" size={13} />图PNG</button>
            <button onClick={() => onExportImage('svg')} className="psa-btn"><Icon name="download" size={13} />图SVG</button>
          </div>
          {qErr && <div style={{ color: 'var(--psa-danger-strong)', fontSize: 12, marginTop: 6 }}>失败:{qErr}</div>}
        </div>

        <div style={{ flexShrink: 0, display: 'flex', padding: '0 14px', borderBottom: '1px solid var(--psa-line)', gap: 18 }}>
          {([['attr', '属性'], ['quant', '量化结果'], ['imp', '重要度']] as const).map(([id, label]) => (
            <div key={id} onClick={() => setTab(id)}
              style={{ padding: '11px 0 9px', fontSize: 13, fontWeight: tab === id ? 600 : 400, color: tab === id ? 'var(--psa-primary)' : 'var(--psa-muted)', borderBottom: `2px solid ${tab === id ? 'var(--psa-primary)' : 'transparent'}`, cursor: 'pointer' }}>{label}</div>
          ))}
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 14px 14px' }}>
          {tab === 'attr' && (
            <>
              <h4 style={h4s}>初始事件</h4>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                <span style={{ width: 48, fontSize: 11, color: 'var(--psa-muted)' }}>名称</span>
                <input value={model.initEvent} onChange={(e) => onChange(setInitEvent(model, e.target.value))} style={{ flex: 1, fontSize: 12 }} />
              </div>
              {/* 频率来源单选 */}
              <div style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 11, color: 'var(--psa-muted)', marginBottom: 4 }}>频率来源</div>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {([['manual', '手工输入'], ['product', '产品维度'], ['ft', '故障树 FTA']] as const).map(([src, label]) => (
                    <label key={src} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer' }}>
                      <input type="radio" name="initFreqSource" value={src}
                        checked={(model.initFreqSource ?? 'manual') === src}
                        onChange={() => onChange(setInitFreqSource(model, src))} />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
              {/* 手工模式 */}
              {(model.initFreqSource ?? 'manual') === 'manual' && (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ width: 48, fontSize: 11, color: 'var(--psa-muted)' }}>频率/yr</span>
                  <input key={'freq' + model.initFreq} defaultValue={formatEtaNumber(model.initFreq)}
                    onBlur={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v) && v >= 0) onChange(setInitFreq(model, v)) }}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                    title="支持科学计数,如 1e-3;回车或失焦生效" style={{ flex: 1, fontSize: 12 }} />
                </div>
              )}
              {/* 产品维度模式 */}
              {(model.initFreqSource ?? 'manual') === 'product' && (() => {
                const prod = { cellsPerPack: 100, packsPerSystem: 20, cellFailureRate: 1e-7, ...model.product }
                const onProdChange = (patch: Partial<typeof prod>) => {
                  const m2 = setProduct(model, patch)
                  onChange(setInitFreq(m2, computeProductFreq(m2)))
                }
                return (
                  <div style={{ marginBottom: 4 }}>
                    {([
                      ['单Pack电芯数', 'cellsPerPack', 1, 10000, 1] as const,
                      ['单系统Pack数', 'packsPerSystem', 1, 1000, 1] as const,
                      ['电芯失效率/yr', 'cellFailureRate', 0, 1, 1e-10] as const,
                    ]).map(([label, key, min, max, step]) => (
                      <div key={key} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                        <span style={{ width: 88, fontSize: 11, color: 'var(--psa-muted)' }}>{label}</span>
                        <input type="number" step={step} min={min} max={max} value={prod[key]}
                          onChange={(e) => onProdChange({ [key]: Number(e.target.value) })}
                          style={{ flex: 1, fontSize: 12 }} />
                      </div>
                    ))}
                    <div style={{ fontSize: 11, color: 'var(--psa-muted)', marginTop: 4 }}>
                      总电芯数 = {prod.cellsPerPack} × {prod.packsPerSystem} = {prod.cellsPerPack * prod.packsPerSystem}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--psa-muted)', marginTop: 2 }}>
                      初始频率 = {formatEtaNumber(computeProductFreq(model.initFreqSource === 'product' ? { ...model, product: prod } : model))} /yr
                    </div>
                  </div>
                )
              })()}
              {/* FTA 模式 */}
              {(model.initFreqSource ?? 'manual') === 'ft' && (
                <div style={{ marginBottom: 4 }}>
                  <button onClick={() => onEditInitFt?.()} disabled={!onEditInitFt}
                    style={{ width: '100%', height: 32, background: 'var(--psa-teal)', color: '#fff', border: 0, borderRadius: 6, fontSize: 12.5, fontWeight: 500, cursor: 'pointer', marginBottom: 6 }}>
                    挂载/编辑初始事件 FTA
                  </button>
                  <div style={{ fontSize: 11, color: 'var(--psa-muted)' }}>
                    顶事件概率（已量化）= <span style={{ fontFamily: 'var(--psa-font-mono)', color: 'var(--psa-ink)' }}>{formatEtaNumber(model.initFreq)}</span> /yr
                  </div>
                </div>
              )}

              <h4 style={h4s}>功能事件(屏障)</h4>
              {libBarriers && libBarriers.length > 0 && (
                <div style={{ marginBottom: 6 }}>
                  <LibPicker label="＋从库加屏障" items={libBarriers.map((b) => ({ id: b.id, name: b.name }))}
                    onPick={(id) => { const b = libBarriers.find((x) => x.id === id); if (b) onChange(addBarrierFromLib(model, b)) }} />
                </div>
              )}
              {model.functionalEvents.map((fe, d) => (
                <div key={fe.id} style={{ display: 'flex', gap: 5, alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ width: 30, fontSize: 10, color: 'var(--psa-faint)', fontFamily: mono, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={fe.id}>{fe.id}</span>
                  <input value={fe.label} onChange={(e) => onChange(renameFe(model, d, e.target.value))} style={{ width: 96, fontSize: 12 }} />
                  <input type="number" step="0.01" min={0} max={1} value={fe.failProb}
                    onChange={(e) => onChange(setFailProb(model, d, +e.target.value))} style={{ width: 54, fontSize: 12 }} />
                  <button title="上移" disabled={d === 0} onClick={() => moveFe(d, -1)} style={{ ...moveBtn, opacity: d === 0 ? 0.4 : 1 }}>↑</button>
                  <button title="下移" disabled={d === model.functionalEvents.length - 1} onClick={() => moveFe(d, 1)} style={{ ...moveBtn, opacity: d === model.functionalEvents.length - 1 ? 0.4 : 1 }}>↓</button>
                  <button title="删除屏障" onClick={() => {
                    const used = branchesUsingFe(model, fe.id)
                    if (used === 0 || window.confirm(`将折叠 ${used} 个引用「${fe.label}」的分支为末态,继续?`)) onChange(delFe(model, d))
                  }} style={{ color: 'var(--psa-danger)', border: 0, background: 'none', cursor: 'pointer', fontSize: 14, lineHeight: 1, flexShrink: 0 }}>✕</button>
                </div>
              ))}
              <button onClick={addBarrier} style={{ marginTop: 8, width: '100%', height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: 'var(--psa-surface)', border: '1px dashed var(--psa-line-strong)', borderRadius: 8, color: 'var(--psa-primary)', fontSize: 12.5, fontWeight: 500, cursor: 'pointer' }}>＋ 添加屏障（延长级联）</button>

              <h4 style={h4s}>选中节点</h4>
              {!selNode ? (
                <div style={{ fontSize: 12, color: 'var(--psa-muted)' }}>点击树上圆点选择节点。</div>
              ) : selNode.kind === 'leaf' ? (
                <div style={{ fontSize: 12 }}>
                  <div style={{ marginBottom: 8 }}>
                    末态后果:&nbsp;
                    <select value={selNode.consequence} onChange={(e) => onChange(setConsequence(model, sel!, e.target.value))}>
                      {consEntries(model).map((e) => <option key={e.id} value={e.id}>{gradeLabel(e.level)} — {e.desc}</option>)}
                    </select>
                  </div>
                  {(() => {
                    const subs = subsequentFes(model, sel!)
                    return subs.length === 0 ? (
                      <div style={{ color: 'var(--psa-faint)', marginTop: 6 }}>已无更多可分支的后续屏障(可先「＋ 添加屏障」)。</div>
                    ) : (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <span>继续到屏障:</span>
                        <select value="" onChange={(e) => { if (e.target.value) onChange(branchLeaf(model, sel!, e.target.value)) }}>
                          <option value="" disabled>选择后续屏障…</option>
                          {subs.map((f) => <option key={f.id} value={f.id}>{f.label || f.id}</option>)}
                        </select>
                      </div>
                    )
                  })()}
                </div>
              ) : (
                <div style={{ fontSize: 12 }}>
                  {/* ── 分支判定屏障 ID 标题 ── */}
                  <div style={{ marginBottom: 6 }}>分支:决定 <b title={selFeId ?? ''}>{selFe?.label || selFeId || '—'}</b></div>
                  {selIdx >= 0 && model.functionalEvents[selIdx]?.source && (
                    <div style={{ fontSize: 11, color: 'var(--psa-muted)', marginBottom: 6 }}>来源:{model.functionalEvents[selIdx].source}</div>
                  )}

                  {/* ── 1. 改名 ── */}
                  {selIdx >= 0 && (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ width: 42, fontSize: 11, color: 'var(--psa-muted)' }}>名称</span>
                      <input
                        value={model.functionalEvents[selIdx].label}
                        onChange={(e) => onChange(renameFe(model, selIdx, e.target.value))}
                        style={{ flex: 1, fontSize: 12 }}
                      />
                    </div>
                  )}

                  {/* ── 2. 改 PFD (仅直接 PFD 时可编辑) / FTA 挂载时只读显示 ── */}
                  {selIdx >= 0 && (model.functionalEvents[selIdx]?.linkFt ? (
                    <div style={{ marginBottom: 6 }}>
                      <div style={{ marginBottom: 4 }}>
                        挂载 FTA · PFD={formatEtaNumber(pfds?.[selFeId!] ?? model.functionalEvents[selIdx].failProb)} · 有效性={formatEtaNumber(1 - (pfds?.[selFeId!] ?? model.functionalEvents[selIdx].failProb))}
                      </div>
                      <button onClick={() => setEditingFt(selFeId!)} disabled={!fts || !ftsApi}
                        style={{ background: 'var(--psa-primary)', color: '#fff', border: 0, borderRadius: 6, padding: '5px 12px' }}>编辑故障树</button>
                      <button onClick={() => onDetachFt?.(selIdx)} style={{ marginLeft: 8, color: 'var(--psa-danger)', border: 0, background: 'none', cursor: 'pointer' }}>改回直接 PFD</button>
                    </div>
                  ) : (
                    <div style={{ marginBottom: 6 }}>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                        <span style={{ width: 42, fontSize: 11, color: 'var(--psa-muted)' }}>PFD</span>
                        <input
                          type="number" step="0.01" min={0} max={1}
                          value={model.functionalEvents[selIdx].failProb}
                          onChange={(e) => onChange(setFailProb(model, selIdx, Number(e.target.value)))}
                          style={{ flex: 1, fontSize: 12 }}
                        />
                      </div>
                      {/* 置信分级展示 */}
                      {model.functionalEvents[selIdx].grade && (
                        <div style={{ fontSize: 11, color: 'var(--psa-muted)', marginBottom: 4 }}>
                          置信:{model.functionalEvents[selIdx].grade}
                          {model.functionalEvents[selIdx].evidence && (
                            <span title={model.functionalEvents[selIdx].evidence}> · <span style={{ color: 'var(--psa-faint)', cursor: 'help' }}>证据链</span></span>
                          )}
                        </div>
                      )}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <button onClick={() => onAttachFt?.(selIdx)} disabled={selIdx < 0 || !ftsApi}
                          style={{ background: 'var(--psa-teal)', color: '#fff', border: 0, borderRadius: 6, padding: '5px 12px', cursor: 'pointer' }}>挂载 FTA</button>
                        <button
                          onClick={() => setBayesOpen((o) => !o)}
                          style={{ background: bayesOpen ? 'var(--psa-primary)' : 'var(--psa-soft)', color: bayesOpen ? '#fff' : 'var(--psa-ink-2)', border: '1px solid var(--psa-line-strong)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 11.5 }}>
                          {bayesOpen ? '收起' : '现场更新 PFD（贝叶斯）'}
                        </button>
                      </div>
                      {/* ── 现场贝叶斯更新面板 ── */}
                      {bayesOpen && selIdx >= 0 && (() => {
                        const fe = model.functionalEvents[selIdx]
                        const res = posteriorPfd({ pfd: fe.failProb, N: bayesIn.N, k: bayesIn.k, prior: bayesIn.prior, n0: bayesIn.n0 })
                        const fld: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, fontSize: 12 }
                        const date = new Date().toISOString().slice(0, 10)
                        const mkEvidence = (which: 'mean' | 'p95') =>
                          `现场更新 N=${bayesIn.N}、k=${bayesIn.k}、先验=${bayesIn.prior === 'jeffreys' ? 'Jeffreys' : '当前PFD(n0=' + bayesIn.n0 + ')'}、采用=${which === 'mean' ? '后验均值' : '95%上限'}、后验均值=${formatEtaNumber(res.mean)}、95%上限=${formatEtaNumber(res.p95)}(${date})`
                        const adopt = (which: 'mean' | 'p95') => {
                          const pfdVal = which === 'mean' ? res.mean : res.p95
                          onChange(applyFieldUpdate(model, selIdx, { failProb: pfdVal, grade: 'A', evidence: mkEvidence(which) }))
                          setBayesOpen(false)
                        }
                        return (
                          <div style={{ background: 'var(--psa-soft)', border: '1px solid var(--psa-line-2)', borderRadius: 8, padding: '10px 12px', marginBottom: 6 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--psa-ink-2)', marginBottom: 8 }}>现场更新 PFD（贝叶斯）</div>
                            <div style={{ fontSize: 11, color: 'var(--psa-muted)', marginBottom: 8 }}>
                              {fe.label} · 当前 PFD = <span style={{ fontFamily: mono }}>{formatEtaNumber(fe.failProb)}</span>
                            </div>
                            <div style={fld}>
                              <span style={{ width: 72 }}>需求次数 N</span>
                              <input type="number" min={0} value={bayesIn.N}
                                onChange={(e) => setBayesIn({ ...bayesIn, N: Math.max(0, Math.floor(+e.target.value || 0)) })}
                                style={{ flex: 1, fontSize: 12 }} />
                            </div>
                            <div style={fld}>
                              <span style={{ width: 72 }}>失败次数 k</span>
                              <input type="number" min={0} value={bayesIn.k}
                                onChange={(e) => setBayesIn({ ...bayesIn, k: Math.max(0, Math.floor(+e.target.value || 0)) })}
                                style={{ flex: 1, fontSize: 12 }} />
                            </div>
                            <div style={{ ...fld, flexWrap: 'wrap', gap: 6 }}>
                              <span style={{ width: 72 }}>先验</span>
                              <label style={{ display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer', fontSize: 12 }}>
                                <input type="radio" name={`bprior_${selIdx}`} checked={bayesIn.prior === 'current'} onChange={() => setBayesIn({ ...bayesIn, prior: 'current' })} />当前 PFD
                              </label>
                              <label style={{ display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer', fontSize: 12 }}>
                                <input type="radio" name={`bprior_${selIdx}`} checked={bayesIn.prior === 'jeffreys'} onChange={() => setBayesIn({ ...bayesIn, prior: 'jeffreys' })} />Jeffreys
                              </label>
                              {bayesIn.prior === 'current' && (
                                <>
                                  <span style={{ color: 'var(--psa-muted)', fontSize: 12 }}>n₀</span>
                                  <input type="number" min={1} value={bayesIn.n0}
                                    onChange={(e) => setBayesIn({ ...bayesIn, n0: Math.max(1, +e.target.value || 1) })}
                                    style={{ width: 48, fontSize: 12 }} />
                                </>
                              )}
                            </div>
                            <div style={{ background: 'var(--psa-surface)', borderRadius: 6, padding: '8px 10px', margin: '8px 0', fontFamily: mono, fontSize: 12 }}>
                              <div>后验均值 = <b>{formatEtaNumber(res.mean)}</b></div>
                              <div style={{ color: 'var(--psa-muted)', fontSize: 11, marginTop: 3 }}>
                                90% 上限 {formatEtaNumber(res.p90)} · 95% 上限 {formatEtaNumber(res.p95)}
                              </div>
                              <div style={{ color: 'var(--psa-faint)', fontSize: 11, marginTop: 2 }}>
                                Beta(α={formatEtaNumber(res.alpha)}, β={formatEtaNumber(res.beta)})
                              </div>
                            </div>
                            <div style={{ fontSize: 10.5, color: 'var(--psa-faint)', marginBottom: 8 }}>采用后:写入 PFD、置信升 A、记录证据链。</div>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button className="psa-btn" style={{ flex: 1, justifyContent: 'center', fontSize: 11.5 }} onClick={() => adopt('p95')}>采用 95% 上限</button>
                              <button className="psa-btn psa-btn--primary" style={{ flex: 1, justifyContent: 'center', fontSize: 11.5 }} onClick={() => adopt('mean')}>采用后验均值</button>
                            </div>
                          </div>
                        )
                      })()}
                    </div>
                  ))}

                  {/* ── 4. 重新指派屏障 ── */}
                  {sel && (() => {
                    const opts = branchFeOptions(model, sel)
                    if (opts.length <= 1) return null
                    const currentFeId = (selNode as { feId: string }).feId
                    return (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                        <span style={{ width: 54, fontSize: 11, color: 'var(--psa-muted)' }}>判定屏障</span>
                        <select
                          value={currentFeId}
                          onChange={(e) => onChange(setBranchFe(model, sel!, e.target.value))}
                          style={{ flex: 1, fontSize: 12 }}
                        >
                          {opts.map((f) => <option key={f.id} value={f.id}>{f.id} — {f.label}</option>)}
                        </select>
                      </div>
                    )
                  })()}

                  {/* ── 5. 删除屏障 ── */}
                  {selIdx >= 0 && (
                    <button onClick={() => {
                      const feId = model.functionalEvents[selIdx].id
                      const used = branchesUsingFe(model, feId)
                      if (used === 0 || window.confirm(`将折叠 ${used} 个引用「${model.functionalEvents[selIdx].label}」的分支为末态,继续?`)) {
                        onChange(delFe(model, selIdx))
                        setSel(null)
                      }
                    }} style={{ color: 'var(--psa-danger)', border: '1px solid #fca5a5', background: 'var(--psa-danger-soft)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12, marginBottom: 6 }}>
                      删除屏障
                    </button>
                  )}

                  {/* 折叠当前分支节点为末态 */}
                  <div>
                    <button onClick={() => onChange(collapseNode(model, sel!))} style={{ color: 'var(--psa-danger)', border: 0, background: 'none', cursor: 'pointer', fontSize: 12 }}>折叠为末态</button>
                  </div>
                </div>
              )}
            </>
          )}

          {tab === 'quant' && (
            <div style={{ paddingTop: 14 }}>
              <div style={{ fontSize: 12, color: 'var(--psa-muted)', marginBottom: 8 }}>各末态序列频率（{engineSeq ? '引擎精确' : '前端积式'}）· 点击联动下方</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {seqRows.map((r) => {
                  const active = selKey === r.lf.path.join('/')
                  const cc = C_COLOR[consLevel(model, r.c)] || '#64748b'
                  const pathTxt = r.path.map((p) => (p.outcome === 'failure' ? '失效' : '成功')).join(' → ') || '直接末态'
                  return (
                    <div key={r.i} onClick={() => setSel(r.lf.path)}
                      style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 11px', border: '1px solid var(--psa-line)', borderRadius: 8, cursor: 'pointer', background: active ? 'var(--psa-primary-soft)' : 'var(--psa-surface)' }}>
                      <span style={{ width: 20, height: 20, borderRadius: 5, background: cc, color: '#fff', fontFamily: mono, fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{r.seq}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, color: 'var(--psa-ink)', display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span className="psa-chip"><span className="sq" style={{ background: cc }} />{consGrade(model, r.c)}</span>
                          <span style={{ color: 'var(--psa-faint)' }}>{consText(model, r.c)}</span>
                        </div>
                        <div className="psa-num" style={{ fontSize: 10.5, color: 'var(--psa-faint)' }}>{pathTxt}</div>
                      </div>
                      <span className="psa-num" style={{ fontSize: 12, color: 'var(--psa-ink)', flexShrink: 0 }}>{formatEtaNumber(r.freq)}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {tab === 'imp' && (
            <div style={{ paddingTop: 14 }}>
              {imp ? (
                <>
                  <div style={{ fontSize: 12, marginBottom: 4 }}>后果:&nbsp;
                    <select value={impC} onChange={(e) => setImpC(e.target.value)}>{CONSEQUENCES.map((c) => <option key={c} value={c}>{gradeLabel(c)}</option>)}</select>
                  </div>
                  <table style={{ borderCollapse: 'collapse', fontSize: 11 }}>
                    <thead><tr>{['屏障', 'FV', 'RAW'].map((h) => <th key={h} style={cell}>{h}</th>)}</tr></thead>
                    <tbody>{(imp[impC] || []).map((r) => (
                      <tr key={r.barrier}><td style={cell}>{r.barrier}</td><td style={cell}>{formatEtaNumber(r.fv)}</td><td style={cell}>{formatEtaNumber(r.raw)}</td></tr>
                    ))}</tbody>
                  </table>
                  <div style={{ fontSize: 10, color: 'var(--psa-faint)', marginTop: 2 }}>注:良性后果(需屏障成功)FV 可为负。默认看最严重 IV。</div>
                </>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--psa-muted)' }}>点上方「重要度 FV/RAW」运行引擎重要度分析后,在此显示各屏障的 Fussell-Vesely / RAW。</div>
              )}
            </div>
          )}
        </div>

        {/* selected-sequence dark footer */}
        {selNode?.kind === 'leaf' && sel && (() => {
          const li = leaves.findIndex((n) => n.path.join('/') === selKey)
          const r = li >= 0 ? seqRows[li] : null
          if (!r) return null
          const pathTxt = r.path.map((p) => (p.outcome === 'failure' ? '失效' : '成功')).join(' → ') || '直接末态'
          return (
            <div style={{ flexShrink: 0, borderTop: '1px solid var(--psa-line)', background: 'var(--psa-chrome)', padding: '11px 14px', display: 'flex', alignItems: 'center', gap: 11 }}>
              <span style={{ width: 24, height: 24, borderRadius: 6, background: C_COLOR[consLevel(model, r.c)] || '#64748b', color: '#fff', fontFamily: mono, fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{r.seq}</span>
              <div style={{ flex: 1, minWidth: 0, lineHeight: 1.3 }}>
                <div style={{ fontSize: 11.5, color: 'var(--psa-chrome-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>选中序列 · {pathTxt}</div>
                <div style={{ fontSize: 11, color: 'var(--psa-chrome-ink-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>后果 {consGrade(model, r.c)} {consText(model, r.c)}</div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontFamily: mono, fontSize: 13, fontWeight: 600, color: sevIdx(r.c) >= 3 ? '#ff8a7a' : '#8fcf9f' }}>{formatEtaNumber(r.freq)}</div>
                <div style={{ fontSize: 10, color: 'var(--psa-chrome-ink-dim)' }}>/yr</div>
              </div>
            </div>
          )
        })()}
      </aside>

      {editingFt && fts && ftsApi && (
        <BarrierFtModal model={fts} ftName={editingFt} api={ftsApi} pfd={pfds?.[editingFt]} libComponents={libComponents}
          onClose={() => { const id = editingFt; setEditingFt(null); onFtEdited?.(id) }} />
      )}
    </div>
  )
}
