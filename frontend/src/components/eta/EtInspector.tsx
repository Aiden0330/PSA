import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { EventTreeModel } from '../../eventtree'
import {
  branchLeaf, collapseNode, setConsequence, setFailProb, renameFe, addBarrierFromLib,
  branchesUsingFe, delFe, nodeAt, subsequentFes, CONSEQUENCES,
  setInitEvent, setInitFreq, setInitFreqSource, setProduct, computeProductFreq,
  consEntries, consLevel, consText, branchFeOptions, setBranchFe,
  gradeLabel, consGrade, applyFieldUpdate,
} from '../../eventtree'
import { posteriorPfd } from '../../bayes'
import type { BayesPrior } from '../../bayes'
import { LibPicker } from '../LibPicker'
import { C_COLOR } from '../../riskmatrix'
import { Icon } from '../icons'
import { formatEtaNumber } from '../../etaNumberFormat'
import type { SeqRow } from './types'

const cell: CSSProperties = { border: '1px solid var(--psa-line)', padding: '2px 6px' }
const moveBtn: CSSProperties = { width: 20, height: 22, border: '1px solid var(--psa-line-strong)', borderRadius: 5, background: 'var(--psa-surface)', color: 'var(--psa-muted)', cursor: 'pointer', fontSize: 11, lineHeight: 1, padding: 0, flexShrink: 0 }
const h4s: CSSProperties = { margin: '16px 0 8px', fontSize: 12, fontWeight: 600, color: 'var(--psa-ink-2)', paddingLeft: 8, borderLeft: '2px solid var(--psa-primary)' }
const mono = 'var(--psa-font-mono)'

/**
 * ETA 检视器(纯拆分自 EventTreeEditor):量化/导出按钮区 + 属性/量化结果/重要度页签
 * + 内联贝叶斯更新 + 选中序列页脚。副作用(引擎调用/导出)由容器经 props 注入;
 * 本组件仅持有页签与贝叶斯输入这两类局部 UI 态。
 */
export function EtInspector(
  { model, onChange, sel, onSelect, seqRows, engineSeq, engineMeta, imp, impC, onImpCChange,
    qBusy, deepBusy, expBusy, qErr, onEngineQuantify, onDeepen, onExport, onExportImage,
    pfds, canEditFt, onEditFt, onAttachFt, onDetachFt, libBarriers, onAddBarrier, onMoveFe, onEditInitFt }: {
    model: EventTreeModel
    onChange: (m: EventTreeModel | ((prev: EventTreeModel) => EventTreeModel)) => void
    sel: string[] | null
    onSelect: (path: string[] | null) => void
    seqRows: SeqRow[]
    engineSeq: Record<string, number> | null
    /** 序列级 LFT 集成回执:method='integrated' 时携带初因频率 ie_frequency(集成口径展示)。 */
    engineMeta?: { method: string; ieFrequency: number | null } | null
    imp: Record<string, { barrier: string; fv: number; raw: number }[]> | null
    impC: string
    onImpCChange: (c: string) => void
    qBusy: boolean; deepBusy: boolean; expBusy: boolean; qErr: string | null
    onEngineQuantify: () => void
    onDeepen: () => void
    onExport: (fmt: 'docx' | 'pdf' | 'csv') => void
    onExportImage: (fmt: 'png' | 'svg') => void
    pfds?: Record<string, number>
    canEditFt: boolean
    onEditFt: (feId: string) => void
    onAttachFt?: (idx: number) => void
    onDetachFt?: (idx: number) => void
    libBarriers?: { id: string; name: string; pfd: number; grade?: string; category?: string; source?: { citation?: string; url?: string; note?: string } }[]
    onAddBarrier: () => void
    onMoveFe: (d: number, dir: -1 | 1) => void
    onEditInitFt?: () => void
  },
) {
  const [tab, setTab] = useState<'attr' | 'quant' | 'imp'>('attr')
  const [bayesOpen, setBayesOpen] = useState(false)
  const [bayesIn, setBayesIn] = useState<{ N: number; k: number; prior: BayesPrior; n0: number }>({ N: 0, k: 0, prior: 'current', n0: 2 })
  useEffect(() => { setBayesOpen(false); setBayesIn({ N: 0, k: 0, prior: 'current', n0: 2 }) }, [sel])
  // 重要度结果就绪时切到重要度页(容器 onDeepen 完成后传入 imp)
  useEffect(() => { if (imp) setTab('imp') }, [imp])

  const selNode = sel ? nodeAt(model.root, sel) : null
  const selKey = sel ? sel.join('/') : ' '
  const selFeId = selNode?.kind === 'branch' ? selNode.feId : undefined
  const selFe = selFeId ? model.functionalEvents.find((f) => f.id === selFeId) : undefined
  const selIdx = selFe ? model.functionalEvents.indexOf(selFe) : -1
  const sevIdx = (c?: string) => CONSEQUENCES.indexOf(consLevel(model, c ?? 'C1'))

  return (
    <aside style={{ width: 'var(--exp-eta-inspector-w)', flexShrink: 0, alignSelf: 'stretch', background: 'var(--psa-surface)', border: '1px solid var(--psa-line-2)', borderRadius: 9, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 1px 2px rgba(15,25,40,.04)' }}>
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
              <input value={model.initEvent} onChange={(e) => { const v = e.target.value; onChange((prev) => setInitEvent(prev, v)) }} style={{ flex: 1, fontSize: 12 }} />
            </div>
            {/* 初因溯源(模板/库带入;证据链首环)*/}
            {(model.initSource || model.initGrade) && (
              <div style={{ fontSize: 10.5, color: 'var(--psa-muted)', marginBottom: 6, lineHeight: 1.5 }}>
                {model.initGrade && <span style={{ display: 'inline-block', border: '1px solid var(--psa-line-strong)', borderRadius: 4, padding: '0 5px', marginRight: 6, fontFamily: 'var(--psa-font-mono)' }}>置信 {model.initGrade}</span>}
                {model.initSource && <span>来源:{model.initSource}</span>}
                {model.initEvidence && <div style={{ color: 'var(--psa-faint)', marginTop: 2 }}>{model.initEvidence}</div>}
              </div>
            )}
            {/* 频率来源单选 */}
            <div style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 11, color: 'var(--psa-muted)', marginBottom: 4 }}>频率来源</div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {([['manual', '手工输入'], ['product', '产品维度'], ['ft', '故障树 FTA']] as const).map(([src, label]) => (
                  <label key={src} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer' }}>
                    <input type="radio" name="initFreqSource" value={src}
                      checked={(model.initFreqSource ?? 'manual') === src}
                      onChange={() => onChange((prev) => setInitFreqSource(prev, src))} />
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
                  onBlur={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v) && v >= 0) onChange((prev) => setInitFreq(prev, v)) }}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                  title="支持科学计数,如 1e-3;回车或失焦生效" style={{ flex: 1, fontSize: 12 }} />
              </div>
            )}
            {/* 产品维度模式 */}
            {(model.initFreqSource ?? 'manual') === 'product' && (() => {
              const prod = { cellsPerPack: 100, packsPerSystem: 20, cellFailureRate: 1e-7, ...model.product }
              const onProdChange = (patch: Partial<typeof prod>) => {
                onChange((prev) => { const m2 = setProduct(prev, patch); return setInitFreq(m2, computeProductFreq(m2)) })
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
                  初因频率(已量化)F = <span style={{ fontFamily: 'var(--psa-font-mono)', color: 'var(--psa-ink)' }}>{formatEtaNumber(model.initFreq)}</span> /yr
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--psa-faint)', marginTop: 3, lineHeight: 1.5 }}>
                  F = Σ 割集(初因率 × Π 使能概率);每个最小割集恰好一个频率事件,违规会明确报错。
                </div>
              </div>
            )}

            <h4 style={h4s}>功能事件(屏障)</h4>
            {libBarriers && libBarriers.length > 0 && (
              <div style={{ marginBottom: 6 }}>
                <LibPicker label="＋从库加屏障" items={libBarriers.map((b) => ({ id: b.id, name: b.name }))}
                  onPick={(id) => { const b = libBarriers.find((x) => x.id === id); if (b) onChange((prev) => addBarrierFromLib(prev, b)) }} />
              </div>
            )}
            {model.functionalEvents.map((fe, d) => (
              <div key={fe.id} style={{ display: 'flex', gap: 5, alignItems: 'center', marginBottom: 4 }}>
                <span style={{ width: 30, fontSize: 10, color: 'var(--psa-faint)', fontFamily: mono, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={fe.id}>{fe.id}</span>
                <input value={fe.label} onChange={(e) => { const v = e.target.value; onChange((prev) => renameFe(prev, d, v)) }} style={{ width: 96, fontSize: 12 }} />
                <input type="number" step="0.01" min={0} max={1} value={fe.failProb}
                  onChange={(e) => { const v = +e.target.value; onChange((prev) => setFailProb(prev, d, v)) }} style={{ width: 54, fontSize: 12 }} />
                <button title="上移" disabled={d === 0} onClick={() => onMoveFe(d, -1)} style={{ ...moveBtn, opacity: d === 0 ? 0.4 : 1 }}>↑</button>
                <button title="下移" disabled={d === model.functionalEvents.length - 1} onClick={() => onMoveFe(d, 1)} style={{ ...moveBtn, opacity: d === model.functionalEvents.length - 1 ? 0.4 : 1 }}>↓</button>
                <button title="删除屏障" onClick={() => {
                  const used = branchesUsingFe(model, fe.id)
                  if (used === 0 || window.confirm(`将折叠 ${used} 个引用「${fe.label}」的分支为末态,继续?`)) onChange((prev) => delFe(prev, d))
                }} style={{ color: 'var(--psa-danger)', border: 0, background: 'none', cursor: 'pointer', fontSize: 14, lineHeight: 1, flexShrink: 0 }}>✕</button>
              </div>
            ))}
            <button onClick={onAddBarrier} style={{ marginTop: 8, width: '100%', height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: 'var(--psa-surface)', border: '1px dashed var(--psa-line-strong)', borderRadius: 8, color: 'var(--psa-primary)', fontSize: 12.5, fontWeight: 500, cursor: 'pointer' }}>＋ 添加屏障（延长级联）</button>

            <h4 style={h4s}>选中节点</h4>
            {!selNode ? (
              <div style={{ fontSize: 12, color: 'var(--psa-muted)' }}>点击树上圆点选择节点。</div>
            ) : selNode.kind === 'leaf' ? (
              <div style={{ fontSize: 12 }}>
                <div style={{ marginBottom: 8 }}>
                  末态后果:&nbsp;
                  <select value={selNode.consequence} onChange={(e) => { const v = e.target.value; onChange((prev) => setConsequence(prev, sel!, v)) }}>
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
                      <select value="" onChange={(e) => { const v = e.target.value; if (v) onChange((prev) => branchLeaf(prev, sel!, v)) }}>
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
                      onChange={(e) => { const v = e.target.value; onChange((prev) => renameFe(prev, selIdx, v)) }}
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
                    <button onClick={() => onEditFt(selFeId!)} disabled={!canEditFt}
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
                        onChange={(e) => { const v = Number(e.target.value); onChange((prev) => setFailProb(prev, selIdx, v)) }}
                        style={{ flex: 1, fontSize: 12 }}
                      />
                    </div>
                    {/* 置信/口径/出处展示(库快照随节点走;手改 PFD 后 grade 由 setFailProb 降 D 并标注) */}
                    {(() => {
                      const fe = model.functionalEvents[selIdx]
                      if (!fe.grade && !fe.category && !fe.note && !fe.url && !fe.evidence) return null
                      return (
                        <div style={{ fontSize: 11, color: 'var(--psa-muted)', marginBottom: 4 }}>
                          {fe.grade && <>置信:{fe.grade}</>}
                          {fe.category && <span> · {fe.category}</span>}
                          {fe.note && (
                            <span title={fe.note}> · <span style={{ color: 'var(--psa-faint)', cursor: 'help' }}>口径</span></span>
                          )}
                          {fe.url && (
                            <a href={fe.url} target="_blank" rel="noopener noreferrer" title={fe.url}
                              style={{ color: 'var(--psa-primary)', textDecoration: 'none' }}> ↗</a>
                          )}
                          {fe.evidence && (
                            <span title={fe.evidence}> · <span style={{ color: 'var(--psa-faint)', cursor: 'help' }}>证据链</span></span>
                          )}
                        </div>
                      )
                    })()}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <button onClick={() => onAttachFt?.(selIdx)} disabled={selIdx < 0 || !canEditFt}
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
                        onChange((prev) => applyFieldUpdate(prev, selIdx, { failProb: pfdVal, grade: 'A', evidence: mkEvidence(which) }))
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
                        onChange={(e) => { const v = e.target.value; onChange((prev) => setBranchFe(prev, sel!, v)) }}
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
                      onChange((prev) => delFe(prev, selIdx))
                      onSelect(null)
                    }
                  }} style={{ color: 'var(--psa-danger)', border: '1px solid #fca5a5', background: 'var(--psa-danger-soft)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12, marginBottom: 6 }}>
                    删除屏障
                  </button>
                )}

                {/* 折叠当前分支节点为末态 */}
                <div>
                  <button onClick={() => onChange((prev) => collapseNode(prev, sel!))} style={{ color: 'var(--psa-danger)', border: 0, background: 'none', cursor: 'pointer', fontSize: 12 }}>折叠为末态</button>
                </div>
              </div>
            )}
          </>
        )}

        {tab === 'quant' && (
          <div style={{ paddingTop: 14 }}>
            {/* 序列级 LFT 集成口径(规格 2026-07-15):初因树与屏障共享事件时,序列频率按
                Σλ_i·P(E_i∧Path) 在合并 BDD 上精确求值;ie_frequency 为守恒总频率 Σ 序列。 */}
            {engineMeta?.method === 'integrated' && engineMeta.ieFrequency != null && (
              <div style={{ marginBottom: 8, padding: '8px 10px', background: 'var(--psa-primary-soft)', border: '1px solid var(--psa-line-2)', borderRadius: 8 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--psa-primary-strong)', border: '1px solid var(--psa-primary)', borderRadius: 5, padding: '1px 6px' }}>集成口径</span>
                  <span style={{ fontSize: 11.5, color: 'var(--psa-muted)' }}>初因频率 F</span>
                  <span className="psa-num" style={{ fontSize: 14, fontWeight: 600, color: 'var(--psa-ink)' }}>{formatEtaNumber(engineMeta.ieFrequency)}</span>
                  <span style={{ fontSize: 11, color: 'var(--psa-muted)' }}>/yr</span>
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--psa-faint)', marginTop: 3, lineHeight: 1.5 }}>
                  序列级精确集成:序列频率按 Σλ<sub>i</sub>·P(E<sub>i</sub>∧Path) 精确求值(共享事件自动正确;Σ 序列 = F,守恒)。
                </div>
              </div>
            )}
            <div style={{ fontSize: 12, color: 'var(--psa-muted)', marginBottom: 8 }}>各末态序列频率（{engineSeq ? (engineMeta?.method === 'integrated' ? '引擎精确 · 集成' : '引擎精确') : '前端积式'}）· 点击联动下方</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {seqRows.map((r) => {
                const active = selKey === r.lf.path.join('/')
                const cc = C_COLOR[consLevel(model, r.c)] || '#64748b'
                const pathTxt = r.path.map((p) => (p.outcome === 'failure' ? '失效' : '成功')).join(' → ') || '直接末态'
                return (
                  <div key={r.i} onClick={() => onSelect(r.lf.path)}
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
                  <select value={impC} onChange={(e) => onImpCChange(e.target.value)}>{CONSEQUENCES.map((c) => <option key={c} value={c}>{gradeLabel(c)}</option>)}</select>
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
        const li = seqRows.findIndex((r) => r.lf.path.join('/') === selKey)
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
  )
}
