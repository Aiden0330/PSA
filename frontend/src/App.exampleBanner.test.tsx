/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import App from './App'
import { resetViewStore, useViewStore } from './stores/viewStore'
import { resetProjectStore } from './stores/projectStore'
import { resetAuthStore } from './stores/authStore'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
;(globalThis as typeof globalThis & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver = class {
  observe() {} unobserve() {} disconnect() {}
} as unknown as typeof ResizeObserver

// 隔离 FE-09 横幅(App.tsx 的 params 块贡献),用桩件替换 ParamLibrary,避免把 ag-grid 拖进 jsdom
vi.mock('./components/ParamLibrary', () => ({ ParamLibrary: () => <div>PARAM_STUB</div> }))

vi.mock('./api', () => ({
  getMe: vi.fn().mockResolvedValue({ mode: 'off', username: 'root', role: 'admin', display_name: null }),
  getExamples: vi.fn().mockResolvedValue([]),
  getModel: vi.fn().mockResolvedValue({
    model: { model_data: { parameters: [{ id: 'P0', kind: 'probability', value: 0.01 }] }, fault_trees: [] },
    fault_tree: 'BMS',
  }),
  getScenarios: vi.fn().mockResolvedValue([]),
  listSaved: vi.fn().mockResolvedValue([]),
  getBessEventTree: vi.fn().mockResolvedValue({
    init_event: '默认初因', init_frequency: 0.001, functional_events: ['B1'], labels: { B1: 'BMS' },
    fe_prob: { B1: 0.1 }, sequences: [], consequences: {}, barrier_importance: [], fault_trees: {}, parameters: [],
  }),
  getLibrary: vi.fn().mockResolvedValue({ meta: { disclaimer: '' }, component_failure_rates: [], barrier_effectiveness: [], initiating_events: [] }),
  wasSavedOffline: vi.fn(() => false),
}))

let root: Root | null = null
let host: HTMLDivElement | null = null

async function waitFor(assertion: () => void): Promise<void> {
  const deadline = Date.now() + 15000
  let last: unknown
  while (Date.now() < deadline) {
    try { assertion(); return } catch (e) {
      last = e
      await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    }
  }
  throw last
}

afterEach(() => {
  if (root) act(() => root!.unmount())
  host?.remove()
  root = null
  host = null
  localStorage.clear()
  resetViewStore()
  resetProjectStore()
  resetAuthStore()
})

describe('App FE-09 示例模型横幅', () => {
  it('参数页顶部显示醒目横幅:改动不进入当前项目与报告', async () => {
    useViewStore.setState({ tab: 'params' })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root!.render(<App />))

    await waitFor(() => {
      const note = host!.querySelector('[role="note"]')
      expect(note).not.toBeNull()
      expect(note!.textContent).toContain('示例模型')
      expect(note!.textContent).toContain('改动不进入当前项目与报告')
    })
  })
})
