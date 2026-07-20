import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { StatusError, getPortfolio } from '../../api'
import type { PortfolioRow, ReviewState } from '../../api'
import type { ProjectPersistence } from '../persistence/useProjectPersistence'
import type { MainTab } from '../../stores/viewStore'
import { useAuthStore } from '../../stores/authStore'
import { bgLevel, cGE3, worseCell, SEV_RANK } from './portfolioMath'
import { fmtE } from './portfolioFmt'

/**
 * 多项目组合总览(R5,规格 2026-07-13-explorer-redesign §4)。
 * 证据链正确性:所有风险数字**取自已钉扎案例**(GET /api/portfolio,后端绝不现算)——
 * 无案例项目显示「未量化」。矩阵频带/评级与报告矩阵**同源**(后端 risk_placement),
 * 前端只在矩阵背景(可接受准则热区)复用同一 4/9/14 阈值,项目落格与最劣格全部后端给定。
 */

// —— 与 report_export 同源的常量(后果标签/频带/风险色)——
const SEV = ['C1', 'C2', 'C3', 'C4', 'C5'] as const
const SEV_LABEL: Record<string, string> = { C1: '单体排气', C2: '模组蔓延', C3: '簇/舱火灾', C4: '多舱火灾', C5: '爆燃/爆炸' }
const BAND_LABEL = ['极不可能', '不可能', '偶尔', '可能', '频繁'] // F1..F5
const RISK_HEX: Record<string, string> = { low: '#16a34a', medium: '#eab308', high: '#f97316', extreme: '#dc2626' }
const LEVEL_ZH: Record<string, string> = { low: '低', medium: '中', high: '高', extreme: '极高' }
const MARKERS = ['●', '▲', '■', '◆', '★', '⬢', '▼', '✦']

const hash8 = (h: string | null | undefined) => (h ? h.slice(0, 8) : '—')

const STATE_STYLE: Record<ReviewState, { bg: string; fg: string; zh: string }> = {
  in_review: { bg: 'var(--psa-warn-soft, #fff7ed)', fg: 'var(--psa-warn-strong, #b45309)', zh: '送审中' },
  signed: { bg: 'var(--psa-ok-soft, #f0fdf4)', fg: 'var(--psa-ok-strong, #15803d)', zh: '已签发' },
  returned: { bg: 'var(--psa-danger-soft)', fg: 'var(--psa-danger-strong)', zh: '已退回' },
}

export function PortfolioTab({ persistence, setTab }: { persistence: ProjectPersistence; setTab: (t: MainTab) => void }) {
  const [rows, setRows] = useState<PortfolioRow[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getPortfolio().then((r) => { setRows(r); setLoading(false) })
      .catch((e) => {
        // P4-C ⑧:401 与全 app 同口径进重认证,而非裸「→ 401」死胡同
        if (e instanceof StatusError && e.status === 401) useAuthStore.setState({ identity: null, needsLogin: true })
        setErr(String(e?.message ?? e)); setLoading(false)
      })
  }, [])

  // 稳定的项目→标记符映射(按 uuid 排序,避免每渲染漂移)
  const markerOf = useMemo(() => {
    const m: Record<string, string> = {}
    rows.map((r) => r.uuid).sort().forEach((u, i) => { m[u] = MARKERS[i % MARKERS.length] })
    return m
  }, [rows])

  const quantified = rows.filter((r) => r.latest_case)
  // 队列按 open_review 过滤(域评审裁决 2):在审行可能钉在旧版本上(送审后又存新版),
  // 若按最新版本锚定的 review_state 过滤,挂起评审会从队列消失("看不见还能签")。
  const queue = rows.filter((r) => r.open_review)

  // 对比条形:C≥3 累计,对数感知宽度(跨越多个数量级时线性会压扁小值)
  const [minLog, maxLog] = useMemo(() => {
    const lgs = quantified.map((r) => cGE3(r.latest_case!.consequences)).filter((v) => v > 0).map((v) => Math.log10(v))
    return lgs.length ? [Math.min(...lgs), Math.max(...lgs)] : [0, 0]
  }, [quantified])
  const barPct = (v: number): number => {
    if (v <= 0) return 0
    if (maxLog === minLog) return 100
    const lg = Math.log10(v)
    return 12 + 88 * ((lg - minLog) / (maxLog - minLog)) // 12% 地板保证最小值可见
  }

  // 组合最劣格:各项目 risk.worst 归约取更劣(worseCell:评级优先,平手取更高后果级)
  const worstOverall = useMemo(() => {
    let w: { severity: string; level: 'low' | 'medium' | 'high' | 'extreme'; row: PortfolioRow } | null = null
    for (const r of quantified) {
      const cw = r.latest_case?.risk?.worst   // P4-C ⑩:旧/部分案例可缺 risk,不抛
      if (cw) w = worseCell(w, { severity: cw.severity, level: cw.level, row: r })
    }
    return w
  }, [quantified])

  const openProject = async (savedId: string | null, tab: MainTab) => {
    if (!savedId) return
    await persistence.loadProject(savedId)   // R2:已打开 → 聚焦,否则载入
    setTab(tab)
  }

  return (
    <div style={wrap}>
      <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--exp-ink)' }}>多项目组合总览</div>
      <div style={sub}>
        {rows.length} 个项目 · {quantified.length} 个已量化 · 数字取自已钉扎分析案例(案例# · 版本哈希),绝不现算。
      </div>

      {err && <div style={errBox}>{err}</div>}
      {loading && <div style={{ color: 'var(--exp-muted)', fontSize: 12 }}>载入中…</div>}
      {!loading && rows.length === 0 && !err && (
        <div className="psa-panel" style={{ padding: 16, color: 'var(--exp-muted)', fontSize: 12.5 }}>
          暂无已保存项目。保存或导出报告后,项目在此按风险画像并排。
        </div>
      )}

      {!loading && rows.length > 0 && (
        <>
          {/* —— 风险画像表 —— */}
          <div className="psa-panel" style={{ overflow: 'hidden' }}>
            <div style={panelHead}>项目库 — 风险画像</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={tableSt}>
                <thead>
                  <tr>
                    {/* 列名直接用公式(域评审裁决 1b):与单项目页"≥III 累计"(C4+C5,危险等级
                        口径)是不同口径,近同形缩写会诱发跨页口径混淆,故不用"C≥3"缩写。 */}
                    {['项目', '版本', 'C3+C4+C5 /yr', 'C5 /yr', '最劣格', '评审(当前版本)', '版本哈希', '案例来源'].map((h) => (
                      <th key={h} style={th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const c = r.latest_case
                    // spec A §2.4:checked_set 案例 → 口径写「聚合 n 树」;单场景/旧案例照旧场景名。
                    const isAgg = c?.scope === 'checked_set'
                    const srcScope = c ? (isAgg ? ` · 聚合 ${c.tree_count ?? '?'} 树` : (c.scenario ? ` · 场景 ${c.scenario}` : '')) : ''
                    const src = c ? `案例 #${c.id} · ${c.kind}${srcScope} · 版本 ${hash8(c.version_hash)} · ${c.created_at.slice(0, 10)}` : ''
                    const worst = c?.risk.worst
                    // 域评审裁决 3:数字来自比当前最新版本更旧的案例 → 显式徽章,不靠肉眼比对哈希
                    const stale = !!(c && r.latest_hash && c.version_hash !== r.latest_hash)
                    return (
                      <tr key={r.uuid}>
                        <td style={td}>
                          <button style={linkBtn} disabled={!r.saved_id} title={r.saved_id ? '打开该项目' : '无本地存档,请从左侧存档树打开'}
                            onClick={() => openProject(r.saved_id, 'home')}>
                            <span style={{ marginRight: 6, color: 'var(--exp-faint)' }}>{markerOf[r.uuid]}</span><b>{r.name}</b>
                          </button>
                        </td>
                        <td style={{ ...td, ...mono }}>{r.versions}</td>
                        <td style={{ ...td, ...mono }} title={c ? `C3+C4+C5 端态频率之和(后果类别口径,非 0–IV 危险等级)· ${src}` : '未量化'}>
                          {c ? fmtE(cGE3(c.consequences)) : <span style={unq}>未量化</span>}
                        </td>
                        <td style={{ ...td, ...mono }} title={c ? `爆燃/爆炸端态频率 · ${src}` : '未量化'}>
                          {c ? fmtE(c.consequences.C5) : <span style={unq}>未量化</span>}
                        </td>
                        <td style={td}>
                          {worst ? (
                            <span style={{ ...pill, background: RISK_HEX[worst.level], color: '#fff' }}
                              title={`最劣格:${worst.severity}(${SEV_LABEL[worst.severity]})× ${BAND_LABEL[worst.freq_band]} → ${LEVEL_ZH[worst.level]}`}>
                              {worst.severity} · {LEVEL_ZH[worst.level]}
                            </span>
                          ) : <span style={unq}>—</span>}
                        </td>
                        <td style={td}>
                          {r.review_state
                            ? <span style={{ ...pill, background: STATE_STYLE[r.review_state].bg, color: STATE_STYLE[r.review_state].fg }}>{STATE_STYLE[r.review_state].zh}</span>
                            : <span style={{ ...pill, background: 'var(--exp-soft)', color: 'var(--exp-faint)' }}>草稿</span>}
                        </td>
                        <td style={{ ...td, ...mono, color: 'var(--exp-faint)' }}>{hash8(r.latest_hash)}</td>
                        <td style={{ ...td, ...mono, color: 'var(--exp-faint)', fontSize: 11 }}>
                          {c ? `#${c.id}` : '—'}
                          {c && isAgg && (
                            // 聚合徽章替代场景名(§2.4)——聚合行与单场景行落格天然不同,比较以徽章为准
                            <span style={{ ...pill, marginLeft: 6, background: 'var(--psa-primary-soft, #eff6ff)', color: 'var(--psa-primary-strong, #1d4ed8)' }}
                              title={`勾选集聚合案例:${c.tree_count ?? '?'} 棵勾选事件树的后果频率逐级求和(点估计精确);分位带为同名参数联合抽样`}>
                              聚合 {c.tree_count ?? '?'} 树
                            </span>
                          )}
                          {c && !isAgg && c.scenario ? ` · ${c.scenario}` : ''}
                          {c ? ` · ${hash8(c.version_hash)}` : ''}
                          {stale && (
                            <span style={{ ...pill, marginLeft: 6, background: 'var(--psa-warn-soft, #fff7ed)', color: 'var(--psa-warn-strong, #b45309)' }}
                              title={`风险数字取自版本 ${hash8(c!.version_hash)},当前最新版本为 ${hash8(r.latest_hash)} —— 数字非当前模型,重新导出报告/运行不确定性可更新`}>
                              数字非当前版本
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {/* 口径脚注(域评审 1b + F2 + F3):可见文字,不藏 tooltip——截图/投影不丢失 */}
            <div style={{ padding: '6px 12px', fontSize: 11, color: 'var(--exp-muted)', borderTop: '1px solid var(--exp-line)' }}>
              口径:C 列为后果<b>类别</b>频率(C1 单体排气 … C5 爆燃/爆炸),非 0–IV 危险等级口径,本页不使用等级口径;
              每行数字取自该项目最近一次钉扎案例,覆盖范围为该案例对应的事件树(场景)或勾选集聚合(徽章「聚合 n 树」),非必然为项目全部 ETA 之和;
              <b>各行案例口径可能不同(单场景/聚合),比较以徽章为准</b>;
              跨项目比较假设各项目 C1–C5 内涵一致(内置口径)。
            </div>
          </div>

          {/* —— C≥3 累计对比条形 + 组合矩阵(并排)—— */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div className="psa-panel" style={{ flex: '1 1 340px', minWidth: 300, overflow: 'hidden' }}
              title="条长按 log10 归一(最短 12% 保可见),视觉差距被压缩——以旁标数值为准">
              <div style={panelHead}>C3+C4+C5 频率对比 <span style={{ color: 'var(--exp-faint)', fontWeight: 400 }}>(对数刻度;条长≠线性比例,以数值为准)</span></div>
              <div style={{ padding: '8px 12px 12px' }}>
                {quantified.length === 0 && <div style={{ color: 'var(--exp-muted)', fontSize: 12 }}>无已量化项目。</div>}
                {quantified.map((r) => {
                  const v = cGE3(r.latest_case!.consequences)
                  return (
                    <div key={r.uuid} style={{ marginBottom: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, marginBottom: 3 }}>
                        <span style={{ color: 'var(--exp-ink2, #334155)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{markerOf[r.uuid]} {r.name}</span>
                        <span style={{ ...mono, color: 'var(--exp-muted)', flexShrink: 0, marginLeft: 8 }}>{fmtE(v)}</span>
                      </div>
                      <div style={barTrack}><div style={{ ...barFill, width: `${barPct(v)}%` }} /></div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="psa-panel" style={{ flex: '1 1 320px', minWidth: 300, overflow: 'hidden' }}>
              <div style={panelHead}>组合风险矩阵 <span style={{ color: 'var(--exp-faint)', fontWeight: 400 }}>(后果 × 频率;标记 = 项目落格)</span></div>
              <div style={{ padding: 12, overflowX: 'auto' }}>
                <RiskMatrix quantified={quantified} markerOf={markerOf} />
                <div style={{ marginTop: 8, fontSize: 11.5 }}>
                  {worstOverall ? (() => {
                    // 同级同后果的并列项目数(域评审裁决 4:"—— 某项目"暗示唯一性,并列须注明)
                    const ties = quantified.filter((r) => {
                      const w = r.latest_case!.risk.worst
                      return w && w.level === worstOverall.level && w.severity === worstOverall.severity
                    }).length
                    return <>组合最劣格:<b style={{ color: RISK_HEX[worstOverall.level] }}>{LEVEL_ZH[worstOverall.level]}区</b> —— {worstOverall.row.name}{ties > 1 ? ` 等 ${ties} 项` : ''} · {worstOverall.severity}({SEV_LABEL[worstOverall.severity]})</>
                  })() : <span style={{ color: 'var(--exp-muted)' }}>无已量化项目落格。</span>}
                </div>
              </div>
            </div>
          </div>

          {/* —— 评审队列 —— */}
          <div className="psa-panel" style={{ overflow: 'hidden' }}>
            <div style={panelHead}>评审队列 <span style={{ color: 'var(--exp-faint)', fontWeight: 400 }}>(送审中项目 —— 跨项目待办的唯一入口)</span></div>
            <div style={{ padding: '4px 0' }}>
              {queue.length === 0 && <div style={{ padding: '8px 12px', color: 'var(--exp-muted)', fontSize: 12 }}>无送审中项目。</div>}
              {queue.map((r) => (
                <div key={r.uuid} style={queueRow}>
                  <span style={{ ...pill, background: STATE_STYLE.in_review.bg, color: STATE_STYLE.in_review.fg }}>送审中</span>
                  <b style={{ color: 'var(--exp-ink)' }}>{r.name}</b>
                  {/* 在审的是 open_review 指向的版本(可能非最新)——哈希显示被审版本 */}
                  <span style={{ ...mono, color: 'var(--exp-faint)', fontSize: 11 }} title="送审版本哈希">{hash8(r.open_review!.version_hash)}</span>
                  {!r.open_review!.is_latest && (
                    <span style={{ ...pill, background: 'var(--psa-warn-soft, #fff7ed)', color: 'var(--psa-warn-strong, #b45309)' }}
                      title={`送审的版本 ${hash8(r.open_review!.version_hash)} 之后已保存更新版本(当前 ${hash8(r.latest_hash)})——签发前请确认审的是哪一版`}>
                      已有更新版本
                    </span>
                  )}
                  <button style={{ ...linkBtn, marginLeft: 'auto', color: 'var(--exp-accent, #0f766e)' }}
                    disabled={!r.saved_id} title={r.saved_id ? '打开该项目的报告与证据链页' : '无本地存档,请从左侧存档树打开'}
                    onClick={() => openProject(r.saved_id, 'report')}>
                    前往报告页 →
                  </button>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/** 5(频带 F5..F1 上→下)× 5(后果 C1..C5 左→右)矩阵。落格标记来自后端 risk.cells。 */
function RiskMatrix({ quantified, markerOf }: { quantified: PortfolioRow[]; markerOf: Record<string, string> }) {
  // 落格标记:cell[band][severity] = [{marker, level}]。level 取后端给定(载荷),非前端计算。
  const placed: Record<string, { marker: string; level: string }[]> = {}
  for (const r of quantified) {
    for (const cell of r.latest_case?.risk?.cells ?? []) {
      const key = `${cell.freq_band}:${cell.severity}`
      ;(placed[key] ??= []).push({ marker: markerOf[r.uuid], level: cell.level })
    }
  }
  const rowsBand = [4, 3, 2, 1, 0] // F5 顶 → F1 底
  return (
    <table style={{ borderCollapse: 'collapse', fontSize: 11 }}>
      <thead>
        <tr>
          <th style={mCorner}>频率＼后果</th>
          {SEV.map((c) => <th key={c} style={mHead} title={SEV_LABEL[c]}>{c}</th>)}
        </tr>
      </thead>
      <tbody>
        {rowsBand.map((band) => (
          <tr key={band}>
            <th style={mRowHead}>{BAND_LABEL[band]}</th>
            {SEV.map((c) => {
              const key = `${band}:${c}`
              const here = placed[key]
              // 占用格颜色用**后端给定**的 cell.level(域评审裁决 5:阈值漂移时落格颜色
              // 必须跟载荷走);空格背景才是前端 bgLevel 的装饰性热区(半透明)。
              const bg = here ? RISK_HEX[here[0].level] + 'ff'
                : RISK_HEX[bgLevel(SEV_RANK[c], band + 1)] + '2e'
              return (
                <td key={c} style={{ ...mCell, background: bg }}
                  title={`${c}(${SEV_LABEL[c]})× ${BAND_LABEL[band]}`}>
                  {here && here.map((p, i) => <span key={i} style={{ color: '#fff', fontSize: 12, marginRight: 1 }}>{p.marker}</span>)}
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

const wrap: CSSProperties = { flex: 1, minHeight: 0, overflow: 'auto', background: 'var(--exp-bg)', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }
const sub: CSSProperties = { fontSize: 11.5, color: 'var(--exp-muted)', marginTop: -6 }
const errBox: CSSProperties = { padding: 8, background: 'var(--psa-danger-soft)', color: 'var(--psa-danger-strong)', borderRadius: 6, fontSize: 12 }
const panelHead: CSSProperties = { padding: '8px 12px', fontSize: 12.5, fontWeight: 600, color: 'var(--exp-ink2, #334155)', borderBottom: '1px solid var(--exp-line)', background: 'var(--exp-soft)' }
const tableSt: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 12.5, whiteSpace: 'nowrap' }
const th: CSSProperties = { padding: '7px 10px', fontSize: 11, color: 'var(--exp-muted)', fontWeight: 600, textAlign: 'left', borderBottom: '1px solid var(--exp-line)', background: 'var(--exp-soft)' }
const td: CSSProperties = { padding: '6px 10px', borderTop: '1px solid var(--exp-line)' }
const mono: CSSProperties = { fontFamily: 'var(--psa-font-mono)', fontVariantNumeric: 'tabular-nums' }
const unq: CSSProperties = { color: 'var(--exp-faint)', fontStyle: 'italic', fontSize: 11.5 }
const pill: CSSProperties = { display: 'inline-block', fontSize: 10.5, fontWeight: 700, borderRadius: 5, padding: '1px 7px', whiteSpace: 'nowrap' }
const linkBtn: CSSProperties = { border: 0, background: 'none', padding: 0, cursor: 'pointer', color: 'var(--exp-ink)', font: 'inherit', textAlign: 'left' }
const barTrack: CSSProperties = { height: 8, background: 'var(--exp-soft)', borderRadius: 4, overflow: 'hidden' }
const barFill: CSSProperties = { height: '100%', background: 'var(--exp-accent, #0f766e)', borderRadius: 4 }
const queueRow: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderTop: '1px solid var(--exp-line)' }
const mCorner: CSSProperties = { padding: '3px 6px', fontSize: 9.5, color: 'var(--exp-faint)', fontWeight: 600, textAlign: 'right', whiteSpace: 'nowrap' }
const mHead: CSSProperties = { padding: '3px 6px', fontSize: 10.5, color: 'var(--exp-muted)', fontWeight: 700, textAlign: 'center' }
const mRowHead: CSSProperties = { padding: '3px 6px', fontSize: 9.5, color: 'var(--exp-muted)', fontWeight: 600, textAlign: 'right', whiteSpace: 'nowrap' }
const mCell: CSSProperties = { width: 34, height: 26, textAlign: 'center', border: '1px solid rgba(255,255,255,.6)', verticalAlign: 'middle' }
