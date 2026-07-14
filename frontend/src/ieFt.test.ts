import { describe, it, expect, afterEach, vi } from 'vitest'
import { addBasic, attachStarterFt, setParamKind, sharedIeBarrierEvents } from './model'
import type { ModelJson } from './model'
import { ftFrequency } from './api'

/** 初因故障树前端纯层(规格 2026-07-13 §2.3):种子量纲、量纲切换、独立性护栏、频率客户端。 */

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
})
