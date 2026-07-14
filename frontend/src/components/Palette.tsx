import { Icon } from './icons'

interface Props {
  onAddGate: (op: string) => void
  onAddBasic: () => void
  /** 初因频率树模式:额外提供「频率初因」事件(kind=frequency, /yr)。 */
  onAddFrequency?: () => void
}

export function Palette({ onAddGate, onAddBasic, onAddFrequency }: Props) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <span style={{ fontSize: 11.5, color: 'var(--psa-muted)', fontWeight: 500 }}>添加</span>
      <button className="psa-btn" onClick={() => onAddGate('or')}><Icon name="plus" size={13} />OR 门</button>
      <button className="psa-btn" onClick={() => onAddGate('and')}><Icon name="plus" size={13} />AND 门</button>
      <button className="psa-btn" onClick={() => onAddGate('atleast')}><Icon name="plus" size={13} />表决门</button>
      <button className="psa-btn" onClick={onAddBasic}><Icon name="plus" size={13} />{onAddFrequency ? '使能事件(概率)' : '基本事件'}</button>
      {onAddFrequency && (
        <button className="psa-btn psa-btn--primary" onClick={onAddFrequency} title="初因事件(频率, /yr)——每个最小割集须恰好一个">
          <Icon name="plus" size={13} />频率初因(/yr)
        </button>
      )}
    </div>
  )
}
