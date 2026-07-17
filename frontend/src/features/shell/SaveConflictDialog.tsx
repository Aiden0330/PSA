import { useId } from 'react'
import type { CSSProperties } from 'react'
import type { ProjectPersistence } from '../persistence/useProjectPersistence'
import { useDialogA11y } from './a11y'

/**
 * D-P5-4 乐观并发冲突对话:他人已保存更新版本时的三条路(规格 §6):
 * 查看双方 diff(报告页版本对比,已有组件)/ 另存副本 / 确认覆盖。任一路径零数据丢失
 * ——版本库内容寻址保底,409 只是让冲突可见,不是防丢(ADR-2/ADR-4)。
 */
export function SaveConflictDialog({ persistence, onGoToDiff }: { persistence: ProjectPersistence; onGoToDiff: () => void }) {
  const c = persistence.conflict
  // FE-13:role=dialog + aria-modal + aria-labelledby + Esc(= 取消,先不保存)+ 焦点回环/恢复
  const titleId = useId()
  const dialogRef = useDialogA11y(persistence.dismissConflict, !!c)
  if (!c) return null
  return (
    <div style={overlay}>
      <div ref={dialogRef} className="psa-panel" style={box} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div id={titleId} style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--psa-danger-strong)', marginBottom: 8 }}>保存冲突</div>
        <div style={{ fontSize: 12.5, color: 'var(--psa-ink-2)', lineHeight: 1.7, marginBottom: 12 }}>
          他人已保存了更新的版本 —— 你这次保存未写入服务器,当前编辑仍在本机,可选择:
        </div>
        <div style={{ fontFamily: 'var(--psa-font-mono)', fontSize: 11, background: 'var(--psa-soft)', border: '1px solid var(--psa-line)', borderRadius: 6, padding: '8px 10px', marginBottom: 14 }}>
          你的基线版本 {c.baseHash ? c.baseHash.slice(0, 8) : '(无)'} · 服务器最新版本 {c.serverHash.slice(0, 8)}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            className="psa-btn"
            onClick={() => { persistence.dismissConflict(); onGoToDiff() }}
          >
            查看双方差异(前往报告页版本对比)
          </button>
          <button className="psa-btn" onClick={persistence.resolveConflictSaveAsCopy}>
            另存为新项目副本(不覆盖对方)
          </button>
          <button
            className="psa-btn"
            style={{ borderColor: 'var(--psa-danger)', color: 'var(--psa-danger)' }}
            onClick={persistence.resolveConflictOverwrite}
          >
            确认覆盖(对方版本仍保留在版本库中,可回查)
          </button>
          <button className="psa-btn" style={{ color: 'var(--psa-muted)' }} onClick={persistence.dismissConflict}>取消,先不保存</button>
        </div>
      </div>
    </div>
  )
}

const overlay: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }
const box: CSSProperties = { width: 420, maxWidth: '100%', background: 'var(--psa-surface)', padding: 20 }
