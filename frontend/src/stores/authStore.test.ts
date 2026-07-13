import { describe, it, expect, afterEach, vi } from 'vitest'
import { useAuthStore, resetAuthStore } from './authStore'

afterEach(() => { vi.unstubAllGlobals(); resetAuthStore() })

const okJson = (data: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data) })
const status = (code: number, detail: unknown) => Promise.resolve({ ok: false, status: code, json: () => Promise.resolve({ detail }) })

describe('authStore', () => {
  it('refresh() 200(off 模式)→ identity 落位,needsLogin=false', async () => {
    vi.stubGlobal('fetch', vi.fn(() => okJson({ mode: 'off', username: 'root', role: 'admin', display_name: null })) as any)
    await useAuthStore.getState().refresh()
    const s = useAuthStore.getState()
    expect(s.status).toBe('ready')
    expect(s.needsLogin).toBe(false)
    expect(s.identity?.mode).toBe('off')
  })

  it('refresh() 401 → needsLogin=true,identity=null', async () => {
    vi.stubGlobal('fetch', vi.fn(() => status(401, '未登录')) as any)
    await useAuthStore.getState().refresh()
    const s = useAuthStore.getState()
    expect(s.needsLogin).toBe(true)
    expect(s.identity).toBeNull()
  })

  it('refresh() 网络不可达 → needsLogin 保持 false(约束 #0:离线单文件不弹登录墙)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('fetch failed'))))
    await useAuthStore.getState().refresh()
    const s = useAuthStore.getState()
    expect(s.status).toBe('ready')
    expect(s.needsLogin).toBe(false)
    expect(s.identity).toBeNull()
  })

  it('login() 成功 → identity 落位;失败 → loginError 落位且不改 needsLogin', async () => {
    vi.stubGlobal('fetch', vi.fn(() => status(401, '用户名或口令错误')) as any)
    await expect(useAuthStore.getState().login('x', 'wrong')).rejects.toThrow()
    expect(useAuthStore.getState().loginError).toBe('用户名或口令错误')

    vi.stubGlobal('fetch', vi.fn(() => okJson({ mode: 'local', username: 'wang', role: 'reviewer', display_name: '王雪梅' })) as any)
    await useAuthStore.getState().login('wang', 'pw')
    const s = useAuthStore.getState()
    expect(s.identity?.username).toBe('wang')
    expect(s.needsLogin).toBe(false)
    expect(s.loginError).toBeNull()
  })

  it('logout() 清空身份并置 needsLogin', async () => {
    useAuthStore.setState({ identity: { mode: 'local', username: 'wang', role: 'reviewer', display_name: null }, needsLogin: false })
    vi.stubGlobal('fetch', vi.fn(() => okJson({ ok: true })) as any)
    await useAuthStore.getState().logout()
    const s = useAuthStore.getState()
    expect(s.identity).toBeNull()
    expect(s.needsLogin).toBe(true)
  })
})
