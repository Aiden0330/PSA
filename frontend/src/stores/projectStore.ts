import { create } from 'zustand'
import type { EventTreeModel } from '../eventtree'
import { setLinkFt } from '../eventtree'
import { attachStarterFt } from '../model'
import type { ModelJson } from '../model'
import type { ProjectEta } from '../project'

export const EMPTY_FTS: ModelJson = { model_data: { parameters: [] }, fault_trees: [] }

// 文档内容 = 全部 ETA 页签 + 自建 FTA 工作区,单一来源(无活动/非活动之分),
// 撤销/重做为文档级单历史。activeKey/checkedKeys 进存档 payload 但不进历史
// (切页签/勾选汇总不是内容编辑)。
export interface ProjectDoc {
  etas: ProjectEta[]
  userFts: ModelJson
}

type Updater<T> = T | ((prev: T) => T)
const apply = <T,>(u: Updater<T>, prev: T): T => (typeof u === 'function' ? (u as (p: T) => T)(prev) : u)

export interface ProjectStore {
  past: ProjectDoc[]
  present: ProjectDoc
  future: ProjectDoc[]
  activeKey: string
  checkedKeys: Record<string, boolean>

  /** 整体载入(读档/导入/初始场景):替换内容并清空历史。 */
  load: (etas: ProjectEta[], activeKey: string, checkedKeys: Record<string, boolean>, userFts?: ModelJson) => void
  /** 整体替换(AI 应用等):一次编辑 = 一条历史。 */
  applyProject: (p: { etas: ProjectEta[]; checkedKeys: Record<string, boolean>; activeKey: string; userFts?: ModelJson }) => void

  setActive: (key: string) => void
  toggleChecked: (key: string) => void

  setEtaModel: (key: string, m: Updater<EventTreeModel>) => void
  setEtaFts: (key: string, m: Updater<ModelJson>) => void
  setUserFts: (m: Updater<ModelJson>) => void
  addTab: (tab: ProjectEta, opts?: { checked?: boolean; activate?: boolean }) => void
  insertTabs: (tabs: ProjectEta[], afterKey?: string) => void
  removeTab: (key: string) => void
  renameTab: (key: string, name: string) => void
  /** 挂载屏障故障树:starter FT + linkFt 同步写入,单条历史。 */
  attachFt: (key: string, feIndex: number) => void
  detachFt: (key: string, feIndex: number) => void
  /** 派生量缓存写入(PFD):不产生历史条目。 */
  setEtaPfd: (key: string, feId: string, prob: number) => void

  undo: () => void
  redo: () => void
}

const initialDoc: ProjectDoc = { etas: [], userFts: EMPTY_FTS }

function mapEta(doc: ProjectDoc, key: string, f: (e: ProjectEta) => ProjectEta): ProjectDoc {
  return { ...doc, etas: doc.etas.map((e) => (e.key === key ? f(e) : e)) }
}

export const useProjectStore = create<ProjectStore>()((set) => {
  const push = (f: (doc: ProjectDoc) => ProjectDoc) =>
    set((s) => ({ past: [...s.past, s.present], present: f(s.present), future: [] }))
  // 派生量写入:替换 present,不推历史(撤销栈对派生缓存透明)
  const quiet = (f: (doc: ProjectDoc) => ProjectDoc) => set((s) => ({ present: f(s.present) }))

  return {
    past: [],
    present: initialDoc,
    future: [],
    activeKey: '',
    checkedKeys: {},

    load: (etas, activeKey, checkedKeys, userFts) =>
      set({ past: [], future: [], present: { etas, userFts: userFts ?? EMPTY_FTS }, activeKey, checkedKeys }),

    applyProject: ({ etas, checkedKeys, activeKey, userFts }) =>
      set((s) => ({
        past: [...s.past, s.present],
        present: { etas, userFts: userFts ?? s.present.userFts },
        future: [],
        activeKey,
        checkedKeys,
      })),

    setActive: (activeKey) => set({ activeKey }),
    toggleChecked: (key) => set((s) => ({ checkedKeys: { ...s.checkedKeys, [key]: !s.checkedKeys[key] } })),

    setEtaModel: (key, m) => push((doc) => mapEta(doc, key, (e) => ({ ...e, model: apply(m, e.model) }))),
    setEtaFts: (key, m) => push((doc) => mapEta(doc, key, (e) => ({ ...e, fts: apply(m, e.fts ?? EMPTY_FTS) }))),
    setUserFts: (m) => push((doc) => ({ ...doc, userFts: apply(m, doc.userFts) })),

    addTab: (tab, opts) =>
      set((s) => ({
        past: [...s.past, s.present],
        present: { ...s.present, etas: [...s.present.etas, tab] },
        future: [],
        ...(opts?.activate !== false ? { activeKey: tab.key } : {}),
        ...(opts?.checked !== false ? { checkedKeys: { ...s.checkedKeys, [tab.key]: true } } : {}),
      })),

    insertTabs: (tabs, afterKey) =>
      push((doc) => {
        const idx = afterKey ? doc.etas.findIndex((e) => e.key === afterKey) : -1
        const at = idx >= 0 ? idx + 1 : doc.etas.length
        return { ...doc, etas: [...doc.etas.slice(0, at), ...tabs, ...doc.etas.slice(at)] }
      }),

    removeTab: (key) =>
      set((s) => {
        const idx = s.present.etas.findIndex((e) => e.key === key)
        if (idx < 0 || s.present.etas.length <= 1) return s
        const etas = s.present.etas.filter((e) => e.key !== key)
        const checkedKeys = { ...s.checkedKeys }
        delete checkedKeys[key]
        const activeKey = s.activeKey === key ? etas[Math.min(idx, etas.length - 1)].key : s.activeKey
        return { past: [...s.past, s.present], present: { ...s.present, etas }, future: [], activeKey, checkedKeys }
      }),

    renameTab: (key, name) => push((doc) => mapEta(doc, key, (e) => ({ ...e, name, renamed: true }))),

    attachFt: (key, feIndex) =>
      push((doc) =>
        mapEta(doc, key, (e) => {
          const fe = e.model.functionalEvents[feIndex]
          if (!fe) return e
          return { ...e, fts: attachStarterFt(e.fts ?? EMPTY_FTS, fe.id, fe.failProb), model: setLinkFt(e.model, feIndex, fe.id) }
        })),

    detachFt: (key, feIndex) => push((doc) => mapEta(doc, key, (e) => ({ ...e, model: setLinkFt(e.model, feIndex, undefined) }))),

    setEtaPfd: (key, feId, prob) => quiet((doc) => mapEta(doc, key, (e) => ({ ...e, pfds: { ...(e.pfds ?? {}), [feId]: prob } }))),

    undo: () =>
      set((s) => {
        if (!s.past.length) return s
        const prev = s.past[s.past.length - 1]
        return { past: s.past.slice(0, -1), present: prev, future: [s.present, ...s.future] }
      }),
    redo: () =>
      set((s) => {
        if (!s.future.length) return s
        const next = s.future[0]
        return { past: [...s.past, s.present], present: next, future: s.future.slice(1) }
      }),
  }
})

/** 测试用:回到空项目。 */
export function resetProjectStore() {
  useProjectStore.setState({ past: [], present: initialDoc, future: [], activeKey: '', checkedKeys: {} })
}

/** 便捷选择器:活动 ETA(不存在时 null)。 */
export const selectActiveEta = (s: ProjectStore): ProjectEta | null =>
  s.present.etas.find((e) => e.key === s.activeKey) ?? null
