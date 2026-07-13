import { describe, it, expect, afterEach, vi } from 'vitest'
import { StatusError, SaveConflictError, getMe, login, logout, saveWorkspace } from './api'

afterEach(() => vi.unstubAllGlobals())

const okJson = (data: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data) })

describe('Phase 5 认证 API 客户端', () => {
  it('getMe 200 → 返回身份', async () => {
    vi.stubGlobal('fetch', vi.fn(() => okJson({ mode: 'off', username: 'root', role: 'admin', display_name: null })) as any)
    const me = await getMe()
    expect(me.mode).toBe('off')
  })

  it('getMe 401 → 抛 StatusError(status=401,携带中文 detail)——精确信号,非网络异常', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: false, status: 401, json: () => Promise.resolve({ detail: '未登录' }),
    })) as any)
    try {
      await getMe()
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(StatusError)
      expect((e as StatusError).status).toBe(401)
      expect((e as StatusError).message).toBe('未登录')
    }
  })

  it('getMe 网络不可达 → 抛的不是 StatusError(约束 #0:离线单文件不得误判为需要登录)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('fetch failed'))))
    try {
      await getMe()
      expect.unreachable()
    } catch (e) {
      expect(e).not.toBeInstanceOf(StatusError)
    }
  })

  it('login 成功 → 返回身份;失败 → 抛后端中文 detail', async () => {
    vi.stubGlobal('fetch', vi.fn(() => okJson({ mode: 'local', username: 'wang', role: 'reviewer', display_name: '王雪梅' })) as any)
    const id = await login('wang', 'pw')
    expect(id.username).toBe('wang')

    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: false, status: 401, json: () => Promise.resolve({ detail: '用户名或口令错误' }),
    })) as any)
    await expect(login('wang', 'wrong')).rejects.toThrow('用户名或口令错误')
  })

  it('logout 打对端点', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) }))
    vi.stubGlobal('fetch', fetchMock as any)
    await logout()
    const calls = fetchMock.mock.calls as unknown as [string][]
    expect(String(calls[0][0])).toContain('/auth/logout')
  })
})

describe('saveWorkspace 乐观并发 409', () => {
  it('base_version_hash 冲突 → 抛 SaveConflictError 携带双方哈希', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: false, status: 409,
      json: () => Promise.resolve({ detail: { message: '版本冲突', server_hash: 'aaa111', base_hash: 'bbb222' } }),
    })) as any)
    try {
      await saveWorkspace('P', { v: 2 }, 'sid1', 'bbb222')
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(SaveConflictError)
      expect((e as SaveConflictError).serverHash).toBe('aaa111')
      expect((e as SaveConflictError).baseHash).toBe('bbb222')
    }
  })

  it('409 不落 localStorage(不是离线回退语义)', async () => {
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: false, status: 409,
      json: () => Promise.resolve({ detail: { server_hash: 'x', base_hash: 'y' } }),
    })) as any)
    await expect(saveWorkspace('P', { v: 2 }, 'sid1', 'y')).rejects.toBeInstanceOf(SaveConflictError)
    expect(localStorage.length).toBe(0)
  })

  it('携带 base_version_hash 请求体', async () => {
    const fetchMock = vi.fn(() => okJson({ id: 'sid1', name: 'P', saved_at: 'now' }))
    vi.stubGlobal('fetch', fetchMock as any)
    await saveWorkspace('P', { v: 2 }, 'sid1', 'hash-abc')
    const [, init] = fetchMock.mock.calls[0] as any
    expect(JSON.parse(init.body).base_version_hash).toBe('hash-abc')
  })
})
