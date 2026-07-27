/**
 * @vitest-environment jsdom
 *
 * 对比页选择器锁测(报障 2026-07-27:下拉与项目树不一致 + 选不出案例无出路)。
 * 语义:可选集 = 有存档(树中可见)∨ 已有案例;残渣(两者皆无)不出现;同名缀 #id;
 * 无案例项目禁选;选中无案例项目时给出生成路径提示;运行按钮选满才可用。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const CASE = { id: 9, kind: 'report', consequences: {}, version_hash: 'a'.repeat(64), created_at: 't', scenario: null, risk: { cells: [], worst: null } }
const ROWS = [
  { uuid: 'u-arch-case', name: '供应商A', versions: 3, latest_hash: 'h', review_state: null, open_review: null, latest_case: CASE, saved_id: 's1' },
  { uuid: 'u-arch-nocase', name: 'test1', versions: 2, latest_hash: 'h', review_state: null, open_review: null, latest_case: null, saved_id: 's2' },
  { uuid: 'u-pin-only', name: '电芯内短 → 热失控', versions: 5, latest_hash: 'h', review_state: null, open_review: null, latest_case: CASE, saved_id: null },
  { uuid: 'u-residue', name: 'QUIZ-DEL-测试', versions: 1, latest_hash: 'h', review_state: null, open_review: null, latest_case: null, saved_id: null },
  { uuid: 'u-dup-1', name: 'IE_TR', versions: 1, latest_hash: 'h', review_state: null, open_review: null, latest_case: CASE, saved_id: 's3' },
  { uuid: 'u-dup-2', name: 'IE_TR', versions: 1, latest_hash: 'h', review_state: null, open_review: null, latest_case: null, saved_id: 's4' },
]

vi.mock('../../api', async (orig) => ({
  ...(await orig() as object),
  getPortfolio: () => Promise.resolve(ROWS),
  // 幽灵存档:树里有(listSaved),版本库没有(portfolio 无 saved_id 对应行)——ADR-2 前老存档
  listSaved: () => Promise.resolve([
    { id: 's1', name: '供应商A', saved_at: 't' },
    { id: 's-ghost', name: '默认热失控级联', saved_at: 't' },
  ]),
  listCompareGroups: () => Promise.resolve([]),
  listProjectCases: (uuid: string) => Promise.resolve(uuid === 'u-arch-nocase' ? [] : [
    { id: 9, version_id: 3, kind: 'report', engine_version: 'x', created_at: '2026-07-17T00:00:00' },
  ]),
}))

import { CompareTab } from './CompareTab'

let host: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); host = null; root = null })

async function renderTab(): Promise<HTMLDivElement> {
  act(() => root!.render(<CompareTab />))
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const sel = host!.querySelector('[data-testid="slot-project-0"]') as HTMLSelectElement | null
    if (sel && sel.options.length > 1) return host!
    await act(async () => { await new Promise((r) => setTimeout(r, 15)) })
  }
  throw new Error('选择器未就绪')
}

function setSelect(el: HTMLSelectElement, v: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!
  act(() => { setter.call(el, v); el.dispatchEvent(new Event('change', { bubbles: true })) })
}

describe('对比页选择器', () => {
  it('残渣不出现;同名缀 #id;无案例项目禁选标注', async () => {
    const el = await renderTab()
    const sel = el.querySelector('[data-testid="slot-project-0"]') as HTMLSelectElement
    const labels = [...sel.options].map((o) => o.textContent)
    expect(labels.join('|')).not.toContain('QUIZ-DEL-测试')          // 无存档且无案例 → 滤除
    expect(labels.some((t) => t?.includes('电芯内短'))).toBe(true)   // 无存档但有案例 → 保留
    expect(labels.some((t) => t === 'IE_TR #u-du(无案例)' || /IE_TR #u-du/.test(t ?? ''))).toBe(true) // 同名去歧义
    const noCaseOpt = [...sel.options].find((o) => o.value === 'u-arch-nocase')!
    expect(noCaseOpt.disabled).toBe(true)
    expect(noCaseOpt.textContent).toContain('(无案例)')
    // 幽灵存档(未入版本库)必须可见且禁选——树中可见者在此必可见
    const ghost = [...sel.options].find((o) => /默认热失控级联/.test(o.textContent || ''))!
    expect(ghost).toBeTruthy()
    expect(ghost.disabled).toBe(true)
    expect(ghost.textContent).toContain('(未入版本库)')
    // 已在版本库的存档(供应商A)不重复出现幽灵行
    expect([...sel.options].filter((o) => /供应商A/.test(o.textContent || ''))).toHaveLength(1)
  })

  it('选中无案例项目 ⇒ 案例下拉禁用 + 生成路径提示;选满前运行禁用', async () => {
    const el = await renderTab()
    const p0 = el.querySelector('[data-testid="slot-project-0"]') as HTMLSelectElement
    setSelect(p0, 'u-arch-case')
    await act(async () => { await new Promise((r) => setTimeout(r, 60)) })
    // 有案例项目:可选案例,尚未选满 → 运行禁用
    const runBtn = [...el.querySelectorAll('button')].find((b) => /运行对比/.test(b.textContent || '')) as HTMLButtonElement
    expect(runBtn.disabled).toBe(true)
    const c0 = el.querySelector('[data-testid="slot-case-0"]') as HTMLSelectElement
    setSelect(c0, '9')
    // 第二列选一个无案例项目 → 黄条提示
    const p1 = el.querySelector('[data-testid="slot-project-1"]') as HTMLSelectElement
    setSelect(p1, 'u-arch-nocase')
    await act(async () => { await new Promise((r) => setTimeout(r, 60)) })
    expect(el.querySelector('[data-testid="slot-nocase-1"]')?.textContent).toContain('导出一次报告')
    const c1 = el.querySelector('[data-testid="slot-case-1"]') as HTMLSelectElement
    expect(c1.disabled).toBe(true)
    expect(runBtn.disabled).toBe(true)                                 // 仍未选满
  })
})
