/** loadSaved 三态语义锁测(报障 2026-07-25「存档 27489f5c 不存在」)。
 *
 * 病理:此前任何失败(权威 404 / 瞬时 5xx / 网络断)一律回退 localStorage,再把
 * localStorage 的「存档 X 不存在」当事实报出 —— 存档明明在服务器上完好,用户看到
 * 的却是"数据没了"。与 F2-R4(save 侧 4xx 不得静默回退)同病,这里锁 load 侧:
 *   ① 后端可达 + 404  ⇒ SavedNotFoundError(权威答案),不回退、不置离线;
 *   ② 后端可达 + 5xx  ⇒ 抛状态码错误(服务器才是真相持有者),不回退、不置离线;
 *   ③ 网络层失败      ⇒ 才回退 localStorage;本地也无 ⇒ 错误必须说「后端未连接」,
 *      绝不说「存档不存在」。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadSaved, SavedNotFoundError, wasSavedOffline } from './api'

beforeEach(() => { localStorage.clear() })
afterEach(() => { vi.unstubAllGlobals() })

describe('loadSaved 三态', () => {
  it('① 权威 404:SavedNotFoundError,不碰 localStorage,不置离线', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"detail":"no saved workspace x"}', { status: 404 })))
    await expect(loadSaved('27489f5c')).rejects.toBeInstanceOf(SavedNotFoundError)
    await expect(loadSaved('27489f5c')).rejects.toThrow(/服务器上不存在/)
    expect(wasSavedOffline()).toBe(false)
  })

  it('② 5xx:抛状态码,不回退本地(本地陈本可能过期,服务器才是真相)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })))
    await expect(loadSaved('27489f5c')).rejects.toThrow(/500/)
    expect(wasSavedOffline()).toBe(false)
  })

  it('③ 网络断 + 本地无副本:错误说「后端未连接」而非「存档不存在」', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    await expect(loadSaved('27489f5c')).rejects.toThrow(/后端未连接/)
    expect(wasSavedOffline()).toBe(true)
  })

  it('③b 网络断 + 本地有副本:正常回退返回本地记录', async () => {
    const { lsSave } = await import('./localStore')
    lsSave('本地存档', { etas: [] }, 'aabbccdd')
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    const rec = await loadSaved('aabbccdd')
    expect(rec.name).toBe('本地存档')
    expect(wasSavedOffline()).toBe(true)
  })

  it('在线成功路径回归:200 返回记录并复位离线标志', async () => {
    const rec = { id: 'x1', name: 'srv', saved_at: 't', payload: {} }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(rec), { status: 200 })))
    expect((await loadSaved('x1')).name).toBe('srv')
    expect(wasSavedOffline()).toBe(false)
  })
})
