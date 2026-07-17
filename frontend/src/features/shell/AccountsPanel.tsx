import { useEffect, useId, useState } from 'react'
import type { CSSProperties } from 'react'
import { createAccount, listAccounts, setAccountDisabled } from '../../api'
import type { AccountInfo } from '../../api'
import { useDialogA11y } from './a11y'

const ROLE_LABEL: Record<string, string> = { admin: '管理员', analyst: '分析员', reviewer: '评审人' }

/** 账户管理面(admin only,D-P5-3 小团队三角色)。列表 + 建账户 + 停用/启用。 */
export function AccountsPanel({ onClose }: { onClose: () => void }) {
  const [accounts, setAccounts] = useState<AccountInfo[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [uname, setUname] = useState('')
  const [pw, setPw] = useState('')
  const [role, setRole] = useState('analyst')
  const [display, setDisplay] = useState('')
  // FE-13:role=dialog + aria-modal + aria-labelledby + Esc 关闭 + 焦点回环/恢复
  const titleId = useId()
  const dialogRef = useDialogA11y(onClose)

  const refresh = () => { listAccounts().then(setAccounts).catch((e) => setErr(String(e?.message ?? e))) }
  useEffect(refresh, [])

  const onCreate = async () => {
    if (!uname || !pw) return
    setBusy(true); setErr(null)
    try {
      await createAccount(uname, pw, role, display || undefined)
      setUname(''); setPw(''); setDisplay('')
      refresh()
    } catch (e: any) { setErr(String(e?.message ?? e)) }
    finally { setBusy(false) }
  }
  const onToggle = async (a: AccountInfo) => {
    setBusy(true); setErr(null)
    try { await setAccountDisabled(a.username, !a.disabled); refresh() }
    catch (e: any) { setErr(String(e?.message ?? e)) }
    finally { setBusy(false) }
  }

  return (
    <div style={overlay} onClick={onClose}>
      <div ref={dialogRef} className="psa-panel" style={box} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <div id={titleId} style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--psa-ink)' }}>账户管理</div>
          <button onClick={onClose} className="psa-btn" style={{ marginLeft: 'auto' }}>关闭</button>
        </div>
        {err && <div style={{ marginBottom: 10, padding: 8, background: 'var(--psa-danger-soft)', color: 'var(--psa-danger-strong)', borderRadius: 6, fontSize: 12 }}>{err}</div>}

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, marginBottom: 16 }}>
          <thead>
            <tr style={{ background: 'var(--psa-soft-2)', textAlign: 'left' }}>
              {['用户名', '姓名', '角色', '状态', ''].map((h) => <th key={h} style={th}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id} style={{ borderTop: '1px solid var(--psa-line)' }}>
                <td style={td}>{a.username}</td>
                <td style={td}>{a.display_name ?? '—'}</td>
                <td style={td}>{ROLE_LABEL[a.role] ?? a.role}</td>
                <td style={td}>{a.disabled ? <span style={{ color: 'var(--psa-danger-strong)' }}>已停用</span> : <span style={{ color: 'var(--psa-ok)' }}>启用</span>}</td>
                <td style={td}><button disabled={busy} onClick={() => onToggle(a)} className="psa-btn" style={{ height: 24, fontSize: 11 }}>{a.disabled ? '启用' : '停用'}</button></td>
              </tr>
            ))}
            {accounts.length === 0 && <tr><td colSpan={5} style={{ ...td, color: 'var(--psa-muted)' }}>暂无账户。</td></tr>}
          </tbody>
        </table>

        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--psa-muted)', marginBottom: 8 }}>新建账户</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input value={uname} onChange={(e) => setUname(e.target.value)} placeholder="用户名" style={input} />
          <input value={pw} onChange={(e) => setPw(e.target.value)} type="password" placeholder="初始口令(≥8 位)" style={input} />
          <input value={display} onChange={(e) => setDisplay(e.target.value)} placeholder="姓名(可选)" style={input} />
          <select value={role} onChange={(e) => setRole(e.target.value)} style={{ ...input, width: 100 }}>
            <option value="analyst">分析员</option>
            <option value="reviewer">评审人</option>
            <option value="admin">管理员</option>
          </select>
          <button disabled={busy || !uname || !pw} onClick={onCreate} className="psa-btn psa-btn--primary">建账户</button>
        </div>
      </div>
    </div>
  )
}

const overlay: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', zIndex: 55, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }
const box: CSSProperties = { width: 560, maxWidth: '100%', maxHeight: '80vh', overflowY: 'auto', background: 'var(--psa-surface)', padding: 18 }
const th: CSSProperties = { padding: '7px 10px', fontSize: 11, color: 'var(--psa-muted)', fontWeight: 600 }
const td: CSSProperties = { padding: '7px 10px' }
const input: CSSProperties = { height: 30, boxSizing: 'border-box', padding: '0 8px', fontSize: 12.5, border: '1px solid var(--psa-line-strong)', borderRadius: 6, background: 'var(--psa-soft)', flex: '1 1 120px' }
