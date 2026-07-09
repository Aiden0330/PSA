import { useRef } from 'react'
import type { RefObject, UIEvent as ReactUIEvent } from 'react'
import type { EventTreeModel } from '../../eventtree'
import { layout, nodeAt, subsequentFes, branchLeaf, consLevel, consText, gradeLabel } from '../../eventtree'
import { C_COLOR } from '../../riskmatrix'
import { formatEtaNumber } from '../../etaNumberFormat'
import type { SeqRow } from './types'

const mono = 'var(--psa-font-mono)'

/**
 * 事件树 SVG 画布 + 冻结表头(纯拆分自 EventTreeEditor):
 * 布局几何由 model 内部计算(与容器 seqRows 同一 DFS 叶序);选中/回写经 props 上抛。
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
                <g key={f.id} style={{ cursor: 'pointer' }} onClick={() => { onChange(branchLeaf(model, lf.path, f.id)); onSelect(null) }}>
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
  )
}
