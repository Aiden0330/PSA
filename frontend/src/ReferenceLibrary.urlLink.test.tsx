/** 参考库 URL 单元格外链锁测(2026-07-25)。
 *
 * 语义:URL 列的**已提交值**是 http(s) 时,单元格渲染 target=_blank 的 ↗ 锚点
 * (rel 带 noopener noreferrer);非 URL 值(空/普通文本)不渲染锚点。这是用户从
 * 表格核对出处的唯一入口——note/grade 不随节点快照走,断链即证据链断头。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ReferenceLibrary } from './components/ReferenceLibrary'

const LIB = {
  meta: { version: '0.3', disclaimer: '演示用途' },
  component_failure_rates: [
    { id: 'cfr-a', name: '带链器件', failure_mode: 'x', rate: 1e-6, unit: '/unit·yr', grade: 'C',
      source: { citation: 'IEEE 493', url: 'https://ieeexplore.ieee.org/document/4264700' } },
    { id: 'cfr-b', name: '无链器件', failure_mode: 'x', rate: 1e-6, unit: '/unit·yr', grade: 'D',
      source: { citation: '内部分配表' } },
  ],
  barrier_effectiveness: [],
  initiating_events: [],
}

vi.mock('./api', () => ({ getLibrary: () => Promise.resolve(LIB) }))

let host: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => { localStorage.clear() })
afterEach(() => {
  if (root) act(() => root!.unmount())
  host?.remove(); host = null; root = null
})

async function renderLib(): Promise<HTMLDivElement> {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(<ReferenceLibrary />))
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    if (host.querySelector('table')) return host
    await act(async () => { await new Promise((r) => setTimeout(r, 15)) })
  }
  throw new Error('参考库表格未渲染')
}

describe('ReferenceLibrary URL 外链', () => {
  it('http(s) URL 渲染 _blank 锚点且 rel 安全;无 URL 行不渲染', async () => {
    const el = await renderLib()
    const anchors = [...el.querySelectorAll('a[target="_blank"]')] as HTMLAnchorElement[]
    const hit = anchors.filter((a) => a.href === 'https://ieeexplore.ieee.org/document/4264700')
    expect(hit).toHaveLength(1)
    expect(hit[0].rel).toContain('noopener')
    expect(hit[0].rel).toContain('noreferrer')
    // 无链行:整表只有这一个外链锚点(导出按钮等不是 <a target=_blank>)
    expect(anchors).toHaveLength(1)
    // 输入框仍在(可编辑性不因锚点丢失)
    const urlInputs = [...el.querySelectorAll('input')].filter(
      (i) => (i as HTMLInputElement).value.startsWith('https://ieeexplore'))
    expect(urlInputs).toHaveLength(1)
  })
})
