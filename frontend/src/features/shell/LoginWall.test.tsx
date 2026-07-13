/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { LoginWall } from './LoginWall'
import { useAuthStore, resetAuthStore } from '../../stores/authStore'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLDivElement | null = null

const render = async () => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root!.render(<LoginWall />) })
}

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  vi.unstubAllGlobals()
  resetAuthStore()
})

const okJson = (data: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data) })
const status = (code: number, detail: unknown) => Promise.resolve({ ok: false, status: code, json: () => Promise.resolve({ detail }) })

describe('LoginWall', () => {
  it('提交前禁用登录按钮;填写后可提交,成功登录后 authStore.identity 落位', async () => {
    await render()
    const btn = host!.querySelector('button[type="submit"]') as HTMLButtonElement
    expect(btn.disabled).toBe(true)

    const [uname, pw] = Array.from(host!.querySelectorAll('input'))
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
    setter.call(uname, 'wang'); uname.dispatchEvent(new Event('input', { bubbles: true }))
    setter.call(pw, 'review-pw-1'); pw.dispatchEvent(new Event('input', { bubbles: true }))
    expect(btn.disabled).toBe(false)

    vi.stubGlobal('fetch', vi.fn(() => okJson({ mode: 'local', username: 'wang', role: 'reviewer', display_name: '王雪梅' })) as any)
    await act(async () => { btn.click(); await new Promise((r) => setTimeout(r, 0)) })

    expect(useAuthStore.getState().identity?.username).toBe('wang')
  })

  it('登录失败 → 错误文案渲染,不抛未捕获异常', async () => {
    await render()
    const [uname, pw] = Array.from(host!.querySelectorAll('input'))
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
    setter.call(uname, 'wang'); uname.dispatchEvent(new Event('input', { bubbles: true }))
    setter.call(pw, 'wrong'); pw.dispatchEvent(new Event('input', { bubbles: true }))

    vi.stubGlobal('fetch', vi.fn(() => status(401, '用户名或口令错误')) as any)
    const btn = host!.querySelector('button[type="submit"]') as HTMLButtonElement
    await act(async () => { btn.click(); await new Promise((r) => setTimeout(r, 0)) })

    expect(host!.textContent).toContain('用户名或口令错误')
  })
})
