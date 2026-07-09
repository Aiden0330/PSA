import { beforeEach, describe, expect, it } from 'vitest'
import { resetViewStore, useViewStore } from './viewStore'

describe('viewStore', () => {
  beforeEach(() => {
    localStorage.clear()
    resetViewStore()
  })

  it('默认视图态:bess 主页签、独立 FTA 目标、无选中', () => {
    const s = useViewStore.getState()
    expect(s.tab).toBe('bess')
    expect(s.ftEditTarget).toEqual({ src: 'model' })
    expect(s.selected).toBeNull()
    expect(s.heatOn).toBe(false)
    expect(s.treeH).toBeNull()
    expect(s.seqW).toBeNull()
  })

  it('setter 逐项生效', () => {
    const s = useViewStore.getState()
    s.setTab('ft')
    s.setFtEditTarget({ src: 'eta', etaKey: 'k1', name: 'FE1' })
    s.setSelected('n3')
    s.setHeatOn(true)
    s.setTreeH(420)
    s.setSeqW(260)
    const t = useViewStore.getState()
    expect(t.tab).toBe('ft')
    expect(t.ftEditTarget).toEqual({ src: 'eta', etaKey: 'k1', name: 'FE1' })
    expect(t.selected).toBe('n3')
    expect(t.heatOn).toBe(true)
    expect(t.treeH).toBe(420)
    expect(t.seqW).toBe(260)
  })

  it('persist 只持久化布局子集(tab/treeH/seqW),不含运行期引用', () => {
    const s = useViewStore.getState()
    s.setTab('library')
    s.setTreeH(300)
    s.setSelected('node-x')
    s.setFtEditTarget({ src: 'standalone', name: '我的树' })
    const raw = localStorage.getItem('psa.view')
    expect(raw).toBeTruthy()
    const persisted = JSON.parse(raw!).state
    expect(persisted).toEqual({ tab: 'library', treeH: 300, seqW: null })
    expect(persisted.selected).toBeUndefined()
    expect(persisted.ftEditTarget).toBeUndefined()
  })
})
