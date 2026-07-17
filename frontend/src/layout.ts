import dagre from 'dagre'
import { Position } from 'reactflow'
import type { Node, Edge } from 'reactflow'
import type { ModelJson } from './model'
import { getFt } from './model'
import { bandLeafPositions } from './ftbanding'

const NODE_W = 150
const NODE_H = 72

/** 取指定 fault_tree, 用 dagre(自顶向下)算坐标, 产出 React Flow 节点与边。
 *  positions 中的节点用其(手拖)坐标覆盖 dagre, 其余仍 dagre。 */
export function layoutFaultTree(model: ModelJson, ftName: string, positions?: Record<string, { x: number; y: number }>, bandLeaves = false): { nodes: Node[]; edges: Edge[] } {
  const ft = getFt(model, ftName)
  // 防御:命名树缺失且 fault_trees 为空时 getFt 返回 undefined —— 此前直接
  // `for (const n of ft.nodes)` 抛 TypeError,经无 ErrorBoundary 的懒模态 Suspense
  // 冒泡即白屏(ETA 屏障挂树→重编辑白屏)。缺树 = 空图,绝不抛。
  if (!ft) return { nodes: [], edges: [] }
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'TB', nodesep: 30, ranksep: 70, marginx: 20, marginy: 20 })
  g.setDefaultEdgeLabel(() => ({}))

  for (const n of ft.nodes) g.setNode(n.id, { width: NODE_W, height: NODE_H })
  const edges: Edge[] = []
  for (const n of ft.nodes) {
    if (n.args) {
      for (const a of n.args) {
        if (!ft.nodes.find((x) => x.id === a)) continue
        g.setEdge(n.id, a)
        edges.push({ id: `${n.id}->${a}`, source: n.id, target: a, type: 'smoothstep' })
      }
    }
  }
  dagre.layout(g)

  let bandPos: Record<string, { x: number; y: number }> = {}
  if (bandLeaves) {
    const bn = ft.nodes.map((n) => {
      const p = g.node(n.id)
      return { id: n.id, isLeaf: !!(n.basic || n.house), x: p?.x ?? 0, y: p?.y ?? 0 }
    })
    bandPos = bandLeafPositions(bn, { nodeW: NODE_W, nodeH: NODE_H, gap: 70, leafGap: 24, marginX: 20 })
  }

  const nodes: Node[] = ft.nodes.map((n) => {
    const p = g.node(n.id)
    const type = n.basic ? 'basic' : n.house ? 'house' : 'gate'
    const center = bandPos[n.id] ?? { x: (p?.x ?? 0), y: (p?.y ?? 0) }
    const saved = positions?.[n.id]
    return {
      id: n.id,
      type,
      position: saved ?? { x: center.x - NODE_W / 2, y: center.y - NODE_H / 2 },
      data: { label: n.id, nodeLabel: n.label, op: n.op, k: n.k, args: n.args, isTop: n.id === ft.top },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
    }
  })
  return { nodes, edges }
}
