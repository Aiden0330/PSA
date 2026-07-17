/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { CommandPalette } from './CommandPalette'
import { useViewStore, resetViewStore } from '../../stores/viewStore'
import { resetProjectStore } from '../../stores/projectStore'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const persistence = { saved: [], loadProject: vi.fn(), onSaveWorkspace: vi.fn(), onSaveAs: vi.fn(), onExportFile: vi.fn() } as any

let root: Root | null = null
let host: HTMLDivElement | null = null

function render() {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(<CommandPalette scenarios={[]} summaries={[]} persistence={persistence} onOpenScenario={vi.fn()} />))
  return host
}

beforeEach(() => { resetProjectStore(); resetViewStore(); useViewStore.setState({ paletteOpen: true }) })
afterEach(() => {
  if (root) act(() => root!.unmount())
  host?.remove()
  root = null
  host = null
  resetViewStore()
  resetProjectStore()
})

describe('CommandPalette FE-13 对话框语义', () => {
  it('面板为 role=dialog + aria-modal + 有可访问名', () => {
    const el = render()
    const dialog = el.querySelector('[role="dialog"]') as HTMLElement
    expect(dialog).not.toBeNull()
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-label')).toBeTruthy()
  })

  it('打开时焦点落入搜索框(data-autofocus)', () => {
    const el = render()
    const input = el.querySelector('input[data-autofocus]') as HTMLInputElement
    expect(input).not.toBeNull()
    expect(document.activeElement).toBe(input)
  })

  it('Esc 键关闭命令板', () => {
    const el = render()
    const dialog = el.querySelector('[role="dialog"]') as HTMLElement
    act(() => { dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(useViewStore.getState().paletteOpen).toBe(false)
  })
})
