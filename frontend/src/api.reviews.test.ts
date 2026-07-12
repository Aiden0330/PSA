import { describe, it, expect, afterEach, vi } from 'vitest'
import { listProjectReviews, submitReview, signReview, returnReview, addVersionComment } from './api'

afterEach(() => vi.unstubAllGlobals())

const PU = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'
const review = {
  id: 1, version_id: 3, content_hash: 'abcd1234ef', state: 'in_review',
  submitted_by: 'liqingchuan@bess-psa/0.1.0', submitted_at: '2026-07-12T08:00:00+00:00',
  decided_by: null, decided_at: null, note: null,
}

describe('Phase 5 评审 API 客户端', () => {
  it('submitReview 发正确载荷并返回评审状态', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(review) }))
    vi.stubGlobal('fetch', fetchMock as any)
    const r = await submitReview(PU, 3, 'Rev 12 送审')
    expect(r.state).toBe('in_review')
    const [url, init] = fetchMock.mock.calls[0] as any
    expect(String(url)).toContain(`/projects/${PU}/reviews`)
    expect(JSON.parse(init.body)).toEqual({ version_id: 3, note: 'Rev 12 送审' })
  })

  it('409 冲突 → 抛后端中文 detail(绝不静默回退 localStorage)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: false, status: 409,
      json: () => Promise.resolve({ detail: '已有送审中版本(单项目同一时刻至多一个送审中)' }),
    })) as any)
    await expect(submitReview(PU, 3)).rejects.toThrow(/已有送审中版本/)
    expect(localStorage.length).toBe(0)
  })

  it('signReview / returnReview 打到对应子路径', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ ...review, state: 'signed' }) }))
    vi.stubGlobal('fetch', fetchMock as any)
    await signReview(PU, 3, '同意')
    await returnReview(PU, 3, '补依据')
    expect(String(fetchMock.mock.calls[0][0])).toContain('/reviews/3/sign')
    expect(String(fetchMock.mock.calls[1][0])).toContain('/reviews/3/return')
  })

  it('网络不可达 → 显式抛错(评审无离线语义)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network down'))))
    await expect(listProjectReviews(PU)).rejects.toThrow()
    await expect(addVersionComment(PU, 3, '评论')).rejects.toThrow('network down')
  })
})
