/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { EtCanvas } from './EtCanvas'
import type { EventTreeModel } from '../../eventtree'
import type { SeqRow } from './types'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
;(globalThis as typeof globalThis & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

const model: EventTreeModel = {
  initEvent: '外短',
  initFreq: 0.001,
  functionalEvents: [{ id: 'B1', label: 'BMS 隔离', failProb: 0.1 }],
  root: { kind: 'branch', feId: 'B1', success: { kind: 'leaf', consequence: 'C1' }, failure: { kind: 'leaf', consequence: 'C4' } },
}
const seqRows = [{ freq: 9e-4 }, { freq: 1e-4 }] as unknown as SeqRow[]

function Harness({ onSelect }: { onSelect: (p: string[] | null) => void }) {
  const ref = useRef<SVGSVGElement>(null)
  return <EtCanvas model={model} seqRows={seqRows} sel={null} onSelect={onSelect} onChange={vi.fn()} svgRef={ref} />
}

let root: Root | null = null
let host: HTMLDivElement | null = null

function render(onSelect = vi.fn()) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(<Harness onSelect={onSelect} />))
  return { host: host!, onSelect }
}

afterEach(() => {
  if (root) act(() => root!.unmount())
  host?.remove()
  root = null
  host = null
})

describe('EtCanvas FE-13 SVG 键盘可达', () => {
  it('叶节点与分支锚点提供可聚焦等价控件(role=button + tabindex + aria-label)', () => {
    const { host } = render()
    const focusables = Array.from(host.querySelectorAll('.psa-svg-focus'))
    // 2 叶 + 1 分支锚点 = 3 个可聚焦交互节点
    expect(focusables.length).toBe(3)
    expect(focusables.every((el) => el.getAttribute('role') === 'button')).toBe(true)
    expect(focusables.every((el) => el.getAttribute('tabindex') === '0')).toBe(true)
    expect(focusables.every((el) => (el.getAttribute('aria-label') ?? '').length > 0)).toBe(true)
  })

  it('Enter 在叶节点上等效点击 → onSelect(该末态路径)', () => {
    const { host, onSelect } = render()
    const leaf = Array.from(host.querySelectorAll('g.psa-svg-focus'))[0] as SVGGElement
    act(() => { leaf.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(onSelect).toHaveBeenCalledTimes(1)
    const arg = onSelect.mock.calls[0][0]
    expect(Array.isArray(arg)).toBe(true)
    expect(arg.length).toBe(1)
  })
})
