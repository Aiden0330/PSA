import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { listSaved, loadSaved, saveWorkspace, deleteSaved, wasSavedOffline } from './api'

const et = { initEvent: 'IE' }
const fts = { model_data: { parameters: [] }, fault_trees: [] }

beforeEach(() => localStorage.clear())
afterEach(() => vi.unstubAllGlobals())

describe('api 存档回退', () => {
  it('后端 reject → 走 localStorage 全套往返, wasSavedOffline=true', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network'))))
    const item = await saveWorkspace('s1', { etModel: et, fts })
    expect(item.id).toMatch(/^[0-9a-f]{8}$/)
    expect(wasSavedOffline()).toBe(true)
    const list = await listSaved()
    expect(list.map((x) => x.id)).toContain(item.id)
    const rec = await loadSaved(item.id)
    expect(rec.payload.etModel).toEqual(et)
    await deleteSaved(item.id)
    expect((await listSaved()).map((x) => x.id)).not.toContain(item.id)
  })

  it('后端可达 → 用后端数据, wasSavedOffline=false', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve([{ id: 'srv1', name: 'fromServer', saved_at: '2026-06-22T00:00:00Z' }]) }),
    ) as any)
    const list = await listSaved()
    expect(list[0].id).toBe('srv1')
    expect(wasSavedOffline()).toBe(false)
  })

  it('后端 !ok(404) 视为回退', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) }),
    ) as any)
    const list = await listSaved()
    expect(wasSavedOffline()).toBe(true)
    expect(Array.isArray(list)).toBe(true)
  })

  it('saveWorkspace !ok(500) → 回退 localStorage, wasSavedOffline=true', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) }),
    ) as any)
    const item = await saveWorkspace('x', { etModel: et, fts })
    expect(item.id).toMatch(/^[0-9a-f]{8}$/)
    expect(wasSavedOffline()).toBe(true)
  })

  it('后端不可达且本地无此 id → loadSaved 抛错(不静默吞), 旗标=true', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network'))))
    await expect(loadSaved('deadbeef')).rejects.toThrow()
    expect(wasSavedOffline()).toBe(true)
  })

  it('saveWorkspace 带 id → POST body 含 id(原地更新而非新建)', async () => {
    const spy = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'srv1', name: 'n', saved_at: '2026-06-22T00:00:00Z' }) }))
    vi.stubGlobal('fetch', spy as any)
    await saveWorkspace('n', { v: 1 }, 'srv1')
    const body = JSON.parse((spy.mock.calls[0] as any[])[1].body)
    expect(body.id).toBe('srv1')
  })
})
