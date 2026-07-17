/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('../../api', () => ({
  listAccounts: vi.fn().mockResolvedValue([]),
  createAccount: vi.fn(),
  setAccountDisabled: vi.fn(),
}))

import { AccountsPanel } from './AccountsPanel'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLDivElement | null = null

async function render(onClose = vi.fn()) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root!.render(<AccountsPanel onClose={onClose} />) })
  return { host: host!, onClose }
}

afterEach(() => {
  if (root) act(() => root!.unmount())
  host?.remove()
  root = null
  host = null
})

describe('AccountsPanel FE-13 对话框语义', () => {
  it('role=dialog + aria-modal + aria-labelledby 指向标题「账户管理」', async () => {
    const { host } = await render()
    const dialog = host.querySelector('[role="dialog"]') as HTMLElement
    expect(dialog).not.toBeNull()
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    const labId = dialog.getAttribute('aria-labelledby')!
    expect(document.getElementById(labId)?.textContent).toBe('账户管理')
  })

  it('Esc 调 onClose', async () => {
    const { host, onClose } = await render()
    const dialog = host.querySelector('[role="dialog"]') as HTMLElement
    act(() => { dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('卸载后焦点还给打开前持有焦点的元素', async () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    await render()
    act(() => root!.unmount())
    root = null
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })
})
