/** 站级评估页(规格 2026-07-27-station-model §4;C′ 版面收敛版)。
 *
 * 铁律:舱 = 产品钉扎 report 案例的实例(频率直读案例,绝不现算);
 * 标签绑定(评审 BLOCKING-1):「≥5 舱」只许绑 metrics.ge5,「整排」只许绑
 * metrics.ge_row——本组件的 KPI 标签即该铁律的 UI 落点,锁测把守。
 * 简化清单(declared.simplifications)必须渲染——口径不藏。
 */
import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  StatusError, createStation, deleteStation, getStation, getPortfolio, listProjectCases,
  listStations, pinStation, quantifyStation, stationCaseReportUrl, updateStation,
} from '../../api'
import type { StationMetricKey, CaseInfo, PortfolioRow, StationDoc, StationQuantify } from '../../api'

const PCOLORS = ['#0f766e', '#2563eb', '#9333ea', '#b45309']
const fmtE = (v: number | null | undefined) => (v == null ? '—' : v.toExponential(2))
const METRIC_LABEL: Record<string, string> = {
  any: '任一舱 C3+', ge2: '多舱 ≥2 舱', ge5: '≥5 舱(排内连片)',
  ge_row: '整排蔓延(k=排长)', offsite: '站界外后果',
}
interface WizAcc { metric: string; limit: string; eval_basis: 'point' | 'p95'; basis: string; label: string }

const th: CSSProperties = { fontSize: 11, color: 'var(--psa-muted)', textAlign: 'left', padding: '5px 10px', background: 'var(--psa-soft)', borderBottom: '1px solid var(--psa-line-2)' }
const td: CSSProperties = { padding: '5px 10px', borderBottom: '1px solid var(--psa-line-2)', fontSize: 11.5 }

interface WizProduct { key: string; project_uuid: string; case_id: number | null }
interface WizRow { id: string; product: string; count: number; walls: string }

export function StationTab() {
  const [stations, setStations] = useState<{ id: number; name: string; modified_at: string }[]>([])
  const [ports, setPorts] = useState<PortfolioRow[]>([])
  const [cases, setCases] = useState<Record<string, CaseInfo[]>>({})
  const [doc, setDoc] = useState<StationDoc | null>(null)
  const [q, setQ] = useState<StationQuantify | null>(null)
  const [selCab, setSelCab] = useState<string>('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  // 向导态
  const [name, setName] = useState('新站型')
  const [wps, setWps] = useState<WizProduct[]>([{ key: 'A', project_uuid: '', case_id: null }])
  const [wrows, setWrows] = useState<WizRow[]>([{ id: 'Z1', product: 'A', count: 5, walls: '' }])
  const [intraP, setIntraP] = useState('0.10')
  const [wallP, setWallP] = useState('0.03')
  const [interP, setInterP] = useState('0.02')
  const [supPfd, setSupPfd] = useState('0.29')
  const [erPfd, setErPfd] = useState('0.20')
  const [fenceP, setFenceP] = useState('0.10')
  const [acc, setAcc] = useState<WizAcc[]>([])

  useEffect(() => {
    listStations().then(setStations).catch((e) => setErr(`站型列表读取失败:${e?.message ?? e}`))
    getPortfolio().then(setPorts).catch((e) => setErr(`项目列表读取失败:${e?.message ?? e}`))
  }, [])

  const loadCases = (uuid: string) => {
    if (!uuid || cases[uuid]) return
    listProjectCases(uuid)
      .then((cs) => setCases((p) => ({ ...p, [uuid]: cs.filter((c) => c.kind === 'report') })))
      .catch((e) => setErr(`案例列表读取失败:${e?.message ?? e}`))
  }

  const pickable = useMemo(() => ports.filter((r) => r.latest_case != null)
    .slice().sort((x, y) => x.name.localeCompare(y.name, 'zh')), [ports])

  const openStation = async (sid: number) => {
    setErr('')
    try {
      const d = await getStation(sid)
      setDoc(d)
      setQ(await quantifyStation(sid))
      setSelCab('')
      // 报障 2026-07-27:打开只载结果不回填表单 ⇒ 用户以为"不能保存",每次点创建又生
      // 一个新站型。打开 = 完整回填,配合「保存修改」构成编辑闭环。
      setName(d.name)
      setWps(d.products.map((pp) => ({ key: pp.key, project_uuid: pp.project_uuid, case_id: pp.case_id })))
      d.products.forEach((pp) => loadCases(pp.project_uuid))
      setWrows(d.rows.map((r) => ({ id: r.id, product: r.cabins[0]?.product ?? d.products[0]?.key ?? 'A',
        count: r.cabins.length, walls: (r.walls ?? []).join(',') })))
      setIntraP(String(d.edge_defaults.intra_p))
      setWallP(String(d.edge_defaults.wall_p))
      setInterP(String(d.edge_defaults.inter_row_p))
      setSupPfd(String(d.station_barriers.find((b) => b.key === 'sup')?.pfd ?? 1))
      setErPfd(String(d.station_barriers.find((b) => b.key === 'er')?.pfd ?? 1))
      setFenceP(String(d.offsite.p_fence))
      setAcc((d.acceptance ?? []).map((a) => ({ metric: a.metric, limit: String(a.limit),
        eval_basis: a.eval_basis, basis: a.basis, label: a.label ?? '' })))
    } catch (e) { setErr(e instanceof StatusError ? e.message : String((e as Error)?.message ?? e)) }
  }

  const buildDoc = (): StationDoc | null => {
    if (wps.some((p) => !p.project_uuid || p.case_id == null)) { setErr('每个产品都要选定项目与 report 案例。'); return null }
    return {
      name,
      products: wps.map((p) => ({ key: p.key, project_uuid: p.project_uuid, case_id: p.case_id as number })),
      rows: wrows.map((r) => ({
        id: r.id,
        cabins: Array.from({ length: r.count }, (_, i) => ({ id: `${r.id}-${String(i + 1).padStart(2, '0')}`, product: r.product })),
        walls: r.walls.split(',').map((s) => s.trim()).filter(Boolean).map(Number),
      })),
      edge_defaults: { intra_p: Number(intraP), wall_p: Number(wallP), inter_row_p: Number(interP), refs: { intra: 'B_SPACING' } },
      edge_overrides: [],
      station_barriers: [
        { key: 'sup', label: '站级消防(就绪⊕条件有效)', pfd: Number(supPfd), grade: 'D', scope: '全站', basis: 'act-suppress-readiness ⊕ η' },
        { key: 'er', label: '应急响应(SPAR-H)', pfd: Number(erPfd), grade: 'D', scope: '全站', basis: 'hep-diagnosis/action-sparh' },
      ],
      ccf_groups: wps.map((p) => ({ key: `fw-${p.key}`, label: `产品${p.key} BMS 固件`, member_products: [p.key], beta: 0.05, basis: '同 OTA 批次(申报,v1 不入值)' })),
      offsite: { p_fence: Number(fenceP), basis: '泄爆朝向+站界距离' },
      acceptance: acc.map((a) => ({ metric: a.metric as StationMetricKey, limit: Number(a.limit),
        eval_basis: a.eval_basis, basis: a.basis, ...(a.label ? { label: a.label } : {}) })),
    }
  }

  const create = async () => {
    setErr('')
    const body = buildDoc()
    if (!body) return
    // 同名知情确认(保存双胞胎病,同 onSaveWorkspace 守卫)
    if (stations.some((st) => st.name === body.name) &&
        !window.confirm(`已存在同名站型「${body.name}」。继续将创建第二份(列表以 #id 区分)。确定?建议改名或用「保存修改」更新已打开的站型。`)) return
    setBusy(true)
    try {
      const created = await createStation(body)
      setStations((p) => [{ id: created.id!, name: created.name, modified_at: '', created_by: '' }, ...p])
      await openStation(created.id!)
    } catch (e) { setErr(e instanceof StatusError ? e.message : String((e as Error)?.message ?? e)) }
    finally { setBusy(false) }
  }

  const saveChanges = async () => {
    if (doc?.id == null) return
    setErr('')
    const body = buildDoc()
    if (!body) return
    setBusy(true)
    try {
      await updateStation(doc.id, body)
      setStations((p) => p.map((st) => (st.id === doc.id ? { ...st, name: body.name } : st)))
      await openStation(doc.id)
    } catch (e) { setErr(e instanceof StatusError ? e.message : String((e as Error)?.message ?? e)) }
    finally { setBusy(false) }
  }

  const cabinByRow = useMemo(() => {
    if (!q) return []
    const m = new Map<string, typeof q.per_cabin>()
    for (const c of q.per_cabin) {
      if (!m.has(c.row)) m.set(c.row, [])
      m.get(c.row)!.push(c)
    }
    return [...m.entries()]
  }, [q])
  const prodIdx = useMemo(() => new Map((doc?.products ?? []).map((p, i) => [p.key, i])), [doc])
  const sel = q?.per_cabin.find((c) => c.id === selCab) ?? null

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: 'var(--exp-bg)', padding: 16, boxSizing: 'border-box' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--exp-ink)', marginBottom: 4 }}>站级评估</div>
          <div style={{ fontSize: 11.5, color: 'var(--exp-muted)' }}>
            舱 = 产品(系统项目)<b>已钉扎 report 案例</b>的实例(频率直读案例,版本哈希续接);站层为连续区间蔓延模型,简化清单随结果申报。
          </div>
        </div>
        {err && <div role="alert" style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>{err}</div>}

        {/* ── 站型列表 + 新建向导 ── */}
        <div className="psa-panel" style={{ flex: 'none' }}>
          <div className="psa-ch"><span className="t">站型</span>
            <span className="meta">
              <select data-testid="station-open" value="" onChange={(e) => { const v = Number(e.target.value); if (v) void openStation(v) }} style={{ fontSize: 11 }}>
                <option value="">打开已有站型…</option>
                {stations.map((s) => <option key={s.id} value={s.id}>{s.name} #{s.id}</option>)}
              </select>
            </span>
          </div>
          <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              站名 <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: 140 }} />
              排内升级 p <input data-testid="intra-p" value={intraP} onChange={(e) => setIntraP(e.target.value)} style={{ width: 52 }} className="psa-num" title="B_SPACING 间距升级概率" />
              墙 p <input value={wallP} onChange={(e) => setWallP(e.target.value)} style={{ width: 52 }} className="psa-num" />
              跨排 p <input value={interP} onChange={(e) => setInterP(e.target.value)} style={{ width: 52 }} className="psa-num" />
              站级消防 PFD <input value={supPfd} onChange={(e) => setSupPfd(e.target.value)} style={{ width: 52 }} className="psa-num" />
              应急 PFD <input value={erPfd} onChange={(e) => setErPfd(e.target.value)} style={{ width: 52 }} className="psa-num" />
              站界 p <input value={fenceP} onChange={(e) => setFenceP(e.target.value)} style={{ width: 52 }} className="psa-num" title="必填——隐式缺省被后端拒绝(零默认=风险抹除)" />
            </div>
            {/* ── ST-7 验收准则(可选;判据口径显式必填,限值必须带依据) ── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 11, color: 'var(--psa-faint)' }}>
                验收准则(可选)——判据口径与限值依据必填,判定随结果钉扎入报告
                <button className="psa-btn" data-testid="acc-add" style={{ marginLeft: 8, fontSize: 11 }}
                  onClick={() => setAcc((x) => [...x, { metric: 'ge5', limit: '1e-6', eval_basis: 'point', basis: '', label: '' }])}>+ 加准则</button>
              </div>
              {acc.map((a, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', fontSize: 11.5 }}>
                  <select value={a.metric} data-testid={`acc-metric-${i}`} style={{ fontSize: 11.5 }}
                    onChange={(e) => setAcc((x) => x.map((y, j) => j === i ? { ...y, metric: e.target.value } : y))}>
                    {Object.entries(METRIC_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                  ≤ <input value={a.limit} className="psa-num" style={{ width: 64 }} title="限值(/站·年)"
                    onChange={(e) => setAcc((x) => x.map((y, j) => j === i ? { ...y, limit: e.target.value } : y))} />
                  <select value={a.eval_basis} title="判据口径:点值判 or P95 保守判(监管声明,必须显式)" style={{ fontSize: 11.5 }}
                    onChange={(e) => setAcc((x) => x.map((y, j) => j === i ? { ...y, eval_basis: e.target.value as 'point' | 'p95' } : y))}>
                    <option value="point">点值判</option><option value="p95">P95 保守判</option>
                  </select>
                  <input value={a.basis} placeholder="限值依据(法规/业主目标)——必填" style={{ width: 200 }}
                    onChange={(e) => setAcc((x) => x.map((y, j) => j === i ? { ...y, basis: e.target.value } : y))} />
                  <input value={a.label} placeholder="名称(可选)" style={{ width: 110 }}
                    onChange={(e) => setAcc((x) => x.map((y, j) => j === i ? { ...y, label: e.target.value } : y))} />
                  <button className="psa-btn" style={{ fontSize: 11 }} onClick={() => setAcc((x) => x.filter((_, j) => j !== i))}>移除</button>
                </div>
              ))}
            </div>
            {wps.map((p, i) => {
              const cs = cases[p.project_uuid] ?? []
              return (
                <div key={p.key} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ width: 14, height: 14, borderRadius: 4, background: PCOLORS[i] }} />产品 {p.key}
                  <select data-testid={`wiz-project-${i}`} value={p.project_uuid}
                    onChange={(e) => { const v = e.target.value; setWps((x) => x.map((y, j) => j === i ? { ...y, project_uuid: v, case_id: null } : y)); loadCases(v) }}
                    style={{ minWidth: 200, fontSize: 12 }}>
                    <option value="">选择项目(须已有 report 案例)…</option>
                    {pickable.map((r) => <option key={r.uuid} value={r.uuid}>{r.name}</option>)}
                  </select>
                  <select data-testid={`wiz-case-${i}`} value={p.case_id ?? ''} disabled={!p.project_uuid || cs.length === 0}
                    onChange={(e) => setWps((x) => x.map((y, j) => j === i ? { ...y, case_id: e.target.value ? Number(e.target.value) : null } : y))}
                    style={{ minWidth: 200, fontSize: 12 }}>
                    <option value="">选择 report 案例…</option>
                    {cs.map((c) => <option key={c.id} value={c.id}>#{c.id} · v{c.version_id} · {c.created_at.slice(0, 10)}</option>)}
                  </select>
                  {wps.length > 1 && <button className="psa-btn" style={{ padding: '2px 7px', fontSize: 11 }} onClick={() => setWps((x) => x.filter((_, j) => j !== i))}>✕</button>}
                </div>
              )
            })}
            {wrows.map((r, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                排 <input value={r.id} onChange={(e) => setWrows((x) => x.map((y, j) => j === i ? { ...y, id: e.target.value } : y))} style={{ width: 52 }} />
                产品 <select value={r.product} onChange={(e) => setWrows((x) => x.map((y, j) => j === i ? { ...y, product: e.target.value } : y))}>{wps.map((p) => <option key={p.key} value={p.key}>{p.key}</option>)}</select>
                舱数 <input data-testid={`wiz-count-${i}`} type="number" min={1} max={30} value={r.count} onChange={(e) => setWrows((x) => x.map((y, j) => j === i ? { ...y, count: Number(e.target.value) } : y))} style={{ width: 56 }} className="psa-num" />
                墙位(0 起,逗号分隔)<input value={r.walls} onChange={(e) => setWrows((x) => x.map((y, j) => j === i ? { ...y, walls: e.target.value } : y))} style={{ width: 110 }} className="psa-num" placeholder="如 3" />
                {wrows.length > 1 && <button className="psa-btn" style={{ padding: '2px 7px', fontSize: 11 }} onClick={() => setWrows((x) => x.filter((_, j) => j !== i))}>✕</button>}
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8 }}>
              {wps.length < 4 && <button className="psa-btn" onClick={() => setWps((x) => [...x, { key: String.fromCharCode(65 + x.length), project_uuid: '', case_id: null }])}>＋产品</button>}
              <button className="psa-btn" onClick={() => setWrows((x) => [...x, { id: `Z${x.length + 1}`, product: wps[0]?.key ?? 'A', count: 5, walls: '' }])}>＋排</button>
              <button data-testid="build" className="psa-btn psa-btn--primary" disabled={busy} onClick={() => void create()}>{busy ? '建模中…' : '新建站型并量化'}</button>
              {doc?.id != null && (
                <button data-testid="save-changes" className="psa-btn psa-btn--dark" disabled={busy} onClick={() => void saveChanges()}
                  title={`把上方表单保存回站型「${doc.name}」#${doc.id} 并重算`}>保存修改并重算</button>
              )}
              {doc?.id != null && q && (
                <button data-testid="pin-report" className="psa-btn" disabled={busy}
                  title="钉扎站级案例(冻结站型文档+量化结果+doc_hash,入审计)并下载 Word 报告——导出必经钉扎,可复现"
                  onClick={() => { void (async () => {
                    try {
                      const c = await pinStation(doc.id!)
                      const a = document.createElement('a')
                      a.href = stationCaseReportUrl(c.id); a.download = `station-case-${c.id}.docx`
                      document.body.appendChild(a); a.click(); a.remove()
                    } catch (e) { setErr(`钉扎/导出失败:${String((e as Error)?.message ?? e)}`) }
                  })() }}>钉扎并导出报告(Word)</button>
              )}
              {doc?.id != null && <button className="psa-btn psa-btn--danger" onClick={() => { if (window.confirm(`删除站型「${doc.name}」?`)) void deleteStation(doc.id!).then(() => { setDoc(null); setQ(null); setStations((p) => p.filter((s) => s.id !== doc.id)) }) }}>删除站型</button>}
            </div>
          </div>
        </div>

        {q && doc && (
          <>
            {q.acceptance_results?.some((a) => a.verdict === 'fail') && (
              <div data-testid="acc-fail-banner" style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 8, padding: '8px 13px', fontSize: 12.5, fontWeight: 600 }}>
                ⚠ 存在未通过的验收准则(FAIL)——见下方判定条与报告章节;本判定不构成签发结论。
              </div>
            )}
            {/* ── KPI(标签绑定铁律:≥5 舱 ↔ ge5;整排 ↔ ge_row) ── */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {([['任一舱 C3+', q.metrics.any, '', 'any'], ['多舱 ≥2 舱', q.metrics.ge2, '', 'ge2'],
                 ['≥5 舱(排内连片)', q.metrics.ge5, 'kpi-ge5', 'ge5'], ['整排蔓延(k=排长)', q.metrics.ge_row, 'kpi-gerow', 'ge_row'],
                 ['站界外后果', q.metrics.offsite, '', 'offsite']] as const).map(([l, v, tid, mk]) => (
                <div key={l} data-testid={tid || undefined} style={{ border: '1px solid var(--psa-line)', borderRadius: 8, padding: '6px 12px', background: 'var(--psa-surface)' }}>
                  <div style={{ fontSize: 10, color: 'var(--psa-faint)' }}>{l}(/站·年)</div>
                  <div className="psa-num" style={{ fontFamily: 'var(--psa-font-mono)', fontSize: 15, fontWeight: 700 }}>{fmtE(v)}</div>
                  {q.bands && (
                    <div data-testid={tid ? `${tid}-band` : undefined} style={{ fontSize: 9.5, color: 'var(--psa-faint)', fontFamily: 'var(--psa-font-mono)' }}
                      title="不确定带:同分位合成(全联动包络);p50 为 MC 中位数,与解析点值可不同">
                      {fmtE(q.bands[mk].p05)} – {fmtE(q.bands[mk].p95)}(p50 {fmtE(q.bands[mk].p50)})
                    </div>
                  )}
                </div>
              ))}
            </div>
            {(q.acceptance_results?.length ?? 0) > 0 && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {q.acceptance_results.map((a, i) => {
                  const c = a.verdict === 'pass' ? ['#f0fdf4', '#bbf7d0', '#15803d'] : a.verdict === 'fail' ? ['#fef2f2', '#fecaca', '#b91c1c'] : ['#f4f4f5', '#d4d4d8', '#52525b']
                  return (
                    <div key={i} data-testid={`acc-chip-${i}`} title={`依据:${a.basis}${a.reason ? ' · ' + a.reason : ''}`}
                      style={{ background: c[0], border: `1px solid ${c[1]}`, color: c[2], borderRadius: 8, padding: '5px 10px', fontSize: 11.5 }}>
                      <b>{a.verdict === 'pass' ? 'PASS' : a.verdict === 'fail' ? 'FAIL' : '无带不可判'}</b>
                      {' '}{a.label || METRIC_LABEL[a.metric]} · {a.eval_basis === 'point' ? '点值' : 'P95'}{' '}
                      <span className="psa-num" style={{ fontFamily: 'var(--psa-font-mono)' }}>
                        {a.value == null ? '—' : fmtE(a.value)} ≤ {fmtE(a.limit)}
                      </span>
                      {a.margin != null && <span> · 占用 {(a.margin * 100).toFixed(0)}%</span>}
                    </div>
                  )
                })}
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 330px', gap: 14 }}>
              {/* ── 画布(行=分区;墙=红条) ── */}
              <div className="psa-panel" style={{ flex: 'none' }}>
                <div className="psa-ch"><span className="t">站拓扑</span><span className="meta">点舱看产品参数与蔓延;墙=红条(衰减边,非截断)</span></div>
                <div style={{ padding: 14, overflowX: 'auto' }}>
                  {cabinByRow.map(([rowId, cabs]) => {
                    const walls = new Set(doc.rows.find((r) => r.id === rowId)?.walls ?? [])
                    const k = q.rows.find((r) => r.id === rowId)?.k
                    return (
                      <div key={rowId} style={{ marginBottom: 14 }}>
                        <div style={{ fontSize: 10, color: '#b45309', fontWeight: 700, marginBottom: 4 }}>分区 {rowId}(k={k})</div>
                        <div style={{ display: 'flex', alignItems: 'stretch', gap: 0 }}>
                          {cabs.map((c, i) => (
                            <span key={c.id} style={{ display: 'flex', alignItems: 'center' }}>
                              <div data-testid={`cab-${c.id}`} onClick={() => setSelCab(c.id)}
                                style={{ width: 92, borderRadius: 7, color: '#fff', padding: '5px 7px', cursor: 'pointer', marginRight: walls.has(i) ? 0 : 10,
                                  background: PCOLORS[prodIdx.get(c.product) ?? 0], outline: selCab === c.id ? '3px solid #f59e0b' : undefined, outlineOffset: 2 }}>
                                <div style={{ fontFamily: 'var(--psa-font-mono)', fontWeight: 700, fontSize: 10.5 }}>{c.id}</div>
                                <div style={{ fontFamily: 'var(--psa-font-mono)', fontSize: 9, opacity: .85 }}>{fmtE(c.f)}</div>
                              </div>
                              {walls.has(i) && <div title={`防火墙(边 p→${doc.edge_defaults.wall_p})`} style={{ width: 4, background: '#dc2626', borderRadius: 2, margin: '0 3px' }} />}
                            </span>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
                {/* 站级链 */}
                <div style={{ borderTop: '1px solid var(--psa-line-2)', padding: '7px 12px', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--psa-faint)' }}>站级屏障链</span>
                  {doc.station_barriers.map((b) => (
                    <span key={b.key} title={b.basis} style={{ border: '1px solid var(--psa-line)', background: 'var(--psa-soft)', borderRadius: 7, padding: '3px 9px', fontSize: 10.5, color: 'var(--psa-ink-2)' }}>
                      <span style={{ fontSize: 9, color: '#fff', background: '#64748b', borderRadius: 4, padding: '0 4px', marginRight: 4 }}>{b.scope}</span>
                      {b.label} <b className="psa-num" style={{ fontFamily: 'var(--psa-font-mono)' }}>{b.pfd}</b> {b.grade}
                    </span>
                  ))}
                  <span title="站界屏障(越界支链,不嵌套舱数链)" style={{ border: '1px solid var(--psa-line)', background: 'var(--psa-soft)', borderRadius: 7, padding: '3px 9px', fontSize: 10.5, color: 'var(--psa-ink-2)' }}>
                    <span style={{ fontSize: 9, color: '#fff', background: '#64748b', borderRadius: 4, padding: '0 4px', marginRight: 4 }}>站界</span>
                    泄爆朝向+围栏 <b className="psa-num" style={{ fontFamily: 'var(--psa-font-mono)' }}>{doc.offsite.p_fence}</b>
                  </span>
                </div>
              </div>

              {/* ── 检视器 ── */}
              <div className="psa-panel" style={{ flex: 'none' }}>
                <div className="psa-ch"><span className="t">{sel ? `舱 ${sel.id}` : '检视器'}</span></div>
                {sel ? (() => {
                  const prod = q.products.find((p) => p.key === sel.product)!
                  return (
                    <div style={{ padding: 12, fontSize: 11.5, color: 'var(--psa-ink-2)' }}>
                      <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--psa-faint)', marginBottom: 4 }}>产品参数(实例化自系统项目)</div>
                      {([['产品', `${sel.product} · ${prod.label ?? ''}`],
                         ['系统模型版本', `v${prod.case.vid} · #${prod.case.version_hash.slice(0, 8)}`],
                         ['案例', `#${prod.case.id} · ${prod.case.created_at.slice(0, 10)}`]] as const).map(([l, v]) => (
                        <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px dashed var(--psa-line-2)' }}>
                          <span>{l}</span><b className="psa-num" style={{ fontFamily: 'var(--psa-font-mono)' }}>{v}</b>
                        </div>
                      ))}
                      <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--psa-faint)', margin: '10px 0 4px' }}>舱级频率(直读钉扎案例)</div>
                      {([['C3+(起火)', sel.f], ['C4+(爆燃+)', sel.f4]] as const).map(([l, v]) => (
                        <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px dashed var(--psa-line-2)' }}>
                          <span>{l}</span><b className="psa-num" style={{ fontFamily: 'var(--psa-font-mono)' }}>{fmtE(v)}</b>
                        </div>
                      ))}
                      <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--psa-faint)', margin: '10px 0 4px' }}>作为火源(站层组合)</div>
                      {([['任一邻舱受累 esc', sel.esc], ['排内连片 ≥5(chain5)', sel.chain5], ['整排(chain_row)', sel.chain_row]] as const).map(([l, v]) => (
                        <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px dashed var(--psa-line-2)' }}>
                          <span>{l}</span><b className="psa-num" style={{ fontFamily: 'var(--psa-font-mono)' }}>{fmtE(v)}</b>
                        </div>
                      ))}
                    </div>
                  )
                })() : <div style={{ padding: 12, fontSize: 11.5, color: 'var(--psa-faint)' }}>点画布上的舱查看产品参数、舱级频率与蔓延贡献。</div>}
              </div>
            </div>

            {/* ── 产品配置表 ── */}
            <div className="psa-panel" style={{ flex: 'none' }}>
              <div className="psa-ch"><span className="t">产品配置</span><span className="meta">舱 = 版本快照实例;上游出新版此处标注而不自动漂移(v1 提示)</span></div>
              <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%' }}><thead><tr>
                <th style={th}>产品</th><th style={th}>舱数</th><th style={th}>舱级 C3+</th><th style={th}>舱级 C4+</th><th style={th}>系统模型版本</th><th style={th}>CCF 组(申报,v1 不入值)</th>
              </tr></thead><tbody>
                {q.products.map((p, i) => {
                  const n = q.per_cabin.filter((c) => c.product === p.key).length
                  const g = doc.ccf_groups.find((x) => x.member_products.includes(p.key))
                  return (
                    <tr key={p.key}>
                      <td style={td}><span style={{ color: PCOLORS[i], fontWeight: 700 }}>{p.key} · {p.label}</span></td>
                      <td style={td} className="psa-num">{n}</td>
                      <td style={td} className="psa-num">{fmtE(p.f)}</td>
                      <td style={td} className="psa-num">{fmtE(p.f4)}</td>
                      <td style={td} className="psa-num">v{p.case.vid} · #{p.case.version_hash.slice(0, 8)}</td>
                      <td style={td}>{g ? `${g.label} · β=${g.beta}` : '—'}</td>
                    </tr>
                  )
                })}
              </tbody></table>
              </div>
            </div>

            {/* ── 口径申报(必须渲染) ── */}
            <div data-testid="simplifications" style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', borderRadius: 8, padding: '9px 13px', fontSize: 11.5, lineHeight: 1.7 }}>
              <b>口径申报(随结果发布,不可隐藏)</b>
              {q.declared.simplifications.map((s, i) => <div key={i}>· {s}</div>)}
              {q.band_notes?.map((s, i) => <div key={`b${i}`}>◦ {s}</div>)}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
