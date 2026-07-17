/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { SequencePaths } from './SequencePaths'
import type { SeqRow } from './SequencePaths'
import type { EventTreeModel } from '../eventtree'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const model: EventTreeModel = {
  initEvent: '外短',
  initFreq: 0.001,
  functionalEvents: [{ id: 'B1', label: 'BMS 隔离', failProb: 0.1 }],
  root: { kind: 'branch', feId: 'B1', success: { kind: 'leaf', consequence: 'C1' }, failure: { kind: 'leaf', consequence: 'C4' } },
}
const rows: SeqRow[] = [
  { i: 0, seq: 1, lf: { path: ['failure'] }, freq: 1e-4, c: 'C4', path: [{ feId: 'B1', outcome: 'failure' }] },
  { i: 1, seq: 2, lf: { path: ['success'] }, freq: 9e-4, c: 'C1', path: [{ feId: 'B1', outcome: 'success' }] },
]

let root: Root | null = null
let host: HTMLDivElement | null = null

function render(onSelect = vi.fn()) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(<SequencePaths rows={rows} model={model} selKey=" " onSelect={onSelect} />))
  return { host: host!, onSelect }
}

afterEach(() => {
  if (root) act(() => root!.unmount())
  host?.remove()
  root = null
  host = null
})

describe('SequencePaths FE-13 键盘选择', () => {
  it('每条序列是 role=button 且可聚焦', () => {
    const { host } = render()
    const btns = Array.from(host.querySelectorAll('[role="button"]'))
    expect(btns.length).toBe(2)
    expect(btns.every((b) => b.getAttribute('tabindex') === '0')).toBe(true)
    expect(btns.every((b) => (b.getAttribute('aria-label') ?? '').length > 0)).toBe(true)
  })

  it('Enter 在序列行上等效点击 → onSelect(该路径)', () => {
    const { host, onSelect } = render()
    const first = host.querySelector('[role="button"]') as HTMLElement
    act(() => { first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(onSelect).toHaveBeenCalledTimes(1)
    // 行按 freq 降序:首行是 seq 2(success, 9e-4)
    expect(onSelect).toHaveBeenCalledWith(['success'])
  })
})
