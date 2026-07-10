import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { diffProjectVersions, exportReport, listProjectCases, listProjectVersions } from '../../api'
import type { CaseInfo, VersionDiff, VersionInfo } from '../../api'
import { Icon } from '../../components/icons'
import { CONSEQUENCES, consDef, toEngineRequest } from '../../eventtree'
import { useActiveEta } from '../../stores/useActiveEta'
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
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const pu = persistence.projectUuid

  const refresh = () => {
    if (!pu) { setVersions([]); setCases([]); return }
    listProjectVersions(pu).then(setVersions).catch(() => setVersions([]))
    listProjectCases(pu).then(setCases).catch(() => setCases([]))
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

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: 'var(--psa-bg)', padding: 18 }}>
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
      {err && <div style={{ marginBottom: 12, padding: 10, background: 'var(--psa-danger-soft)', color: 'var(--psa-danger-strong)', borderRadius: 6, fontSize: 12 }}>导出失败:{err}</div>}

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
                    {['案例', '类型', '模型版本', '引擎', '产物', '时间'].map((h) => <th key={h} style={th}>{h}</th>)}
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
              [...versions].sort((a, b) => b.id - a.id).map((v) => (
                <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderBottom: '1px solid var(--psa-line)', fontSize: 12 }}>
                  <span style={badge} title={v.content_hash}>{v.content_hash.slice(0, 8)}</span>
                  <span style={{ color: 'var(--psa-ink-2)' }}>{v.origin === 'auto_pin' ? '报告钉扎' : v.origin === 'import' ? '导入' : '保存'}</span>
                  <span style={{ marginLeft: 'auto', fontFamily: mono, fontSize: 10.5, color: 'var(--psa-faint)' }}>{v.created_at.slice(0, 19).replace('T', ' ')}</span>
                </div>
              ))
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
        </div>
      </div>
    </div>
  )
}

const secHead: CSSProperties = { fontSize: 12, fontWeight: 700, color: 'var(--psa-muted)', textTransform: 'uppercase', letterSpacing: '.5px', margin: '0 0 8px 2px' }
const th: CSSProperties = { padding: '7px 10px', fontSize: 11, color: 'var(--psa-muted)', fontWeight: 600 }
const td: CSSProperties = { padding: '7px 10px', verticalAlign: 'middle' }
const badge: CSSProperties = { fontFamily: mono, fontSize: 11, fontWeight: 700, background: 'var(--psa-primary-soft)', color: 'var(--psa-primary-strong)', border: '1px solid rgba(37,99,235,.22)', borderRadius: 5, padding: '1px 6px' }
