/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { activateOnKey, useDialogA11y } from './a11y'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('activateOnKey', () => {
  it('Enter 与 Space 触发 handler 并 preventDefault;其他键不触发', () => {
    const fn = vi.fn()
    const handler = activateOnKey(fn)
    const mk = (key: string) => {
      const e = { key, preventDefault: vi.fn() } as unknown as React.KeyboardEvent
      handler(e)
      return e
    }
    const enter = mk('Enter')
    expect(fn).toHaveBeenCalledTimes(1)
    expect(enter.preventDefault).toHaveBeenCalled()
    mk(' ')
    expect(fn).toHaveBeenCalledTimes(2)
    const tab = mk('Tab')
    expect(fn).toHaveBeenCalledTimes(2)
    expect(tab.preventDefault).not.toHaveBeenCalled()
  })
})

let root: Root | null = null
let host: HTMLDivElement | null = null

function Dialog({ onClose }: { onClose: () => void }) {
  const ref = useDialogA11y(onClose)
  return (
    <div ref={ref} role="dialog" aria-modal="true" tabIndex={-1}>
      <button data-autofocus>一</button>
      <button>二</button>
    </div>
  )
}

afterEach(() => {
  if (root) act(() => root!.unmount())
  host?.remove()
  root = null
  host = null
})

describe('useDialogA11y', () => {
  it('打开时聚焦 data-autofocus,Esc 调 onClose,卸载后焦点还给触发元素', () => {
    host = document.createElement('div')
    document.body.appendChild(host)
    const opener = document.createElement('button')
    opener.textContent = '打开'
    document.body.appendChild(opener)
    opener.focus()
    expect(document.activeElement).toBe(opener)

    const onClose = vi.fn()
    root = createRoot(host)
    act(() => root!.render(<Dialog onClose={onClose} />))

    const dialog = host.querySelector('[role="dialog"]') as HTMLElement
    const first = dialog.querySelector('button[data-autofocus]') as HTMLButtonElement
    expect(document.activeElement).toBe(first)

    act(() => { dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(onClose).toHaveBeenCalledTimes(1)

    act(() => root!.unmount())
    root = null
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })
})
