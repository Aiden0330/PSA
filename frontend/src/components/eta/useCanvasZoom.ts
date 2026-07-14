import { useCallback, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'

/**
 * ETA 画布缩放/平移(R4a §1,规格 2026-07-13 §3 eta):纯数学部分(clampScale/computeFit/
 * zoomAtPoint/panBy)与 React 事件接线分离——前者在 useCanvasZoom.test.ts 直接测试,无需渲染。
 * 缩放范围 0.4–2.5;wheel 以指针位置为锚点缩放;fit() = 内容 bbox + 8% 边距,居中匹配容器。
 */
export const ZOOM_MIN = 0.4
export const ZOOM_MAX = 2.5
const FIT_MARGIN = 0.08 // 内容 bbox 四周各留 8% 边距(规格原文"内容 bbox+8% 边距")

export interface ZoomState { scale: number; tx: number; ty: number }
export interface Size { width: number; height: number }
export interface BBox { x: number; y: number; width: number; height: number }
export interface Point { x: number; y: number }
interface Bounds { min?: number; max?: number }

/** 缩放系数夹在 [min,max](默认 0.4–2.5);非数值(NaN)回退到 min,避免 NaN 扩散到渲染。 */
export function clampScale(scale: number, min = ZOOM_MIN, max = ZOOM_MAX): number {
  if (Number.isNaN(scale)) return min
  return Math.min(max, Math.max(min, scale))
}

/**
 * 内容 bbox 完整可见于容器 + 8% 边距,居中。容器/内容退化(≤0)时回退单位变换(scale=1,tx=ty=0),
 * 不产生 NaN/Infinity——调用方(EtCanvas)在容器尚未布局(如 jsdom 测试环境)时安全可调。
 */
export function computeFit(bbox: BBox, container: Size, opts?: { margin?: number } & Bounds): ZoomState {
  const margin = opts?.margin ?? FIT_MARGIN
  const min = opts?.min ?? ZOOM_MIN
  const max = opts?.max ?? ZOOM_MAX
  if (bbox.width <= 0 || bbox.height <= 0 || container.width <= 0 || container.height <= 0) {
    return { scale: 1, tx: 0, ty: 0 }
  }
  const availW = container.width * (1 - margin * 2)
  const availH = container.height * (1 - margin * 2)
  const scale = clampScale(Math.min(availW / bbox.width, availH / bbox.height), min, max)
  const tx = (container.width - bbox.width * scale) / 2 - bbox.x * scale
  const ty = (container.height - bbox.height * scale) / 2 - bbox.y * scale
  return { scale, tx, ty }
}

/**
 * 以 pointer(容器坐标系)为锚点缩放:锚点下方的世界坐标点在缩放前后保持不变(屏幕位置不动)。
 * 已在边界饱和(clamp 后 scale 不变)时原样返回输入状态——避免抖动/无意义的浮点漂移。
 */
export function zoomAtPoint(state: ZoomState, pointer: Point, factor: number, opts?: Bounds): ZoomState {
  const min = opts?.min ?? ZOOM_MIN
  const max = opts?.max ?? ZOOM_MAX
  const nextScale = clampScale(state.scale * factor, min, max)
  if (nextScale === state.scale) return state
  const worldX = (pointer.x - state.tx) / state.scale
  const worldY = (pointer.y - state.ty) / state.scale
  return { scale: nextScale, tx: pointer.x - worldX * nextScale, ty: pointer.y - worldY * nextScale }
}

/** 纯平移(背景拖拽):scale 不变,tx/ty 各加 dx/dy。 */
export function panBy(state: ZoomState, dx: number, dy: number): ZoomState {
  return { scale: state.scale, tx: state.tx + dx, ty: state.ty + dy }
}

export interface CanvasZoomApi extends ZoomState {
  /**
   * 注意:必须以原生 addEventListener(el,'wheel',handler,{passive:false}) 接线,不能用 JSX 的
   * onWheel= 属性——React 对 wheel/touch 类事件在根容器上以 passive:true 委托监听(浏览器滚动性能
   * 优化的既定行为),passive 监听器里调用 preventDefault() 会被浏览器静默忽略,页面/祖先容器仍可能
   * 响应默认滚轮行为。实测复现(见 R4a 实现记录):同一段代码从 JSX onWheel 换成原生监听后
   * e.defaultPrevented 才从 false 变为 true。EtCanvas 用 useEffect + addEventListener 接这个函数。
   */
  onWheel: (e: WheelEvent) => void
  onPointerDown: (e: ReactPointerEvent) => void
  onPointerMove: (e: ReactPointerEvent) => void
  onPointerUp: (e: ReactPointerEvent) => void
  fit: () => void
  zoomIn: () => void
  zoomOut: () => void
  reset: () => void
}

/**
 * SVG 画布缩放/平移 hook。containerRef 必须是决定"可见视口"尺寸的元素(通常是画布外层 div,
 * 而非内容尺寸的 <svg> 本身——后者按内容原始像素定宽高,供导出还原,参见 EtCanvas/EventTreeEditor
 * 的 prepareCanvasForExport)。onPointerDown 是否启动拖拽由调用方按 e.target===e.currentTarget
 * 之类的判断决定(仅背景、非节点触发平移)——hook 本身不内置该判断,保持通用。
 */
export function useCanvasZoom(opts: {
  containerRef: RefObject<Element>
  getContentBBox: () => BBox
  min?: number
  max?: number
}): CanvasZoomApi {
  const { containerRef, getContentBBox, min = ZOOM_MIN, max = ZOOM_MAX } = opts
  const [state, setState] = useState<ZoomState>({ scale: 1, tx: 0, ty: 0 })
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number; scale: number; id: number } | null>(null)

  const containerSize = useCallback((): Size => {
    const el = containerRef.current
    return el ? { width: el.clientWidth, height: el.clientHeight } : { width: 0, height: 0 }
  }, [containerRef])

  const fit = useCallback(() => {
    setState(computeFit(getContentBBox(), containerSize(), { min, max }))
  }, [getContentBBox, containerSize, min, max])

  const zoomIn = useCallback(() => {
    const c = containerSize()
    setState((s) => zoomAtPoint(s, { x: c.width / 2, y: c.height / 2 }, 1.25, { min, max }))
  }, [containerSize, min, max])

  const zoomOut = useCallback(() => {
    const c = containerSize()
    setState((s) => zoomAtPoint(s, { x: c.width / 2, y: c.height / 2 }, 1 / 1.25, { min, max }))
  }, [containerSize, min, max])

  const reset = useCallback(() => setState({ scale: 1, tx: 0, ty: 0 }), [])

  const onWheel = useCallback((e: WheelEvent) => {
    e.preventDefault()
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    const factor = Math.exp(-e.deltaY * 0.0018) // 连续手势(触控板)友好的指数系数;正 deltaY(远离)= 缩小
    setState((s) => zoomAtPoint(s, pointer, factor, { min, max }))
  }, [containerRef, min, max])

  const onPointerDown = useCallback((e: ReactPointerEvent) => {
    if (e.button !== 0) return
    dragRef.current = { x: e.clientX, y: e.clientY, tx: state.tx, ty: state.ty, scale: state.scale, id: e.pointerId }
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
  }, [state.tx, state.ty, state.scale])

  const onPointerMove = useCallback((e: ReactPointerEvent) => {
    const d = dragRef.current
    if (!d || d.id !== e.pointerId) return
    setState(panBy({ scale: d.scale, tx: d.tx, ty: d.ty }, e.clientX - d.x, e.clientY - d.y))
  }, [])

  const onPointerUp = useCallback((e: ReactPointerEvent) => {
    if (dragRef.current?.id === e.pointerId) dragRef.current = null
  }, [])

  return { ...state, onWheel, onPointerDown, onPointerMove, onPointerUp, fit, zoomIn, zoomOut, reset }
}
