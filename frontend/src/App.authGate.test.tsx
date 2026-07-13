/**
 * @vitest-environment jsdom
 * B4 认证门(security-critical):local 模式未登录时,渲染 LoginWall 而非应用壳,
 * 且壳内数据获取(存档列表/场景/默认项目引导等)一律不触发 —— 避免预登录网络噪音,
 * 也避免任何编辑器内容在登录前泄露到 DOM。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import App from './App'
import { resetAuthStore } from './stores/authStore'
import { resetViewStore } from './stores/viewStore'
import { resetProjectStore } from './stores/projectStore'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLDivElement | null = null

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  vi.unstubAllGlobals()
  resetAuthStore()
  resetViewStore()
  resetProjectStore()
})

describe('App 认证门', () => {
  it('local 模式未登录(/auth/me 401)→ 渲染登录墙,不挂载应用壳,不发起其余网络请求', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      calls.push(String(url))
      if (String(url).includes('/auth/me')) {
        return Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({ detail: '未登录' }) })
      }
      return Promise.reject(new Error(`unexpected fetch in login-gated state: ${url}`))
    }) as any)

    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => { root!.render(<App />); await new Promise((r) => setTimeout(r, 0)) })

    expect(host.textContent).toContain('登录')
    expect(host.querySelector('input[placeholder="用户名"]')).toBeTruthy()
    expect(host.textContent).not.toContain('事件树（ETA）')     // 应用壳(含页签导航)未挂载
    expect(calls.every((u) => u.includes('/auth/me'))).toBe(true)   // 唯一发出的请求是身份检查
  })
})
