/**
 * @vitest-environment jsdom
 */
/** 白屏报障回归(2026-07-17):模态开着时命名树消失(撤销撤过「挂载」/树被删)——
 *  必须呈现可见说明 + 可关闭,绝不进画布(进了会经 getFt 回退误改别的树)、绝不抛。 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, useReducer, useRef } from 'react'
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

/** 有状态渲染:api.set 落到一个 ref(同步 apply updater,即写即生效——真实 projectStore
 *  是 Zustand,set() 同步跑 updater,不是 React useState 的延迟队列语义;若用 useState 桩,
 *  BarrierFtModal 内「api.set 后紧跟着读栈」的时序会对不上,读到 setState 排队前的旧值),
 *  + 一个 bump 触发重渲染,让「点按钮→模型变→重渲染」在测试里真实、同步地发生
 *  (不像上面的缺树套件用纯 vi.fn() 桩)。getModel() 读 ref 当前值,act() 内 click 后即最新。 */
function renderStateful(initial: ModelJson, ftName: string) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  let modelRef: { current: ModelJson } | null = null
  function Harness() {
    const ref = useRef<ModelJson>(initial)
    modelRef = ref
    const [, bump] = useReducer((n: number) => n + 1, 0)
    const statefulApi = {
      set: (u: ModelJson | ((prev: ModelJson) => ModelJson)) => {
        ref.current = typeof u === 'function' ? (u as (prev: ModelJson) => ModelJson)(ref.current) : u
        bump()
      },
      undo: vi.fn(), redo: vi.fn(), canUndo: false, canRedo: false,
    }
    return <BarrierFtModal model={ref.current} ftName={ftName} api={statefulApi} onClose={vi.fn()} />
  }
  act(() => root!.render(<Harness />))
  return { host: host!, getModel: () => modelRef!.current }
}

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

describe('BarrierFtModal — 本地撤销限定树内(特性 2:↶ 不越过「挂载」边界)', () => {
  it('模态内 ↶ 只撤本次树内编辑(节点数回退,树仍存在);栈空后 disabled;↷ 对称恢复', () => {
    const initial: ModelJson = {
      model_data: { parameters: [{ id: 'A', kind: 'probability', value: 0.1 }] },
      fault_trees: [{ name: 'B_BMS', top: 'T', nodes: [
        { id: 'T', op: 'or', args: ['A'] },
        { id: 'A', basic: true, param_ref: 'A' },
      ] }],
    } as unknown as ModelJson
    const { host, getModel } = renderStateful(initial, 'B_BMS')
    const nodeCount = () => getModel().fault_trees[0].nodes.length
    const btn = (title: string) => [...host.querySelectorAll('button')].find((b) => b.title.startsWith(title))!

    expect(nodeCount()).toBe(2)

    // 点「基本事件」(调色板 onAddBasic)→ 树内新增一个基本事件节点
    const addBasicBtn = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('基本事件'))!
    act(() => addBasicBtn.click())
    expect(nodeCount()).toBe(3)
    expect(btn('撤销').disabled).toBe(false)

    // 模态内 ↶:节点数回到 2,且树仍存在(不出现「该故障树已不存在」防御文案)
    act(() => btn('撤销').click())
    expect(nodeCount()).toBe(2)
    expect(host.querySelector('[role="alertdialog"]')).toBeFalsy()
    expect(host.textContent).not.toContain('该故障树已不存在')

    // 本地栈已空 → 再 ↶ 应 disabled(不会误越过「挂载」边界去撤项目级历史)
    expect(btn('撤销').disabled).toBe(true)

    // ↷ 对称恢复到 3
    expect(btn('重做').disabled).toBe(false)
    act(() => btn('重做').click())
    expect(nodeCount()).toBe(3)
    expect(btn('重做').disabled).toBe(true)
  })
})
