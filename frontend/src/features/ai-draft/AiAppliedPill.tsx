import type { CSSProperties } from 'react'
import { Icon } from '../../components/icons'
import type { AiDraftState } from './useAiDraft'

const aiNoticePill: CSSProperties = { maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', border: '1px solid rgba(22,163,74,.22)', borderRadius: 7, background: 'rgba(22,163,74,.1)', color: 'var(--psa-ok)', padding: '5px 9px', fontSize: 12, fontWeight: 600 }
const aiResultPill: CSSProperties = { maxWidth: 460, minHeight: 30, display: 'inline-flex', alignItems: 'center', gap: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', border: '1px solid rgba(37,99,235,.25)', borderRadius: 7, background: 'var(--psa-primary-soft)', color: 'var(--psa-primary-strong)', padding: '5px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }

/** 「AI 已应用」结果胶囊(点击回跳到生成物);无应用结果时显示临时通知。 */
export function AiAppliedPill({ ai }: { ai: AiDraftState }) {
  const r = ai.aiAppliedResult
  if (r) {
    return (
      <button type="button" style={aiResultPill} onClick={ai.openAiAppliedResult}>
        <Icon name="check" size={13} />
        {r.kind === 'eta'
          ? `${r.mode === 'complete_eta' ? 'AI 已补全 ETA' : 'AI 已新增 ETA'}: ${r.etaName}`
          : r.kind === 'fta'
            ? `AI 已打开 FTA: ${r.barrierLabel}`
            : `AI 已打开自建 FTA: ${r.treeName}`}
      </button>
    )
  }
  return ai.aiNotice ? <span style={aiNoticePill}>{ai.aiNotice}</span> : null
}
