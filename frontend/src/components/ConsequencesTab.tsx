import type { EventTreeModel, ConsLevel } from '../eventtree'
import { consEntries, addConsequence, updateConsequence, delConsequence, CONSEQUENCES, gradeLabel } from '../eventtree'
import { Icon } from './icons'

const isDefault = (id: string) => (CONSEQUENCES as string[]).includes(id)

const C_TOKEN: Record<string, string> = {
  C1: 'var(--psa-c1)',
  C2: 'var(--psa-c2)',
  C3: 'var(--psa-c3)',
  C4: 'var(--psa-c4)',
  C5: 'var(--psa-c5)',
}

export function ConsequencesTab({ model, onChange }: {
  model: EventTreeModel
  onChange: (m: EventTreeModel | ((prev: EventTreeModel) => EventTreeModel)) => void
}) {
  const entries = [...consEntries(model)].sort(
    (a, b) => CONSEQUENCES.indexOf(a.level) - CONSEQUENCES.indexOf(b.level),
  )
  return (
    <div style={{ padding: 16, overflowY: 'auto', height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* Section header */}
      <div className="psa-panel" style={{ flex: 'none' }}>
        <div className="psa-ch">
          <span className="t">后果定义</span>
          <span className="meta">{entries.length} 条</span>
        </div>
        <div style={{ padding: '8px 12px 6px', fontSize: 11.5, color: 'var(--psa-muted)' }}>
          默认 0–IV 五条不可删、等级锁定；可改写其文字，或为同一等级新增多条后果。
          事件树的叶节点从此列表选择具体后果（分箱仍按其等级 0–IV）。
        </div>

        {/* Consequence rows as cards */}
        <div style={{ padding: '6px 10px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {entries.map((e) => (
            <div key={e.id} className="psa-card" style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 12 }}>
              {/* Chip: colored square + level selector */}
              <span className="psa-chip" style={{ flexShrink: 0, minWidth: 64 }}>
                <span className="sq" style={{ background: C_TOKEN[e.level] ?? 'var(--psa-muted)' }} />
                <select
                  value={e.level}
                  disabled={isDefault(e.id)}
                  style={{ fontSize: 11.5, fontWeight: 600, border: 'none', background: 'transparent', cursor: isDefault(e.id) ? 'default' : 'pointer', color: C_TOKEN[e.level] ?? 'var(--psa-ink)', padding: 0 }}
                  onChange={(ev) => { const lv = ev.target.value as ConsLevel; onChange((prev) => updateConsequence(prev, e.id, { level: lv })) }}
                >
                  {CONSEQUENCES.map((c) => <option key={c} value={c}>{gradeLabel(c)}</option>)}
                </select>
              </span>

              {/* Description input */}
              <input
                style={{ flex: 1, fontSize: 13, border: '1px solid transparent', borderRadius: 5, padding: '3px 7px', background: 'transparent', minWidth: 0 }}
                value={e.desc}
                onFocus={(ev) => (ev.currentTarget.style.borderColor = 'var(--psa-primary)')}
                onBlur={(ev) => (ev.currentTarget.style.borderColor = 'transparent')}
                onChange={(ev) => { const d = ev.target.value; onChange((prev) => updateConsequence(prev, e.id, { desc: d })) }}
              />

              {/* Delete — only for non-defaults */}
              {!isDefault(e.id) ? (
                <button className="psa-btn psa-btn--danger" style={{ height: 26, padding: '0 9px', fontSize: 11.5, flexShrink: 0 }}
                  onClick={() => onChange((prev) => delConsequence(prev, e.id))}>
                  <Icon name="trash" size={13} />
                </button>
              ) : (
                /* placeholder to keep alignment */
                <span style={{ width: 34, flexShrink: 0 }} />
              )}
            </div>
          ))}
        </div>

        {/* Add button */}
        <div style={{ padding: '0 10px 12px' }}>
          <button className="psa-btn psa-btn--primary" onClick={() => onChange((prev) => addConsequence(prev, '新后果', 'C3'))}>
            <Icon name="plus" size={13} /> 新增后果
          </button>
        </div>
      </div>
    </div>
  )
}
