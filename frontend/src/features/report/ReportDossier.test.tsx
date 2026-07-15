/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ReportDossier } from './ReportDossier'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const h = vi.hoisted(() => ({
  versions: [] as any[],
  reviews: [] as any[],
  cases: [] as any[],
}))

vi.mock('../../api', () => ({
  listProjectVersions: vi.fn(async () => h.versions),
  listProjectCases: vi.fn(async () => h.cases),
  listProjectReviews: vi.fn(async () => h.reviews),
  listVersionComments: vi.fn(async () => []),
  addVersionComment: vi.fn(async () => ({ id: 9, author: 'a@x', created_at: '2026-07-12T09:00:00', body: 'x' })),
  submitReview: vi.fn(async () => ({})),
  signReview: vi.fn(async () => ({})),
  returnReview: vi.fn(async () => ({})),
  diffProjectVersions: vi.fn(async () => ({ from: {}, to: {}, changes: [], summary: { added: 0, removed: 0, changed: 0 } })),
  exportReport: vi.fn(async () => {}),
}))
import { exportReport, signReview, submitReview } from '../../api'
import { EMPTY_FTS, resetProjectStore, useProjectStore } from '../../stores/projectStore'
import type { ProjectEta } from '../../project'

const V = (id: number, hash: string) => ({
  id, content_hash: hash, parent_version_id: null,
  created_at: '2026-07-12T08:00:00', actor: 'liqingchuan@bess-psa/0.1.0', origin: 'save', message: null,
})
const persistence = { projectUuid: 'pu-1', buildPayload: () => ({}) } as any

let root: Root | null = null
let host: HTMLDivElement | null = null

const render = async () => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root!.render(<ReportDossier persistence={persistence} />) })
  await act(async () => {})                       // flush refresh() promise chains
}
const buttons = () => Array.from(host!.querySelectorAll('button'))
const click = async (label: string) => {
  const b = buttons().find((x) => x.textContent?.includes(label))
  expect(b, `button ${label}`).toBeTruthy()
  await act(async () => { b!.click() })
}

beforeEach(() => { h.versions = []; h.reviews = []; h.cases = [] })
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  vi.clearAllMocks()
})

describe('ReportDossier 台账签发(D-P5-5 方向 A)', () => {
  it('状态徽章与案例正式性按评审状态渲染', async () => {
    h.versions = [V(1, 'aaaa1111bbbb'), V(2, 'cccc2222dddd')]
    h.reviews = [
      { id: 1, version_id: 1, content_hash: 'aaaa1111bbbb', state: 'signed', submitted_by: 's@x', submitted_at: '', decided_by: 'wang@bess-psa/0.1.0', decided_at: '2026-07-12', note: null },
      { id: 2, version_id: 2, content_hash: 'cccc2222dddd', state: 'in_review', submitted_by: 's@x', submitted_at: '', decided_by: null, decided_at: null, note: null },
    ]
    h.cases = [
      { id: 11, version_id: 1, kind: 'report', engine_version: '0.1.0', created_at: '2026-07-12T08:30:00' },
      { id: 12, version_id: 2, kind: 'report', engine_version: '0.1.0', created_at: '2026-07-12T08:40:00' },
      // spec A §2.4:checked_set 案例 → 案例列表徽章「聚合 n 树」;无 scope 的旧案例照旧
      { id: 13, version_id: 2, kind: 'report', engine_version: '0.1.0', created_at: '2026-07-12T08:50:00',
        settings_json: JSON.stringify({ scope: 'checked_set', scenarios: [{ key: 'a', name: '内短' }, { key: 'b', name: '过充' }] }) },
    ]
    await render()
    const text = host!.textContent ?? ''
    expect(text).toContain('已签发 · wang')
    expect(text).toContain('送审中')
    expect(text).toContain('正式(签发版)')                 // 案例 #11(签发版)
    expect(text).toContain('工作稿')                        // 案例 #12(送审中 ≠ 正式)
    expect(text).toContain('聚合 2 树')                     // 案例 #13(checked_set 徽章)
  })

  it('最新草稿行有送审按钮,点击调用 submitReview', async () => {
    h.versions = [V(1, 'aaaa1111bbbb'), V(2, 'cccc2222dddd')]
    await render()
    // 仅最新版本(v2)有送审按钮
    expect(buttons().filter((b) => b.textContent === '送审')).toHaveLength(1)
    await click('送审')
    expect(submitReview).toHaveBeenCalledWith('pu-1', 2)
  })

  it('送审中行:签发弹窗确认路径调用 signReview(哈希与终态提示可见)', async () => {
    h.versions = [V(3, 'eeee3333ffff')]
    h.reviews = [{ id: 5, version_id: 3, content_hash: 'eeee3333ffff', state: 'in_review', submitted_by: 's@x', submitted_at: '', decided_by: null, decided_at: null, note: null }]
    await render()
    await click('签发…')
    expect(host!.textContent).toContain('eeee3333ffff')     // 弹窗展示完整哈希
    expect(host!.textContent).toContain('只增审计')
    // off 模式(authStore identity 默认 null)不渲染口令复核输入 —— 签发口令复核是 local 模式专属
    expect(host!.textContent).not.toContain('签发口令复核')
    await click('确认签发')
    expect(signReview).toHaveBeenCalledWith('pu-1', 3, undefined, undefined)
  })

  it('退回行带理由徽章;已签发行无动作按钮', async () => {
    h.versions = [V(4, '9999aaaa0000')]
    h.reviews = [{ id: 6, version_id: 4, content_hash: '9999aaaa0000', state: 'returned', submitted_by: 's@x', submitted_at: '', decided_by: 'wang@x', decided_at: '2026-07-11', note: 'B_OFFGAS 依据不足' }]
    await render()
    expect(host!.textContent).toContain('退回')
    expect(buttons().some((b) => b.textContent === '送审')).toBe(true)   // 退回后可重新送审
    expect(buttons().some((b) => b.textContent === '签发…')).toBe(false)
  })
})

// ── spec A:「按勾选集聚合」触发器(默认 OFF 零扰动;ON → trees[] = 全部勾选页签)──

function pEta(key: string, initEvent: string, opts: { checked?: boolean; initEvidence?: string } = {}): ProjectEta {
  return {
    key, name: key.toUpperCase(), renamed: false,
    model: {
      initEvent, initFreq: 1e-3,
      functionalEvents: [{ id: 'FE1', label: '屏障一', failProb: 0.1 }],
      root: {
        kind: 'branch', feId: 'FE1',
        success: { kind: 'leaf', consequence: 'C1' },
        failure: { kind: 'leaf', consequence: 'C2' },
      },
      ...(opts.initEvidence ? { initEvidence: opts.initEvidence } : {}),
    } as any,
    fts: EMPTY_FTS,
    pfds: {},
  }
}

describe('ReportDossier 勾选集聚合导出(spec A)', () => {
  beforeEach(() => {
    resetProjectStore()
    // 3 页签,勾选 a、b(c 不勾)→ 聚合应恰为 [a, b]
    useProjectStore.getState().load(
      [pEta('a', '电芯内短路', { initEvidence: '舱级 canonical,见稿 B' }), pEta('b', 'BMS 过充'), pEta('c', '外部火烧')],
      'a', { a: true, b: true, c: false })
  })
  afterEach(() => resetProjectStore())

  const toggle = () => host!.querySelector('[data-testid="agg-scope-toggle"]') as HTMLInputElement

  it('默认 OFF:导出请求不带 scope/trees(单场景零扰动),场景名 = 当前初因', async () => {
    await render()
    expect(toggle()).toBeTruthy()
    expect(toggle().checked).toBe(false)
    expect(host!.textContent).toContain('按勾选集聚合(2 棵)')   // 勾选计数 = a,b
    await click('Word')
    expect(exportReport).toHaveBeenCalledTimes(1)
    const [fmt, req, scenario] = (exportReport as any).mock.calls[0]
    expect(fmt).toBe('docx')
    expect(req.scope).toBeUndefined()
    expect(req.trees).toBeUndefined()
    expect(scenario).toBe('电芯内短路')
  })

  it('ON:trees[] = 全部勾选页签(key/name/单树字段/init_note 透传),场景名标聚合口径', async () => {
    await render()
    await act(async () => { toggle().click() })
    expect(toggle().checked).toBe(true)
    await click('CSV')
    const [fmt, req, scenario] = (exportReport as any).mock.calls[0]
    expect(fmt).toBe('csv')
    expect(req.scope).toBe('checked_set')
    expect(req.trees).toHaveLength(2)                            // c 未勾选 → 不在集合
    expect(req.trees.map((t: any) => t.key)).toEqual(['a', 'b'])
    expect(req.trees[0].name).toBe('电芯内短路')                  // 未改名页签显示名 = 初因名
    expect(req.trees[0].init_event).toBe('电芯内短路')
    expect(req.trees[0].init_frequency).toBe(1e-3)
    expect(req.trees[0].sequences.length).toBeGreaterThan(0)      // 单树序列化(toEngineRequest)
    expect(req.trees[0].labels).toEqual({ FE1: '屏障一' })
    expect(req.trees[0].init_note).toBe('舱级 canonical,见稿 B')  // spec B 注记透传
    expect(req.trees[1].init_note).toBeUndefined()                // 无注记 → 优雅省略
    expect(scenario).toBe('勾选集聚合(2 树)')
  })
})
