import { describe, it, expect } from 'vitest'
import pkg from '../package.json'

// CLAUDE.md 硬约束 1:Vite 5 / React 18 / echarts 5 / ag-grid 32(Node 20)不升级。
// 这是绊线测试:任何人(或任何模型)动 package.json 主版本,这里先红——
// 升级须走 ADR + 全量回归,不得静默发生。
const major = (spec: string) => {
  const m = /(\d+)/.exec(spec)
  return m ? Number(m[1]) : NaN
}

describe('版本钉扎(硬约束 1)', () => {
  const deps: Record<string, string> = { ...pkg.dependencies, ...pkg.devDependencies }
  it.each([
    ['react', 18], ['react-dom', 18],
    ['vite', 5], ['echarts', 5],
    ['ag-grid-community', 32], ['ag-grid-react', 32],
  ])('%s 主版本 = %i', (name, want) => {
    expect(deps[name], `${name} 不在依赖中?`).toBeTruthy()
    expect(major(deps[name])).toBe(want)
  })
})
