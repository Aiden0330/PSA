/** 系统对比页(规格 2026-07-26-product-comparison §1;B′ 主视图 + A 下钻)。
 *
 * 铁律:成员=已钉扎 report 案例(选择器只列 kind=report),数字直读案例——绝不现算;
 * 对齐门(shared/divergent/unmatched)由服务端裁定,本页只呈现。矩阵/后果色语义
 * 复用 riskmatrix.ts 单源,不重复阈值。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  StatusError, compareAssemble, createCompareGroup, getPortfolio, listCompareGroups,
  listProjectCases, listSaved,
} from '../../api'
import type { CompareAssembly, CompareGroup, CompareMemberRef, CaseInfo, PortfolioRow, SavedItem } from '../../api'
import { FREQ_BANDS, SEVERITY_LABELS, CELLS, ZONE_COLORS, zoneOf, freqBandOf, C_TO_LEVEL } from '../../riskmatrix'
import { RADAR_AXES, buildCsv, consPlus, deltaPct, radarScores } from './compareCalc'

const MCOLORS = ['#0f766e', '#2563eb', '#9333ea', '#b45309']
const GRADE_COLORS: Record<string, string> = { A: '#16a34a', B: '#2563eb', C: '#d97706', D: '#6b7280' }
const fmtE = (v: number | null | undefined) => (v == null ? '—' : v.toExponential(2))

interface Slot { project_uuid: string; case_id: number | null }

function DeltaChip({ v }: { v: number | null }) {
  if (v == null) return <span style={{ color: 'var(--psa-faint)' }}>—</span>
  const up = v > 0
  return (
    <span style={{ fontFamily: 'var(--psa-font-mono)', fontWeight: 600, fontSize: 11,
      color: up ? 'var(--psa-danger-strong)' : '#166534' }}>
      {up ? '+' : ''}{v.toFixed(0)}%
    </span>
  )
}

function GradeBadge({ g }: { g: string | null }) {
  if (!g) return null
  return <span style={{ fontFamily: 'var(--psa-font-mono)', fontSize: 9.5, fontWeight: 700, color: '#fff',
    background: GRADE_COLORS[g] ?? '#6b7280', borderRadius: 4, padding: '0 4px', marginLeft: 4 }}>{g}</span>
}

export function CompareTab() {
  const [rows, setRows] = useState<PortfolioRow[]>([])
  const [cases, setCases] = useState<Record<string, CaseInfo[]>>({})
  const [slots, setSlots] = useState<Slot[]>([{ project_uuid: '', case_id: null }, { project_uuid: '', case_id: null }])
  const [baseIdx, setBaseIdx] = useState(0)
  const [asm, setAsm] = useState<CompareAssembly | null>(null)
  const [groups, setGroups] = useState<CompareGroup[]>([])
  const [savedList, setSavedList] = useState<SavedItem[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    getPortfolio().then(setRows).catch((e) => setErr(`项目列表读取失败:${e?.message ?? e}`))
    listSaved().then(setSavedList).catch(() => { /* 存档列表失败只影响幽灵行提示 */ })
    listCompareGroups().then(setGroups).catch(() => { /* 组列表失败不阻塞主流程 */ })
  }, [])

  const loadCases = useCallback((uuid: string) => {
    if (!uuid || cases[uuid]) return
    listProjectCases(uuid)
      .then((cs) => setCases((p) => ({ ...p, [uuid]: cs.filter((c) => c.kind === 'report') })))
      .catch((e) => setErr(`案例列表读取失败:${e?.message ?? e}`))
  }, [cases])

  const setSlot = (i: number, patch: Partial<Slot>) => {
    setSlots((p) => p.map((s, j) => (j === i ? { ...s, ...patch } : s)))
  }

  const run = async (members?: CompareMemberRef[], base?: number) => {
    setErr('')
    const ms = members ?? slots.map((s) => ({ project_uuid: s.project_uuid, case_id: s.case_id as number }))
    if (ms.some((m) => !m.project_uuid || m.case_id == null)) { setErr('每列都要选定项目与 report 案例。'); return }
    setBusy(true)
    try {
      setAsm(await compareAssemble(ms, base ?? baseIdx))
    } catch (e) {
      setAsm(null)
      setErr(e instanceof StatusError ? e.message : `对比组装失败:${String((e as Error)?.message ?? e)}`)
    } finally { setBusy(false) }
  }

  const saveGroup = async () => {
    const ms = slots.map((s) => ({ project_uuid: s.project_uuid, case_id: s.case_id as number }))
    if (ms.some((m) => !m.project_uuid || m.case_id == null)) { setErr('先选满成员再保存案例组。'); return }
    const name = window.prompt('对比案例组名称', '选型对比')
    if (!name) return
    try {
      const g = await createCompareGroup(name, ms, baseIdx)
      setGroups((p) => [g, ...p])
    } catch (e) { setErr(`保存案例组失败:${String((e as Error)?.message ?? e)}`) }
  }

  const loadGroup = (gid: number) => {
    const g = groups.find((x) => x.id === gid)
    if (!g) return
    setSlots(g.members.map((m) => ({ project_uuid: m.project_uuid, case_id: m.case_id })))
    setBaseIdx(g.base_index)
    g.members.forEach((m) => loadCases(m.project_uuid))
    void run(g.members, g.base_index)
  }

  const exportCsv = () => {
    if (!asm) return
    const blob = new Blob(['﻿' + buildCsv(asm)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'bess-compare.csv'; document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const names = useMemo(() => (asm ? asm.members.map((m) => m.project.name ?? m.project.uuid.slice(0, 8)) : []), [asm])

  // 报障 2026-07-27:portfolio 是版本库全量(含自动钉扎/已删存档残留/测试残渣),与项目树
  // 观感不一致且同名成堆。可选集收敛为「树中可见(有存档)∨ 已有分析案例」,名称字典序,
  // 同名缀 #uuid 短码;无案例项目禁选并在案例下拉给出生成路径提示。
  const pickable = useMemo(() => {
    const kept = rows.filter((r) => r.saved_id != null || r.latest_case != null)
    // 报障 2026-07-27 第二轮:ADR-2 前的老存档从未双写入版本库 → portfolio 无行,
    // 在下拉里整个消失(连灰条都没有)。并入"树里有、版本库没有"的幽灵存档,禁选 +
    // 指明入库路径,保证树中可见者在此必可见。
    const inStore = new Set(kept.map((r) => r.saved_id).filter(Boolean))
    const phantoms = savedList.filter((w) => !inStore.has(w.id))
      .map((w) => ({ uuid: `saved:${w.id}`, name: w.name, latest_case: null, phantom: true as const }))
    const all = [...kept.map((r) => ({ ...r, phantom: false as const })), ...phantoms]
    all.sort((x, y) => x.name.localeCompare(y.name, 'zh') || x.uuid.localeCompare(y.uuid))
    const dup = (n: string) => all.filter((r) => r.name === n).length > 1
    return all.map((r) => ({
      ...r,
      optionLabel: `${r.name}${dup(r.name) ? ` #${r.uuid.replace('saved:', '').slice(0, 4)}` : ''}${
        r.phantom ? '(未入版本库)' : r.latest_case ? '' : '(无案例)'}`,
    }))
  }, [rows, savedList])
  const slotsReady = slots.length >= 2 && slots.every((s) => s.project_uuid && s.case_id != null)

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: 'var(--exp-bg)', padding: 16, boxSizing: 'border-box' }}>
      <div style={{ maxWidth: 1150, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--exp-ink)', marginBottom: 4 }}>系统对比</div>
          <div style={{ fontSize: 11.5, color: 'var(--exp-muted)' }}>
            成员 = 各项目<b>已钉扎的 report 分析案例</b>(数字绝不现算,案例锚定版本哈希);结构对齐门服务端裁定 —— 未配对/结构分歧以 ◇ 隔离,禁止硬比。
          </div>
        </div>

        {err && <div role="alert" style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>{err}</div>}

        {/* ── 选择器 ── */}
        <div className="psa-panel" style={{ flex: 'none' }}>
          <div className="psa-ch"><span className="t">对比成员(2–4 列)</span>
            <span className="meta">
              案例组:
              <select data-testid="group-load" value="" onChange={(e) => { const v = Number(e.target.value); if (v) loadGroup(v) }}
                style={{ margin: '0 6px', fontSize: 11 }}>
                <option value="">载入…</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}({g.members.length} 列)</option>)}
              </select>
              <button className="psa-btn" style={{ fontSize: 11, padding: '2px 8px' }} onClick={saveGroup}>保存当前为组</button>
            </span>
          </div>
          <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {slots.map((s, i) => {
              const cs = cases[s.project_uuid] ?? []
              return (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ width: 14, height: 14, borderRadius: 4, background: MCOLORS[i], flexShrink: 0 }} />
                  <select data-testid={`slot-project-${i}`} value={s.project_uuid}
                    onChange={(e) => { setSlot(i, { project_uuid: e.target.value, case_id: null }); loadCases(e.target.value) }}
                    style={{ minWidth: 220, fontSize: 12 }}>
                    <option value="">选择项目…</option>
                    {pickable.map((r) => (
                      <option key={r.uuid} value={r.uuid} disabled={!r.latest_case}
                        title={r.latest_case ? undefined
                          : r.phantom ? '老存档尚未入版本库——打开该项目保存一次,再导出报告即可参与对比'
                          : '该项目尚无分析案例——先在其「报告与证据链」页导出报告(自动钉扎)'}>
                        {r.optionLabel}
                      </option>
                    ))}
                  </select>
                  <select data-testid={`slot-case-${i}`} value={s.case_id ?? ''}
                    onChange={(e) => setSlot(i, { case_id: e.target.value ? Number(e.target.value) : null })}
                    style={{ minWidth: 240, fontSize: 12 }} disabled={!s.project_uuid || cs.length === 0}>
                    <option value="">{s.project_uuid && cases[s.project_uuid] && cs.length === 0 ? '该项目暂无 report 案例' : '选择 report 案例…'}</option>
                    {cs.map((c) => <option key={c.id} value={c.id}>#{c.id} · v{c.version_id} · {c.created_at.slice(0, 10)}</option>)}
                  </select>
                  {s.project_uuid && cases[s.project_uuid] && cs.length === 0 && (
                    <span data-testid={`slot-nocase-${i}`} style={{ fontSize: 11, color: '#92400e', background: '#fef3c7', borderRadius: 5, padding: '2px 8px' }}>
                      无 report 案例——到该项目「报告与证据链」页导出一次报告(自动钉扎)即可参与对比
                    </span>
                  )}
                  <label style={{ fontSize: 11.5, color: 'var(--psa-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input type="radio" name="cmp-base" checked={baseIdx === i} onChange={() => setBaseIdx(i)} />基准
                  </label>
                  {slots.length > 2 && (
                    <button className="psa-btn" style={{ fontSize: 11, padding: '2px 7px' }}
                      onClick={() => { setSlots((p) => p.filter((_, j) => j !== i)); if (baseIdx >= slots.length - 1) setBaseIdx(0) }}>✕</button>
                  )}
                </div>
              )
            })}
            <div style={{ fontSize: 10.5, color: 'var(--psa-faint)' }}>
              列表 = 项目树存档 ∪ 已有分析案例的钉扎项目(同名以 #id 区分;含已删存档但保留案例的项目——证据不随存档删除)。灰「(无案例)」= 到该项目报告页导出一次(自动钉扎);灰「(未入版本库)」= 老存档,打开保存一次再导出。
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {slots.length < 4 && (
                <button className="psa-btn" onClick={() => setSlots((p) => [...p, { project_uuid: '', case_id: null }])}>＋添加对比列</button>
              )}
              <button className="psa-btn psa-btn--primary" disabled={busy || !slotsReady}
                title={slotsReady ? undefined : '每列都需选定项目与 report 案例后才能运行'}
                onClick={() => void run()}>{busy ? '组装中…' : '运行对比'}</button>
              {asm && <button className="psa-btn" onClick={exportCsv}>导出 CSV</button>}
            </div>
          </div>
        </div>

        {asm && (() => {
          const ms = asm.members
          const plus = ms.map((m) => consPlus(m.consequences))
          const bp = plus[asm.base]
          const scores = ms.map((m) => radarScores(m))
          return (
            <>
              {/* ── 汇总 ── */}
              <div className="psa-panel" style={{ flex: 'none' }}>
                <div className="psa-ch"><span className="t">结果汇总(/舱·年)</span><span className="meta">基准:{names[asm.base]}</span></div>
                <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
                  <thead><tr>
                    <th style={th}>指标</th>
                    {ms.map((m, i) => (
                      <th key={i} style={th}>
                        <span style={{ color: MCOLORS[i], fontWeight: 700 }}>{names[i]}</span>
                        <div style={{ fontFamily: 'var(--psa-font-mono)', fontWeight: 400, fontSize: 10, color: 'var(--psa-faint)' }}>
                          #{m.case.version_hash.slice(0, 8)} · case {m.case.id}
                        </div>
                      </th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {([['C3+(舱内起火及以上)', (p: typeof bp) => p.c3p],
                       ['C4+(爆燃及以上)', (p: typeof bp) => p.c4p],
                       ['C5(爆炸)', (p: typeof bp) => p.c5]] as const).map(([lab, get]) => (
                      <tr key={lab}>
                        <td style={td}>{lab}</td>
                        {ms.map((_, i) => (
                          <td key={i} style={td}>
                            <span className="psa-num" style={{ fontFamily: 'var(--psa-font-mono)' }}>{fmtE(get(plus[i]))}</span>
                            {i !== asm.base && <span style={{ marginLeft: 6 }}><DeltaChip v={deltaPct(get(plus[i]), get(bp))} /></span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                    <tr>
                      <td style={td}>参数置信构成(屏障快照)</td>
                      {ms.map((m, i) => (
                        <td key={i} style={td}>
                          {(['A', 'B', 'C', 'D'] as const).map((g) => (m.grade_mix[g] ?? 0) > 0 && (
                            <span key={g} style={{ marginRight: 6 }}><GradeBadge g={g} />×{m.grade_mix[g]}</span>
                          ))}
                          {(m.grade_mix.none ?? 0) > 0 && <span style={{ color: 'var(--psa-faint)' }}>无级×{m.grade_mix.none}</span>}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1.1fr .9fr', gap: 14 }}>
                {/* ── 风险矩阵落点(riskmatrix.ts 单源) ── */}
                <div className="psa-panel" style={{ flex: 'none' }}>
                  <div className="psa-ch"><span className="t">风险矩阵落点(C4+ 点值)</span><span className="meta">色带 = riskmatrix.ts 同源</span></div>
                  <div style={{ padding: 12, display: 'grid', gridTemplateColumns: `86px repeat(${SEVERITY_LABELS.length}, 1fr)`, gap: 3 }}>
                    {CELLS.map((row, bi) => (
                      [<div key={`l${bi}`} style={{ fontSize: 9.5, color: 'var(--psa-faint)', fontFamily: 'var(--psa-font-mono)', display: 'flex', alignItems: 'center' }}>{FREQ_BANDS[bi]?.label ?? ''}</div>,
                       ...row.map((cell, si) => {
                        const pins = ms.map((m, i) => ({ i, band: freqBandOf(consPlus(m.consequences).c4p) - 1, sev: (C_TO_LEVEL.C4 ?? 5) - 1 }))  // freqBandOf 1-based → CELLS 行 0-based
                          .filter((p) => p.band === bi && p.sev === si)
                        return (
                          <div key={si} style={{ height: 40, borderRadius: 5, background: ZONE_COLORS[zoneOf(cell)], opacity: .82, position: 'relative' }}>
                            <div style={{ position: 'absolute', top: 3, left: 4, display: 'flex', gap: 3 }}>
                              {pins.map((p) => (
                                <span key={p.i} data-testid={`pin-${p.i}`} title={names[p.i]}
                                  style={{ width: 15, height: 15, borderRadius: '50%', background: MCOLORS[p.i], border: '2px solid #fff', boxShadow: '0 1px 3px rgba(0,0,0,.4)', color: '#fff', fontSize: 8, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                  {String.fromCharCode(65 + p.i)}
                                </span>
                              ))}
                            </div>
                          </div>
                        )
                      })]
                    ))}
                    <div />
                    {SEVERITY_LABELS.map((s2) => <div key={s2} style={{ fontSize: 9, color: 'var(--psa-faint)', textAlign: 'center' }}>{s2}</div>)}
                  </div>
                  <div style={{ padding: '0 12px 10px', fontSize: 10.5, color: 'var(--psa-faint)' }}>落点 = 案例点值(p50 口径见不确定带);列 = C4 映射严重度。</div>
                </div>

                {/* ── 雷达(B′:四客观轴,分档规则披露) ── */}
                <div className="psa-panel" style={{ flex: 'none' }}>
                  <div className="psa-ch"><span className="t">均衡画像(四轴,客观分档)</span><span className="meta">分数不进证据链</span></div>
                  <div style={{ padding: '8px 12px 0', textAlign: 'center' }}>
                    <svg viewBox="0 0 300 300" style={{ maxWidth: 300, width: '100%' }} role="img" aria-label="对比雷达">
                      {[5, 3, 1].map((lv) => {
                        const t = lv / 5
                        const p = [[150, 150 - 120 * t], [150 + 120 * t, 150], [150, 150 + 120 * t], [150 - 120 * t, 150]]
                        return <polygon key={lv} points={p.map((q) => q.join(',')).join(' ')} fill="none" stroke="var(--psa-line, #e2e8f0)" />
                      })}
                      {ms.map((m, i) => {
                        const sc = scores[i]
                        const vals = [sc.c3p, sc.c4p, sc.width ?? 1, sc.conf]
                        const ax = [[150, 30], [270, 150], [150, 270], [30, 150]]
                        const pts = vals.map((v, k) => {
                          const t = v / 5
                          return [150 + (ax[k][0] - 150) * t, 150 + (ax[k][1] - 150) * t].map((n) => n.toFixed(1)).join(',')
                        }).join(' ')
                        const allD = (m.grade_mix.D ?? 0) > 0 && (m.grade_mix.A ?? 0) + (m.grade_mix.B ?? 0) + (m.grade_mix.C ?? 0) === 0
                        return <polygon key={i} data-testid={`radar-${i}`} points={pts} fill={`${MCOLORS[i]}26`}
                          stroke={MCOLORS[i]} strokeWidth={2} strokeDasharray={allD ? '4 3' : undefined} />
                      })}
                      <text x="150" y="18" textAnchor="middle" fontSize="10" fill="var(--psa-muted,#64748b)">{RADAR_AXES[0].label}</text>
                      <text x="284" y="154" textAnchor="middle" fontSize="10" fill="var(--psa-muted,#64748b)">{RADAR_AXES[1].label}</text>
                      <text x="150" y="292" textAnchor="middle" fontSize="10" fill="var(--psa-muted,#64748b)">{RADAR_AXES[2].label}</text>
                      <text x="18" y="154" textAnchor="middle" fontSize="10" fill="var(--psa-muted,#64748b)">{RADAR_AXES[3].label}</text>
                    </svg>
                  </div>
                  <div style={{ padding: '4px 12px 10px', fontSize: 10, color: 'var(--psa-faint)', lineHeight: 1.6 }}>
                    {RADAR_AXES.map((a) => <div key={a.key}>{a.label}:{a.rule}</div>)}
                    {ms.some((_m2, i) => scores[i].width == null) && <div>⚠ 无 bands 的成员"不确定带宽"按 1 计——补不确定性量化后复算。</div>}
                    全 D 级成员以虚线弱化(低置信画像不与实测画像同权)。
                  </div>
                </div>
              </div>

              {/* ── 不确定带 ── */}
              {ms.every((m) => m.bands?.C4) && (
                <div className="psa-panel" style={{ flex: 'none' }}>
                  <div className="psa-ch"><span className="t">不确定带并排(C4 · p05 — p50 — p95)</span><span className="meta">来自各案例 MC 结果</span></div>
                  <div style={{ padding: 12 }}>
                    {ms.map((m, i) => {
                      const b = m.bands!.C4
                      const lo = -8, hi = -4
                      const pos = (v: number) => `${Math.min(100, Math.max(0, ((Math.log10(v) - lo) / (hi - lo)) * 100))}%`
                      return (
                        <div key={i} style={{ display: 'grid', gridTemplateColumns: '130px 1fr 220px', gap: 10, alignItems: 'center', marginBottom: 10 }}>
                          <span style={{ fontSize: 11.5, color: MCOLORS[i], fontWeight: 600 }}>{names[i]}</span>
                          <div style={{ position: 'relative', height: 20 }}>
                            <i style={{ position: 'absolute', top: 9, left: pos(b.p05), right: `calc(100% - ${pos(b.p95)})`, height: 3, background: MCOLORS[i], opacity: .5, borderRadius: 2 }} />
                            <i style={{ position: 'absolute', top: 3, left: pos(b.p50), width: 3, height: 14, background: MCOLORS[i], borderRadius: 2 }} />
                          </div>
                          <span className="psa-num" style={{ fontFamily: 'var(--psa-font-mono)', fontSize: 10.5 }}>{fmtE(b.p05)} / {fmtE(b.p50)} / {fmtE(b.p95)}</span>
                        </div>
                      )
                    })}
                    <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr 220px', gap: 10, fontSize: 9.5, color: 'var(--psa-faint)', fontFamily: 'var(--psa-font-mono)' }}>
                      <span /><div style={{ display: 'flex', justifyContent: 'space-between' }}><span>10⁻⁸</span><span>10⁻⁷</span><span>10⁻⁶</span><span>10⁻⁵</span><span>10⁻⁴</span></div><span />
                    </div>
                  </div>
                </div>
              )}

              {/* ── 下钻:逐场景参数 Δ ── */}
              {asm.alignment.matched.map((al) => {
                const union: string[] = []
                for (const refs of al.fe_refs) for (const r of refs) if (!union.includes(r)) union.push(r)
                return (
                  <div key={al.ref} className="psa-panel" style={{ flex: 'none' }}>
                    <div className="psa-ch">
                      <span className="t">场景 {ms[asm.base].etas.find((e) => e.ref === al.ref)?.name ?? al.ref}</span>
                      {al.structural === 'divergent' && (
                        <span data-testid={`divergent-${al.ref}`} style={{ fontSize: 10.5, fontWeight: 700, color: '#92400e', background: '#fef3c7', borderRadius: 5, padding: '1px 7px' }}>◇ 结构分歧——仅交集屏障逐项可比,总量仍可比</span>
                      )}
                      <span className="meta">{al.ref}</span>
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                    <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
                      <thead><tr>
                        <th style={th}>屏障(PFD · 快照置信)</th>
                        {ms.map((_, i) => <th key={i} style={{ ...th, color: MCOLORS[i] }}>{names[i]}</th>)}
                      </tr></thead>
                      <tbody>
                        {union.map((feRef) => {
                          const fes = ms.map((m) => m.etas.find((e) => e.ref === al.ref)?.fes.find((f) => f.ref === feRef) ?? null)
                          const lab = fes.find((f) => f)?.label ?? feRef
                          const baseFe = fes[asm.base]
                          const missing = fes.some((f) => !f)
                          return (
                            <tr key={feRef} style={missing ? { background: '#fffbeb' } : undefined}>
                              <td style={td} title={fes.find((f) => f?.note)?.note ?? undefined}>
                                <span style={{ fontFamily: 'var(--psa-font-mono)', fontSize: 10.5, color: 'var(--psa-faint)' }}>{feRef}</span> {lab}
                                {missing && <span style={{ color: '#92400e' }}> ◇</span>}
                                {fes.find((f) => f?.url) && (
                                  <a href={fes.find((f) => f?.url)!.url!} target="_blank" rel="noopener noreferrer"
                                    style={{ color: 'var(--psa-primary)', textDecoration: 'none' }}> ↗</a>
                                )}
                              </td>
                              {fes.map((f, i) => (
                                <td key={i} style={td}>
                                  {f == null ? <span style={{ color: 'var(--psa-faint)' }}>—(无此屏障)</span> : (
                                    <>
                                      <span className="psa-num" style={{ fontFamily: 'var(--psa-font-mono)' }}>{f.pfd == null ? '—' : f.pfd}</span>
                                      <GradeBadge g={f.grade} />
                                      {i !== asm.base && f.pfd != null && baseFe?.pfd != null && baseFe.pfd !== 0 && (
                                        <span style={{ marginLeft: 6 }}><DeltaChip v={deltaPct(f.pfd, baseFe.pfd)} /></span>
                                      )}
                                    </>
                                  )}
                                </td>
                              ))}
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                    </div>
                  </div>
                )
              })}

              {asm.alignment.unmatched.length > 0 && (
                <div className="psa-panel" style={{ flex: 'none' }}>
                  <div className="psa-ch"><span className="t">◇ 未配对场景(仅在部分成员存在,禁止硬比)</span></div>
                  <div style={{ padding: 12, fontSize: 12, color: 'var(--psa-ink-2)' }}>
                    {asm.alignment.unmatched.map((u, k) => (
                      <div key={k}>{names[u.member]}:{u.ref}(其余成员无该场景——总量对比已含其贡献,逐屏障不可比)</div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )
        })()}
      </div>
    </div>
  )
}

const th: CSSProperties = { fontSize: 11, color: 'var(--psa-muted)', textAlign: 'left', padding: '6px 10px', background: 'var(--psa-soft)', borderBottom: '1px solid var(--psa-line-2)' }
const td: CSSProperties = { padding: '6px 10px', borderBottom: '1px solid var(--psa-line-2)' }
