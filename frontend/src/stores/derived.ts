import type { EventTreeModel } from '../eventtree'
import type { ProjectEta } from '../project'

/** pfds 缓存里初始事件顶值的保留键(与屏障 feId 不冲突)。 */
export const INIT_FREQ_KEY = '__init__'

/**
 * 内容 × 派生 → 展示/量化/序列化用的合成模型。
 * linkFt 屏障的 failProb 与 FT 源 initFreq 以 pfds 缓存为准;内容层保留最后物化值。
 * 无派生差异时原样返回(引用相等,免重渲染)。
 */
export function composeModel(m: EventTreeModel, pfds: Record<string, number> | undefined): EventTreeModel {
  if (!pfds) return m
  let feChanged = false
  const fes = m.functionalEvents.map((f) => {
    if (f.linkFt && pfds[f.id] != null && pfds[f.id] !== f.failProb) { feChanged = true; return { ...f, failProb: pfds[f.id] } }
    return f
  })
  const initFt = m.initFreqSource === 'ft' && pfds[INIT_FREQ_KEY] != null && pfds[INIT_FREQ_KEY] !== m.initFreq
  if (!feChanged && !initFt) return m
  return { ...m, functionalEvents: feChanged ? fes : m.functionalEvents, ...(initFt ? { initFreq: pfds[INIT_FREQ_KEY] } : {}) }
}

export function composeEta(e: ProjectEta): ProjectEta {
  const m = composeModel(e.model, e.pfds)
  return m === e.model ? e : { ...e, model: m }
}

/**
 * 编辑回写剥离:组件拿到的是合成模型,写回内容层前恢复其中的派生量,
 * 保证 PFD/initFreq 量化回写不进入内容撤销历史(蓝图 §二 derived 分离)。
 * - linkFt 屏障 failProb 按 id 匹配恢复内容值(重排序安全);
 * - initFreq 仅当前后都是 FT 源时恢复(源切换 ft→manual 时物化当前派生值,与旧交互一致)。
 */
export function stripDerived(next: EventTreeModel, content: EventTreeModel): EventTreeModel {
  const fes = next.functionalEvents.map((f) => {
    if (!f.linkFt) return f
    const c = content.functionalEvents.find((p) => p.id === f.id)
    return c && c.failProb !== f.failProb ? { ...f, failProb: c.failProb } : f
  })
  const keepInit = next.initFreqSource === 'ft' && content.initFreqSource === 'ft'
  return { ...next, functionalEvents: fes, ...(keepInit ? { initFreq: content.initFreq } : {}) }
}
