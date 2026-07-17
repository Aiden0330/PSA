/** FE-07(a) 锚点:jget 走内置降级(embedded)时,响应必须携带可见来源 provenance,
 *  而非静默替换。命中服务器时无 provenance(source 隐含 server)。 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { getScenarios, getLibrary, provenanceOf } from './api'

afterEach(() => vi.unstubAllGlobals())

describe('jget 内置降级来源可见(FE-07a)', () => {
  it('网络 reject → 回退 embedded,响应带 provenance{source:embedded,reason}', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('fetch failed'))))
    const data = await getScenarios()
    expect(Array.isArray(data)).toBe(true)
    const prov = provenanceOf(data)
    expect(prov?.source).toBe('embedded')
    expect(prov?.reason).toContain('fetch failed')
    // provenance 非枚举:不污染 JSON 序列化/渲染
    expect(JSON.stringify(data)).not.toContain('__provenance')
  })

  it('服务器 500 → 也回退 embedded 但来源可见(不再"悄悄"切内置库)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) })) as unknown as typeof fetch)
    const lib = await getLibrary()
    expect(provenanceOf(lib)?.source).toBe('embedded')
    expect(provenanceOf(lib)?.reason).toContain('500')
  })

  it('服务器命中 → 用服务器数据,无 embedded provenance', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([{ id: 'X', name: 'srv' }]) })) as unknown as typeof fetch)
    const data = await getScenarios()
    expect(data[0].id).toBe('X')
    expect(provenanceOf(data)).toBeUndefined()
  })
})
