import { useEffect, useMemo, useRef } from 'react'
import ReactFlow, { Background, Controls, MiniMap, useNodesInitialized, useNodesState, useEdgesState, useReactFlow, useStore, useViewport } from 'reactflow'
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
  // 第三道门(报障 2026-07-20 二轮):真实浏览器里节点**晚一帧才完成测量**,
  // nodesInitialized 为 false 时 fitView 等于适配空集——视口定格在空处,画布"空白"。
  const nodesReady = useNodesInitialized()
  const doneFor = useRef<string | null>(null)
  useEffect(() => {
    if (doneFor.current === fitKey) return
    if (!nodeCount || !width || !height || !nodesReady) return
    const id = requestAnimationFrame(() => { fitView({ padding: 0.15, maxZoom: 1.25 }); doneFor.current = fitKey })
    return () => cancelAnimationFrame(id)
  }, [nodeCount, width, height, nodesReady, fitKey, fitView])
  return null
}

export function FaultTreeCanvas({ nodes: pNodes, edges: pEdges, editable, highlight, heat, onConnectNodes, onDeleteNodes, onSelect, onNodeDragStop, zoomToolbar, fitKey }: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState(pNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(pEdges)
  // 结构变化或高亮变化时同步(割集回溯把割集路径节点/边着色)
  useEffect(() => {
    const hot = highlight ?? new Set<string>()
    // 保留已测尺寸(空白画布终修 2026-07-20):此前整批换成**未测量**的新对象,把
    // reactflow 刚经 ResizeObserver 测得的 width/height 踩掉——测量被每次父渲染归零,
    // 节点长期停留在 visibility:hidden(v11 未测量即隐藏)。合并旧节点的测量结果,
    // 测量只需成功一次,之后任何重渲染都不再打回隐藏态。
    setNodes((prev) => pNodes.map((n) => {
      const old = prev.find((p) => p.id === n.id)
      return { ...n, ...(old?.width != null ? { width: old.width, height: old.height } : {}),
               data: { ...n.data, highlighted: hot.has(n.id), heat: heat ? heat[n.id] : undefined, onNodeSelect: onSelect, onNodeDragStop } }
    }))
    setEdges(pEdges.map((e) => {
      const on = hot.has(e.source) && hot.has(e.target)
      return { ...e, animated: on, style: on ? { stroke: '#f59e0b', strokeWidth: 2.5 } : undefined }
    }))
  }, [pNodes, pEdges, highlight, heat, onSelect, onNodeDragStop, setNodes, setEdges])

  // 确定性初始视口(报障 2026-07-20 三轮):节点坐标/尺寸皆为本方 dagre 布局的已知量,
  // 初始变换用纯数学同步给出——把树的左上角放进视野(100%)。不依赖 fitView/rAF/节点测量,
  // 任何异步路径失灵节点也必然可见。挂载期一次性(父层以 key=fitKey 换树即重挂重算);
  // AutoFit 保留为增强:条件齐备时再优化为整树适配。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initialViewport = useMemo(() => {
    if (!pNodes.length) return { x: 24, y: 24, zoom: 1 }
    const minX = Math.min(...pNodes.map((n) => n.position.x))
    const minY = Math.min(...pNodes.map((n) => n.position.y))
    return { x: 24 - minX, y: 24 - minY, zoom: 1 }
  }, [])
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      defaultViewport={initialViewport}
      nodesDraggable={false}
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
