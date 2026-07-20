import { useEffect, useRef } from 'react'
import ReactFlow, { Background, Controls, MiniMap, useNodesState, useEdgesState, useReactFlow, useStore, useViewport } from 'reactflow'
import type { ReactFlowState } from 'reactflow'
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
  /** R4b(explorer redesign §3 fta):用悬浮 .exp-zoom 工具条替换 reactflow 默认 Controls,
   *  与 ETA 画布(EtCanvas)视觉统一。未传时保持原行为(默认 Controls,无自定义工具条)——
   *  BarrierFtModal 复用本组件但不传此 prop,行为逐位不变。 */
  zoomToolbar?: boolean
  /** 适配键:换树(名变)即重新自动适配一次;缺省 'ft' */
  fitKey?: string
}

/** 悬浮缩放工具条(reactflow 自带缩放/平移,这里只是换皮成 .exp-zoom 视觉 + 复用其 zoomIn/zoomOut/fitView)。
 *  必须渲染在 <ReactFlow> 内部(取其 store context),故拆成子组件而非内联在 FaultTreeCanvas 里。 */
function FtaZoomToolbar() {
  const { zoomIn, zoomOut, fitView } = useReactFlow()
  const { zoom } = useViewport()
  return (
    <div className="exp-zoom">
      <button type="button" onClick={() => zoomOut()} title="缩小">⊖</button>
      <span className="pct psa-num">{Math.round(zoom * 100)}%</span>
      <button type="button" onClick={() => zoomIn()} title="放大">⊕</button>
      <button type="button" onClick={() => fitView({ padding: 0.08 })} title="适应窗口">⤢</button>
    </div>
  )
}

/** 空白画布修复(报障 2026-07-20,截图实证:200% 缩放 + 空小地图 + 树存在):
 *  reactflow 的 fitView 只在初始化一帧执行。懒加载页/模态首帧容器 0×0、或节点晚一拍注入时,
 *  fitView 在错误状态上定格视口,之后**永不重适配** —— 节点全在视口外,画布看似空白。
 *  本组件等到「面板有真实尺寸 && 节点已注入」才 fit,一棵树只 fit 一次(换树重置),
 *  绝不覆盖用户随后的手动平移/缩放。maxZoom 限 1.25:两节点小树不再被顶到 200%。 */
function AutoFit({ nodeCount, fitKey }: { nodeCount: number; fitKey: string }) {
  const { fitView } = useReactFlow()
  const width = useStore((st: ReactFlowState) => st.width)
  const height = useStore((st: ReactFlowState) => st.height)
  const doneFor = useRef<string | null>(null)
  useEffect(() => {
    if (doneFor.current === fitKey) return
    if (!nodeCount || !width || !height) return
    const id = requestAnimationFrame(() => { fitView({ padding: 0.15, maxZoom: 1.25 }); doneFor.current = fitKey })
    return () => cancelAnimationFrame(id)
  }, [nodeCount, width, height, fitKey, fitView])
  return null
}

export function FaultTreeCanvas({ nodes: pNodes, edges: pEdges, editable, highlight, heat, onConnectNodes, onDeleteNodes, onSelect, onNodeDragStop, zoomToolbar, fitKey }: Props) {
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
      fitViewOptions={{ padding: 0.15, maxZoom: 1.25 }}
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
      <AutoFit nodeCount={pNodes.length} fitKey={fitKey ?? 'ft'} />
      <Background color="var(--psa-line)" gap={18} />
      {zoomToolbar ? <FtaZoomToolbar /> : <Controls />}
      <MiniMap pannable zoomable nodeStrokeWidth={2} />
    </ReactFlow>
  )
}
