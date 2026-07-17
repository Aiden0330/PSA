/**
 * @vitest-environment jsdom
 * FE-06 锚点(组件级 deferred-promise 时序):
 *  - A 慢 B 快 → 三类台账只显 B(切项目后迟到响应不串项目);
 *  - 任意证据链 API 401 → 进重认证(needsLogin=true)且绝不呈现为"暂无数据";
 *  - 签发口令在取消/遮罩/确认/切项目关闭路径清除。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ReportDossier } from './ReportDossier'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type ReadFn = (uuid: string) => Promise<unknown[]>
const h = vi.hoisted<{ versionsFor: ReadFn; casesFor: ReadFn; reviewsFor: ReadFn }>(() => ({
  versionsFor: () => Promise.resolve([]),
  casesFor: () => Promise.resolve([]),
  reviewsFor: () => Promise.resolve([]),
}))

vi.mock('../../api', () => {
  class StatusError extends Error {
    status: number
    constructor(status: number, message?: string) { super(message); this.name = 'StatusError'; this.status = status }
  }
  return {
    StatusError,
    listProjectVersions: vi.fn((uuid: string) => h.versionsFor(uuid)),
    listProjectCases: vi.fn((uuid: string) => h.casesFor(uuid)),
    listProjectReviews: vi.fn((uuid: string) => h.reviewsFor(uuid)),
    listVersionComments: vi.fn(async () => []),
    addVersionComment: vi.fn(async () => ({ id: 1, author: 'a@x', created_at: '', body: 'x' })),
    diffProjectVersions: vi.fn(async () => ({ from: {}, to: {}, changes: [], summary: { added: 0, removed: 0, changed: 0 } })),
    exportReport: vi.fn(async () => {}),
    submitReview: vi.fn(async () => ({})),
    signReview: vi.fn(async () => ({})),
    returnReview: vi.fn(async () => ({})),
  }
})
import { StatusError, signReview } from '../../api'
import { resetProjectStore } from '../../stores/projectStore'
import { resetAuthStore, useAuthStore } from '../../stores/authStore'

const V = (id: number, hash: string) => ({
  id, content_hash: hash, parent_version_id: null,
  created_at: '2026-07-12T08:00:00', actor: 'u@x', origin: 'save', message: null,
})
const inReview = (vid: number, hash: string) => ({
  id: vid + 100, version_id: vid, content_hash: hash, state: 'in_review',
  submitted_by: 's@x', submitted_at: '2026-07-12', decided_by: null, decided_at: null, note: null,
})

function defer<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

let root: Root | null = null
let host: HTMLDivElement | null = null
const persistence = (pu: string | undefined) => ({ projectUuid: pu, buildPayload: () => ({}) }) as unknown as import('../persistence/useProjectPersistence').ProjectPersistence
const flush = async () => { await act(async () => {}); await act(async () => {}) }
const renderAt = async (pu: string | undefined) => {
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root!.render(<ReportDossier persistence={persistence(pu)} />) })
  await flush()
}
const rerenderAt = async (pu: string | undefined) => {
  await act(async () => { root!.render(<ReportDossier persistence={persistence(pu)} />) })
  await flush()
}
const text = () => host!.textContent ?? ''
const buttons = () => Array.from(host!.querySelectorAll('button'))
const click = async (label: string) => {
  const b = buttons().find((x) => x.textContent?.trim() === label || x.textContent?.includes(label))
  expect(b, `button ${label}`).toBeTruthy()
  await act(async () => { b!.click() })
  await flush()
}
const pwInput = () => host!.querySelector('input[type="password"]') as HTMLInputElement | null
const typeInto = async (el: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  await act(async () => { setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
}

beforeEach(() => {
  resetProjectStore(); resetAuthStore()
  h.versionsFor = async () => []; h.casesFor = async () => []; h.reviewsFor = async () => []
})
afterEach(() => {
  act(() => root?.unmount()); host?.remove(); root = null; host = null
  vi.clearAllMocks()
})

describe('FE-06 证据链页竞态 + 401', () => {
  it('A 慢 B 快:切项目后迟到的 A 响应不落入 B 的台账(只显 B)', async () => {
    const slowA = defer<unknown[]>()
    const never = () => new Promise<unknown[]>(() => {})
    h.versionsFor = (uuid) => (uuid === 'A' ? slowA.promise : Promise.resolve([V(9, 'bbbb2222cccc')]))
    h.casesFor = (uuid) => (uuid === 'A' ? never() : Promise.resolve([]))
    h.reviewsFor = (uuid) => (uuid === 'A' ? never() : Promise.resolve([]))

    await renderAt('A')                       // A 发起(版本读悬挂)
    await rerenderAt('B')                      // 切 B,B 立即返回
    expect(text()).toContain('bbbb2222')       // B 的版本已显示
    await act(async () => { slowA.resolve([V(1, 'aaaa1111dddd')]) })   // A 的慢响应此刻返回
    await flush()
    expect(text()).toContain('bbbb2222')       // 仍是 B
    expect(text()).not.toContain('aaaa1111')   // A 的迟到响应被守卫丢弃(不串项目)
  })

  it('任意证据链读 401 → needsLogin=true 且不呈现"暂无数据"', async () => {
    h.versionsFor = async () => { throw new StatusError(401, '未登录') }
    h.casesFor = async () => { throw new StatusError(401, '未登录') }
    h.reviewsFor = async () => { throw new StatusError(401, '未登录') }
    await renderAt('A')
    expect(useAuthStore.getState().needsLogin).toBe(true)     // 重认证界面(App 据此弹登录墙)
    expect(text()).toContain('登录已过期')                     // 读失败态可见
    expect(text()).not.toContain('暂无版本')                   // 绝不把 401 伪装成"暂无数据"
    expect(text()).not.toContain('暂无分析案例')
  })

  it('403 → 显式无权限,不进登录墙、不呈现"暂无"', async () => {
    h.versionsFor = async () => { throw new StatusError(403, '无权限') }
    h.casesFor = async () => { throw new StatusError(403, '无权限') }
    h.reviewsFor = async () => { throw new StatusError(403, '无权限') }
    await renderAt('A')
    expect(useAuthStore.getState().needsLogin).toBe(false)
    expect(text()).toContain('无权限(403)')
    expect(text()).not.toContain('暂无版本')
  })
})

describe('FE-06 签发口令在所有关闭路径清除', () => {
  beforeEach(() => {
    // local 模式 + reviewer → 渲染口令输入且可签发
    useAuthStore.setState({ identity: { mode: 'local', username: 'u', role: 'reviewer', display_name: null }, status: 'ready', needsLogin: false, loginError: null })
    h.versionsFor = async () => [V(3, 'eeee3333ffff')]
    h.reviewsFor = async () => [inReview(3, 'eeee3333ffff')]
    h.casesFor = async () => []
  })

  const openSign = async () => { await click('签发…') }

  it('取消 → 口令清除(重开为空)', async () => {
    await renderAt('A')
    await openSign()
    await typeInto(pwInput()!, 'secret-1')
    expect(pwInput()!.value).toBe('secret-1')
    await click('取消')
    expect(pwInput()).toBeNull()               // 弹窗关闭
    await openSign()
    expect(pwInput()!.value).toBe('')          // 重开:口令已清
  })

  it('确认签发 → 调用 signReview 且口令清除', async () => {
    await renderAt('A')
    await openSign()
    await typeInto(pwInput()!, 'secret-2')
    await click('确认签发')
    expect(signReview).toHaveBeenCalledWith('A', 3, undefined, 'secret-2')
    await openSign()
    expect(pwInput()!.value).toBe('')
  })

  it('切项目 → 签发弹窗关闭、口令清除(不跨项目复用)', async () => {
    await renderAt('A')
    await openSign()
    await typeInto(pwInput()!, 'secret-3')
    await rerenderAt('B')                       // 切到 B(无在审版本)
    expect(pwInput()).toBeNull()               // 弹窗随切项目关闭
    await rerenderAt('A')                       // 切回 A
    await openSign()
    expect(pwInput()!.value).toBe('')          // 口令已清,未复用
  })
})
