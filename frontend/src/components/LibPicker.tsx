/** 从参考库选条目的轻量下拉（选后回调，自身复位为占位）。 */
import { Icon } from './icons'

export function LibPicker(
  { items, label, onPick }:
  { items: { id: string; name: string; unit?: string }[]; label: string; onPick: (id: string) => void },
) {
  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <select
        value=""
        onChange={(e) => { if (e.target.value) onPick(e.target.value) }}
        className="psa-btn"
        style={{
          appearance: 'none', WebkitAppearance: 'none',
          paddingRight: 28, cursor: 'pointer',
          fontFamily: 'var(--psa-font-sans)', fontSize: 12.5,
        }}
      >
        <option value="">{label}</option>
        {items.map((it) => <option key={it.id} value={it.id}>{it.name}{it.unit ? ` (${it.unit})` : ''}</option>)}
      </select>
      <span style={{ position: 'absolute', right: 8, pointerEvents: 'none', display: 'flex', alignItems: 'center', color: 'var(--psa-muted)' }}>
        <Icon name="chevron-down" size={13} />
      </span>
    </span>
  )
}
