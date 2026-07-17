/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { SaveConflictDialog } from './SaveConflictDialog'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLDivElement | null = null

function makePersistence(dismiss = vi.fn()) {
  return {
    conflict: { baseHash: 'aaaaaaaa11', serverHash: 'bbbbbbbb22' },
    dismissConflict: dismiss,
    resolveConflictSaveAsCopy: vi.fn(),
    resolveConflictOverwrite: vi.fn(),
  } as any
}

function render(persistence: any) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(<SaveConflictDialog persistence={persistence} onGoToDiff={vi.fn()} />))
  return host
}

afterEach(() => {
  if (root) act(() => root!.unmount())
  host?.remove()
  root = null
  host = null
})

describe('SaveConflictDialog FE-13 对话框语义', () => {
  it('role=dialog + aria-modal + aria-labelledby 指向标题「保存冲突」', () => {
    const el = render(makePersistence())
    const dialog = el.querySelector('[role="dialog"]') as HTMLElement
    expect(dialog).not.toBeNull()
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    const labId = dialog.getAttribute('aria-labelledby')!
    expect(document.getElementById(labId)?.textContent).toBe('保存冲突')
  })

  it('Esc 等效「取消,先不保存」→ dismissConflict', () => {
    const dismiss = vi.fn()
    const el = render(makePersistence(dismiss))
    const dialog = el.querySelector('[role="dialog"]') as HTMLElement
    act(() => { dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(dismiss).toHaveBeenCalledTimes(1)
  })
})
