import { useState } from 'react'
import type { CSSProperties } from 'react'
import { Icon } from '../../components/icons'
import type { HouseEventInfo, AnalysisSettings, PostRuleDraft, PostRuleKind, BcSetJson } from './analysisSettings'
import { newPostRule, settingsActive, validatePostRules, addBcSet, renameBcSet, deleteBcSet, setBcSetMember } from './analysisSettings'

const KIND_LABEL: Record<PostRuleKind, string> = {
  mutually_exclusive: '互斥组',
  delete_contains: '删除(含)',
  recovery: '恢复',
}

/**
 * 分析设置面板(4c1):house 事件覆盖(边界条件)+ 命名边界条件集 + 割集后处理规则。
 * 纯受控组件——house 覆盖/集合选择由工作台持有(经 toQuantifyOptions/toEtEngineOptions 提交);
 * 命名集定义随模型 JSON(bcSets),经 onBcSetsChange 写回模型 setter(吃撤销历史)。
 * ETA 复用同组件:showPostRules=false 隐藏后处理规则(post 规则是 FTA 专属语义)。
 */
export function AnalysisSettingsPanel(
  { houses, basicEvents, settings, onChange, bcSets = [], onBcSetsChange, showPostRules = true }: {
    houses: HouseEventInfo[]
    basicEvents: string[]           // 供后处理规则挑选成员
    settings: AnalysisSettings
    onChange: (s: AnalysisSettings) => void
    bcSets?: BcSetJson[]            // 模型内命名边界条件集(定义);缺省空
    onBcSetsChange?: (sets: BcSetJson[]) => void   // 写回模型;缺省则不渲染集合管理
    showPostRules?: boolean         // 缺省 true;ETA 传 false 隐藏后处理规则
  },
) {
  const [open, setOpen] = useState(false)
  const [editIdx, setEditIdx] = useState<number | null>(null)   // 展开成员编辑的集合下标
  const active = settingsActive(settings)
  const errs = validatePostRules(settings.postRules)

  const setHouse = (id: string, v: boolean | undefined) => {
    const next = { ...settings.houseOverrides }
    if (v === undefined) delete next[id]
    else next[id] = v
    onChange({ ...settings, houseOverrides: next })
  }
  // ── 命名边界条件集(定义写回模型;选择/清除是分析设置)──
  const createBcSet = () => {
    if (!onBcSetsChange) return
    const name = window.prompt('新建边界条件集名称', `工况 ${bcSets.length + 1}`)
    if (name == null) return
    onBcSetsChange(addBcSet(bcSets, name))
  }
  const renameBc = (i: number, cur: string) => {
    if (!onBcSetsChange) return
    const name = window.prompt('重命名边界条件集', cur)
    if (name == null) return
    const next = renameBcSet(bcSets, i, name)
    onBcSetsChange(next)
    if (settings.boundaryConditionSet === cur && next[i] && next[i].name !== cur) onChange({ ...settings, boundaryConditionSet: next[i].name })
  }
  const deleteBc = (i: number, name: string) => {
    if (!onBcSetsChange) return
    if (!window.confirm(`删除边界条件集「${name}」?`)) return
    onBcSetsChange(deleteBcSet(bcSets, i))
    if (settings.boundaryConditionSet === name) onChange({ ...settings, boundaryConditionSet: undefined })
    if (editIdx === i) setEditIdx(null)
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
        <span className="meta">{active ? '已启用' : (showPostRules ? '边界条件 · 集合 · 后处理' : '边界条件 · 集合')}{active && <span style={dot} />}</span>
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

          {/* ── 命名边界条件集(house 组合)── */}
          {onBcSetsChange && (
            <>
              <div style={{ ...h5, marginTop: 12 }}>边界条件集（命名 house 组合）</div>
              <div style={hint}>把若干 house 事件的状态存为命名集,量化时按名整体套用（显式覆盖优先于集合）。</div>
              <div style={{ ...row, marginBottom: 8 }}>
                <span style={{ color: 'var(--psa-ink-2)' }}>应用</span>
                <select value={settings.boundaryConditionSet ?? ''} style={{ flex: 1, fontSize: 12 }}
                  onChange={(e) => onChange({ ...settings, boundaryConditionSet: e.target.value || undefined })}>
                  <option value="">不应用</option>
                  {bcSets.map((b) => <option key={b.name} value={b.name}>{b.name}</option>)}
                </select>
              </div>
              {bcSets.length === 0
                ? <div style={hint}>尚无命名集。新建后可在此选择套用。</div>
                : bcSets.map((b, i) => {
                  const memberIds = Object.keys(b.house_states)
                  const isApplied = settings.boundaryConditionSet === b.name
                  return (
                    <div key={i} style={{ border: `1px solid ${isApplied ? 'var(--psa-primary)' : 'var(--psa-line)'}`, borderRadius: 8, padding: '7px 8px', marginBottom: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600, fontSize: 12 }} title={b.name}>{b.name}</span>
                        {isApplied && <span style={{ fontSize: 10, color: 'var(--psa-primary)', fontWeight: 700 }}>应用中</span>}
                        <button className="psa-btn" style={miniBtn} onClick={() => setEditIdx(editIdx === i ? null : i)} title="编辑成员 house 状态">{editIdx === i ? '收起' : `成员(${memberIds.length})`}</button>
                        <button className="psa-btn" style={miniBtn} onClick={() => renameBc(i, b.name)} title="重命名">改名</button>
                        <button onClick={() => deleteBc(i, b.name)} title="删除边界条件集" style={{ ...miniBtn, color: 'var(--psa-danger)' }}>✕</button>
                      </div>
                      {editIdx === i && (
                        <div style={{ marginTop: 6 }}>
                          {houses.length === 0
                            ? <div style={hint}>当前无 house 事件可选。先在故障树添加 house 节点。</div>
                            : houses.map((h) => {
                              const st = b.house_states[h.id]
                              const val = st === undefined ? '' : st ? 'T' : 'F'
                              return (
                                <div key={h.id} style={row}>
                                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={h.id}>{h.label}</span>
                                  <select value={val} style={{ fontSize: 11, fontFamily: 'var(--psa-font-mono)' }}
                                    onChange={(e) => onBcSetsChange(setBcSetMember(bcSets, i, h.id, e.target.value === '' ? undefined : e.target.value === 'T'))}>
                                    <option value="">不含</option>
                                    <option value="T">TRUE</option>
                                    <option value="F">FALSE</option>
                                  </select>
                                </div>
                              )
                            })}
                        </div>
                      )}
                    </div>
                  )
                })}
              <button className="psa-btn" style={miniBtn} onClick={createBcSet}><Icon name="plus" size={11} />新建边界条件集</button>
            </>
          )}

          {/* ── 割集后处理规则(FTA 专属;ETA 隐藏)── */}
          {showPostRules && (<>
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
          </>)}
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
