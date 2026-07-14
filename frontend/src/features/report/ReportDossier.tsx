import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { addVersionComment, diffProjectVersions, exportReport, listProjectCases, listProjectReviews, listProjectVersions, listVersionComments, returnReview, signReview, submitReview } from '../../api'
import type { CaseInfo, ReviewComment, ReviewInfo, VersionDiff, VersionInfo } from '../../api'
import { Icon } from '../../components/icons'
import { CONSEQUENCES, consDef, toEngineRequest } from '../../eventtree'
import { useActiveEta } from '../../stores/useActiveEta'
import { useAuthStore } from '../../stores/authStore'
import type { ProjectPersistence } from '../persistence/useProjectPersistence'

const mono = 'var(--psa-font-mono)'

/**
 * 证据文档页(外壳决策记录 D → 报告页演进):报告导出 + 版本/案例台账,
 * 每条案例挂版本短哈希与引擎版本徽章 —— 报告页脚「评价依据」在此可回查(ADR-2)。
 */
export function ReportDossier({ persistence }: { persistence: ProjectPersistence }) {
  const { etModel, etFtsModel } = useActiveEta()
  const [versions, setVersions] = useState<VersionInfo[]>([])
  const [cases, setCases] = useState<CaseInfo[]>([])
  const [reviews, setReviews] = useState<ReviewInfo[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const pu = persistence.projectUuid
  // 前端呈现层的角色感知(后端 B3 已实际守卫,这里只是不呈现无权限操作)。
  // identity===null(off 模式/未知)一律视为全权 —— off 模式单用户即全权(约束 #0)。
  const role = useAuthStore((s) => s.identity?.role ?? null)
  const canSubmitReview = role === null || role === 'analyst' || role === 'admin'
  const canDecideReview = role === null || role === 'reviewer' || role === 'admin'

  const refresh = () => {
    if (!pu) { setVersions([]); setCases([]); setReviews([]); return }
    listProjectVersions(pu).then(setVersions).catch(() => setVersions([]))
    listProjectCases(pu).then(setCases).catch(() => setCases([]))
    listProjectReviews(pu).then(setReviews).catch(() => setReviews([]))
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(refresh, [pu])

  const onExport = async (fmt: 'docx' | 'pdf' | 'csv') => {
    if (!etModel) return
    setBusy(true); setErr(null)
    try {
      const linked = { fault_trees: etFtsModel.fault_trees ?? [], parameters: etFtsModel.model_data.parameters ?? [] }
      const req = toEngineRequest(etModel, linked)
      await exportReport(fmt, {
        ...req, samples: 1000,
        consequence_defs: Object.fromEntries(CONSEQUENCES.map((c) => [c, consDef(etModel, c)])),
        labels: Object.fromEntries(etModel.functionalEvents.map((f) => [f.id, f.label])),
        ...(pu ? { project_uuid: pu, project_payload: persistence.buildPayload() } : {}),
      }, etModel.initEvent)
      refresh()                                              // auto-pin 产生了新版本/案例 → 台账即时更新
    } catch (e: any) { setErr(String(e?.message ?? e)) }
    finally { setBusy(false) }
  }

  const versionByCase = (c: CaseInfo) => versions.find((v) => v.id === c.version_id)
  const reviewByVersion = (vid: number) => reviews.find((r) => r.version_id === vid)

  // ── Phase 5 台账签发(D-P5-5 方向 A):送审/签发/退回 + 版本评论 ──
  const [signTarget, setSignTarget] = useState<VersionInfo | null>(null)
  const [signNote, setSignNote] = useState('')
  const [signPassword, setSignPassword] = useState('')
  const [actBusy, setActBusy] = useState(false)
  const isLocalAuth = useAuthStore((s) => s.identity?.mode === 'local')
  const doAction = async (fn: () => Promise<unknown>) => {
    setActBusy(true); setErr(null)
    try { await fn(); refresh() } catch (e: any) { setErr(String(e?.message ?? e)) }
    finally { setActBusy(false) }
  }
  const onSubmitReview = (v: VersionInfo) => { if (pu) doAction(() => submitReview(pu, v.id)) }
  const onReturnReview = (v: VersionInfo) => {
    if (!pu) return
    const note = window.prompt('退回理由(必填,入只增审计):')
    if (note && note.trim()) doAction(() => returnReview(pu, v.id, note.trim()))
  }
  const onConfirmSign = () => {
    if (!pu || !signTarget) return
    const t = signTarget
    const pw = signPassword
    setSignTarget(null)
    doAction(() => signReview(pu, t.id, signNote.trim() || undefined, pw || undefined))
    setSignNote(''); setSignPassword('')
  }
  const artifacts = (c: CaseInfo): { format?: string; sha256?: string } => {
    try { return typeof c.artifacts_json === 'string' ? JSON.parse(c.artifacts_json) : (c.artifacts_json ?? {}) } catch { return {} }
  }

  // ── 4a5 版本对比(parity #5)──
  const byIdDesc = [...versions].sort((a, b) => b.id - a.id)
  const [fromV, setFromV] = useState<number | ''>('')
  const [toV, setToV] = useState<number | ''>('')
  const [diff, setDiff] = useState<VersionDiff | null>(null)
  const [diffBusy, setDiffBusy] = useState(false)
  useEffect(() => {
    // 默认对比:最近两个版本
    if (byIdDesc.length >= 2) { setToV(byIdDesc[0].id); setFromV(byIdDesc[1].id) }
    else { setToV(''); setFromV('') }
    setDiff(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versions.length, pu])
  const onDiff = async () => {
    if (!pu || fromV === '' || toV === '') return
    setDiffBusy(true); setErr(null)
    try { setDiff(await diffProjectVersions(pu, Number(fromV), Number(toV))) }
    catch (e: any) { setErr(String(e?.message ?? e)) }
    finally { setDiffBusy(false) }
  }
  const fmtVal = (v: unknown) => {
    const s = typeof v === 'string' ? v : JSON.stringify(v)
    return s !== undefined && s.length > 60 ? s.slice(0, 60) + '…' : s
  }

  // ── 版本评论(版本级;元素锚定线程为方向 B 的将来扩展)──
  const [cmVersion, setCmVersion] = useState<number | ''>('')
  const [cmList, setCmList] = useState<ReviewComment[]>([])
  const [cmText, setCmText] = useState('')
  useEffect(() => {
    // 默认选中送审中的版本(评审注意力所在),否则最新版本
    const inRev = reviews.find((r) => r.state === 'in_review')
    setCmVersion(inRev?.version_id ?? byIdDesc[0]?.id ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviews, versions.length, pu])
  useEffect(() => {
    if (!pu || cmVersion === '') { setCmList([]); return }
    listVersionComments(pu, Number(cmVersion)).then(setCmList).catch(() => setCmList([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pu, cmVersion])
  const onAddComment = async () => {
    if (!pu || cmVersion === '' || !cmText.trim()) return
    setErr(null)
    try {
      await addVersionComment(pu, Number(cmVersion), cmText.trim())
      setCmText('')
      setCmList(await listVersionComments(pu, Number(cmVersion)))
    } catch (e: any) { setErr(String(e?.message ?? e)) }
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: 'var(--exp-bg)', padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--psa-ink)' }}>报告与证据链</div>
          <div style={{ fontSize: 11.5, color: 'var(--psa-faint)' }}>
            {pu
              ? <>项目 <span style={{ fontFamily: mono }}>{pu.slice(0, 8)}</span> · 导出即钉扎:报告页脚「评价依据」= 案例 # + 版本哈希 + 引擎版本</>
              : '未关联版本库:先「保存项目」,之后导出的每份报告都会钉扎为可回溯的分析案例'}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--psa-muted)' }}>导出当前 ETA 报告</span>
          {(['docx', 'pdf', 'csv'] as const).map((f) => (
            <button key={f} onClick={() => onExport(f)} disabled={busy || !etModel} className="psa-btn psa-btn--dark">
              <Icon name="download" size={13} />{f === 'docx' ? 'Word' : f.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      {err && <div style={{ marginBottom: 12, padding: 10, background: 'var(--psa-danger-soft)', color: 'var(--psa-danger-strong)', borderRadius: 6, fontSize: 12 }}>操作失败:{err}</div>}

      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* 分析案例台账 */}
        <div style={{ flex: '3 1 460px', minWidth: 340 }}>
          <div style={secHead}>分析案例({cases.length})</div>
          <div className="psa-panel" style={{ overflow: 'hidden' }}>
            {cases.length === 0 ? (
              <div style={{ padding: 16, fontSize: 12, color: 'var(--psa-muted)' }}>暂无分析案例。带项目上下文导出报告后,案例在此出现并可与报告页脚互查。</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'var(--psa-soft-2)', textAlign: 'left' }}>
                    {['案例', '类型', '模型版本', '正式性', '引擎', '产物', '时间'].map((h) => <th key={h} style={th}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {[...cases].sort((a, b) => b.id - a.id).map((c) => {
                    const v = versionByCase(c)
                    const a = artifacts(c)
                    return (
                      <tr key={c.id} style={{ borderTop: '1px solid var(--psa-line)' }}>
                        <td style={td}><span style={{ fontFamily: mono, fontWeight: 600 }}>#{c.id}</span></td>
                        <td style={td}>{c.kind === 'report' ? '报告' : c.kind}</td>
                        <td style={td}>
                          <span style={badge} title={v ? `完整哈希 ${v.content_hash}` : ''}>{v ? v.content_hash.slice(0, 8) : `v${c.version_id}`}</span>
                        </td>
                        <td style={td}>
                          {reviewByVersion(c.version_id)?.state === 'signed'
                            ? <span style={{ ...stBadge('signed') }}>正式(签发版)</span>
                            : <span style={{ fontSize: 10.5, color: 'var(--psa-faint)' }}>工作稿</span>}
                        </td>
                        <td style={td}><span style={{ fontFamily: mono, fontSize: 11 }}>{c.engine_version}</span></td>
                        <td style={td}>{a.format ? <span title={a.sha256 ? `sha256 ${a.sha256.slice(0, 16)}…` : ''} style={{ fontFamily: mono }}>{a.format}</span> : '—'}</td>
                        <td style={{ ...td, fontFamily: mono, fontSize: 11, color: 'var(--psa-faint)' }}>{c.created_at.slice(0, 19).replace('T', ' ')}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* 版本台账 */}
        <div style={{ flex: '2 1 320px', minWidth: 280 }}>
          <div style={secHead}>模型版本({versions.length})</div>
          <div className="psa-panel" style={{ overflow: 'hidden' }}>
            {versions.length === 0 ? (
              <div style={{ padding: 16, fontSize: 12, color: 'var(--psa-muted)' }}>暂无版本。保存项目即产生内容寻址版本(同内容幂等)。</div>
            ) : (
              [...versions].sort((a, b) => b.id - a.id).map((v, idx) => {
                const rv = reviewByVersion(v.id)
                const isLatest = idx === 0
                const canSubmit = isLatest && (!rv || rv.state === 'returned') && canSubmitReview
                return (
                  <div key={v.id} style={{ padding: '7px 10px', borderBottom: '1px solid var(--psa-line)', fontSize: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={badge} title={v.content_hash}>{v.content_hash.slice(0, 8)}</span>
                      <span style={{ color: 'var(--psa-ink-2)' }}>{v.origin === 'auto_pin' ? '报告钉扎' : v.origin === 'import' ? '导入' : '保存'}</span>
                      {rv && (
                        <span
                          style={stBadge(rv.state)}
                          title={rv.state === 'signed' ? `签发 ${rv.decided_by ?? ''} ${rv.decided_at ?? ''}${rv.note ? ` · ${rv.note}` : ''}`
                            : rv.state === 'returned' ? `退回理由:${rv.note ?? ''}`
                            : `送审 ${rv.submitted_by} ${rv.submitted_at}`}
                        >
                          {rv.state === 'in_review' ? '送审中'
                            : rv.state === 'signed' ? `已签发 · ${(rv.decided_by ?? '').split('@')[0]}`
                            : '退回'}
                        </span>
                      )}
                      <span style={{ marginLeft: 'auto', fontFamily: mono, fontSize: 10.5, color: 'var(--psa-faint)' }}>{v.created_at.slice(0, 19).replace('T', ' ')}</span>
                    </div>
                    {(canSubmit || (rv?.state === 'in_review' && canDecideReview)) && (
                      <div style={{ display: 'flex', gap: 6, marginTop: 5 }}>
                        {canSubmit && (
                          <button className="psa-btn" disabled={actBusy} onClick={() => onSubmitReview(v)}>送审</button>
                        )}
                        {rv?.state === 'in_review' && canDecideReview && (
                          <>
                            <button className="psa-btn psa-btn--primary" disabled={actBusy} onClick={() => { setSignTarget(v); setSignNote('') }}>签发…</button>
                            <button className="psa-btn" disabled={actBusy} onClick={() => onReturnReview(v)}>退回…</button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>

          {/* 4a5 版本对比(仿 RiskSpectrum Model Compare) */}
          <div style={{ ...secHead, marginTop: 16 }}>版本对比</div>
          <div className="psa-panel" style={{ padding: 10 }}>
            {byIdDesc.length < 2 ? (
              <div style={{ fontSize: 12, color: 'var(--psa-muted)' }}>需要至少两个版本。</div>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                  <select value={fromV} onChange={(e) => setFromV(Number(e.target.value))} style={{ fontSize: 12 }}>
                    {byIdDesc.map((v) => <option key={v.id} value={v.id}>{v.content_hash.slice(0, 8)} · v{v.id}</option>)}
                  </select>
                  <span style={{ color: 'var(--psa-faint)', fontSize: 12 }}>→</span>
                  <select value={toV} onChange={(e) => setToV(Number(e.target.value))} style={{ fontSize: 12 }}>
                    {byIdDesc.map((v) => <option key={v.id} value={v.id}>{v.content_hash.slice(0, 8)} · v{v.id}</option>)}
                  </select>
                  <button className="psa-btn psa-btn--primary" onClick={onDiff} disabled={diffBusy || fromV === '' || toV === ''}>
                    {diffBusy ? '对比中…' : '对比'}
                  </button>
                  {diff && (
                    <span style={{ fontSize: 11.5, color: 'var(--psa-muted)' }}>
                      +{diff.summary.added} · −{diff.summary.removed} · ~{diff.summary.changed}
                    </span>
                  )}
                </div>
                {diff && (diff.changes.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--psa-muted)' }}>两版本内容一致。</div>
                ) : (
                  <div style={{ maxHeight: 280, overflowY: 'auto', fontSize: 11.5 }}>
                    {diff.changes.slice(0, 200).map((c, i) => (
                      <div key={i} style={{ display: 'flex', gap: 8, padding: '4px 6px', borderBottom: '1px solid var(--psa-line)', alignItems: 'baseline' }}>
                        <span style={{ ...badge, background: c.op === 'added' ? 'rgba(22,163,74,.12)' : c.op === 'removed' ? 'var(--psa-danger-soft)' : 'var(--psa-primary-soft)', color: c.op === 'added' ? 'var(--psa-ok)' : c.op === 'removed' ? 'var(--psa-danger-strong)' : 'var(--psa-primary-strong)', flexShrink: 0 }}>
                          {c.op === 'added' ? '增' : c.op === 'removed' ? '删' : '改'}
                        </span>
                        <span style={{ fontFamily: mono, fontSize: 10.5, color: 'var(--psa-ink-2)', wordBreak: 'break-all' }}>{c.path}</span>
                        {c.op === 'changed' && (
                          <span style={{ marginLeft: 'auto', fontFamily: mono, fontSize: 10.5, color: 'var(--psa-faint)', flexShrink: 0 }}>
                            {fmtVal(c.from)} → {fmtVal(c.to)}
                          </span>
                        )}
                      </div>
                    ))}
                    {diff.changes.length > 200 && (
                      <div style={{ padding: 6, color: 'var(--psa-faint)' }}>…共 {diff.changes.length} 条,仅显示前 200</div>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>

          {/* Phase 5 版本评论(版本级) */}
          <div style={{ ...secHead, marginTop: 16 }}>版本评论</div>
          <div className="psa-panel" style={{ padding: 10 }}>
            {byIdDesc.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--psa-muted)' }}>暂无版本。</div>
            ) : (
              <>
                <select value={cmVersion} onChange={(e) => setCmVersion(Number(e.target.value))} style={{ fontSize: 12, marginBottom: 8 }}>
                  {byIdDesc.map((v) => <option key={v.id} value={v.id}>{v.content_hash.slice(0, 8)} · v{v.id}</option>)}
                </select>
                <div style={{ maxHeight: 180, overflowY: 'auto' }}>
                  {cmList.length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--psa-muted)' }}>该版本暂无评论。</div>
                  ) : (
                    cmList.map((c) => (
                      <div key={c.id} style={{ padding: '5px 0', borderBottom: '1px solid var(--psa-line)', fontSize: 12 }}>
                        <span style={{ fontWeight: 600 }}>{c.author.split('@')[0]}</span>
                        <span style={{ fontFamily: mono, fontSize: 10.5, color: 'var(--psa-faint)', marginLeft: 6 }}>{c.created_at.slice(0, 19).replace('T', ' ')}</span>
                        <div style={{ color: 'var(--psa-ink-2)' }}>{c.body}</div>
                      </div>
                    ))
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <input
                    value={cmText}
                    onChange={(e) => setCmText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') onAddComment() }}
                    placeholder="版本级评论(入审计)"
                    style={{ flex: 1, fontSize: 12 }}
                  />
                  <button className="psa-btn" onClick={onAddComment} disabled={!cmText.trim() || cmVersion === ''}>评论</button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Phase 5 签发确认弹窗:身份/时间/哈希入只增审计 + 报告页脚 */}
      {signTarget && (
        <div style={signOverlay} onClick={() => setSignTarget(null)}>
          <div className="psa-panel" style={{ width: 440, margin: 'auto', padding: 18, background: 'var(--psa-surface)' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--psa-ink)', marginBottom: 8 }}>
              签发版本 {signTarget.content_hash.slice(0, 8)}
            </div>
            <div style={{ fontSize: 12, color: 'var(--psa-muted)', lineHeight: 1.7 }}>
              签发为<b>终态</b>(不可撤销;取代 = 签发更新的版本)。签发人身份、时间与版本哈希写入
              <b>只增审计</b>,此后以该版本内容导出的报告页脚携带签发行;任何未保存改动导出即回到工作稿。
            </div>
            <div style={{ fontFamily: mono, fontSize: 11, background: 'var(--psa-soft)', border: '1px solid var(--psa-line)', borderRadius: 6, padding: '6px 8px', margin: '10px 0', wordBreak: 'break-all' }}>
              {signTarget.content_hash}
            </div>
            <input
              value={signNote}
              onChange={(e) => setSignNote(e.target.value)}
              placeholder="签发意见(可选,入审计)"
              style={{ width: '100%', fontSize: 12, marginBottom: 8, boxSizing: 'border-box' }}
            />
            {isLocalAuth && (
              <input
                type="password"
                value={signPassword}
                onChange={(e) => setSignPassword(e.target.value)}
                placeholder="当前账户口令(签发口令复核,必填)"
                style={{ width: '100%', fontSize: 12, marginBottom: 12, boxSizing: 'border-box' }}
              />
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="psa-btn" onClick={() => setSignTarget(null)}>取消</button>
              <button className="psa-btn psa-btn--primary" disabled={actBusy || (isLocalAuth && !signPassword)} onClick={onConfirmSign}>确认签发</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const secHead: CSSProperties = { fontSize: 12, fontWeight: 700, color: 'var(--psa-muted)', textTransform: 'uppercase', letterSpacing: '.5px', margin: '0 0 8px 2px' }
const th: CSSProperties = { padding: '7px 10px', fontSize: 11, color: 'var(--psa-muted)', fontWeight: 600 }
const td: CSSProperties = { padding: '7px 10px', verticalAlign: 'middle' }
const badge: CSSProperties = { fontFamily: mono, fontSize: 11, fontWeight: 700, background: 'var(--psa-primary-soft)', color: 'var(--psa-primary-strong)', border: '1px solid rgba(37,99,235,.22)', borderRadius: 5, padding: '1px 6px' }
const stBadge = (state: 'in_review' | 'signed' | 'returned'): CSSProperties => ({
  fontSize: 10.5, fontWeight: 700, borderRadius: 999, padding: '1px 8px', whiteSpace: 'nowrap',
  ...(state === 'in_review' ? { background: 'rgba(217,119,6,.12)', color: 'var(--psa-amber)' }
    : state === 'signed' ? { background: 'rgba(46,194,106,.14)', color: '#1B7F42' }
    : { background: 'var(--psa-danger-soft)', color: 'var(--psa-danger-strong)' }),
})
const signOverlay: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(9,14,22,.42)', zIndex: 60, display: 'flex', padding: 24 }
