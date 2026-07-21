import type { CSSProperties } from 'react'
import { Handle, Position } from 'reactflow'

const COLOR: Record<string, string> = {
  and: '#2563eb', or: '#16a34a', atleast: '#7c3aed', not: '#dc2626', xor: '#ea580c',
}

/** 重要度热力: t∈[0,1] 绿(#16a34a)→红(#dc2626) 线性插值。 */
function heatColor(t: number): string {
  const c = Math.max(0, Math.min(1, t))
  const r = Math.round(22 + c * (220 - 22)), g = Math.round(163 + c * (38 - 163)), b = Math.round(74 + c * (38 - 74))
  return `rgb(${r},${g},${b})`
}

const LABEL: CSSProperties = {
  fontSize: 10, fontWeight: 600, color: 'var(--psa-ink)',
  wordBreak: 'break-word', lineHeight: 1.1, marginTop: 2, maxWidth: 148,
}

function box(width: number, highlighted: boolean): CSSProperties {
  return {
    width, textAlign: 'center', fontFamily: 'system-ui, sans-serif',
    outline: highlighted ? '3px solid #f59e0b' : 'none',
    outlineOffset: 2, borderRadius: 8,
    background: highlighted ? 'rgba(245,158,11,0.10)' : 'transparent',
  }
}

const IE_RECT: CSSProperties = {
  border: '1px solid var(--psa-line-2)',
  borderRadius: 7,
  background: 'var(--psa-surface)',
  boxShadow: 'var(--psa-shadow)',
  padding: '4px 9px',
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--psa-ink)',
  textAlign: 'center',
  wordBreak: 'break-word',
  lineHeight: 1.3,
  marginBottom: 3,
  minWidth: 84,
  maxWidth: 150,
}

/** 自接点击层(2026-07-21):选择回调直接挂在节点根元素——reactflow 内部事件管线在
 *  测量停摆环境里会整体失灵("所有节点点不中"),自接层只依赖 DOM,永不失效。 */
export function GateNode({ id, data }: { id: string; data: any }) {
  const op = (data.op ?? 'and') as string
  const color = COLOR[op] ?? '#475569'
  const text = op === 'atleast' ? `≥${data.k}/${(data.args ?? []).length}` : op.toUpperCase()
  // nodeLabel is the user-editable description; label is the node id (fallback)
  const ieLabel: string = data.nodeLabel ?? data.label
  return (
    <div style={box(150, data.highlighted)} onClick={(e) => { e.stopPropagation(); data.onNodeSelect?.(id) }}>
      <Handle type="target" position={Position.Top} style={{ background: color }} />
      <div style={IE_RECT}>{ieLabel}{data.isTop ? ' ★' : ''}</div>
      <svg width="150" height="46" viewBox="0 0 150 46">
        {op === 'and' && (
          <path d="M35,42 L35,22 A40,18 0 0 1 115,22 L115,42 Z" fill={color} fillOpacity="0.14" stroke={color} strokeWidth="2" />
        )}
        {(op === 'or' || op === 'atleast') && (
          <path d="M35,42 Q75,30 115,42 Q115,12 75,4 Q35,12 35,42 Z" fill={color} fillOpacity="0.14" stroke={color} strokeWidth="2" />
        )}
        {(op === 'not' || op === 'xor') && (
          <polygon points="75,4 113,42 37,42" fill={color} fillOpacity="0.14" stroke={color} strokeWidth="2" />
        )}
        <text x="75" y="32" textAnchor="middle" fontSize="13" fontWeight="800" fill={color}>{text}</text>
      </svg>
      <Handle type="source" position={Position.Bottom} style={{ background: color }} />
    </div>
  )
}

export function BasicEventNode({ id, data }: { id: string; data: any }) {
  return (
    <div style={box(130, data.highlighted)} onClick={(e) => { e.stopPropagation(); data.onNodeSelect?.(id) }}>
      <Handle type="target" position={Position.Top} style={{ background: '#d97706' }} />
      <svg width="130" height="40" viewBox="0 0 130 40">
        <circle cx="65" cy="20" r="17" fill={data.heat != null ? heatColor(data.heat) : '#fef3c7'} stroke="#d97706" strokeWidth="2" />
      </svg>
      <div style={LABEL}>{data.label}</div>
    </div>
  )
}

export function HouseNode({ id, data }: { id: string; data: any }) {
  return (
    <div style={box(130, data.highlighted)} onClick={(e) => { e.stopPropagation(); data.onNodeSelect?.(id) }}>
      <Handle type="target" position={Position.Top} style={{ background: 'var(--psa-primary)' }} />
      <svg width="130" height="40" viewBox="0 0 130 40">
        <polygon points="50,38 50,16 65,4 80,16 80,38" fill="var(--psa-primary-soft)" stroke="var(--psa-primary)" strokeWidth="2" />
      </svg>
      <div style={LABEL}>{data.label}</div>
    </div>
  )
}

export const nodeTypes = { gate: GateNode, basic: BasicEventNode, house: HouseNode }
