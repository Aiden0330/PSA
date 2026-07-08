// FMEA 行数据 localStorage 持久化(仿 libraryStore.ts 风格)
import type { FmeaRow } from './fmea'

const KEY = 'bess-eta:fmea:v1'

const EXAMPLE_ROWS: FmeaRow[] = [
  { id: 'ex1', object: '动力电芯', mode: '内短路热失控', S: 9, O: 3, D: 6, source: '参考库' },
  { id: 'ex2', object: 'BMS 过充保护', mode: '逻辑误判', S: 6, O: 4, D: 4, source: '参考库' },
]

export function loadRows(): FmeaRow[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return EXAMPLE_ROWS
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.length > 0) return parsed as FmeaRow[]
    return EXAMPLE_ROWS
  } catch {
    return EXAMPLE_ROWS
  }
}

export function saveRows(rows: FmeaRow[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(rows))
  } catch {
    throw new Error('FMEA 数据本地保存失败(可能是隐私模式或空间不足)')
  }
}

export function clearRows(): void {
  try { localStorage.removeItem(KEY) } catch {}
}
