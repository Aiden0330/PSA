import type { SavedItem, SavedRecord } from './api'

// 单键存全部存档; import type 确保与 api.ts 仅类型耦合(运行时无循环依赖)
const KEY = 'bess-eta:saved:v1'
type Store = Record<string, SavedRecord>

function readStore(): Store {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const o = JSON.parse(raw)
    return o && typeof o === 'object' ? (o as Store) : {}
  } catch {
    return {} // 坏 JSON / localStorage 不可读 → 视为空(镜像后端吞坏文件)
  }
}

function writeStore(s: Store): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    // 配额超限 / 隐私模式 setItem 抛错 → 统一可读错误(lsSave 与 lsDelete 共用)
    throw new Error('本地存储失败(可能是隐私模式或空间不足)')
  }
}

function genId(): string {
  const c = (globalThis as any).crypto
  if (c?.getRandomValues) {
    const a = new Uint8Array(4)
    c.getRandomValues(a)
    return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('')
  }
  return Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0')
}

export function lsList(): SavedItem[] {
  const s = readStore()
  return Object.values(s)
    .map(({ id, name, saved_at }) => ({ id, name, saved_at }))
    .sort((a, b) => (a.saved_at < b.saved_at ? 1 : -1))
}

export function lsLoad(id: string): SavedRecord {
  const r = readStore()[id]
  if (!r) throw new Error(`存档 ${id} 不存在`)
  return r
}

export function lsSave(name: string, payload: any, id?: string): SavedItem {
  const s = readStore()
  const sid = id ?? genId()   // 传 id → 原地覆盖现有存档; 省略 → 新建
  const rec: SavedRecord = { id: sid, name, saved_at: new Date().toISOString(), payload }
  s[sid] = rec
  writeStore(s) // writeStore 已统一抛可读错误
  return { id: sid, name, saved_at: rec.saved_at }
}

export function lsDelete(id: string): void {
  const s = readStore()
  if (!(id in s)) throw new Error(`存档 ${id} 不存在`)
  delete s[id]
  writeStore(s)
}
