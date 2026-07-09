import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildScenarioTab, computePfds } from './scenarioLoader'
import { getBessEventTree, quantify } from '../../api'

vi.mock('../../api', () => ({
  getBessEventTree: vi.fn(),
  quantify: vi.fn(),
}))

const BIG_FT = { name: 'B_A', nodes: [{ id: 'B_A' }, { id: 'g1' }, { id: 'e1' }, { id: 'e2' }] }
const TINY_FT = { name: 'B_B', nodes: [{ id: 'B_B' }, { id: 'e' }] }

function mockScenario() {
  vi.mocked(getBessEventTree).mockResolvedValue({
    init_event: '热失控', init_frequency: 2e-3,
    functional_events: ['B_A', 'B_B'],
    labels: { B_A: '早期探测', B_B: '灭火' },
    fe_prob: { B_A: 0.1, B_B: 0.2 },
    sequences: [], consequences: {}, barrier_importance: [],
    fault_trees: { B_A: BIG_FT, B_B: TINY_FT },
    parameters: [{ id: 'p1', value: 0.01 }],
  } as any)
  vi.mocked(quantify).mockResolvedValue({ probability: 0.037, method: 'exact', cutsets: [], importance: {} })
}

describe('scenarioLoader', () => {
  beforeEach(() => vi.clearAllMocks())

  it('buildScenarioTab:>2 节点故障树才 linkFt;量化 PFD 覆盖 failProb', async () => {
    mockScenario()
    const t = await buildScenarioTab('tr', '场景')
    expect(t.key).toBe('sc:tr')
    expect(t.renamed).toBe(false)
    const [a, b] = t.model.functionalEvents
    expect(a.linkFt).toBe('B_A')          // 4 节点 → 挂载
    expect(b.linkFt).toBeUndefined()      // 2 节点 → 不挂载
    expect(a.failProb).toBe(0.037)        // linkFt 屏障 failProb 被顶事件概率覆盖
    expect(b.failProb).toBe(0.2)          // 非挂载屏障维持 fe_prob
    expect(t.pfds).toEqual({ B_A: 0.037 })
    expect(t.model.initEvent).toBe('热失控')
    expect(t.model.root.kind).toBe('branch')
    expect(t.fts.fault_trees).toHaveLength(2)
  })

  it('空 sid 归入 sc:default;量化失败静默跳过', async () => {
    mockScenario()
    vi.mocked(quantify).mockRejectedValue(new Error('engine down'))
    const t = await buildScenarioTab('', '默认')
    expect(t.key).toBe('sc:default')
    expect(t.pfds).toEqual({})
    expect(t.model.functionalEvents[0].failProb).toBe(0.1)  // 覆盖不发生
  })

  it('computePfds 只对 linkFt 屏障量化', async () => {
    vi.mocked(quantify).mockResolvedValue({ probability: 0.5, method: 'exact', cutsets: [], importance: {} })
    const m = {
      initEvent: 'IE', initFreq: 1e-3,
      functionalEvents: [
        { id: 'F1', label: 'F1', failProb: 0.1, linkFt: 'F1' },
        { id: 'F2', label: 'F2', failProb: 0.2 },
      ],
      root: { kind: 'leaf', consequence: 'C1' },
    } as any
    const p = await computePfds({ model_data: { parameters: [] }, fault_trees: [] }, m)
    expect(p).toEqual({ F1: 0.5 })
    expect(vi.mocked(quantify)).toHaveBeenCalledTimes(1)
  })
})
