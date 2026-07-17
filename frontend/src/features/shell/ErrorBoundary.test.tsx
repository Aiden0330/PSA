/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ErrorBoundary } from './ErrorBoundary'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLDivElement | null = null

function Boom(): JSX.Element {
  throw new Error('chunk load failed')
}

afterEach(() => {
  if (root) act(() => root!.unmount())
  host?.remove()
  root = null
  host = null
  vi.restoreAllMocks()
})

describe('ErrorBoundary', () => {
  it('子树抛错时渲染可见兜底文案 + 重试按钮(不留白屏)', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root!.render(<ErrorBoundary><Boom /></ErrorBoundary>))

    const alert = host.querySelector('[role="alert"]')
    expect(alert).not.toBeNull()
    expect(host.textContent).toContain('模块加载失败')
    const retry = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('重试'))
    expect(retry).toBeTruthy()
  })

  it('正常子树原样透传', () => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root!.render(<ErrorBoundary><div>正常内容</div></ErrorBoundary>))
    expect(host.textContent).toContain('正常内容')
    expect(host.querySelector('[role="alert"]')).toBeNull()
  })
})
