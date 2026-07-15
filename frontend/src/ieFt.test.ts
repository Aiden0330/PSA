import { describe, it, expect, afterEach, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { addBasic, attachStarterFt, setParamKind, sharedIeBarrierEvents } from './model'
import type { ModelJson } from './model'
import { ftFrequency } from './api'
import { BarrierFtModal } from './components/BarrierFtModal'

/** 初因故障树前端纯层(规格 2026-07-13 §2.3):种子量纲、量纲切换、独立性护栏、频率客户端;
 *  逐初因精确开关(规格 2026-07-14 §4):请求带 method、响应 by_initiator 渲染。 */

// 精确渲染用例:桩掉重子组件(reactflow 画布/检视器/布局),只验证本模态自身标记(开关/结果表)。
vi.mock('./components/FaultTreeCanvas', () => ({ FaultTreeCanvas: () => null }))
vi.mock('./components/Palette', () => ({ Palette: () => null }))
vi.mock('./components/Inspector', () => ({ Inspector: () => null }))
vi.mock('./components/LibPicker', () => ({ LibPicker: () => null }))
vi.mock('./layout', () => ({ layoutFaultTree: () => ({ nodes: [], edges: [] }) }))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const EMPTY: ModelJson = { model_data: { parameters: [] }, fault_trees: [] }

afterEach(() => vi.unstubAllGlobals())

describe('attachStarterFt 频率种子', () => {
  it("kind='frequency' 时种子参数为频率量纲,值 = 当前手动 initFreq(迁移零意外)", () => {
    const m = attachStarterFt(EMPTY, '__init__', 4.2e-4, 'frequency')
    const p = m.model_data.parameters.find((x) => x.id === '__init___BE')
    expect(p?.kind).toBe('frequency')
    expect(p?.value).toBe(4.2e-4)
  })
  it('缺省仍是概率(屏障树行为逐位不变)', () => {
    const m = attachStarterFt(EMPTY, 'FE1', 0.1)
    expect(m.model_data.parameters.find((x) => x.id === 'FE1_BE')?.kind).toBe('probability')
  })
})

describe('addBasic / setParamKind', () => {
  it('addBasic 频率量纲建 F 前缀事件;setParamKind 可来回切换', () => {
    let m = attachStarterFt(EMPTY, '__init__', 1e-3, 'frequency')
    m = addBasic(m, '__init__', 2e-3, 'frequency')
    const freq = m.model_data.parameters.filter((p) => p.kind === 'frequency')
    expect(freq).toHaveLength(2)
    const fid = freq.find((p) => p.id !== '__init___BE')!.id
    expect(fid.startsWith('F')).toBe(true)
    m = setParamKind(m, fid, 'probability')
    expect(m.model_data.parameters.find((p) => p.id === fid)?.kind).toBe('probability')
  })
})

describe('sharedIeBarrierEvents 独立性护栏', () => {
  const fts = (shared: boolean): ModelJson => ({
    model_data: { parameters: [
      { id: 'F_BMS', kind: 'frequency', value: 1e-3 },
      { id: 'Q_SENSOR', kind: 'probability', value: 0.1 },
    ] },
    fault_trees: [
      { name: '__init__', top: 'TOP_I', nodes: [
        { id: 'F_BMS', basic: true, param_ref: 'F_BMS' },
        { id: shared ? 'Q_SENSOR' : 'Q_OTHER', basic: true, param_ref: shared ? 'Q_SENSOR' : 'Q_OTHER' },
        { id: 'TOP_I', op: 'and', args: ['F_BMS', shared ? 'Q_SENSOR' : 'Q_OTHER'] } ] },
      { name: 'FE1', top: 'TOP_B', nodes: [
        { id: 'Q_SENSOR', basic: true, param_ref: 'Q_SENSOR' },
        { id: 'TOP_B', op: 'or', args: ['Q_SENSOR'] } ] },
    ],
  })
  it('共享基本事件被点名(排序)', () => {
    expect(sharedIeBarrierEvents(fts(true))).toEqual(['Q_SENSOR'])
  })
  it('无共享 → 空数组(放行)', () => {
    expect(sharedIeBarrierEvents(fts(false))).toEqual([])
  })
  it('无 __init__ 树 → 空数组', () => {
    expect(sharedIeBarrierEvents(EMPTY)).toEqual([])
  })
})

describe('ftFrequency 客户端', () => {
  it('打对端点并返回频率;400 中文 detail 原样上抛(响亮)', async () => {
    const okJson = { frequency: 7e-4, cutsets: [{ events: ['F_BMS'], order: 1, frequency: 7e-4, initiator: 'F_BMS' }] }
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(okJson) }))
    vi.stubGlobal('fetch', fetchMock as any)
    const r = await ftFrequency({ x: 1 }, '__init__')
    expect(r.frequency).toBe(7e-4)
    const calls = fetchMock.mock.calls as unknown as [string, any][]
    expect(String(calls[0][0])).toContain('/ft/frequency')
    expect(JSON.parse(calls[0][1].body).fault_tree).toBe('__init__')

    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: false, status: 400,
      json: () => Promise.resolve({ detail: '频率树规则违规:cut set …' }),
    })) as any)
    await expect(ftFrequency({}, '__init__')).rejects.toThrow(/频率树规则违规/)
  })

  it("method='exact' 携带 method 且回传 by_initiator(精确口径)", async () => {
    const okJson = {
      frequency: 0.088, method: 'exact',
      cutsets: [
        { events: ['I', 'A'], order: 2, frequency: 0.06, initiator: 'I' },
        { events: ['I', 'B'], order: 2, frequency: 0.07, initiator: 'I' },
      ],
      by_initiator: [{ initiator: 'I', rate: 0.1, enabling_probability: 0.88, frequency: 0.088 }],
    }
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(okJson) }))
    vi.stubGlobal('fetch', fetchMock as any)
    const r = await ftFrequency({ x: 1 }, '__init__', 'exact')
    const body = JSON.parse((fetchMock.mock.calls as unknown as [string, any][])[0][1].body)
    expect(body.method).toBe('exact')
    expect(r.method).toBe('exact')
    expect(r.by_initiator).toHaveLength(1)
    expect(r.by_initiator![0]).toMatchObject({ initiator: 'I', rate: 0.1, enabling_probability: 0.88, frequency: 0.088 })
  })

  it('默认口径不带 method 键(sum,既有 sum 调用逐字节零扰动)', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ frequency: 7e-4, cutsets: [] }) }))
    vi.stubGlobal('fetch', fetchMock as any)
    await ftFrequency({}, '__init__')
    const body = JSON.parse((fetchMock.mock.calls as unknown as [string, any][])[0][1].body)
    expect('method' in body).toBe(false)
  })
})

describe('BarrierFtModal 逐初因精确渲染', () => {
  let root: Root | null = null
  let hostEl: HTMLDivElement | null = null
  afterEach(() => { if (root) act(() => root!.unmount()); hostEl?.remove(); root = null; hostEl = null })

  const model: ModelJson = {
    model_data: { parameters: [{ id: 'I_BE', kind: 'frequency', value: 0.1 }] },
    fault_trees: [{ name: '__init__', top: 'I_BE', nodes: [{ id: 'I_BE', basic: true, param_ref: 'I_BE' }] }],
  }
  const noopApi = { set: () => {}, undo: () => {}, redo: () => {}, canUndo: false, canRedo: false }
  const btn = (label: string) =>
    Array.from(hostEl!.querySelectorAll('button')).find((b) => b.textContent?.includes(label)) as HTMLButtonElement

  it('切到逐初因精确并计算:请求带 method=exact,by_initiator 行降序渲染,头条标注精确口径', async () => {
    const exactJson = {
      frequency: 0.088, method: 'exact',
      cutsets: [{ events: ['I_BE'], order: 1, frequency: 0.088, initiator: 'I_BE' }],
      by_initiator: [
        { initiator: 'I_BE', rate: 0.1, enabling_probability: 0.88, frequency: 0.088 },
        { initiator: 'J_BE', rate: 0.02, enabling_probability: 0.5, frequency: 0.01 },
      ],
    }
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(exactJson) }))
    vi.stubGlobal('fetch', fetchMock as any)

    hostEl = document.createElement('div'); document.body.appendChild(hostEl)
    root = createRoot(hostEl)
    act(() => root!.render(createElement(BarrierFtModal, { model, ftName: '__init__', api: noopApi, pfd: 0.1, onClose: () => {}, frequencyMode: true })))

    act(() => btn('逐初因精确').click())                                    // 切口径
    await act(async () => { btn('计算频率').click(); await new Promise((res) => setTimeout(res, 0)) })

    expect(hostEl.textContent).toContain('逐初因精确口径')                    // 头条口径标注切换
    expect(hostEl.textContent).toContain('P(使能)')                          // 逐初因表列头
    expect(hostEl.textContent).toContain('I_BE')
    expect(hostEl.textContent).toContain('J_BE')                             // 两初因行都渲染
    const body = JSON.parse((fetchMock.mock.calls as unknown as [string, any][])[0][1].body)
    expect(body.method).toBe('exact')                                       // 请求确带 exact 口径
    // 降序:I_BE(0.088)在 J_BE(0.01)之前
    const rowText = hostEl.textContent!
    expect(rowText.indexOf('I_BE')).toBeLessThan(rowText.indexOf('J_BE'))
  })
})
