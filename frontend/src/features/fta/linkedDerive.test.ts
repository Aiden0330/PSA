/** FE-03 锚点:初因树只走频率端点;共享事件不做两段式;错误上抛不吞。 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../api', () => ({
  ftFrequency: vi.fn(async () => ({ frequency: 0.0123 })),
  quantify: vi.fn(async () => ({ probability: 0.4 })),
}))

import { ftFrequency, quantify } from '../../api'
import { deriveLinkedValue } from './linkedDerive'
import { INIT_FREQ_KEY } from '../../stores/derived'
import type { ModelJson } from '../../model'

const ieOnly: ModelJson = {
  model_data: { parameters: [{ id: 'I', kind: 'frequency', value: 1e-3 }] },
  fault_trees: [{ name: '__init__', top: 'T', nodes: [
    { id: 'I', basic: true, param_ref: 'I' },
    { id: 'T', op: 'or', args: ['I'] }] }],
}

const sharedModel: ModelJson = {
  model_data: { parameters: [
    { id: 'I', kind: 'frequency', value: 1e-3 },
    { id: 'S', kind: 'probability', value: 0.2 }] },
  fault_trees: [
    { name: '__init__', top: 'T', nodes: [
      { id: 'I', basic: true, param_ref: 'I' },
      { id: 'S', basic: true, param_ref: 'S' },
      { id: 'T', op: 'and', args: ['I', 'S'] }] },
    { name: 'B', top: 'BT', nodes: [
      { id: 'S', basic: true, param_ref: 'S' },
      { id: 'BT', op: 'or', args: ['S'] }] }],
}

beforeEach(() => { vi.clearAllMocks() })

describe('deriveLinkedValue — FE-03 端点分派', () => {
  it('__init__ + ft 源 → 只调频率端点,写 INIT_FREQ_KEY', async () => {
    const r = await deriveLinkedValue(ieOnly, '__init__', 'ft')
    expect(r).toEqual({ kind: 'value', key: INIT_FREQ_KEY, value: 0.0123 })
    expect(ftFrequency).toHaveBeenCalledTimes(1)
    expect(quantify).not.toHaveBeenCalled()          // 概率端点绝不被触碰
  })

  it('__init__ + 非 ft 源 → skip(无派生更新)', async () => {
    const r = await deriveLinkedValue(ieOnly, '__init__', 'manual')
    expect(r).toEqual({ kind: 'skip' })
    expect(ftFrequency).not.toHaveBeenCalled()
  })

  it('共享事件 → integrated 提示,不做两段式,不发请求', async () => {
    const r = await deriveLinkedValue(sharedModel, '__init__', 'ft')
    expect(r).toEqual({ kind: 'integrated', shared: ['S'] })
    expect(ftFrequency).not.toHaveBeenCalled()
    expect(quantify).not.toHaveBeenCalled()
  })

  it('屏障树 → 概率端点', async () => {
    const r = await deriveLinkedValue(ieOnly, 'B_X', undefined)
    expect(r).toEqual({ kind: 'value', key: 'B_X', value: 0.4 })
    expect(quantify).toHaveBeenCalledWith(ieOnly, 'B_X')
  })

  it('端点错误上抛(绝不吞成旧值)', async () => {
    ;(ftFrequency as any).mockRejectedValueOnce(new Error('400 频率树含概率参数'))
    await expect(deriveLinkedValue(ieOnly, '__init__', 'ft')).rejects.toThrow('400')
  })
})
