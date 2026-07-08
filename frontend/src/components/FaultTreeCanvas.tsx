import { useEffect } from 'react'
import ReactFlow, { Background, Controls, MiniMap, useNodesState, useEdgesState } from 'reactflow'
import type { Node, Edge, Connection } from 'reactflow'
import 'reactflow/dist/style.css'
import { nodeTypes } from './nodes'

interface Props {
  nodes: Node[]
  edges: Edge[]
  editable?: boolean
  highlight?: Set<string>
  heat?: Record<string, number>
  onConnectNodes?: (source: string, target: string) => void
  onDeleteNodes?: (ids: string[]) => void
  onSelect?: (id: string | null) => void
  onNodeDragStop?: (id: string, x: number, y: number) => void
}

export function FaultTreeCanvas({ nodes: pNodes, edges: pEdges, editable, highlight, heat, onConnectNodes, onDeleteNodes, onSelect, onNodeDragStop }: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState(pNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(pEdges)
  // 结构变化或高亮变化时同步(割集回溯把割集路径节点/边着色)
  useEffect(() => {
    const hot = highlight ?? new Set<string>()
    setNodes(pNodes.map((n) => ({ ...n, data: { ...n.data, highlighted: hot.has(n.id), heat: heat ? heat[n.id] : undefined } })))
    setEdges(pEdges.map((e) => {
      const on = hot.has(e.source) && hot.has(e.target)
      return { ...e, animated: on, style: on ? { stroke: '#f59e0b', strokeWidth: 2.5 } : undefined }
    }))
  }, [pNodes, pEdges, highlight, heat, setNodes, setEdges])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      fitView
      minZoom={0.2}
      nodesConnectable={!!editable}
      deleteKeyCode={editable ? ['Backspace', 'Delete'] : null}
      onConnect={(c: Connection) => { if (c.source && c.target) onConnectNodes?.(c.source, c.target) }}
      onNodesDelete={(ns) => onDeleteNodes?.(ns.map((n) => n.id))}
      onNodeClick={(_, n) => onSelect?.(n.id)}
      onNodeDragStop={(_, n) => onNodeDragStop?.(n.id, n.position.x, n.position.y)}
      onPaneClick={() => onSelect?.(null)}
      proOptions={{ hideAttribution: true }}
    >
      <Background color="var(--psa-line)" gap={18} />
      <Controls />
      <MiniMap pannable zoomable nodeStrokeWidth={2} />
    </ReactFlow>
  )
}
