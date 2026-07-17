import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { getLibrary } from '../api'
import type { LibraryData } from '../api'
import {
  getOverlay, applyOverlay, upsertEntry, deleteEntry, resetOverlay,
  mergeOverlay, buildLibraryFile, parseLibraryFile,
} from '../libraryStore'
import type { LibrarySection, LibraryRow } from '../libraryStore'
import { validateFieldEdit, validateGradeEdit } from '../libraryValidation'
import { Icon } from './icons'
import { posteriorPfd, posteriorRate } from '../bayes'
import type { BayesPrior } from '../bayes'

interface Col { key: string; label: string; num?: boolean; src?: boolean }
interface SectionSpec { section: LibrarySection; title: string; cols: Col[]; blank: () => LibraryRow }

const uid = () => 'usr_' + Math.random().toString(36).slice(2, 8)
const SRC: Col[] = [{ key: 'citation', label: '来源', src: true }, { key: 'url', label: 'URL', src: true }, { key: 'note', label: '备注', src: true }]

const SPECS: SectionSpec[] = [
  { section: 'component_failure_rates', title: '器件基础失效率',
    cols: [{ key: 'name', label: '器件' }, { key: 'failure_mode', label: '失效模式' }, { key: 'rate', label: '参考值', num: true }, { key: 'unit', label: '单位' }, { key: 'grade', label: '置信' }, ...SRC],
    blank: () => ({ id: uid(), name: '新器件', failure_mode: '', rate: 1e-6, unit: '', grade: 'D', source: { citation: '' } }) },
  { section: 'barrier_effectiveness', title: '防护措施有效性(PFD)',
    cols: [{ key: 'name', label: '措施' }, { key: 'category', label: '类型' }, { key: 'pfd', label: 'PFD', num: true }, { key: 'eff', label: 'η', num: true }, { key: 'grade', label: '置信' }, ...SRC],
    blank: () => ({ id: uid(), name: '新措施', category: '', pfd: 0.1, grade: 'D', source: { citation: '' } }) },
  { section: 'initiating_events', title: '初始事件频率',
    cols: [{ key: 'label', label: '初因' }, { key: 'category', label: '类别' }, { key: 'freq_prior', label: '频率/年', num: true }, ...SRC],
    blank: () => ({ id: uid(), label: '新初因', category: '', freq_prior: 1e-3, source: { citation: '' } }) },
]

const GRADES = ['A', 'B', 'C', 'D']
const GRADE_META: Record<string, { color: string; bg: string; desc: string }> = {
  A: { color: '#166534', bg: '#dcfce7', desc: 'A · 项目实测(现场/运行数据)' },
  B: { color: '#1e40af', bg: '#dbeafe', desc: 'B · 厂商数据' },
  C: { color: '#92400e', bg: '#fef3c7', desc: 'C · 行业统计(EPRI / OREDA / NPRD / NFPA 等)' },
  D: { color: '#475569', bg: '#eef2f6', desc: 'D · 文献参考 / 类比推断 / 示例值' },
}
const sectionHasGrade = (spec: SectionSpec) => spec.cols.some((c) => c.key === 'grade')

const th: CSSProperties = {
  textAlign: 'left', padding: '6px 10px',
  fontSize: 11.5, color: 'var(--psa-ink-2)', whiteSpace: 'nowrap',
  background: 'var(--psa-soft)', fontWeight: 600,
}
const td: CSSProperties = { padding: '2px 5px', borderBottom: '1px solid var(--psa-soft)' }
const inp: CSSProperties = { width: '100%', boxSizing: 'border-box', border: '1px solid transparent', borderRadius: 4, padding: '3px 5px', fontSize: 12, background: 'transparent' }

const cellVal = (row: any, c: Col) => (c.src ? row.source?.[c.key] ?? '' : row[c.key] ?? '')
function withCell(row: any, c: Col, raw: string): LibraryRow {
  if (c.src) return { ...row, source: { ...(row.source ?? {}), [c.key]: raw } }
  if (c.num) { const v = raw === '' ? 0 : Number(raw); return Number.isNaN(v) ? row : { ...row, [c.key]: v } }
  return { ...row, [c.key]: raw }
}
const ckey = (section: string, id: string, key: string) => `${section}|${id}|${key}`

export function ReferenceLibrary({ onLibraryChange }: { onLibraryChange?: () => void }) {
  const [base, setBase] = useState<LibraryData | null>(null)
  const [, force] = useState(0)
  const [err, setErr] = useState<string | null>(null)
  const [draft, setDraft] = useState<{ k: string; v: string } | null>(null)
  const [gradeFilter, setGradeFilter] = useState<Set<string>>(new Set(GRADES))
  const toggleGrade = (g: string) => setGradeFilter((s) => { const n = new Set(s); if (n.has(g)) n.delete(g); else n.add(g); return n })
  const [bayes, setBayes] = useState<{ section: LibrarySection; row: any } | null>(null)
  const [bIn, setBIn] = useState<{ N: number; k: number; prior: BayesPrior; n0: number }>({ N: 0, k: 0, prior: 'current', n0: 2 })
  const [pgBayes, setPgBayes] = useState<{ section: LibrarySection; row: any } | null>(null)
  const [pgIn, setPgIn] = useState<{ T: number; k: number; prior: BayesPrior; n0: number }>({ T: 0, k: 0, prior: 'current', n0: 2 })
  useEffect(() => { getLibrary().then(setBase).catch((e) => setErr(String(e?.message ?? e))) }, [])

  const refresh = useCallback(() => { force((n) => n + 1); onLibraryChange?.() }, [onLibraryChange])
  const guard = (fn: () => void) => { setErr(null); try { fn(); refresh() } catch (e: any) { setErr(String(e?.message ?? e)) } }
  // 单元格原子提交(FE-10):blur/Enter 时校验被编辑字段。返回 true=已提交,false=被拒。
  // 被拒时丢弃草稿、覆盖层逐位不动并显红;显示层的复原由调用点(onBlur/onKeyDown)命令式回填,
  // 因为受控 value 在 draft→null 后不总能触发 DOM 重同步(草稿态编辑的已知取舍)。
  const commitCell = (spec: SectionSpec, row: LibraryRow, c: Col, raw: string): boolean => {
    const fieldErr = validateFieldEdit(spec.section, row, c.key, raw)
    if (fieldErr) { setErr(`${spec.title} · ${row[spec.cols[0].key] ?? row.id}:${fieldErr}`); setDraft(null); return false }
    setDraft(null)
    guard(() => upsertEntry(spec.section, withCell(row, c, raw)))
    return true
  }
  const applyBayes = (which: 'mean' | 'p95') => {
    if (!bayes) return
    const r = bayes.row
    const res = posteriorPfd({ pfd: Number(r.pfd) || 0.1, N: bIn.N, k: bIn.k, prior: bIn.prior, n0: bIn.n0 })
    const pfdVal = which === 'mean' ? res.mean : res.p95
    const date = new Date().toISOString().slice(0, 10)
    const ev = `现场更新 N=${bIn.N}、k=${bIn.k}、先验=${bIn.prior === 'jeffreys' ? 'Jeffreys' : '当前PFD(n0=' + bIn.n0 + ')'}、采用=${which === 'mean' ? '后验均值' : '95%上限'}、后验均值=${res.mean.toExponential(2)}、95%上限=${res.p95.toExponential(2)}(${date})`
    const note = r.source?.note ? `${r.source.note};${ev}` : ev
    guard(() => upsertEntry('barrier_effectiveness', { ...r, pfd: pfdVal, grade: 'A', source: { ...(r.source ?? {}), note } }))
    setBayes(null)
  }
  const applyPgBayes = (which: 'mean' | 'p95') => {
    if (!pgBayes) return
    const r = pgBayes.row
    const isIE = pgBayes.section === 'initiating_events'
    const currentRate = isIE ? (Number(r.freq_prior) || 1e-3) : (Number(r.rate) || 1e-6)
    const res = posteriorRate({ rate: currentRate, T: pgIn.T, k: pgIn.k, prior: pgIn.prior, n0: pgIn.n0 })
    const val = which === 'mean' ? res.mean : res.p95
    const date = new Date().toISOString().slice(0, 10)
    const ev = `现场更新 T=${pgIn.T}、k=${pgIn.k}、先验=${pgIn.prior === 'jeffreys' ? 'Jeffreys' : '当前值(n0=' + pgIn.n0 + ')'}、采用=${which === 'mean' ? '后验均值' : '95%上限'}、后验均值=${res.mean.toExponential(2)}、95%上限=${res.p95.toExponential(2)}(${date})`
    const note = r.source?.note ? `${r.source.note};${ev}` : ev
    const updated = isIE
      ? { ...r, freq_prior: val, source: { ...(r.source ?? {}), note } }
      : { ...r, rate: val, grade: 'A', source: { ...(r.source ?? {}), note } }
    guard(() => upsertEntry(pgBayes.section, updated))
    setPgBayes(null)
  }
  const eff = base ? applyOverlay(base, getOverlay()) : null

  const onExport = () => {
    const blob = new Blob([JSON.stringify(buildLibraryFile(), null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob); const a = document.createElement('a')
    a.href = url; a.download = 'bess-reference-library.json'; document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const onImport = async (f: File) => { setErr(null); try { mergeOverlay(parseLibraryFile(await f.text())); refresh() } catch (e: any) { setErr(String(e?.message ?? e)) } }

  if (err && !base) return <p style={{ padding: 24, color: 'var(--psa-danger-strong)' }}>加载失败:{err}</p>
  if (!eff) return <p style={{ padding: 24 }}>加载中…</p>
  return (
    <div style={{ padding: 16, overflowY: 'auto', height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Page header(R4c:该页此前无统一标题,补一条,呼应 PortfolioTab.tsx 的既有写法) */}
      <div>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--exp-ink)', marginBottom: 4 }}>参考库</div>
        <div style={{ fontSize: 11.5, color: 'var(--exp-muted)' }}>器件失效率 / 屏障有效性 / 初始事件频率 — 全局共享,随项目文件迁移</div>
      </div>

      {/* Toolbar(R4c:换皮为 ETA/FTA ribbon 配色,处理器不变) */}
      <div style={{ display: 'flex', alignItems: 'center', columnGap: 10, rowGap: 8, flexWrap: 'wrap', padding: '8px 14px', background: 'var(--psa-surface)', borderBottom: '1px solid var(--psa-line-2)' }}>
        <button className="psa-btn" onClick={onExport}>
          <Icon name="download" size={13} /> 导出参考库
        </button>
        <label className="psa-btn" style={{ cursor: 'pointer' }}>
          <Icon name="upload" size={13} /> 导入参考库
          <input type="file" accept=".json" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onImport(f); e.currentTarget.value = '' }} />
        </label>
        <button className="psa-btn psa-btn--danger"
          onClick={() => { if (window.confirm('恢复内置参考库？将清空全部本地修改与新增。')) guard(() => resetOverlay()) }}>
          <Icon name="x" size={13} /> 恢复内置
        </button>
        {err && <span style={{ color: 'var(--psa-danger-strong)', fontSize: 12 }}>{err}</span>}
      </div>

      {/* Grade legend + filter (双用:图例 + 按置信等级筛选) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12 }}>
        <span style={{ color: 'var(--psa-muted)' }}>置信分级(点击筛选):</span>
        {GRADES.map((g) => {
          const on = gradeFilter.has(g); const m = GRADE_META[g]
          return (
            <button key={g} title={m.desc} onClick={() => toggleGrade(g)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 9px', borderRadius: 6, cursor: 'pointer',
                border: `1px solid ${on ? m.color : 'var(--psa-line)'}`, background: on ? m.bg : 'var(--psa-surface)',
                color: on ? m.color : 'var(--psa-faint)', opacity: on ? 1 : 0.55, fontWeight: 600 }}>
              <span style={{ fontFamily: 'var(--psa-font-mono)' }}>{g}</span>
              <span style={{ fontWeight: 400, fontSize: 11 }}>{m.desc.split('·')[1]?.trim()}</span>
            </button>
          )
        })}
      </div>

      {/* Amber disclaimer banner */}
      <div style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', padding: '10px 14px', borderRadius: 8, fontSize: 12.5 }}>
        ⚠ {eff.meta.disclaimer}　<b>修改保存在本浏览器（localStorage），可导出文件迁移。</b>
      </div>

      {/* One psa-panel per section */}
      {SPECS.map((spec) => {
        const allRows = (eff as unknown as Record<string, any[]>)[spec.section]
        const rows = sectionHasGrade(spec)
          ? allRows.filter((r) => { const g = String(r.grade ?? ''); return !GRADES.includes(g) || gradeFilter.has(g) })
          : allRows
        return (
          <div key={spec.section} className="psa-panel" style={{ flex: 'none' }}>
            <div className="psa-ch">
              <span className="t">{spec.title}</span>
              <span className="meta">{rows.length === allRows.length ? rows.length : rows.length + ' / ' + allRows.length} 条</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 600 }}>
                <thead>
                  <tr>
                    {spec.cols.map((c) => <th key={c.key} style={th}>{c.label}</th>)}
                    {spec.section === 'barrier_effectiveness' && (
                      <>
                        <th style={{ ...th, minWidth: 52 }} title="探测难度 D:1=易探测…5=难/不可探测">探测难度 D</th>
                        <th style={{ ...th, minWidth: 40 }} title="静默失效:无显性信号">静默</th>
                        <th style={{ ...th, minWidth: 90 }}>前兆信号</th>
                      </>
                    )}
                    <th style={th}></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      {spec.cols.map((c) => {
                        const k = ckey(spec.section, row.id, c.key)
                        if (c.key === 'grade') {
                          const g = String(cellVal(row, c) || 'D')
                          const m = GRADE_META[g] ?? GRADE_META.D
                          return (
                            <td key={c.key} style={td}>
                              <select value={g} title={m.desc}
                                onChange={(e) => {
                                  const gerr = validateGradeEdit(row, e.target.value)
                                  if (gerr) { setErr(`${spec.title} · ${row[spec.cols[0].key] ?? row.id}:${gerr}`); return }
                                  guard(() => upsertEntry(spec.section, withCell(row, c, e.target.value)))
                                }}
                                style={{ border: '1px solid var(--psa-line)', borderRadius: 6, padding: '2px 6px', fontSize: 12, fontWeight: 600, fontFamily: 'var(--psa-font-mono)', cursor: 'pointer', background: m.bg, color: m.color }}>
                                {GRADES.map((gg) => <option key={gg} value={gg}>{gg}</option>)}
                                {!GRADES.includes(g) && <option value={g}>{g}</option>}
                              </select>
                            </td>
                          )
                        }
                        const shown = draft && draft.k === k ? draft.v : String(cellVal(row, c))
                        return (
                          <td key={c.key} style={td}>
                            <input
                              style={{ ...inp, ...(c.num ? { fontFamily: 'var(--psa-font-mono)', fontVariantNumeric: 'tabular-nums' } : {}) }}
                              className={c.num ? 'psa-num' : undefined}
                              type="text" inputMode={c.num ? 'decimal' : undefined} value={shown}
                              onChange={(e) => setDraft({ k, v: e.target.value })}
                              onKeyDown={(e) => {
                                const el = e.currentTarget
                                if (e.key === 'Enter') { e.preventDefault(); if (!commitCell(spec, row, c, el.value)) el.value = String(cellVal(row, c)); el.blur() }
                                else if (e.key === 'Escape') { e.preventDefault(); setDraft(null); el.value = String(cellVal(row, c)); el.blur() }
                              }}
                              onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--psa-primary)')}
                              onBlur={(e) => { const el = e.currentTarget; const orig = String(cellVal(row, c)); if (el.value !== orig && !commitCell(spec, row, c, el.value)) el.value = orig; el.style.borderColor = 'transparent' }} />
                          </td>
                        )
                      })}
                      {spec.section === 'barrier_effectiveness' && (() => {
                        const det = (row as any).detection ?? {}
                        const diff = det.difficulty ?? ''
                        const silent = !!det.silent
                        const precursor = det.precursor ?? ''
                        const diffColor = (d: number) => d <= 2 ? '#166534' : d === 3 ? '#92400e' : '#991b1b'
                        const diffBg = (d: number) => d <= 2 ? '#dcfce7' : d === 3 ? '#fef3c7' : '#fee2e2'
                        const nd = Number(diff) || 0
                        return (
                          <>
                            <td style={td}>
                              <select
                                value={String(diff)}
                                title="探测难度 D (1=易探测…5=难/不可探测)"
                                onChange={(e) => {
                                  const v = e.target.value === '' ? undefined : Number(e.target.value)
                                  guard(() => upsertEntry(spec.section, { ...row, detection: { ...det, difficulty: v } }))
                                }}
                                style={{ border: '1px solid var(--psa-line)', borderRadius: 6, padding: '2px 5px', fontSize: 12, fontWeight: 600, fontFamily: 'var(--psa-font-mono)', cursor: 'pointer', background: nd ? diffBg(nd) : 'var(--psa-soft)', color: nd ? diffColor(nd) : 'var(--psa-ink-2)', width: 48 }}>
                                <option value="">–</option>
                                {[1, 2, 3, 4, 5].map((d) => <option key={d} value={d}>{d}</option>)}
                              </select>
                            </td>
                            <td style={td}>
                              <input type="checkbox" checked={silent}
                                onChange={(e) => guard(() => upsertEntry(spec.section, { ...row, detection: { ...det, silent: e.target.checked } }))}
                                title="静默失效:无显性信号" style={{ cursor: 'pointer' }} />
                            </td>
                            <td style={td}>
                              <input type="text" value={precursor} placeholder="前兆信号"
                                style={{ ...inp, minWidth: 100 }}
                                onChange={(e) => guard(() => upsertEntry(spec.section, { ...row, detection: { ...det, precursor: e.target.value || undefined } }))} />
                            </td>
                          </>
                        )
                      })()}
                      <td style={td}>
                        <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                          {spec.section === 'barrier_effectiveness' && (
                            <button title="用现场需求/失败数据贝叶斯更新 PFD(Beta-二项,采用后置信升 A)"
                              className="psa-btn" style={{ height: 26, padding: '0 8px', fontSize: 11.5, whiteSpace: 'nowrap' }}
                              onClick={() => { setBayes({ section: spec.section, row }); setBIn({ N: 0, k: 0, prior: 'current', n0: 2 }) }}>
                              <Icon name="bolt" size={12} /> 现场更新
                            </button>
                          )}
                          {(spec.section === 'component_failure_rates' || spec.section === 'initiating_events') && (
                            <button title="用现场曝露/失效数据 Poisson-Gamma 更新失效率/频率"
                              className="psa-btn" style={{ height: 26, padding: '0 8px', fontSize: 11.5, whiteSpace: 'nowrap' }}
                              onClick={() => { setPgBayes({ section: spec.section, row }); setPgIn({ T: 0, k: 0, prior: 'current', n0: 2 }) }}>
                              <Icon name="bolt" size={12} /> 现场更新
                            </button>
                          )}
                          <button
                            title="删除该行"
                            className="psa-btn psa-btn--danger"
                            style={{ height: 26, padding: '0 8px', fontSize: 11.5 }}
                            onClick={() => { if (window.confirm('删除该行？')) guard(() => deleteEntry(spec.section, row.id)) }}>
                            <Icon name="trash" size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ padding: '8px 10px' }}>
              <button className="psa-btn" onClick={() => guard(() => upsertEntry(spec.section, spec.blank()))}>
                <Icon name="plus" size={13} /> 添加一行
              </button>
            </div>
          </div>
        )
      })}

      {/* 现场贝叶斯更新 PFD 弹层(屏障行入口) */}
      {bayes && (() => {
        const r = bayes.row
        const res = posteriorPfd({ pfd: Number(r.pfd) || 0.1, N: bIn.N, k: bIn.k, prior: bIn.prior, n0: bIn.n0 })
        const fld: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 13 }
        return (
          <div onClick={() => setBayes(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,25,40,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--psa-surface)', borderRadius: 12, padding: 20, width: 460, maxWidth: '92vw', boxShadow: '0 8px 30px rgba(15,25,40,.25)' }}>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>现场贝叶斯更新 · PFD</div>
              <div style={{ fontSize: 12.5, color: 'var(--psa-muted)', marginBottom: 14 }}>{r.name}　当前 PFD={Number(r.pfd).toExponential(2)} · 置信 {r.grade ?? 'D'}</div>
              <div style={fld}><span style={{ width: 88 }}>需求次数 N</span><input type="number" min={0} value={bIn.N} onChange={(e) => setBIn({ ...bIn, N: Math.max(0, Math.floor(+e.target.value || 0)) })} style={{ flex: 1, fontSize: 13 }} /></div>
              <div style={fld}><span style={{ width: 88 }}>失败次数 k</span><input type="number" min={0} value={bIn.k} onChange={(e) => setBIn({ ...bIn, k: Math.max(0, Math.floor(+e.target.value || 0)) })} style={{ flex: 1, fontSize: 13 }} /></div>
              <div style={fld}><span style={{ width: 88 }}>先验</span>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}><input type="radio" name="bprior" checked={bIn.prior === 'current'} onChange={() => setBIn({ ...bIn, prior: 'current' })} />当前 PFD</label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}><input type="radio" name="bprior" checked={bIn.prior === 'jeffreys'} onChange={() => setBIn({ ...bIn, prior: 'jeffreys' })} />Jeffreys</label>
                {bIn.prior === 'current' && <><span style={{ color: 'var(--psa-muted)' }}>n₀</span><input type="number" min={1} value={bIn.n0} onChange={(e) => setBIn({ ...bIn, n0: Math.max(1, +e.target.value || 1) })} style={{ width: 54, fontSize: 13 }} /></>}
              </div>
              <div style={{ background: 'var(--psa-soft)', borderRadius: 8, padding: '10px 12px', margin: '10px 0', fontFamily: 'var(--psa-font-mono)', fontSize: 13 }}>
                <div>后验均值 = <b>{res.mean.toExponential(3)}</b></div>
                <div style={{ color: 'var(--psa-muted)', fontSize: 12, marginTop: 4 }}>90% 上限 {res.p90.toExponential(3)} · 95% 上限 {res.p95.toExponential(3)} · Beta(α={res.alpha.toFixed(2)}, β={res.beta.toFixed(2)})</div>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--psa-faint)', marginBottom: 12 }}>采用后:写回 PFD、置信升 <b>A</b>(项目实测)、备注追加证据链。</div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="psa-btn" onClick={() => setBayes(null)}>取消</button>
                <button className="psa-btn" onClick={() => applyBayes('p95')}>采用 95% 上限</button>
                <button className="psa-btn psa-btn--primary" onClick={() => applyBayes('mean')}>采用后验均值</button>
              </div>
            </div>
          </div>
        )
      })()}
      {/* Poisson-Gamma 现场更新 弹层(器件/初因行入口) */}
      {pgBayes && (() => {
        const r = pgBayes.row
        const isIE = pgBayes.section === 'initiating_events'
        const currentRate = isIE ? (Number(r.freq_prior) || 1e-3) : (Number(r.rate) || 1e-6)
        const res = posteriorRate({ rate: currentRate, T: pgIn.T, k: pgIn.k, prior: pgIn.prior, n0: pgIn.n0 })
        const fld: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 13 }
        return (
          <div onClick={() => setPgBayes(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,25,40,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--psa-surface)', borderRadius: 12, padding: 20, width: 480, maxWidth: '92vw', boxShadow: '0 8px 30px rgba(15,25,40,.25)' }}>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>现场贝叶斯更新 · {isIE ? '初因频率' : '失效率'}(Poisson-Gamma)</div>
              <div style={{ fontSize: 12.5, color: 'var(--psa-muted)', marginBottom: 14 }}>
                {isIE ? r.label : r.name}　当前{isIE ? '频率' : '失效率'}={(currentRate).toExponential(2)}{isIE ? ' /yr' : ` ${r.unit ?? ''}`}{!isIE ? ` · 置信 ${r.grade ?? 'D'}` : ''}
              </div>
              <div style={fld}><span style={{ width: 100 }}>曝露时长 T</span><input type="number" min={0} step="any" value={pgIn.T} onChange={(e) => setPgIn({ ...pgIn, T: Math.max(0, +e.target.value || 0) })} style={{ flex: 1, fontSize: 13 }} /><span style={{ color: 'var(--psa-muted)' }}>(年)</span></div>
              <div style={fld}><span style={{ width: 100 }}>失效次数 k</span><input type="number" min={0} value={pgIn.k} onChange={(e) => setPgIn({ ...pgIn, k: Math.max(0, Math.floor(+e.target.value || 0)) })} style={{ flex: 1, fontSize: 13 }} /></div>
              <div style={fld}><span style={{ width: 100 }}>先验</span>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}><input type="radio" name="pgprior" checked={pgIn.prior === 'current'} onChange={() => setPgIn({ ...pgIn, prior: 'current' })} />当前值</label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}><input type="radio" name="pgprior" checked={pgIn.prior === 'jeffreys'} onChange={() => setPgIn({ ...pgIn, prior: 'jeffreys' })} />Jeffreys</label>
                {pgIn.prior === 'current' && <><span style={{ color: 'var(--psa-muted)' }}>n₀</span><input type="number" min={1} step="any" value={pgIn.n0} onChange={(e) => setPgIn({ ...pgIn, n0: Math.max(1e-3, +e.target.value || 1) })} style={{ width: 60, fontSize: 13 }} /></>}
              </div>
              <div style={{ background: 'var(--psa-soft)', borderRadius: 8, padding: '10px 12px', margin: '10px 0', fontFamily: 'var(--psa-font-mono)', fontSize: 13 }}>
                <div>后验均值 = <b>{res.mean.toExponential(3)}</b></div>
                <div style={{ color: 'var(--psa-muted)', fontSize: 12, marginTop: 4 }}>90% 上限 {res.p90.toExponential(3)} · 95% 上限 {res.p95.toExponential(3)} · Gamma(α={res.alpha.toFixed(3)}, β={res.beta.toFixed(3)})</div>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--psa-faint)', marginBottom: 12 }}>
                采用后:写回{isIE ? '频率' : '失效率'}{!isIE ? '、置信升 A(项目实测)' : ''}、备注追加证据链。
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="psa-btn" onClick={() => setPgBayes(null)}>取消</button>
                <button className="psa-btn" onClick={() => applyPgBayes('p95')}>采用 95% 上限</button>
                <button className="psa-btn psa-btn--primary" onClick={() => applyPgBayes('mean')}>采用后验均值</button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
