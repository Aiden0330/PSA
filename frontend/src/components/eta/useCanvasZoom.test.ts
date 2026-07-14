import { describe, expect, it } from 'vitest'
import { clampScale, computeFit, panBy, zoomAtPoint, ZOOM_MAX, ZOOM_MIN } from './useCanvasZoom'

describe('useCanvasZoom pure math (R4a §1: 缩放/平移的数学核心,独立于 React/DOM)', () => {
  describe('clampScale', () => {
    it('规格规定的缩放上下限为 0.4–2.5', () => {
      expect(ZOOM_MIN).toBe(0.4)
      expect(ZOOM_MAX).toBe(2.5)
    })

    it('区间内数值原样通过', () => {
      expect(clampScale(1)).toBe(1)
      expect(clampScale(0.4)).toBe(0.4)
      expect(clampScale(2.5)).toBe(2.5)
    })

    it('超出上限/下限被夹紧', () => {
      expect(clampScale(0.01)).toBe(0.4)
      expect(clampScale(99)).toBe(2.5)
      expect(clampScale(Infinity)).toBe(2.5)
      expect(clampScale(-Infinity)).toBe(0.4)
    })

    it('支持自定义上下限', () => {
      expect(clampScale(0.9, 1, 3)).toBe(1)
      expect(clampScale(5, 1, 3)).toBe(3)
    })

    it('非数值(NaN)回退到下限,不产生 NaN 扩散', () => {
      expect(clampScale(NaN)).toBe(0.4)
    })
  })

  describe('computeFit — 内容 bbox + 8% 边距,居中匹配容器', () => {
    it('宽内容(受宽度约束)按可用宽度计算缩放,水平/垂直居中', () => {
      const r = computeFit({ x: 0, y: 0, width: 1000, height: 200 }, { width: 500, height: 500 })
      const expected = (500 * 0.84) / 1000 // 容器 92% - 8% 边距 = 84% 可用
      expect(r.scale).toBeCloseTo(expected, 6)
      // 内容中心 (500,100) 变换后应落在容器中心 (250,250)
      expect(r.tx + 500 * r.scale).toBeCloseTo(250, 5)
      expect(r.ty + 100 * r.scale).toBeCloseTo(250, 5)
    })

    it('高内容(受高度约束)取两维中更小的缩放', () => {
      const r = computeFit({ x: 0, y: 0, width: 200, height: 1000 }, { width: 500, height: 500 })
      const expected = (500 * 0.84) / 1000
      expect(r.scale).toBeCloseTo(expected, 6)
    })

    it('结果缩放夹在 0.4–2.5(极小内容不会无限放大)', () => {
      const r = computeFit({ x: 0, y: 0, width: 10, height: 10 }, { width: 2000, height: 2000 })
      expect(r.scale).toBe(2.5)
      // 即使触顶夹紧,仍以夹紧后的 scale 居中(不留超界的居中误差)
      expect(r.tx + 5 * r.scale).toBeCloseTo(1000, 5)
      expect(r.ty + 5 * r.scale).toBeCloseTo(1000, 5)
    })

    it('容器或内容退化(0/负尺寸)时回退单位变换,不产生 NaN/Infinity', () => {
      expect(computeFit({ x: 0, y: 0, width: 0, height: 0 }, { width: 500, height: 500 })).toEqual({ scale: 1, tx: 0, ty: 0 })
      expect(computeFit({ x: 0, y: 0, width: 100, height: 100 }, { width: 0, height: 0 })).toEqual({ scale: 1, tx: 0, ty: 0 })
      expect(computeFit({ x: 0, y: 0, width: -5, height: 100 }, { width: 500, height: 500 })).toEqual({ scale: 1, tx: 0, ty: 0 })
    })

    it('bbox 非零起点(x/y ≠ 0)也能正确居中', () => {
      const r = computeFit({ x: 50, y: 20, width: 100, height: 100 }, { width: 500, height: 500 })
      expect(r.tx + 100 * r.scale).toBeCloseTo(250, 5)
      expect(r.ty + 70 * r.scale).toBeCloseTo(250, 5)
    })
  })

  describe('zoomAtPoint — 指针锚定缩放不变量(规格要求:锚点下方世界坐标缩放前后不变)', () => {
    it('放大:指针下方世界坐标保持不变,scale 按 factor 变化', () => {
      const state = { scale: 1, tx: 10, ty: -5 }
      const pointer = { x: 300, y: 150 }
      const worldBefore = { x: (pointer.x - state.tx) / state.scale, y: (pointer.y - state.ty) / state.scale }
      const next = zoomAtPoint(state, pointer, 1.5)
      const worldAfter = { x: (pointer.x - next.tx) / next.scale, y: (pointer.y - next.ty) / next.scale }
      expect(next.scale).toBeCloseTo(1.5, 8)
      expect(worldAfter.x).toBeCloseTo(worldBefore.x, 8)
      expect(worldAfter.y).toBeCloseTo(worldBefore.y, 8)
    })

    it('缩小:同样满足指针锚定不变量', () => {
      const state = { scale: 2, tx: -120, ty: 40 }
      const pointer = { x: 80, y: 220 }
      const worldBefore = { x: (pointer.x - state.tx) / state.scale, y: (pointer.y - state.ty) / state.scale }
      const next = zoomAtPoint(state, pointer, 0.5)
      const worldAfter = { x: (pointer.x - next.tx) / next.scale, y: (pointer.y - next.ty) / next.scale }
      expect(next.scale).toBeCloseTo(1, 8)
      expect(worldAfter.x).toBeCloseTo(worldBefore.x, 8)
      expect(worldAfter.y).toBeCloseTo(worldBefore.y, 8)
    })

    it('任意指针位置、任意 factor 均满足不变量(多组随机取样)', () => {
      const samples: Array<[number, number, number, number, number, number]> = [
        [1, 0, 0, 0, 0, 1.2], [0.6, 40, -30, 200, 300, 0.83], [2.5, -80, 15, 500, 10, 1.05], [0.4, 5, 5, 0, 0, 1.4],
      ]
      for (const [scale, tx, ty, px, py, factor] of samples) {
        const state = { scale, tx, ty }
        const pointer = { x: px, y: py }
        const worldBefore = { x: (pointer.x - state.tx) / state.scale, y: (pointer.y - state.ty) / state.scale }
        const next = zoomAtPoint(state, pointer, factor)
        const worldAfter = { x: (pointer.x - next.tx) / next.scale, y: (pointer.y - next.ty) / next.scale }
        expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6)
        expect(worldAfter.y).toBeCloseTo(worldBefore.y, 6)
      }
    })

    it('已在上限饱和时继续放大:状态原样返回(不抖动)', () => {
      const state = { scale: 2.5, tx: 3, ty: 4 }
      const next = zoomAtPoint(state, { x: 100, y: 100 }, 1.2)
      expect(next).toEqual(state)
    })

    it('已在下限饱和时继续缩小:状态原样返回(不抖动)', () => {
      const state = { scale: 0.4, tx: 3, ty: 4 }
      const next = zoomAtPoint(state, { x: 100, y: 100 }, 1 / 1.2)
      expect(next).toEqual(state)
    })
  })

  describe('panBy — 纯平移', () => {
    it('只改变 tx/ty,scale 不变', () => {
      const state = { scale: 1.5, tx: 10, ty: 20 }
      expect(panBy(state, 5, -8)).toEqual({ scale: 1.5, tx: 15, ty: 12 })
    })
  })
})
