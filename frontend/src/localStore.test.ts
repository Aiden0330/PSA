import { describe, it, expect, beforeEach, vi } from 'vitest'
import { lsList, lsLoad, lsSave, lsDelete } from './localStore'

const et = { initEvent: 'IE', initFreq: 1 }
const fts = { model_data: { parameters: [] }, fault_trees: [] }

beforeEach(() => localStorage.clear())

describe('localStore', () => {
  it('save 返回 8 位 hex id + ISO 时间戳', () => {
    const item = lsSave('案例A', { etModel: et, fts })
    expect(item.name).toBe('案例A')
    expect(item.id).toMatch(/^[0-9a-f]{8}$/)
    expect(item.saved_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('list 倒序返回元数据(新→旧), 无存档时为 []', () => {
    expect(lsList()).toEqual([])
    // 用假时钟给两次保存确定且不同的 saved_at, 真正验证「新→旧」排序
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-22T00:00:00Z'))
    const a = lsSave('A', { etModel: et, fts })
    vi.setSystemTime(new Date('2026-06-22T00:00:01Z'))
    const b = lsSave('B', { etModel: et, fts })
    vi.useRealTimers()
    expect(lsList().map((x) => x.id)).toEqual([b.id, a.id])
  })

  it('load 返回整条含 payload; 缺失抛错', () => {
    const a = lsSave('A', { etModel: et, fts })
    const rec = lsLoad(a.id)
    expect(rec.payload.etModel).toEqual(et)
    expect(rec.payload.fts).toEqual(fts)
    expect(() => lsLoad('deadbeef')).toThrow()
  })

  it('delete 删除后 load 抛错; 删缺失抛错', () => {
    const a = lsSave('A', { etModel: et, fts })
    lsDelete(a.id)
    expect(() => lsLoad(a.id)).toThrow()
    expect(() => lsDelete('deadbeef')).toThrow()
  })

  it('往返 save→list→load→delete', () => {
    const a = lsSave('round', { etModel: { x: 1 }, fts: { y: 2 } })
    expect(lsList().map((i) => i.id)).toContain(a.id)
    expect(lsLoad(a.id).payload).toEqual({ etModel: { x: 1 }, fts: { y: 2 } })
    lsDelete(a.id)
    expect(lsList().map((i) => i.id)).not.toContain(a.id)
  })

  it('save 带 id → 覆盖现有(不新增, 名称/内容更新)', () => {
    const a = lsSave('A', { etModel: et, fts })
    const b = lsSave('A改', { etModel: { ...et, initFreq: 2 }, fts }, a.id)
    expect(b.id).toBe(a.id)
    expect(lsList().length).toBe(1)
    expect(lsLoad(a.id).name).toBe('A改')
    expect(lsLoad(a.id).payload.etModel.initFreq).toBe(2)
  })

  it('存储里是坏 JSON → list 返回 []', () => {
    localStorage.setItem('bess-eta:saved:v1', '{not json')
    expect(lsList()).toEqual([])
  })

  it('坏 JSON → 隔离到 corrupt-* 侧键 + console.warn(不静默丢失)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    localStorage.setItem('bess-eta:saved:v1', '{not json')
    expect(lsList()).toEqual([])
    const corruptKey = Object.keys(localStorage).find((k) => k.startsWith('bess-eta:saved:v1:corrupt-'))
    expect(corruptKey).toBeTruthy()
    expect(localStorage.getItem(corruptKey!)).toBe('{not json')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('setItem 抛错(配额/隐私模式) → lsSave 抛可读错误', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    expect(() => lsSave('A', { etModel: et, fts })).toThrow(/本地存储/)
    spy.mockRestore()
  })

  it('setItem 抛错时 lsDelete 也抛可读错误(写回一致)', () => {
    const a = lsSave('A', { etModel: et, fts }) // 真实写入成功
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    expect(() => lsDelete(a.id)).toThrow(/本地存储/)
    spy.mockRestore()
  })
})
