/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ExplorerTree } from './ExplorerTree'
import { useProjectStore, EMPTY_FTS, resetProjectStore } from '../../stores/projectStore'
import { DEFAULT_MAPPING } from '../../fmea'
import type { ProjectEta } from '../../project'
import type { EventTreeModel } from '../../eventtree'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mkEta = (key: string, name: string): ProjectEta => ({
  key,
  name,
  model: {
    initEvent: name,
    initFreq: 0.001,
    functionalEvents: [{ id: 'B1', label: 'BMS', failProb: 0.1 }],
    root: { kind: 'branch', feId: 'B1', success: { kind: 'leaf', consequence: 'C1' }, failure: { kind: 'leaf', consequence: 'C4' } },
  } as EventTreeModel,
  fts: EMPTY_FTS,
  pfds: {},
})

const freshMapping = () => JSON.parse(JSON.stringify(DEFAULT_MAPPING))

function seed() {
  useProjectStore.setState({
    past: [], future: [],
    present: { etas: [mkEta('e1', 'ETA 甲'), mkEta('e2', 'ETA 乙')], userFts: EMPTY_FTS },
    activeKey: 'e1', checkedKeys: {}, pfds: {},
    identity: { savedId: 's1', projectUuid: '', displayName: '项目 A' },
    workspaceId: 'w1',
    parked: {
      w2: {
        past: [], present: { etas: [], userFts: EMPTY_FTS }, future: [], activeKey: '', checkedKeys: {}, pfds: {},
        identity: { savedId: 's2', projectUuid: '', displayName: '项目 B' },
        fmeaRows: [], fmeaMapping: freshMapping(),
      },
    },
    openOrder: ['w1', 'w2'],
    fmeaRows: [], fmeaMapping: freshMapping(),
  })
}

const persistence = { saved: [], loadProject: vi.fn(), loading: false } as any

let root: Root | null = null
let host: HTMLDivElement | null = null
let setTab: ReturnType<typeof vi.fn>

function render(tab = 'home') {
  setTab = vi.fn()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(<ExplorerTree persistence={persistence} tab={tab as any} setTab={setTab} />))
  return host
}

beforeEach(() => { resetProjectStore(); seed() })
afterEach(() => {
  if (root) act(() => root!.unmount())
  host?.remove()
  root = null
  host = null
  resetProjectStore()
})

describe('ExplorerTree FE-09 — 参数库/CCF 移出项目子树', () => {
  it('参数库节点存在,但不在活动项目分组内,并归入「示例 / 教学(全局)」区', () => {
    const el = render()
    const projectGroup = el.querySelector('[role="group"][aria-label="项目 A"]') as HTMLElement
    expect(projectGroup).not.toBeNull()
    // 项目子树内不得再出现参数库(否则用户误以为改的是项目参数)
    expect(projectGroup.textContent).not.toContain('参数库')

    const items = Array.from(el.querySelectorAll('[role="treeitem"]'))
    const paramItem = items.find((x) => x.textContent?.includes('参数库 / CCF'))
    expect(paramItem).toBeTruthy()
    expect(projectGroup.contains(paramItem!)).toBe(false)
    expect(el.textContent).toContain('示例 / 教学(全局)')
  })
})

describe('ExplorerTree FE-13 — 键盘可达', () => {
  it('容器为 role=tree,项为 role=treeitem 且可聚焦(tabindex=0)', () => {
    const el = render()
    expect(el.querySelector('nav.exp-tree')?.getAttribute('role')).toBe('tree')
    const items = Array.from(el.querySelectorAll('[role="treeitem"]'))
    expect(items.length).toBeGreaterThan(0)
    expect(items.every((x) => x.getAttribute('tabindex') === '0')).toBe(true)
  })

  it('Enter 键在非活动项目上等效点击 → 切换项目', () => {
    const el = render()
    const projB = Array.from(el.querySelectorAll('[role="treeitem"]')).find((x) => x.textContent?.includes('项目 B')) as HTMLElement
    expect(projB).toBeTruthy()
    act(() => { projB.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(useProjectStore.getState().workspaceId).toBe('w2')
  })

  it('Space 键在 ETA 节点上等效点击 → 选中该 ETA 并切到事件树页', () => {
    const el = render('bess')
    const eta = Array.from(el.querySelectorAll('[role="treeitem"]')).find((x) => x.textContent?.includes('ETA 乙')) as HTMLElement
    expect(eta).toBeTruthy()
    act(() => { eta.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })) })
    expect(useProjectStore.getState().activeKey).toBe('e2')
    expect(setTab).toHaveBeenCalledWith('bess')
  })
})

describe('统一稳定序(报障 2026-07-25:点开存档随机换位)', () => {
  it('打开项目与存档按名称交错排序,打开态原位标注而非置顶成组', () => {
    const p2 = { ...persistence, saved: [
      { id: 'a1', name: 'A 存档', saved_at: 't' },
      { id: 'z9', name: 'Z 存档', saved_at: 't' },
    ] } as any
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root!.render(<ExplorerTree persistence={p2} tab={'home' as any} setTab={vi.fn()} />))
    const prj = [...host.querySelectorAll('.it.prj')].map((e) => e.textContent?.replace(/\s+/g, ' ').trim())
    const idx = (s: string) => prj.findIndex((t) => t!.includes(s))
    // 不变量:呈现序 = 名称字典序(zh),与打开/存档身份无关 —— 期望序用同一比较器算,
    // 不硬编码 locale 的拉丁/汉字先后(环境 ICU 差异)。
    const names = ['A 存档', 'Z 存档', '项目 A', '项目 B']
    const expected = names.slice().sort((x, y) => x.localeCompare(y, 'zh'))
    const actual = names.slice().sort((x, y) => idx(x) - idx(y))
    for (const n of names) expect(idx(n)).toBeGreaterThanOrEqual(0)
    expect(actual).toEqual(expected)
    // 打开的项目仍在同一列表(未被抽走):活动项目行带展开箭头 ▾
    expect(prj.find((t) => t!.includes('项目 A'))!.startsWith('▾')).toBe(true)
  })

  it('打开的存档不再重复出现在存档段(去重逻辑保持)', () => {
    const p2 = { ...persistence, saved: [
      { id: 's1', name: '项目 A', saved_at: 't' },   // 与打开项目同 savedId
      { id: 'a1', name: 'A 存档', saved_at: 't' },
    ] } as any
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root!.render(<ExplorerTree persistence={p2} tab={'home' as any} setTab={vi.fn()} />))
    const hits = [...host.querySelectorAll('.it.prj')].filter((e) => e.textContent?.includes('项目 A'))
    expect(hits).toHaveLength(1)
  })
})
