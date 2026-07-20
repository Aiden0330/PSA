import { getBessEventTree, quantify } from '../../api'
import { buildCascade, CONSEQUENCE_AT_DEPTH } from '../../eventtree'
import type { EventTreeModel } from '../../eventtree'
import type { ModelJson } from '../../model'
import type { ProjectEta } from '../../project'

/** 各 FTA 屏障的顶事件概率 = 其 PFD(仅 linkFt 屏障;量化失败静默跳过)。 */
export async function computePfds(fts: ModelJson, m: EventTreeModel): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const fe of m.functionalEvents) {
    if (fe.linkFt) { try { out[fe.id] = (await quantify(fts, fe.id)).probability } catch {} }
  }
  return out
}

/** 由内置场景构建一个 ETA 页签快照(模型 + 挂载故障树 + 量化 PFD 覆盖 failProb)。 */
export async function buildScenarioTab(sid: string, name: string): Promise<ProjectEta> {
  const d = await getBessEventTree(sid || undefined)
  const fts: ModelJson = { model_data: { parameters: (d.parameters ?? []) as any }, fault_trees: Object.values(d.fault_trees ?? {}) as any }
  const fes = d.functional_events.map((id) => ({
    id, label: d.labels?.[id] ?? id, failProb: d.fe_prob?.[id] ?? 0.1,   // P4-C ⑫:场景响应缺表不抛
    linkFt: ((d.fault_trees?.[id]?.nodes?.length ?? 0) > 2) ? id : undefined,
  }))
  const base: EventTreeModel = { initEvent: d.init_event, initFreq: d.init_frequency, functionalEvents: fes, root: buildCascade(fes, CONSEQUENCE_AT_DEPTH) }
  const p = await computePfds(fts, base)
  const model: EventTreeModel = { ...base, functionalEvents: base.functionalEvents.map((f) => (f.id in p ? { ...f, failProb: p[f.id] } : f)) }
  return { key: 'sc:' + (sid || 'default'), name, renamed: false, model, fts, pfds: p }
}
