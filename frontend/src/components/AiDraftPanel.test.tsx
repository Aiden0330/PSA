/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { AiDraftPanel } from './AiDraftPanel'
import type { AiDraftResponse } from '../aiDraft'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLDivElement | null = null

const draft = (ok: boolean): AiDraftResponse => ({
  draft_id: 'd1',
  summary: '液冷泄漏草案',
  assumptions: ['假设一'],
  questions: ['缺失 PFD'],
  etas: [],
  fts: { model_data: { parameters: [] }, fault_trees: [{ name: 'BMS_FT', top: 'TOP', nodes: [] }] },
  traceability: [{ item: 'BMS_FT', source: '参考库条目' }],
  warnings: ['风险提示一'],
  validation: { ok, errors: ok ? [] : ['bad pfd'], warnings: ['校验提示'] },
})

const etaDraft = (ok: boolean): AiDraftResponse => ({
  ...draft(ok),
  summary: '液冷泄漏 ETA 草案',
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
    fts: { model_data: { parameters: [] }, fault_trees: [] },
    pfds: {},
  }],
  fts: { model_data: { parameters: [] }, fault_trees: [] },
})

function render(ui: ReactElement): HTMLDivElement {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(ui))
  return host
}

function baseProps(patch: Partial<Parameters<typeof AiDraftPanel>[0]> = {}): Parameters<typeof AiDraftPanel>[0] {
  return {
    goal: '电池舱液冷泄漏导致外短',
    mode: 'new_eta',
    targetFeId: '',
    functionalEvents: [],
    draft: draft(false),
    busy: false,
    error: null,
    onGoalChange: vi.fn(),
    onModeChange: vi.fn(),
    onTargetFeIdChange: vi.fn(),
    onGenerate: vi.fn(),
    onApply: vi.fn(),
    onClose: vi.fn(),
    ...patch,
  }
}

afterEach(() => {
  if (root) act(() => root!.unmount())
  host?.remove()
  root = null
  host = null
})

describe('AiDraftPanel', () => {
  it('展示 assumptions、warnings、traceability,且校验失败时禁用应用', () => {
    const el = render(<AiDraftPanel {...baseProps()} />)
    expect(el.textContent).toContain('假设一')
    expect(el.textContent).toContain('风险提示一')
    expect(el.textContent).toContain('BMS_FT: 参考库条目')
    const apply = Array.from(el.querySelectorAll('button')).find((btn) => btn.textContent?.includes('应用草案')) as HTMLButtonElement
    expect(apply.disabled).toBe(true)
  })

  it('校验通过时允许应用草案', () => {
    const onApply = vi.fn()
    const el = render(<AiDraftPanel {...baseProps({
      mode: 'fta_for_barrier',
      targetFeId: 'B1',
      functionalEvents: [{ id: 'B1', label: 'BMS 隔离', failProb: 0.1 }],
      draft: draft(true),
      onApply,
    })} />)
    const apply = Array.from(el.querySelectorAll('button')).find((btn) => btn.textContent?.includes('应用草案')) as HTMLButtonElement
    expect(apply.disabled).toBe(false)
    act(() => apply.click())
    expect(onApply).toHaveBeenCalledTimes(1)
  })

  it('展示草案内容数量和应用去向', () => {
    const el = render(<AiDraftPanel {...baseProps({
      mode: 'fta_for_barrier',
      targetFeId: 'B1',
      functionalEvents: [{ id: 'B1', label: 'BMS 隔离', failProb: 0.1 }],
      draft: draft(true),
    })} />)

    expect(el.textContent).toContain('草案内容')
    expect(el.textContent).toContain('FTA 1')
    expect(el.textContent).toContain('将挂载到屏障: BMS 隔离')
  })

  it('生成中状态有可读提示', () => {
    const el = render(<AiDraftPanel {...baseProps({ busy: true, draft: null })} />)

    expect(el.textContent).toContain('生成中...')
    expect(el.textContent).toContain('正在生成 AI 草案')
  })

  it('ETA 草案预览显示名称和新增页签去向', () => {
    const el = render(<AiDraftPanel {...baseProps({ draft: etaDraft(true) })} />)

    expect(el.textContent).toContain('AI 液冷泄漏 ETA')
    expect(el.textContent).toContain('应用后将新增并切换到 ETA 页签')
  })

  it('FTA 草案预览显示名称、目标屏障和打开去向', () => {
    const el = render(<AiDraftPanel {...baseProps({
      mode: 'fta_for_barrier',
      targetFeId: 'B1',
      functionalEvents: [{ id: 'B1', label: 'BMS 隔离', failProb: 0.1 }],
      draft: draft(true),
    })} />)

    expect(el.textContent).toContain('BMS_FT')
    expect(el.textContent).toContain('挂载到屏障: BMS 隔离')
    expect(el.textContent).toContain('应用后将打开 FTA')
  })

  it('草案窗口展示只读 ETA/FTA 结构预览,用于应用前审视', () => {
    const etaEl = render(<AiDraftPanel {...baseProps({ draft: etaDraft(true) })} />)
    expect(etaEl.textContent).toContain('只读结构预览')
    expect(etaEl.textContent).toContain('初始事件')
    expect(etaEl.textContent).toContain('电池舱液冷泄漏导致外短')
    expect(etaEl.textContent).toContain('泄漏检测')
    expect(etaEl.textContent).toContain('成功 -> C1')
    expect(etaEl.textContent).toContain('失败 -> C4')

    act(() => root!.unmount())
    host?.remove()
    root = null
    host = null

    const ftaEl = render(<AiDraftPanel {...baseProps({
      mode: 'fta_for_barrier',
      targetFeId: 'B1',
      functionalEvents: [{ id: 'B1', label: 'BMS 隔离', failProb: 0.1 }],
      draft: draft(true),
    })} />)
    expect(ftaEl.textContent).toContain('只读结构预览')
    expect(ftaEl.textContent).toContain('BMS_FT')
    expect(ftaEl.textContent).toContain('TOP')
  })

  it('作为固定浮层渲染,不挤压 ETA 主工作区', () => {
    const el = render(<AiDraftPanel {...baseProps({ draft: etaDraft(true) })} />)
    const panel = el.querySelector('section') as HTMLElement
    const body = panel.children[1] as HTMLElement
    const review = body.children[1] as HTMLElement

    expect(panel.style.position).toBe('fixed')
    expect(panel.style.bottom).toBe('40px')
    expect(panel.style.zIndex).toBe('50')
    expect(body.style.overflow).toBe('hidden')
    expect(review.style.overflowY).toBe('auto')
  })
})


describe('截图转录 UI(2026-08-17)', () => {
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNgYGD4DwABBAEAX+XyJgAAAABJRU5ErkJggg=='
  it('缩略图渲染 + 移除回调 + 文件入口在场', () => {
    const onRemove = vi.fn()
    const el = render(<AiDraftPanel {...baseProps()}
      images={[{ name: 'rs-eta.png', media_type: 'image/png', data: PNG }]}
      onAddImages={() => {}} onRemoveImage={onRemove} />)
    expect(el.querySelector('[data-testid="ai-image-thumbs"]')?.textContent).toContain('rs-eta.png')
    expect(el.querySelector('[data-testid="ai-image-input"]')).toBeTruthy()
    ;(el.querySelector('[data-testid="ai-image-rm-0"]') as HTMLButtonElement).click()
    expect(onRemove).toHaveBeenCalledWith(0)
  })
  it('未接线(无 onAddImages)时零渲染——旧用法零扰动', () => {
    const el = render(<AiDraftPanel {...baseProps()} />)
    expect(el.querySelector('[data-testid="ai-image-input"]')).toBeNull()
  })
})
