import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// ECharts 能力边界回归护栏(依赖审计 GHSA-fgmj-fm8m-jvvx:line-series tooltip 渲染不可信
// data.name 的 XSS 可达路径)。项目硬约束禁止升级 ECharts 5,故把「不可达」钉成静态断言:
// ResultsPanel 的 series 图元类型集合 ⊆ {bar} —— 无 line-series 即公告路径不可达。
// 从 vitest 根(frontend/)按已知相对路径读源码——import.meta.url 在 vite 下为 http scheme。
const src = readFileSync(resolve(process.cwd(), 'src/components/ResultsPanel.tsx'), 'utf8')

const SERIES_TYPES = ['bar', 'line', 'scatter', 'pie', 'graph', 'tree', 'treemap', 'sankey', 'heatmap', 'candlestick', 'radar', 'gauge', 'funnel']

describe('ResultsPanel — ECharts 能力边界(GHSA-fgmj-fm8m-jvvx 回归)', () => {
  it('series 图元类型集合 ⊆ {bar}', () => {
    const types = [...src.matchAll(/type:\s*'([a-zA-Z]+)'/g)].map((m) => m[1]).filter((t) => SERIES_TYPES.includes(t))
    expect(types.length).toBeGreaterThan(0)          // 确有图元被扫描到
    expect(types.every((t) => t === 'bar')).toBe(true) // 子集 ⊆ {bar}
  })
  it('不引入 line-series(公告可达路径的必要条件)', () => {
    expect(src).not.toContain("type: 'line'")
    expect(src).not.toContain('type: "line"')
  })
})
