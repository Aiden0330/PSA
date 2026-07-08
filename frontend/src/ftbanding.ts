// 纯函数:把故障树的基本/房形事件压到画布底部同一带,门保持原 dagre 层级。
// 输入/输出均为"节点中心"坐标,无 reactflow 依赖,便于单测。

export interface BandNode { id: string; isLeaf: boolean; x: number; y: number }
export interface BandOpts { nodeW: number; nodeH: number; gap: number; leafGap: number; marginX: number }

/** 返回需要重定位的叶节点 id → 新中心坐标;门节点不返回(保持原位)。 */
export function bandLeafPositions(nodes: BandNode[], opts: BandOpts): Record<string, { x: number; y: number }> {
  const leaves = nodes.filter((n) => n.isLeaf)
  if (leaves.length === 0) return {}
  const gates = nodes.filter((n) => !n.isLeaf)
  const baseY = (gates.length ? gates : leaves).reduce((m, n) => Math.max(m, n.y), -Infinity)
  const bandY = baseY + opts.nodeH + opts.gap
  // 按原 dagre x 排序(dagre 已把同父子节点横向聚拢),稳定打散到一行。
  const ordered = [...leaves].sort((a, b) => a.x - b.x || a.id.localeCompare(b.id))
  const step = opts.nodeW + opts.leafGap
  const out: Record<string, { x: number; y: number }> = {}
  ordered.forEach((l, i) => { out[l.id] = { x: opts.marginX + opts.nodeW / 2 + i * step, y: bandY } })
  return out
}
