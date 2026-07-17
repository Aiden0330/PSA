import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  getOverlay, applyOverlay, upsertEntry, deleteEntry, resetOverlay,
  mergeOverlay, emptyOverlay, buildLibraryFile, parseLibraryFile,
} from './libraryStore'
import type { LibraryData } from './api'

const base: LibraryData = {
  meta: { disclaimer: 'D' } as any,
  component_failure_rates: [
    { id: 'C1', name: '电芯', failure_mode: '热失控', rate: 1e-7, unit: '/cell', source: { citation: 'x' } },
    { id: 'C2', name: 'BMS', failure_mode: '失效', rate: 1e-5, unit: '/h', source: { citation: 'y' } },
  ],
  barrier_effectiveness: [{ id: 'B1', name: 'CID', category: 'cell', pfd: 0.1, source: { citation: 'z' } }],
  initiating_events: [{ id: 'I1', label: '内短', category: 'cell', freq_prior: 1e-3, source: { citation: 'w' } }],
}

beforeEach(() => localStorage.clear())

describe('libraryStore', () => {
  it('无覆盖层 → applyOverlay 与基线等价, 且不改基线对象', () => {
    const out = applyOverlay(base, getOverlay())
    expect(out.component_failure_rates).toHaveLength(2)
    expect(out.component_failure_rates).not.toBe(base.component_failure_rates)
  })

  it('upsert 覆盖既有 id 字段(不增行)', () => {
    upsertEntry('component_failure_rates', { id: 'C1', name: '电芯', failure_mode: '热失控', rate: 9e-9, unit: '/cell', source: { citation: 'x' } })
    const out = applyOverlay(base, getOverlay())
    expect(out.component_failure_rates.find((r) => r.id === 'C1')!.rate).toBe(9e-9)
    expect(out.component_failure_rates).toHaveLength(2)
  })

  it('upsert 新 id → 追加', () => {
    upsertEntry('barrier_effectiveness', { id: 'B9', name: '气溶胶', category: 'module', pfd: 0.2, source: { citation: 'n' } })
    const ids = applyOverlay(base, getOverlay()).barrier_effectiveness.map((r) => r.id)
    expect(ids).toContain('B9'); expect(ids).toHaveLength(2)
  })

  it('delete 隐藏基线行', () => {
    deleteEntry('component_failure_rates', 'C2')
    expect(applyOverlay(base, getOverlay()).component_failure_rates.map((r) => r.id)).toEqual(['C1'])
  })

  it('upsert 同 id 复活被删行', () => {
    deleteEntry('component_failure_rates', 'C2')
    upsertEntry('component_failure_rates', { id: 'C2', name: 'BMS', failure_mode: '失效', rate: 2e-5, unit: '/h', source: { citation: 'y' } })
    expect(applyOverlay(base, getOverlay()).component_failure_rates.find((r) => r.id === 'C2')!.rate).toBe(2e-5)
  })

  it('meta 保留', () => {
    expect(applyOverlay(base, getOverlay()).meta).toEqual(base.meta)
  })

  it('resetOverlay 清空 → 回基线', () => {
    deleteEntry('component_failure_rates', 'C2'); resetOverlay()
    expect(applyOverlay(base, getOverlay()).component_failure_rates).toHaveLength(2)
  })

  it('mergeOverlay 非破坏并入(只 upsert, 保留本地删除)', () => {
    deleteEntry('component_failure_rates', 'C1')
    const other = emptyOverlay()
    other.upsert.barrier_effectiveness['B9'] = { id: 'B9', name: 'x', category: 'm', pfd: 0.3, source: { citation: 'a' } }
    mergeOverlay(other)
    const out = applyOverlay(base, getOverlay())
    expect(out.component_failure_rates.map((r) => r.id)).toEqual(['C2'])
    expect(out.barrier_effectiveness.map((r) => r.id)).toContain('B9')
  })

  it('buildLibraryFile / parseLibraryFile round-trip', () => {
    upsertEntry('barrier_effectiveness', { id: 'B9', name: 'x', category: 'm', pfd: 0.3, source: { citation: 'a' } })
    expect(parseLibraryFile(JSON.stringify(buildLibraryFile())).upsert.barrier_effectiveness['B9'].pfd).toBe(0.3)
  })

  it('parseLibraryFile 坏格式抛错', () => {
    expect(() => parseLibraryFile('{bad')).toThrow(/JSON/)
    expect(() => parseLibraryFile(JSON.stringify({ x: 1 }))).toThrow(/无法识别/)
  })

  it('坏 JSON → getOverlay 返回空覆盖层', () => {
    localStorage.setItem('bess-eta:library-overlay:v1', '{bad')
    expect(getOverlay()).toEqual(emptyOverlay())
  })

  it('setItem 抛错 → 写操作抛可读错误', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError') })
    expect(() => upsertEntry('initiating_events', { id: 'I9', label: 'x', category: 'c', freq_prior: 1e-3, source: { citation: 'q' } })).toThrow(/参考库本地保存失败/)
    spy.mockRestore()
  })
})

const validFile = (overlay: object) => JSON.stringify({ kind: 'bess-psa-library', version: 1, exportedAt: '2026-07-17', overlay })

describe('parseLibraryFile — 导入事务式校验(FE-10)', () => {
  const goodOverlay = {
    upsert: { component_failure_rates: {}, barrier_effectiveness: { B9: { id: 'B9', name: 'x', category: 'm', pfd: 0.3, source: { citation: 'a' } } }, initiating_events: {} },
    deleted: { component_failure_rates: [], barrier_effectiveness: [], initiating_events: [] },
  }
  it('合法文件通过并透传 overlay', () => {
    expect(parseLibraryFile(validFile(goodOverlay)).upsert.barrier_effectiveness.B9.pfd).toBe(0.3)
  })
  it('未知版本点名拒绝', () => {
    expect(() => parseLibraryFile(JSON.stringify({ kind: 'bess-psa-library', version: 99, overlay: goodOverlay }))).toThrow(/版本/)
  })
  it('越界值(PFD>1)拒绝且带分区+id', () => {
    const bad = { ...goodOverlay, upsert: { ...goodOverlay.upsert, barrier_effectiveness: { B9: { id: 'B9', name: 'x', category: 'm', pfd: 5, source: { citation: 'a' } } } } }
    expect(() => parseLibraryFile(validFile(bad))).toThrow(/barrier_effectiveness.*B9/)
  })
  it('空 citation 拒绝', () => {
    const bad = { ...goodOverlay, upsert: { ...goodOverlay.upsert, barrier_effectiveness: { B9: { id: 'B9', name: 'x', category: 'm', pfd: 0.3, source: { citation: '' } } } } }
    expect(() => parseLibraryFile(validFile(bad))).toThrow(/citation|来源/)
  })
  it('跨分区重复 id 拒绝', () => {
    const bad = { ...goodOverlay, upsert: {
      component_failure_rates: { X1: { id: 'X1', name: 'c', failure_mode: 'm', rate: 1e-7, unit: '/cell·yr', grade: 'D', source: { citation: 'a' } } },
      barrier_effectiveness: { X1: { id: 'X1', name: 'x', category: 'm', pfd: 0.3, source: { citation: 'a' } } }, initiating_events: {},
    } }
    expect(() => parseLibraryFile(validFile(bad))).toThrow(/重复|X1/)
  })
  it('超大文件拒绝(>2MB)', () => {
    const huge = 'x'.repeat(2 * 1024 * 1024 + 1)
    expect(() => parseLibraryFile(huge)).toThrow(/过大/)
  })
  it('校验失败时不改本地覆盖层(事务式)', () => {
    upsertEntry('barrier_effectiveness', { id: 'KEEP', name: 'k', category: 'm', pfd: 0.2, source: { citation: 'a' } })
    const before = JSON.stringify(getOverlay())
    const bad = { ...goodOverlay, upsert: { ...goodOverlay.upsert, barrier_effectiveness: { B9: { id: 'B9', name: 'x', category: 'm', pfd: 5, source: { citation: 'a' } } } } }
    expect(() => parseLibraryFile(validFile(bad))).toThrow()
    expect(JSON.stringify(getOverlay())).toBe(before)
  })
})

describe('getOverlay — 坏 JSON 隔离(不静默丢失)', () => {
  it('坏 JSON 搬到 corrupt-* 侧键并 console.warn, 原键回落空', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    localStorage.setItem('bess-eta:library-overlay:v1', '{corrupt')
    expect(getOverlay()).toEqual(emptyOverlay())
    const corruptKey = Object.keys(localStorage).find((k) => k.startsWith('bess-eta:library-overlay:v1:corrupt-'))
    expect(corruptKey).toBeTruthy()
    expect(localStorage.getItem(corruptKey!)).toBe('{corrupt')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
