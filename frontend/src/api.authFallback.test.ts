import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { AuthRequiredError, deleteSaved, listSaved, loadSaved, saveWorkspace, wasSavedOffline } from './api'

/**
 * 修复项 ①(ADR-4 盲区地雷,探针 P2 固化为回归):
 * 401/403 = 后端活着但拒绝 → 直接上抛 AuthRequiredError,绝不静默写 localStorage;
 * 网络不可达 / 其余 HTTP 错误 → 维持既有 localStorage 回退(off 模式语义逐位不变)。
 */

const status = (code: number) => Promise.resolve({ ok: false, status: code, json: () => Promise.resolve({}) })

beforeEach(() => localStorage.clear())
afterEach(() => vi.unstubAllGlobals())

describe('api 存档:认证失败 vs 网络不可达', () => {
  it('401 保存 → 抛 AuthRequiredError,localStorage 零写入,不置离线旗标', async () => {
    vi.stubGlobal('fetch', vi.fn(() => status(401)) as any)
    await expect(saveWorkspace('p1', { x: 1 })).rejects.toBeInstanceOf(AuthRequiredError)
    await expect(saveWorkspace('p1', { x: 1 })).rejects.toThrow(/未登录/)
    expect(localStorage.length).toBe(0)                       // 地雷核心:绝不伪装离线存档
    expect(wasSavedOffline()).toBe(false)
  })

  it('403 删除/401 列表/401 加载 → 全部上抛,不碰本地', async () => {
    vi.stubGlobal('fetch', vi.fn(() => status(403)) as any)
    await expect(deleteSaved('abc')).rejects.toThrow(/无权限/)
    vi.stubGlobal('fetch', vi.fn(() => status(401)) as any)
    await expect(listSaved()).rejects.toBeInstanceOf(AuthRequiredError)
    await expect(loadSaved('abc')).rejects.toBeInstanceOf(AuthRequiredError)
    expect(localStorage.length).toBe(0)
  })

  it('网络不可达 → 维持 localStorage 回退(off 模式语义不变)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('fetch failed'))))
    const item = await saveWorkspace('offline-proj', { x: 1 })
    expect(item.id).toMatch(/^[0-9a-f]{8}$/)
    expect(wasSavedOffline()).toBe(true)
    expect((await listSaved()).map((s) => s.id)).toContain(item.id)
  })

  it('非认证类 HTTP 错误(500)→ 维持既有回退语义', async () => {
    vi.stubGlobal('fetch', vi.fn(() => status(500)) as any)
    const item = await saveWorkspace('degraded', { x: 1 })
    expect(item.id).toMatch(/^[0-9a-f]{8}$/)
    expect(wasSavedOffline()).toBe(true)
  })
})
