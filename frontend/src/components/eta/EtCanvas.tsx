import { useCallback, useEffect, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'
import type { EventTreeModel } from '../../eventtree'
import { layout, nodeAt, subsequentFes, branchLeaf, consLevel, consText, gradeLabel } from '../../eventtree'
import { C_COLOR } from '../../riskmatrix'
import { formatEtaNumber } from '../../etaNumberFormat'
import type { SeqRow } from './types'
import { ETA_CANVAS_CONTENT_ATTR } from './types'
import { useCanvasZoom } from './useCanvasZoom'

const mono = 'var(--psa-font-mono)'

/**
 * 事件树 SVG 画布 + 缩放/平移(纯拆分自 EventTreeEditor;R4a 加缩放——规格 2026-07-13 §3 eta):
 * 布局几何由 model 内部计算(与容器 seqRows 同一 DFS 叶序);选中/回写经 props 上抛。
 *
 * 缩放/平移实现:内容(含列头,不再单独冻结表头——见下)整体包在一个 <g transform=…> 里
 * (useCanvasZoom 提供 scale/tx/ty);外层 <svg ref={svgRef}> 保持内容原始像素宽高不变(与缩放前
 * 完全一致),只是被外层 wrap div 的 overflow:hidden 裁到可见视口——这样导出(svgToPng/下载 SVG)
 * 仍能拿到未缩放的原始画布尺寸,只需在克隆后把这一个 <g> 的 transform 属性清掉即可
 * (EventTreeEditor.prepareCanvasForExport),不必重新计算导出尺寸。
 *
 * 原先的"滚动 + scrollX 同步冻结表头"机制整体替换为 pan/zoom(规格允许二选一);列头随内容
 * 一起缩放/平移,不再需要单独的冻结表头图层。
 */
export function EtCanvas(
  { model, pfds, seqRows, sel, onSelect, onChange, svgRef }: {
    model: EventTreeModel
    pfds?: Record<string, number>
    seqRows: SeqRow[]
    sel: string[] | null
    onSelect: (path: string[] | null) => void
    onChange: (m: EventTreeModel) => void
    svgRef: RefObject<SVGSVGElement>
  },
) {
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
  const leaves = nodes.filter((n) => n.kind === 'leaf')

  // 缩放/平移:containerRef 是决定可见视口尺寸的外层 div(不是内容定宽高的 <svg> 本身)
  const wrapRef = useRef<HTMLDivElement>(null)
  const getContentBBox = useCallback(() => ({ x: 0, y: 0, width, height }), [width, height])
  const zoom = useCanvasZoom({ containerRef: wrapRef, getContentBBox })
  // 仅背景(事件目标就是 <svg> 本身,非其内部节点/形状)按下才启动平移拖拽,节点自身 onClick 不受影响
  const onCanvasPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.target === e.currentTarget) zoom.onPointerDown(e)
  }
  // wheel 必须原生非被动监听(见 useCanvasZoom.CanvasZoomApi.onWheel 注释):JSX onWheel= 在 React 里
  // 走 passive:true 的委托监听,preventDefault() 会被浏览器静默忽略,画布之外的祖先仍可能滚动。
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const handler = (e: WheelEvent) => zoom.onWheel(e)
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [svgRef, zoom.onWheel])

  // 屏障列头(名称 + PFD)+「序列/频率」表头文字——随内容一起缩放/平移,只渲染一次
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
    <div ref={wrapRef} style={{ flex: 1, minWidth: 0, position: 'relative', overflow: 'hidden', backgroundImage: 'radial-gradient(circle at 1px 1px,var(--psa-line) 1.2px,transparent 0)', backgroundSize: '20px 20px' }}>
      <svg ref={svgRef} width={width} height={height}
        onPointerDown={onCanvasPointerDown} onPointerMove={zoom.onPointerMove} onPointerUp={zoom.onPointerUp} onPointerCancel={zoom.onPointerUp}
        onDoubleClick={() => zoom.fit()}
        style={{ display: 'block', fontFamily: '"IBM Plex Sans","Noto Sans SC",sans-serif', cursor: 'grab', touchAction: 'none' }}>
        <g {...{ [ETA_CANVAS_CONTENT_ATTR]: '' }} transform={`translate(${zoom.tx} ${zoom.ty}) scale(${zoom.scale})`}>
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

          {/* 屏障列竖向虚线（结构线;表头文字见 renderColumnHeadings）*/}
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
              <g key={'l' + i} style={{ cursor: 'pointer' }} onClick={() => onSelect(lf.path)}>
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
              style={{ cursor: 'pointer' }} onClick={() => onSelect(n.path)} />
          ))}

          {/* 选中可继续的叶 → 后续屏障(popup 是同一 <g> 的子节点,随缩放/平移自动跟随,无需额外坐标换算) */}
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
                  <g key={f.id} style={{ cursor: 'pointer' }} onClick={() => { onChange(branchLeaf(model, lf.path, f.id)); onSelect(null) }}>
                    <rect x={mx + 5} y={lf.y + 4 + k * ih} width={mw - 10} height={ih - 2} rx={4} fill="var(--psa-soft)" />
                    <text x={mx + 10} y={lf.y + 4 + k * ih + 12} fontSize={10} fill="var(--psa-ink-2)">{(f.label || f.id).slice(0, 16)}<title>{f.label || f.id}（{f.id}）</title></text>
                  </g>
                ))}
              </g>
            )
          })()}
        </g>
      </svg>

      {/* 悬浮缩放工具条(右上角,规格 2026-07-13 §3 eta / mockup:⊖ pct ⊕ ⤢)*/}
      <div className="exp-zoom">
        <button type="button" onClick={zoom.zoomOut} title="缩小">⊖</button>
        <span className="pct psa-num">{Math.round(zoom.scale * 100)}%</span>
        <button type="button" onClick={zoom.zoomIn} title="放大">⊕</button>
        <button type="button" onClick={() => zoom.fit()} title="适应窗口(双击画布同效)">⤢</button>
      </div>
    </div>
  )
}
