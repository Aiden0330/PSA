/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('./EChart', () => ({ EChart: () => null }))

import { ResultsPanel } from './ResultsPanel'
import type { QuantifyResult } from '../api'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const result: QuantifyResult = {
  probability: 0.02,
  method: 'exact',
  cutsets: [
    { events: ['A', 'B'], order: 2, probability: 0.012 },
    { events: ['C'], order: 1, probability: 0.008 },
  ],
  importance: { A: { fv: 0.5 }, B: { fv: 0.3 }, C: { fv: 0.2 } },
} as unknown as QuantifyResult

let root: Root | null = null
let host: HTMLDivElement | null = null

function render(onCutsetClick = vi.fn()) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(<ResultsPanel result={result} onCutsetClick={onCutsetClick} />))
  return { host: host!, onCutsetClick }
}

afterEach(() => {
  if (root) act(() => root!.unmount())
  host?.remove()
  root = null
  host = null
})

describe('ResultsPanel FE-13 键盘选择割集', () => {
  it('每条割集是 role=button 且可聚焦(有可访问名)', () => {
    const { host } = render()
    const btns = Array.from(host.querySelectorAll('[role="button"]'))
    expect(btns.length).toBe(2)
    expect(btns.every((b) => b.getAttribute('tabindex') === '0')).toBe(true)
    expect(btns[0].getAttribute('aria-label')).toContain('割集')
  })

  it('Space 在割集行上等效点击 → onCutsetClick(该割集事件)', () => {
    const { host, onCutsetClick } = render()
    const first = host.querySelector('[role="button"]') as HTMLElement
    act(() => { first.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })) })
    expect(onCutsetClick).toHaveBeenCalledWith(['A', 'B'])
  })
})
