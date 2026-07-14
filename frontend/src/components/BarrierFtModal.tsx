import { useState } from 'react'
import type { CSSProperties } from 'react'
import type { ModelJson } from '../model'
import { addGate, addBasic, connect, deleteNode, updateNode, updateParam, setParamKind, setTop, addBasicFromLib, renameNode } from '../model'
import { layoutFaultTree } from '../layout'
import { FaultTreeCanvas } from './FaultTreeCanvas'
import { Palette } from './Palette'
import { Inspector } from './Inspector'
import { LibPicker } from './LibPicker'
import { formatEtaNumber } from '../etaNumberFormat'

interface Api { set: (m: ModelJson) => void; undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean }

/** 全屏模态:复用故障树编辑器编辑某 ETA 屏障的故障树(方案 A)。
 *  frequencyMode(初因树 __init__):调色板提供频率初因事件、检视器暴露量纲切换,
 *  头部显示 F(/yr)而非 PFD——频率语义,见规格 2026-07-13。 */
export function BarrierFtModal(
  { model, ftName, api, pfd, onClose, libComponents, frequencyMode }:
  { model: ModelJson; ftName: string; api: Api; pfd?: number; onClose: () => void; libComponents?: any[]; frequencyMode?: boolean },
) {
  const [selected, setSelected] = useState<string | null>(null)
  const graph = layoutFaultTree(model, ftName, undefined, true)
  return (
    <div style={overlay} onClick={onClose}>
      <div style={panel} onClick={(e) => e.stopPropagation()}>
        <div style={bar}>
          <strong style={{ fontSize: 14 }}>{frequencyMode ? '编辑初因事件故障树(频率)' : `编辑故障树:${ftName}`}</strong>
          <Palette onAddGate={(op) => api.set(addGate(model, ftName, op))} onAddBasic={() => api.set(addBasic(model, ftName))}
            onAddFrequency={frequencyMode ? () => api.set(addBasic(model, ftName, 1e-3, 'frequency')) : undefined} />
          {libComponents && libComponents.length > 0 && (
            <LibPicker label="＋从库加基本事件" items={libComponents.map((c: any) => ({ id: c.id, name: c.name, unit: c.unit }))}
              onPick={(id) => { const c = libComponents.find((x: any) => x.id === id); if (c) api.set(addBasicFromLib(model, ftName, c)) }} />
          )}
          <button onClick={api.undo} disabled={!api.canUndo} title="撤销" style={icon}>↶</button>
          <button onClick={api.redo} disabled={!api.canRedo} title="重做" style={icon}>↷</button>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 12, color: 'var(--psa-muted)' }}>
            {frequencyMode
              ? <>F={formatEtaNumber(pfd)} /yr(关闭时按「每割集一频率」规则重算)</>
              : <>PFD={formatEtaNumber(pfd)} · 有效性={pfd != null ? formatEtaNumber(1 - pfd) : '—'}</>}
          </span>
          <button onClick={onClose} style={done}>完成</button>
        </div>
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <FaultTreeCanvas
              nodes={graph.nodes} edges={graph.edges} editable highlight={new Set<string>()}
              onConnectNodes={(s, t) => api.set(connect(model, ftName, s, t))}
              onDeleteNodes={(ids) => { let m = model; for (const id of ids) m = deleteNode(m, ftName, id); api.set(m); setSelected(null) }}
              onSelect={setSelected}
            />
          </div>
          <div style={{ width: 360, borderLeft: '1px solid var(--psa-line)', overflowY: 'auto', background: 'var(--psa-surface)' }}>
            <Inspector
              model={model} ftName={ftName} selected={selected}
              onUpdateNode={(id, patch) => api.set(updateNode(model, ftName, id, patch))}
              onUpdateParam={(id, v) => api.set(updateParam(model, id, v))}
              onSetTop={(id) => api.set(setTop(model, ftName, id))}
              onDelete={(id) => { api.set(deleteNode(model, ftName, id)); setSelected(null) }}
              onRenameNode={(o, n) => { api.set(renameNode(model, ftName, o, n)); setSelected(n) }}
              frequencyMode={frequencyMode}
              onSetParamKind={frequencyMode ? (id, k) => api.set(setParamKind(model, id, k)) : undefined}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

const overlay: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', zIndex: 50, display: 'flex', padding: 24 }
const panel: CSSProperties = { margin: 'auto', width: '92%', height: '88%', background: 'var(--psa-surface)', borderRadius: 10, display: 'flex', flexDirection: 'column', overflow: 'hidden' }
const bar: CSSProperties = { display: 'flex', gap: 10, alignItems: 'center', padding: '8px 14px', borderBottom: '1px solid var(--psa-line)' }
const icon: CSSProperties = { border: '1px solid var(--psa-line-2)', borderRadius: 6, background: 'var(--psa-surface)', padding: '4px 10px', fontSize: 14 }
const done: CSSProperties = { background: 'var(--psa-primary)', color: '#fff', border: 0, borderRadius: 6, padding: '6px 16px' }
