/**
 * @vitest-environment jsdom
 *
 * 站级页锁测:KPI 标签绑定铁律(评审 BLOCKING-1 的 UI 落点)——「≥5 舱」只许显示
 * metrics.ge5,「整排」只许显示 metrics.ge_row(两值刻意取不同数量级,错绑必被抓);
 * 简化清单必须渲染(口径不藏);舱检视器展示 chain5 与版本哈希。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const DOC = {
  id: 7, name: '试点站',
  products: [{ key: 'A', label: '供应商A', project_uuid: 'u1', case_id: 9 }],
  rows: [{ id: 'Z1', cabins: [{ id: 'Z1-01', product: 'A' }, { id: 'Z1-02', product: 'A' }], walls: [0] }],
  edge_defaults: { intra_p: 0.1, wall_p: 0.03, inter_row_p: 0.02 },
  edge_overrides: [],
  station_barriers: [{ key: 'sup', label: '站级消防', pfd: 0.29, grade: 'D', scope: '全站', basis: 'x' }],
  ccf_groups: [{ key: 'fw-A', label: 'A 固件', member_products: ['A'], beta: 0.05 }],
  offsite: { p_fence: 0.1 },
}
const Q = {
  metrics: { any: 2.2e-4, ge2: 3.3e-6, ge5: 4.7e-8, ge_row: 2.0e-11, offsite: 1.1e-6 },
  rows: [{ id: 'Z1', k: 2 }],
  per_cabin: [
    { id: 'Z1-01', product: 'A', row: 'Z1', f: 1.1e-4, f4: 1.1e-5, esc: 0.03, chain_row: 0.03, chain5: 0.0, source_rank_value: 0 },
    { id: 'Z1-02', product: 'A', row: 'Z1', f: 1.1e-4, f4: 1.1e-5, esc: 0.03, chain_row: 0.03, chain5: 0.0, source_rank_value: 0 },
  ],
  per_source_rank: [],
  products: [{ key: 'A', label: '供应商A', project: { uuid: 'u1', name: '供应商A' }, case: { id: 9, vid: 3, created_at: '2026-07-17T00:00:00', version_hash: 'f'.repeat(64) }, f: 1.1e-4, f4: 1.1e-5 }],
  gates: { g_sup: 0.29, g_er: 1 },
  declared: { ccf_groups: DOC.ccf_groups, simplifications: ['点值未计入跨舱 CCF(…)', 'ge5 只计排内连片…'] },
}

vi.mock('../../api', async (orig) => ({
  ...(await orig() as object),
  listStations: () => Promise.resolve([{ id: 7, name: '试点站', modified_at: 't', created_by: 'x' }]),
  getPortfolio: () => Promise.resolve([]),
  getStation: () => Promise.resolve(DOC),
  quantifyStation: () => Promise.resolve(Q),
}))

import { StationTab } from './StationTab'

let host: HTMLDivElement | null = null
let root: Root | null = null
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); host = null; root = null })

describe('站级页', () => {
  it('KPI 标签绑定:≥5 舱 ↔ ge5,整排 ↔ ge_row;简化清单渲染;检视器带 chain5 与哈希', async () => {
    act(() => root!.render(<StationTab />))
    // 打开站型
    const deadline = Date.now() + 5000
    let sel: HTMLSelectElement | null = null
    while (Date.now() < deadline) {
      sel = host!.querySelector('[data-testid="station-open"]')
      if (sel && sel.options.length > 1) break
      await act(async () => { await new Promise((r) => setTimeout(r, 15)) })
    }
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!
    act(() => { setter.call(sel!, '7'); sel!.dispatchEvent(new Event('change', { bubbles: true })) })
    while (Date.now() < deadline && !host!.querySelector('[data-testid="kpi-ge5"]')) {
      await act(async () => { await new Promise((r) => setTimeout(r, 15)) })
    }
    const ge5 = host!.querySelector('[data-testid="kpi-ge5"]')!
    const geRow = host!.querySelector('[data-testid="kpi-gerow"]')!
    expect(ge5.textContent).toContain('≥5 舱')
    expect(ge5.textContent).toContain('4.70e-8')            // = metrics.ge5
    expect(geRow.textContent).toContain('整排')
    expect(geRow.textContent).toContain('2.00e-11')         // = metrics.ge_row —— 两值数量级分离,错绑必挂
    expect(ge5.textContent).not.toContain('2.00e-11')
    // 口径申报
    expect(host!.querySelector('[data-testid="simplifications"]')?.textContent).toContain('CCF')
    // 舱检视器
    const cab = host!.querySelector('[data-testid="cab-Z1-01"]') as HTMLElement
    act(() => { cab.click() })
    expect(host!.textContent).toContain('ffffffff')          // 版本哈希短码
    expect(host!.textContent).toContain('chain5')
  })
})
