import { useState } from 'react'
import type { CSSProperties } from 'react'
import type { ModelJson } from '../model'
import { addGate, addBasic, connect, deleteNode, updateNode, updateParam, setParamKind, setTop, addBasicFromLib, renameNode } from '../model'
import { layoutFaultTree } from '../layout'
import { FaultTreeCanvas } from './FaultTreeCanvas'
import { Palette } from './Palette'
import { Inspector } from './Inspector'
import { LibPicker } from './LibPicker'
import { formatEtaNumber, formatEtaRate } from '../etaNumberFormat'
import { ftFrequency } from '../api'
import type { FtFrequencyMethod, FtFrequencyResult } from '../api'

/** set 必须传更新函数(prev => next):值式覆写来自渲染期旧快照,同一拍两次编辑会后写冲前写
 *  (丢改动报障 2026-07-17)。store/useModel 的 set 原生支持函数式 updater。 */
interface Api { set: (m: ModelJson | ((prev: ModelJson) => ModelJson)) => void; undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean }

/** 全屏模态:复用故障树编辑器编辑某 ETA 屏障的故障树(方案 A)。
 *  frequencyMode(初因树 __init__):调色板提供频率初因事件、检视器暴露量纲切换,
 *  头部显示 F(/yr)而非 PFD——频率语义,见规格 2026-07-13。 */
export function BarrierFtModal(
  { model, ftName, api, pfd, onClose, libComponents, frequencyMode }:
  { model: ModelJson; ftName: string; api: Api; pfd?: number; onClose: () => void; libComponents?: any[]; frequencyMode?: boolean },
) {
  const [selected, setSelected] = useState<string | null>(null)
  // 初因频率口径开关 + 结果:纯本模态局部态,不写 store(store 仍由 onClose 走 sum 默认)。
  const [freqMethod, setFreqMethod] = useState<FtFrequencyMethod>('sum')
  const [freqResult, setFreqResult] = useState<FtFrequencyResult | null>(null)
  const [freqBusy, setFreqBusy] = useState(false)
  const [freqError, setFreqError] = useState<string | null>(null)
  const onPickMethod = (m: FtFrequencyMethod) => {
    if (m === freqMethod) return
    setFreqMethod(m)
    setFreqResult(null)   // 切口径即清旧结果:同屏只呈现所选口径,不并列/不对比(规格 §2 口径差不做告警)
    setFreqError(null)
  }
  const onQuantifyFreq = async () => {
    setFreqBusy(true); setFreqError(null)
    try {
      setFreqResult(await ftFrequency(model, ftName, freqMethod))
    } catch (e: any) {
      setFreqResult(null); setFreqError(String(e?.message ?? e))   // 400 规则违规等:响亮,不静默
    } finally {
      setFreqBusy(false)
    }
  }
  // 防御(白屏报障 2026-07-17):命名树缺失时(典型:模态开着时 ↶ 撤销把「挂载」本身
  // 撤掉了,或树被并发删除)不进画布——此态下若继续渲染/编辑,layoutFaultTree 曾直接抛
  // (白屏),且 addGate/addBasic 会经 getFt 的 fault_trees[0] 回退**改错别的树**。
  // 给可见说明 + 关闭,绝不留白、绝不误写。
  if (!model.fault_trees.some((f) => f.name === ftName)) {
    return (
      <div style={overlay} onClick={onClose}>
        <div style={{ margin: 'auto', maxWidth: 400, background: 'var(--psa-surface)', borderRadius: 10, padding: 20, textAlign: 'center' }}
          onClick={(e) => e.stopPropagation()} role="alertdialog" aria-label="故障树不存在">
          <div style={{ fontWeight: 700, marginBottom: 8 }}>该故障树已不存在</div>
          <div style={{ fontSize: 12, color: 'var(--psa-muted)', lineHeight: 1.6, marginBottom: 12 }}>
            屏障「{ftName}」的故障树在模型中找不到——通常是撤销操作把「挂载 FTA」一并撤掉了,
            或树已被删除。请关闭后重新挂载(重做 ↷ 可恢复刚才的撤销)。
          </div>
          <button type="button" className="psa-btn" onClick={onClose}>关闭</button>
        </div>
      </div>
    )
  }
  const graph = layoutFaultTree(model, ftName, undefined, true)
  return (
    <div style={overlay} onClick={onClose}>
      <div style={panel} onClick={(e) => e.stopPropagation()}>
        <div style={bar}>
          <strong style={{ fontSize: 14 }}>{frequencyMode ? '编辑初因事件故障树(频率)' : `编辑故障树:${ftName}`}</strong>
          <Palette onAddGate={(op) => api.set((prev) => addGate(prev, ftName, op))} onAddBasic={() => api.set((prev) => addBasic(prev, ftName))}
            onAddFrequency={frequencyMode ? () => api.set((prev) => addBasic(prev, ftName, 1e-3, 'frequency')) : undefined} />
          {libComponents && libComponents.length > 0 && (
            <LibPicker label="＋从库加基本事件" items={libComponents.map((c: any) => ({ id: c.id, name: c.name, unit: c.unit }))}
              onPick={(id) => { const c = libComponents.find((x: any) => x.id === id); if (c) api.set((prev) => addBasicFromLib(prev, ftName, c)) }} />
          )}
          <button onClick={api.undo} disabled={!api.canUndo} title="撤销" style={icon}>↶</button>
          <button onClick={api.redo} disabled={!api.canRedo} title="重做" style={icon}>↷</button>
          {frequencyMode && (
            <>
              <div style={segmented} role="tablist" aria-label="初因频率口径">
                {METHOD_TABS.map(([m, label, tip]) => (
                  <button key={m} type="button" role="tab" aria-selected={freqMethod === m}
                    style={segBtn(freqMethod === m)} onClick={() => onPickMethod(m)} title={tip}>{label}</button>
                ))}
              </div>
              <button onClick={onQuantifyFreq} disabled={freqBusy} className="psa-btn psa-btn--primary"
                title="按所选口径计算初因总频率">{freqBusy ? '计算中…' : '计算频率'}</button>
            </>
          )}
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
              nodes={graph.nodes} edges={graph.edges} editable highlight={new Set<string>()} fitKey={ftName}
              onConnectNodes={(s, t) => api.set((prev) => connect(prev, ftName, s, t))}
              onDeleteNodes={(ids) => { api.set((prev) => ids.reduce((m, id) => deleteNode(m, ftName, id), prev)); setSelected(null) }}
              onSelect={setSelected}
            />
          </div>
          <div style={{ width: 360, borderLeft: '1px solid var(--psa-line)', overflowY: 'auto', background: 'var(--psa-surface)' }}>
            <Inspector
              model={model} ftName={ftName} selected={selected}
              onUpdateNode={(id, patch) => api.set((prev) => updateNode(prev, ftName, id, patch))}
              onUpdateParam={(id, v) => api.set((prev) => updateParam(prev, id, v))}
              onSetTop={(id) => api.set((prev) => setTop(prev, ftName, id))}
              onDelete={(id) => { api.set((prev) => deleteNode(prev, ftName, id)); setSelected(null) }}
              onRenameNode={(o, n) => { api.set((prev) => renameNode(prev, ftName, o, n)); setSelected(n) }}
              frequencyMode={frequencyMode}
              onSetParamKind={frequencyMode ? (id, k) => api.set((prev) => setParamKind(prev, id, k)) : undefined}
            />
          </div>
        </div>
        {/* 频率量化结果:所选口径的头条 + 逐初因表(仅 exact)。同屏只呈现所选口径,不对比。 */}
        {frequencyMode && (freqBusy || freqError || freqResult) && (
          <div style={freqPanel}>
            {freqError ? (
              <span style={{ color: 'var(--psa-danger)', fontSize: 12 }}>{freqError}</span>
            ) : freqResult ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, color: 'var(--psa-muted)' }}>初因总频率</span>
                  <span className="psa-num" style={{ fontSize: 17, fontWeight: 600, color: 'var(--psa-ink)' }}>{formatEtaRate(freqResult.frequency)}</span>
                  <span style={methodTag((freqResult.method ?? 'sum') === 'exact')}>
                    {(freqResult.method ?? 'sum') === 'exact' ? '逐初因精确口径' : 'Σ 割集口径(行业)'}
                  </span>
                </div>
                {freqResult.by_initiator && freqResult.by_initiator.length > 0 && (
                  <table style={freqTable}>
                    <thead>
                      <tr>
                        <th style={thL}>初因</th><th style={thR}>λ (/yr)</th><th style={thR}>P(使能)</th><th style={thR}>频率 (/yr)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...freqResult.by_initiator].sort((a, b) => b.frequency - a.frequency).map((row) => (
                        <tr key={row.initiator}>
                          <td style={tdL}>{row.initiator}</td>
                          <td style={tdR} className="psa-num">{formatEtaNumber(row.rate)}</td>
                          <td style={tdR} className="psa-num">{formatEtaNumber(row.enabling_probability)}</td>
                          <td style={tdR} className="psa-num">{formatEtaNumber(row.frequency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ) : (
              <span style={{ fontSize: 12, color: 'var(--psa-muted)' }}>计算中…</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

const METHOD_TABS: [FtFrequencyMethod, string, string][] = [
  ['sum', 'Σ 割集', '行业口径(RS/SAPHIRE):F = Σ 割集 λ·Πq —— 默认'],
  ['exact', '逐初因精确', '逐初因精确:F = Σ λ_i·P(使能析取),恢复物理上界 F ≤ Σλ'],
]

const overlay: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', zIndex: 50, display: 'flex', padding: 24 }
const panel: CSSProperties = { margin: 'auto', width: '92%', height: '88%', background: 'var(--psa-surface)', borderRadius: 10, display: 'flex', flexDirection: 'column', overflow: 'hidden' }
const bar: CSSProperties = { display: 'flex', gap: 10, alignItems: 'center', padding: '8px 14px', borderBottom: '1px solid var(--psa-line)' }
const icon: CSSProperties = { border: '1px solid var(--psa-line-2)', borderRadius: 6, background: 'var(--psa-surface)', padding: '4px 10px', fontSize: 14 }
const done: CSSProperties = { background: 'var(--psa-primary)', color: '#fff', border: 0, borderRadius: 6, padding: '6px 16px' }
const segmented: CSSProperties = { display: 'flex', gap: 3, padding: 3, border: '1px solid var(--psa-line-strong)', borderRadius: 7, background: 'var(--psa-soft)' }
const segBtn = (active: boolean): CSSProperties => ({ minHeight: 24, border: 0, borderRadius: 5, padding: '0 9px', background: active ? 'var(--psa-primary)' : 'transparent', color: active ? '#fff' : 'var(--psa-ink-2)', fontSize: 12, cursor: 'pointer' })
const methodTag = (exact: boolean): CSSProperties => ({ fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 5, border: `1px solid ${exact ? 'var(--psa-primary)' : 'var(--psa-line-strong)'}`, color: exact ? 'var(--psa-primary-strong)' : 'var(--psa-muted)', background: exact ? 'var(--psa-primary-soft)' : 'var(--psa-soft)' })
const freqPanel: CSSProperties = { flexShrink: 0, maxHeight: 200, overflowY: 'auto', borderTop: '1px solid var(--psa-line)', background: 'var(--psa-surface)', padding: '10px 14px', display: 'flex' }
const freqTable: CSSProperties = { borderCollapse: 'collapse', fontSize: 12, minWidth: 420 }
const thL: CSSProperties = { textAlign: 'left', padding: '3px 12px 3px 0', color: 'var(--psa-muted)', fontWeight: 600, borderBottom: '1px solid var(--psa-line-2)' }
const thR: CSSProperties = { textAlign: 'right', padding: '3px 0 3px 12px', color: 'var(--psa-muted)', fontWeight: 600, borderBottom: '1px solid var(--psa-line-2)' }
const tdL: CSSProperties = { textAlign: 'left', padding: '3px 12px 3px 0', color: 'var(--psa-ink)' }
const tdR: CSSProperties = { textAlign: 'right', padding: '3px 0 3px 12px', color: 'var(--psa-ink)' }
