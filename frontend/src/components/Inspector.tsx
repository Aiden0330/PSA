import { useState } from 'react'
import type { ModelJson, FtNodeJson } from '../model'
import { getFt } from '../model'
import { Icon } from './icons'

interface Props {
  model: ModelJson
  ftName: string
  selected: string | null
  onUpdateNode: (id: string, patch: Partial<FtNodeJson>) => void
  onUpdateParam: (id: string, value: number) => void
  onSetTop: (id: string) => void
  onDelete: (id: string) => void
  onRenameNode: (oldId: string, newId: string) => void
  /** 初因频率树模式:暴露参数量纲切换(频率初因 /yr ↔ 使能概率);频率值不钳位到 ≤1。 */
  frequencyMode?: boolean
  onSetParamKind?: (id: string, kind: 'probability' | 'frequency') => void
}

const GATE_OPS = ['and', 'or', 'atleast', 'not', 'xor']

const fieldRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8,
}
const fieldLabel: React.CSSProperties = {
  minWidth: 64, fontSize: 11.5, color: 'var(--psa-muted)', flexShrink: 0,
}

/** 事件名(节点 id)可编辑;失焦或回车提交。key=id 使切换选中时重置草稿。 */
function NameField({ id, onRename }: { id: string; onRename: (oldId: string, newId: string) => void }) {
  const [v, setV] = useState(id)
  const commit = () => { const t = v.trim(); if (t && t !== id) onRename(id, t); else setV(id) }
  return (
    <input value={v} onChange={(e) => setV(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      title="事件名称(回车/失焦提交;会级联更新引用)"
      style={{ fontWeight: 600, fontSize: 13, flex: 1, minWidth: 0 }} />
  )
}

export function Inspector({ model, ftName, selected, onUpdateNode, onUpdateParam, onSetTop, onDelete, onRenameNode, frequencyMode, onSetParamKind }: Props) {
  if (!selected) {
    return (
      <div style={{ padding: 14, color: 'var(--psa-muted)', fontSize: 12, lineHeight: 1.6 }}>
        点击节点编辑属性。从门底部圆点拖到子节点顶部圆点可建立父子关系;选中节点按 Delete 删除。
      </div>
    )
  }
  const ft = getFt(model, ftName)
  const node = ft.nodes.find((n) => n.id === selected)
  if (!node) return <div style={{ padding: 14, color: 'var(--psa-faint)', fontSize: 12 }}>—</div>
  const param = node.basic ? model.model_data.parameters.find((p) => p.id === node.param_ref) : null

  return (
    <div style={{ padding: 12, fontSize: 13 }}>
      {/* Name row */}
      <div style={{ ...fieldRow, marginBottom: 12 }}>
        <NameField key={node.id} id={node.id} onRename={onRenameNode} />
        {ft.top === node.id && (
          <span style={{ fontSize: 11, color: 'var(--psa-primary)', fontWeight: 600,
            background: 'var(--psa-primary-soft)', padding: '1px 7px', borderRadius: 5, whiteSpace: 'nowrap' }}>
            顶事件
          </span>
        )}
      </div>

      {node.op ? (
        <>
          <div style={fieldRow}>
            <span style={fieldLabel}>描述</span>
            <input
              value={node.label ?? ''}
              placeholder={node.id}
              onChange={(e) => onUpdateNode(node.id, { label: e.target.value })}
              title="中间事件描述(显示在画布矩形内)"
              style={{ flex: 1, minWidth: 0 }}
            />
          </div>
          <div style={fieldRow}>
            <span style={fieldLabel}>门类型</span>
            <select value={node.op} style={{ flex: 1 }} onChange={(e) =>
              onUpdateNode(node.id, { op: e.target.value, ...(e.target.value === 'atleast' ? { k: node.k ?? 2 } : {}) })}>
              {GATE_OPS.map((o) => <option key={o} value={o}>{o.toUpperCase()}</option>)}
            </select>
          </div>
          {node.op === 'atleast' && (
            <div style={fieldRow}>
              <span style={fieldLabel}>k 值</span>
              <input type="number" min={1} max={(node.args ?? []).length} value={node.k ?? 2} style={{ width: 56 }}
                onChange={(e) => onUpdateNode(node.id, { k: Math.max(1, +e.target.value) })} />
              <span style={{ fontSize: 11.5, color: 'var(--psa-faint)' }}>/ {(node.args ?? []).length}</span>
            </div>
          )}
          <div style={{ fontSize: 11.5, color: 'var(--psa-muted)', padding: '2px 0', marginBottom: 4 }}>
            <span style={{ color: 'var(--psa-faint)' }}>子节点</span>
            {' '}
            <span className="psa-num" style={{ fontSize: 11.5, color: 'var(--psa-ink-2)' }}>
              {(node.args ?? []).join(', ') || '—（拖拽连线添加）'}
            </span>
          </div>
        </>
      ) : frequencyMode ? (
        <>
          {/* 初因频率树:量纲显式可切,频率(/yr)不钳位到 ≤1(频率不是概率) */}
          <div style={fieldRow}>
            <span style={fieldLabel}>量纲</span>
            <select value={param?.kind === 'frequency' ? 'frequency' : 'probability'} style={{ fontSize: 12 }}
              onChange={(e) => onSetParamKind?.(node.param_ref ?? node.id, e.target.value as 'probability' | 'frequency')}>
              <option value="frequency">频率初因(/yr)</option>
              <option value="probability">使能概率</option>
            </select>
          </div>
          <div style={fieldRow}>
            <span style={fieldLabel}>{param?.kind === 'frequency' ? '频率(/yr)' : '使能概率'}</span>
            {param?.kind === 'frequency' ? (
              <input type="number" step="1e-4" min={0} value={param?.value ?? 0} style={{ width: 110 }}
                onChange={(e) => onUpdateParam(node.param_ref ?? node.id, Math.max(0, +e.target.value))} />
            ) : (
              <input type="number" step="0.001" min={0} max={1} value={param?.value ?? 0} style={{ width: 110 }}
                onChange={(e) => onUpdateParam(node.param_ref ?? node.id, Math.min(1, Math.max(0, +e.target.value)))} />
            )}
          </div>
          <div style={{ fontSize: 11, color: 'var(--psa-faint)', marginBottom: 6, lineHeight: 1.5 }}>
            规则:每个最小割集恰好一个「频率初因」,其余为使能概率(违规量化时会明确报错)。
          </div>
        </>
      ) : (
        <div style={fieldRow}>
          <span style={fieldLabel}>失效概率 PFD</span>
          <input type="number" step="0.001" min={0} max={1} value={param?.value ?? 0} style={{ width: 90 }}
            onChange={(e) => onUpdateParam(node.param_ref ?? node.id, Math.min(1, Math.max(0, +e.target.value)))} />
        </div>
      )}

      {/* Actions */}
      <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {node.op && ft.top !== node.id && (
          <button className="psa-btn" onClick={() => onSetTop(node.id)}>设为顶事件</button>
        )}
        <button className="psa-btn psa-btn--danger" onClick={() => onDelete(node.id)}>
          <Icon name="trash" size={13} />删除
        </button>
      </div>
    </div>
  )
}
