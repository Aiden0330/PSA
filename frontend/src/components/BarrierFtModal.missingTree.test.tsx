/**
 * @vitest-environment jsdom
 */
/** 白屏报障回归(2026-07-17):模态开着时命名树消失(撤销撤过「挂载」/树被删)——
 *  必须呈现可见说明 + 可关闭,绝不进画布(进了会经 getFt 回退误改别的树)、绝不抛。 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

// jsdom 无 ResizeObserver(reactflow 画布依赖);本套件只断言模态外壳/防御分支,画布置空即可
vi.mock('./FaultTreeCanvas', () => ({ FaultTreeCanvas: () => null }))

import { BarrierFtModal } from './BarrierFtModal'
import type { ModelJson } from '../model'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const api = { set: vi.fn(), undo: vi.fn(), redo: vi.fn(), canUndo: false, canRedo: false }

let root: Root | null = null
let host: HTMLDivElement | null = null

function render(model: ModelJson, ftName: string, onClose = vi.fn()) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(<BarrierFtModal model={model} ftName={ftName} api={api} onClose={onClose} />))
  return { host: host!, onClose }
}

afterEach(() => {
  if (root) act(() => root!.unmount())
  host?.remove()
  root = null
  host = null
})

describe('BarrierFtModal — 缺树防御(白屏回归)', () => {
  it('命名树不存在 → 可见 alertdialog 说明,点「关闭」触发 onClose,不渲染画布', () => {
    const empty: ModelJson = { model_data: { parameters: [] }, fault_trees: [] }
    const { host, onClose } = render(empty, 'B_BMS')
    const dlg = host.querySelector('[role="alertdialog"]')
    expect(dlg).toBeTruthy()
    expect(host.textContent).toContain('该故障树已不存在')
    expect(host.textContent).toContain('B_BMS')
    // 不应出现编辑器工具(调色板按钮)——防止误改 fault_trees[0]
    expect(host.textContent).not.toContain('OR 门')
    const closeBtn = [...host.querySelectorAll('button')].find((b) => b.textContent === '关闭')!
    act(() => closeBtn.click())
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('有别的树但名字不匹配 → 同样走缺树防御(不回退 fault_trees[0] 编辑错树)', () => {
    const m: ModelJson = {
      model_data: { parameters: [{ id: 'A', value: 0.1 }] },
      fault_trees: [{ name: 'OTHER', top: 'T', nodes: [
        { id: 'A', basic: true, param_ref: 'A' },
        { id: 'T', op: 'or', args: ['A'] }] }],
    } as unknown as ModelJson
    const { host } = render(m, 'B_BMS')
    expect(host.querySelector('[role="alertdialog"]')).toBeTruthy()
    expect(host.textContent).not.toContain('OR 门')
  })

  it('树存在 → 正常进编辑器(标题 + 调色板可见,零扰动)', () => {
    const m: ModelJson = {
      model_data: { parameters: [{ id: 'A', value: 0.1 }] },
      fault_trees: [{ name: 'B_BMS', top: 'T', nodes: [
        { id: 'A', basic: true, param_ref: 'A' },
        { id: 'T', op: 'or', args: ['A'] }] }],
    } as unknown as ModelJson
    const { host } = render(m, 'B_BMS')
    expect(host.textContent).toContain('编辑故障树:B_BMS')
    expect(host.textContent).toContain('OR 门')
    expect(host.querySelector('[role="alertdialog"]')).toBeFalsy()
  })
})
