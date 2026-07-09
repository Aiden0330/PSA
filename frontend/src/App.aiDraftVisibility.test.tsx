/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import App from './App'
import { draftAiModel } from './api'
import type { AiDraftResponse } from './aiDraft'
import { resetViewStore } from './stores/viewStore'
import { resetProjectStore } from './stores/projectStore'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
;(globalThis as typeof globalThis & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

const emptyFts = { model_data: { parameters: [] }, fault_trees: [] }

vi.mock('./api', () => ({
  getExamples: vi.fn().mockResolvedValue([]),
  getModel: vi.fn().mockResolvedValue({
    model: {
      model_data: { parameters: [{ id: 'P0', kind: 'probability', value: 0.01 }] },
      fault_trees: [{
        name: 'BMS',
        top: 'TOP',
        nodes: [
          { id: 'P0', basic: true, param_ref: 'P0' },
          { id: 'TOP', op: 'or', args: ['P0'] },
        ],
      }],
    },
    fault_tree: 'BMS',
  }),
  quantify: vi.fn().mockResolvedValue({ probability: 0.02, method: 'exact', cutsets: [], importance: {} }),
  getBessEventTree: vi.fn().mockResolvedValue({
    init_event: '默认初因',
    init_frequency: 0.001,
    functional_events: ['B1'],
    labels: { B1: 'BMS 隔离' },
    fe_prob: { B1: 0.1 },
    sequences: [],
    consequences: {},
    barrier_importance: [],
    fault_trees: {},
    parameters: [],
  }),
  getScenarios: vi.fn().mockResolvedValue([]),
  listSaved: vi.fn().mockResolvedValue([]),
  loadSaved: vi.fn(),
  saveWorkspace: vi.fn(),
  deleteSaved: vi.fn(),
  getLibrary: vi.fn().mockResolvedValue({
    meta: { disclaimer: '' },
    component_failure_rates: [],
    barrier_effectiveness: [],
    initiating_events: [],
  }),
  importMef: vi.fn(),
  wasSavedOffline: vi.fn(() => false),
  draftAiModel: vi.fn(),
  quantifyEventTree: vi.fn(),
  importanceEventTree: vi.fn(),
  exportReport: vi.fn(),
}))

let root: Root | null = null
let host: HTMLDivElement | null = null

function etaDraft(): AiDraftResponse {
  return {
    draft_id: 'eta-d1',
    summary: '液冷泄漏 ETA 草案',
    assumptions: ['待人工审核'],
    questions: [],
    etas: [{
      key: 'ai-coolant',
      name: 'AI 液冷泄漏 ETA',
      renamed: false,
      model: {
        initEvent: '电池舱液冷泄漏导致外短',
        initFreq: 0.001,
        functionalEvents: [{ id: 'D1', label: '泄漏检测', failProb: 0.05 }],
        root: {
          kind: 'branch',
          feId: 'D1',
          success: { kind: 'leaf', consequence: 'C1' },
          failure: { kind: 'leaf', consequence: 'C4' },
        },
      } as any,
      fts: emptyFts,
      pfds: {},
    }],
    fts: emptyFts,
    traceability: [],
    warnings: [],
    validation: { ok: true, errors: [], warnings: [] },
  }
}

function ftaDraft(): AiDraftResponse {
  return {
    draft_id: 'fta-d1',
    summary: 'BMS 隔离 FTA 草案',
    assumptions: ['待人工审核'],
    questions: [],
    etas: [],
    fts: {
      model_data: { parameters: [{ id: 'SENSOR', kind: 'probability', value: 0.02 }] },
      fault_trees: [{
        name: 'BMS_ISOLATION_FT',
        top: 'TOP',
        nodes: [
          { id: 'SENSOR', basic: true, param_ref: 'SENSOR' },
          { id: 'TOP', op: 'or', args: ['SENSOR'] },
        ],
      }],
    },
    traceability: [],
    warnings: [],
    validation: { ok: true, errors: [], warnings: [] },
  }
}

function renderApp(): HTMLDivElement {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(<App />))
  return host
}

async function waitFor(assertion: () => void): Promise<void> {
  const deadline = Date.now() + 2500
  let last: unknown
  while (Date.now() < deadline) {
    try {
      assertion()
      return
    } catch (e) {
      last = e
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
    }
  }
  throw last
}

function clickButton(text: string): void {
  const btn = Array.from(host!.querySelectorAll('button')).find((x) => x.textContent?.includes(text)) as HTMLButtonElement | undefined
  if (!btn) throw new Error(`button not found: ${text}`)
  act(() => btn.click())
}

function clickByTitle(title: string): void {
  const btn = host!.querySelector(`[title="${title}"]`) as HTMLButtonElement | null
  if (!btn) throw new Error(`button not found by title: ${title}`)
  act(() => btn.click())
}

afterEach(() => {
  if (root) act(() => root!.unmount())
  host?.remove()
  root = null
  host = null
  vi.mocked(draftAiModel).mockReset()
  // store 是模块级单例:跨用例重置,避免上个用例遗留的主页签/编辑目标/项目内容泄漏
  localStorage.clear()
  resetViewStore()
  resetProjectStore()
})

describe('App AI draft visibility', () => {
  it('AI 面板以浮层打开,不改变主框架溢出边界', async () => {
    const el = renderApp()

    await waitFor(() => expect(el.textContent).toContain('默认初因'))
    clickButton('AI 建模助手')

    const appRoot = el.firstElementChild as HTMLElement
    const panel = Array.from(el.querySelectorAll('section')).find((x) => x.textContent?.includes('AI 建模助手')) as HTMLElement | undefined
    expect(appRoot.style.overflow).toBe('hidden')
    expect(panel?.style.position).toBe('fixed')
    expect(panel?.style.bottom).toBe('40px')
  })

  it('应用 ETA 草案后显示新增 ETA 名称和 AI 新增标识', async () => {
    vi.mocked(draftAiModel).mockResolvedValueOnce(etaDraft())
    const el = renderApp()

    await waitFor(() => expect(el.textContent).toContain('默认初因'))
    clickButton('AI 建模助手')
    clickButton('生成草案')
    await waitFor(() => expect(el.textContent).toContain('应用后将新增并切换到 ETA 页签'))
    clickButton('应用草案')

    await waitFor(() => {
      expect(el.textContent).toContain('AI 液冷泄漏 ETA')
      expect(el.textContent).toContain('AI 新增')
    })
  })

  it('应用屏障 FTA 草案后切到 FTA 视图并标记刚生成项', async () => {
    vi.mocked(draftAiModel).mockResolvedValueOnce(ftaDraft())
    const el = renderApp()

    await waitFor(() => expect(el.textContent).toContain('默认初因'))
    clickButton('AI 建模助手')
    clickButton('为当前屏障生成 FTA')
    clickButton('生成草案')
    await waitFor(() => expect(el.textContent).toContain('应用后将打开 FTA'))
    clickButton('应用草案')

    await waitFor(() => {
      expect(el.textContent).toContain('ETA 挂载 FTA')
      expect(el.textContent).toContain('BMS 隔离')
      expect(el.textContent).toContain('故障树: B1')
      expect(el.textContent).toContain('刚生成')
    })
  })

  it('生成 FTA 草案后即使切换 ETA,应用时仍挂到生成草案时的 ETA', async () => {
    vi.mocked(draftAiModel).mockResolvedValueOnce(ftaDraft())
    const el = renderApp()

    await waitFor(() => expect(el.textContent).toContain('默认初因'))
    clickButton('AI 建模助手')
    clickButton('为当前屏障生成 FTA')
    clickButton('生成草案')
    await waitFor(() => expect(el.textContent).toContain('应用后将打开 FTA'))

    clickByTitle('新建 ETA')
    await waitFor(() => expect(el.textContent).toContain('自定义 ETA 2'))
    clickButton('应用草案')

    await waitFor(() => {
      expect(el.textContent).toContain('默认初因')
      expect(el.textContent).toContain('BMS 隔离')
      expect(el.textContent).toContain('故障树: B1')
      expect(el.textContent).not.toContain('故障树: FE1')
    })
  })
})
