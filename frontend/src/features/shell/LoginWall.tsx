import { useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import { useAuthStore } from '../../stores/authStore'

/**
 * 登录墙(D-P5-2 本地账户)。仅在 PSA_AUTH=local 且未认证时渲染
 * (authStore.needsLogin,精确来自 getMe() 401 —— 离线单文件/后端不可达绝不到这里,约束 #0)。
 */
export function LoginWall() {
  const login = useAuthStore((s) => s.login)
  const loginError = useAuthStore((s) => s.loginError)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!username || !password || busy) return
    setBusy(true)
    try { await login(username, password) } catch { /* loginError 已落 store */ }
    finally { setBusy(false) }
  }

  return (
    <div style={wrap}>
      <form onSubmit={onSubmit} style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
          <div style={logo}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M12 2c1 4-2 5-2 8a2 2 0 1 0 4 0c0-1 0-1.5.5-2 1 2 2.5 3 2.5 6a5 5 0 1 1-10 0c0-4 4-6 5-12z" fill="#fff" /></svg>
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--psa-ink)' }}>BESS PSA</div>
            <div style={{ fontSize: 11, color: 'var(--psa-faint)' }}>储能热失控定量风险评估</div>
          </div>
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--psa-ink-2)', marginBottom: 14 }}>登录</div>
        <label style={label}>用户名</label>
        <input
          autoFocus
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          style={input}
          placeholder="用户名"
        />
        <label style={{ ...label, marginTop: 10 }}>口令</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={input}
          placeholder="口令"
        />
        {loginError && <div style={errBox}>{loginError}</div>}
        <button type="submit" disabled={busy || !username || !password} className="psa-btn psa-btn--primary" style={{ width: '100%', height: 36, marginTop: 16, justifyContent: 'center' }}>
          {busy ? '登录中…' : '登录'}
        </button>
        <div style={{ fontSize: 11, color: 'var(--psa-faint)', marginTop: 14, textAlign: 'center' }}>
          账户由管理员创建。忘记口令请联系管理员重置。
        </div>
      </form>
    </div>
  )
}

const wrap: CSSProperties = { height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--psa-bg)' }
const card: CSSProperties = { width: 340, background: 'var(--psa-surface)', border: '1px solid var(--psa-line)', borderRadius: 12, padding: '26px 28px', boxShadow: '0 4px 24px rgba(9,14,22,.08)' }
const logo: CSSProperties = { width: 30, height: 30, borderRadius: 7, background: 'var(--psa-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.15)' }
const label: CSSProperties = { display: 'block', fontSize: 11.5, color: 'var(--psa-muted)', marginBottom: 4 }
const input: CSSProperties = { width: '100%', height: 34, boxSizing: 'border-box', padding: '0 10px', fontSize: 13, border: '1px solid var(--psa-line-strong)', borderRadius: 7, background: 'var(--psa-soft)' }
const errBox: CSSProperties = { marginTop: 12, padding: '8px 10px', background: 'var(--psa-danger-soft)', color: 'var(--psa-danger-strong)', borderRadius: 6, fontSize: 12 }
