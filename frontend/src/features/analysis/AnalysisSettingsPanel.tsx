import { useState } from 'react'
import type { CSSProperties } from 'react'
import { Icon } from '../../components/icons'
import type { HouseEventInfo, AnalysisSettings, PostRuleDraft, PostRuleKind } from './analysisSettings'
import { newPostRule, settingsActive, validatePostRules } from './analysisSettings'

const KIND_LABEL: Record<PostRuleKind, string> = {
  mutually_exclusive: '互斥组',
  delete_contains: '删除(含)',
  recovery: '恢复',
}

/**
 * 分析设置面板(4c1):house 事件覆盖(边界条件)+ 割集后处理规则。
 * 纯受控组件——状态由 FTA 工作台持有,量化时经 toQuantifyOptions 提交。
 */
export function AnalysisSettingsPanel(
  { houses, basicEvents, settings, onChange }: {
    houses: HouseEventInfo[]
    basicEvents: string[]           // 供后处理规则挑选成员
    settings: AnalysisSettings
    onChange: (s: AnalysisSettings) => void
  },
) {
  const [open, setOpen] = useState(false)
  const active = settingsActive(settings)
  const errs = validatePostRules(settings.postRules)

  const setHouse = (id: string, v: boolean | undefined) => {
    const next = { ...settings.houseOverrides }
    if (v === undefined) delete next[id]
    else next[id] = v
    onChange({ ...settings, houseOverrides: next })
  }
  const addRule = (kind: PostRuleKind) => onChange({ ...settings, postRules: [...settings.postRules, newPostRule(kind)] })
  const setRule = (i: number, patch: Partial<PostRuleDraft>) =>
    onChange({ ...settings, postRules: settings.postRules.map((r, j) => (j === i ? { ...r, ...patch } : r)) })
  const delRule = (i: number) => onChange({ ...settings, postRules: settings.postRules.filter((_, j) => j !== i) })

  return (
    <div style={{ borderBottom: '1px solid var(--psa-line)' }}>
      <div className="psa-ch" style={{ cursor: 'pointer' }} onClick={() => setOpen((v) => !v)}>
        <span className="t" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ display: 'inline-flex', transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform .12s' }}><Icon name="chevron-down" size={12} /></span>
          分析设置
        </span>
        <span className="meta">{active ? '已启用' : '边界条件 · 后处理'}{active && <span style={dot} />}</span>
      </div>
      {open && (
        <div style={{ padding: '8px 14px 12px' }}>
          {/* ── 边界条件(house 覆盖)── */}
          <div style={h5}>边界条件（house 事件）</div>
          {houses.length === 0 ? (
            <div style={hint}>当前故障树无 house 事件。可在画布加 house 节点后在此按分析覆盖其状态。</div>
          ) : houses.map((h) => {
            const ov = settings.houseOverrides[h.id]
            const eff = ov === undefined ? h.state : ov
            return (
              <div key={h.id} style={row}>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={h.id}>{h.label}</span>
                <label style={sw} title="TRUE = 该分支存在/启用">
                  <input type="checkbox" checked={eff} onChange={(e) => setHouse(h.id, e.target.checked)} />
                  {eff ? 'TRUE' : 'FALSE'}
                </label>
                {ov !== undefined
                  ? <button className="psa-btn" style={miniBtn} onClick={() => setHouse(h.id, undefined)} title="清除覆盖，回到模型声明值">复位</button>
                  : <span style={{ ...miniBtn, color: 'var(--psa-faint)', border: '1px solid transparent' }}>声明</span>}
              </div>
            )
          })}

          {/* ── 割集后处理规则 ── */}
          <div style={{ ...h5, marginTop: 12 }}>割集后处理规则</div>
          <div style={hint}>只作用于最小割集列表;精确顶值不变(结果面板分列展示 REA/MCUB)。</div>
          {settings.postRules.map((r, i) => (
            <div key={i} style={{ border: '1px solid var(--psa-line)', borderRadius: 8, padding: '7px 8px', marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                <select value={r.kind} onChange={(e) => onChange({ ...settings, postRules: settings.postRules.map((x, j) => (j === i ? newPostRule(e.target.value as PostRuleKind) : x)) })}
                  style={{ fontSize: 12 }}>
                  {(Object.keys(KIND_LABEL) as PostRuleKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                </select>
                <span style={{ flex: 1 }} />
                <button onClick={() => delRule(i)} title="删除规则" style={{ ...miniBtn, color: 'var(--psa-danger)' }}>✕</button>
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--psa-muted)', marginBottom: 3 }}>
                {r.kind === 'mutually_exclusive' ? '成员(选 ≥2;割集同含 ≥2 → 删)'
                  : r.kind === 'delete_contains' ? '成员(割集 ⊇ 全部 → 删)'
                    : '触发成员(割集 ⊇ 全部 → 追加恢复事件)'}
              </div>
              <select multiple value={r.events} onChange={(e) => setRule(i, { events: Array.from(e.target.selectedOptions, (o) => o.value) })}
                style={{ width: '100%', height: 62, fontSize: 11.5 }}>
                {basicEvents.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
              {r.kind === 'recovery' && (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 5 }}>
                  <span style={{ fontSize: 11, color: 'var(--psa-muted)' }}>恢复事件</span>
                  <input value={r.add_event ?? ''} onChange={(e) => setRule(i, { add_event: e.target.value })} style={{ flex: 1, fontSize: 12 }} />
                  <span style={{ fontSize: 11, color: 'var(--psa-muted)' }}>P</span>
                  <input type="number" step="0.01" min={0} max={1} value={r.prob ?? 0}
                    onChange={(e) => setRule(i, { prob: Math.min(1, Math.max(0, +e.target.value)) })} style={{ width: 62, fontSize: 12 }} />
                </div>
              )}
              {errs[i] && <div style={{ fontSize: 11, color: 'var(--psa-amber)', marginTop: 4 }}>{errs[i]}</div>}
            </div>
          ))}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(Object.keys(KIND_LABEL) as PostRuleKind[]).map((k) => (
              <button key={k} className="psa-btn" style={miniBtn} onClick={() => addRule(k)}>
                <Icon name="plus" size={11} />{KIND_LABEL[k]}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const h5: CSSProperties = { fontSize: 11.5, fontWeight: 600, color: 'var(--psa-ink-2)', marginBottom: 4 }
const hint: CSSProperties = { fontSize: 10.5, color: 'var(--psa-faint)', lineHeight: 1.5, marginBottom: 6 }
const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, fontSize: 12 }
const sw: CSSProperties = { display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontFamily: 'var(--psa-font-mono)', color: 'var(--psa-ink-2)', cursor: 'pointer' }
const miniBtn: CSSProperties = { height: 24, padding: '0 8px', fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 3 }
const dot: CSSProperties = { display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'var(--psa-primary)', marginLeft: 6, verticalAlign: 'middle' }
