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
const _B = (m: number) => ({ p05: m / 3, p50: m, p95: m * 3 })
const Q = {
  metrics: { any: 2.2e-4, ge2: 3.3e-6, ge5: 4.7e-8, ge_row: 2.0e-11, offsite: 1.1e-6 },
  bands: { any: _B(2.2e-4), ge2: _B(3.3e-6), ge5: _B(4.7e-8), ge_row: _B(2.0e-11), offsite: _B(1.1e-6) },
  band_notes: ['产品 A:箱 C3 点值>0 无带,以点值参与全部分位'],
  acceptance_results: [
    { metric: 'ge5', label: null, limit: 1e-6, eval_basis: 'point', value: 4.7e-8, verdict: 'pass', margin: 0.047, basis: 'NFPA 855 场址目标(示例)', reason: null },
    { metric: 'ge2', label: '多舱目标', limit: 1e-6, eval_basis: 'point', value: 3.3e-6, verdict: 'fail', margin: 3.3, basis: '内部准则(示例)', reason: null },
  ],
  rows: [{ id: 'Z1', k: 2 }],
  per_cabin: [
    { id: 'Z1-01', product: 'A', row: 'Z1', f: 1.1e-4, f4: 1.1e-5, esc: 0.03, chain_row: 0.03, chain5: 0.0, source_rank_value: 0 },
    { id: 'Z1-02', product: 'A', row: 'Z1', f: 1.1e-4, f4: 1.1e-5, esc: 0.03, chain_row: 0.03, chain5: 0.0, source_rank_value: 0 },
  ],
  per_source_rank: [],
  products: [{ key: 'A', label: '供应商A', project: { uuid: 'u1', name: '供应商A' }, case: { id: 9, vid: 3, created_at: '2026-07-17T00:00:00', version_hash: 'f'.repeat(64) }, f: 1.1e-4, f4: 1.1e-5, band_status: 'partial', f_band: _B(1.1e-4) }],
  gates: { g_sup: 0.29, g_er: 1 },
  declared: { ccf_groups: DOC.ccf_groups, simplifications: ['点值未计入跨舱 CCF(…)', 'ge5 只计排内连片…'] },
}

const updateSpy = vi.fn(() => Promise.resolve(DOC))
const pinSpy = vi.fn(() => Promise.resolve({ id: 42, station_id: 7, doc_hash: 'h'.repeat(64), engine_version: 'x', created_at: 't', actor: 'a' }))
vi.mock('../../api', async (orig) => ({
  ...(await orig() as object),
  listStations: () => Promise.resolve([{ id: 7, name: '试点站', modified_at: 't', created_by: 'x' }]),
  getPortfolio: () => Promise.resolve([]),
  listProjectCases: () => Promise.resolve([{ id: 9, version_id: 3, kind: 'report', engine_version: 'x', created_at: '2026-07-17T00:00:00' }]),
  getStation: () => Promise.resolve(DOC),
  quantifyStation: () => Promise.resolve(Q),
  updateStation: (...a: unknown[]) => updateSpy(...a as []),
  pinStation: (...a: unknown[]) => pinSpy(...a as []),
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
    // 报障 2026-07-27:打开必须回填向导(否则"不能保存"),保存修改走 updateStation
    const intra = host!.querySelector('[data-testid="intra-p"]') as HTMLInputElement
    expect(intra.value).toBe('0.1')                          // 来自 DOC.edge_defaults(回填)
    const save = host!.querySelector('[data-testid="save-changes"]') as HTMLButtonElement
    expect(save).toBeTruthy()
    act(() => { save.click() })
    await act(async () => { await new Promise((r) => setTimeout(r, 60)) })
    expect(updateSpy).toHaveBeenCalledTimes(1)
    expect((updateSpy.mock.calls[0] as unknown[])[0]).toBe(7)
    // 证据链出口:钉扎并导出(pin → 下载链接指向案例 docx)
    const pin = host!.querySelector('[data-testid="pin-report"]') as HTMLButtonElement
    expect(pin).toBeTruthy()
    act(() => { pin.click() })
    await act(async () => { await new Promise((r) => setTimeout(r, 60)) })
    expect(pinSpy).toHaveBeenCalledTimes(1)
    // ST-6:带行渲染在 ge5 卡内(p05–p95 + p50),band_notes 进不可隐藏申报区
    const band = host!.querySelector('[data-testid="kpi-ge5-band"]')
    expect(band?.textContent).toContain('1.57e-8')           // 4.7e-8/3 → toExponential(2)
    expect(band?.textContent).toContain('1.41e-7')           // 4.7e-8×3
    const simp = host!.querySelector('[data-testid="simplifications"]')
    expect(simp?.textContent).toContain('无带,以点值参与全部分位')
    // ST-7:判定 chips(标签绑定 + PASS/FAIL)+ FAIL 总横幅
    expect(host!.querySelector('[data-testid="acc-chip-0"]')?.textContent).toContain('≥5 舱(排内连片)')
    expect(host!.querySelector('[data-testid="acc-chip-0"]')?.textContent).toContain('PASS')
    expect(host!.querySelector('[data-testid="acc-chip-1"]')?.textContent).toContain('FAIL')
    expect(host!.querySelector('[data-testid="acc-fail-banner"]')?.textContent).toContain('未通过')
  })
})
