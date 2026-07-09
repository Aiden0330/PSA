import { CONSEQUENCES, consequenceTotals, layout } from '../../eventtree'
import { composeModel } from '../../stores/derived'
import { etaDisplayName } from '../../stores/useActiveEta'
import type { ProjectEta } from '../../project'
import type { EtaSummary } from '../../components/EventTreeEditor'

/** 页签摘要(数字用合成模型):驱动页签行、汇总清单与驾驶舱卡片。 */
export function computeSummaries(
  etaTabs: ProjectEta[],
  activeKey: string,
  checkedKeys: Record<string, boolean>,
  etaPfds: (t: ProjectEta) => Record<string, number>,
): EtaSummary[] {
  return etaTabs.map((t) => {
    const cm = composeModel(t.model, etaPfds(t))
    const totals = consequenceTotals(cm)
    const leafCount = layout(cm, 1, 0).leafCount
    let worstC = '—', worstFreq = 0
    for (let i = CONSEQUENCES.length - 1; i >= 0; i--) { const c = CONSEQUENCES[i]; if ((totals[c] ?? 0) > 0) { worstC = c; worstFreq = totals[c]; break } }
    return { key: t.key, name: etaDisplayName(t, cm), leafCount, worstC, worstFreq, active: t.key === activeKey, checked: !!checkedKeys[t.key] }
  })
}

/** 勾选页签的后果频率汇总(6×5 矩阵/驾驶舱 KPI 的数据源)。 */
export function computeAggregateTotals(
  etaTabs: ProjectEta[],
  checkedKeys: Record<string, boolean>,
  etaPfds: (t: ProjectEta) => Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const t of etaTabs) {
    if (!checkedKeys[t.key]) continue
    const tt = consequenceTotals(composeModel(t.model, etaPfds(t)))
    for (const c of Object.keys(tt)) out[c] = (out[c] ?? 0) + tt[c]
  }
  return out
}
