import { Icon } from './icons'

interface Props {
  onAddGate: (op: string) => void
  onAddBasic: () => void
}

export function Palette({ onAddGate, onAddBasic }: Props) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <span style={{ fontSize: 11.5, color: 'var(--psa-muted)', fontWeight: 500 }}>添加</span>
      <button className="psa-btn" onClick={() => onAddGate('or')}><Icon name="plus" size={13} />OR 门</button>
      <button className="psa-btn" onClick={() => onAddGate('and')}><Icon name="plus" size={13} />AND 门</button>
      <button className="psa-btn" onClick={() => onAddGate('atleast')}><Icon name="plus" size={13} />表决门</button>
      <button className="psa-btn" onClick={onAddBasic}><Icon name="plus" size={13} />基本事件</button>
    </div>
  )
}
