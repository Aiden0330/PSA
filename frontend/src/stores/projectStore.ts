import { create } from 'zustand'
import type { EventTreeModel } from '../eventtree'
import { setLinkFt } from '../eventtree'
import { attachStarterFt } from '../model'
import type { ModelJson } from '../model'
import type { ProjectEta } from '../project'
import type { FmeaRow, MappingConfig } from '../fmea'
import { DEFAULT_MAPPING } from '../fmea'

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

// ── R2 多项目(规格 2026-07-13-explorer-redesign §1,方案 C)──
// 顶层字段(past/present/future/activeKey/checkedKeys/pfds)**就是**活动项目;
// 非活动项目"停放"在 parked 注册表。任一时刻每个项目的文档只存在于一处 ——
// 切换 = park(顶层→注册表) + unpark(注册表→顶层),undo 历史/pfds/身份随槽整体迁移,
// 隔离是结构给的(跨项目串染对监管工具是溯源违规级缺陷)。

export interface ProjectIdentity {
  savedId: string           // '' = 未存档
  projectUuid: string       // '' = 未绑定版本库
  lastVersionHash?: string  // D-P5-4 乐观并发基线(随项目切换)
  displayName: string
}

interface ParkedSlot {
  past: ProjectDoc[]
  present: ProjectDoc
  future: ProjectDoc[]
  activeKey: string
  checkedKeys: Record<string, boolean>
  pfds: Record<string, Record<string, number>>
  identity: ProjectIdentity
  // FMEA 属项目内容(随 payload 走);并入槽以获得结构性隔离(修复既有 hook 级全局串染)
  fmeaRows: FmeaRow[]
  fmeaMapping: MappingConfig
}

const freshMapping = (): MappingConfig => JSON.parse(JSON.stringify(DEFAULT_MAPPING))

export const EMPTY_IDENTITY: ProjectIdentity = { savedId: '', projectUuid: '', displayName: '未命名项目' }

let _draftSeq = 1
const nextDraftId = () => `draft:${_draftSeq++}`

export interface ProjectStore {
  past: ProjectDoc[]
  present: ProjectDoc
  future: ProjectDoc[]
  activeKey: string
  checkedKeys: Record<string, boolean>
  /** 派生量缓存(各 ETA 的 PFD/顶值),在撤销历史之外:undo/redo 永不回滚派生值。 */
  pfds: Record<string, Record<string, number>>

  /** R2:活动项目身份 + 槽注册表。 */
  identity: ProjectIdentity
  workspaceId: string
  parked: Record<string, ParkedSlot>
  openOrder: string[]
  fmeaRows: FmeaRow[]
  fmeaMapping: MappingConfig

  setIdentity: (patch: Partial<ProjectIdentity>) => void
  /** R2-审 F1:槽定向身份写入 —— 异步操作(保存/删除/冲突解决)期间用户可能切换项目,
   *  写回必须落在**发起操作的槽**:活动 → 顶层;停放 → 该槽;已关闭 → 丢弃(绝不串槽)。 */
  setIdentityFor: (wid: string, patch: Partial<ProjectIdentity>) => void
  /** R2-审 F4:槽键迁移(另存为/首存后 wid 随新 savedId 走)。约定 wid=savedId(读档路径),
   *  否则旧存档 id 的 wid 残留会让 openProject 的 wid 去重把重开旧存档吞成静默 no-op。 */
  rekeyWorkspace: (oldWid: string, newWid: string) => void
  /** FMEA 行/映射更新(活动槽;不进 undo 历史——与今天的 hook 行为一致)。 */
  setFmea: (rows?: FmeaRow[], mapping?: MappingConfig) => void
  /** 打开项目:目标(按 wid 或 identity.savedId)已在打开集 → 仅聚焦(绝不重载,
   *  保护未保存编辑);否则停放当前、载入新槽。 */
  openProject: (wid: string, init: { etas: ProjectEta[]; activeKey: string; checkedKeys: Record<string, boolean>; userFts?: ModelJson; identity: ProjectIdentity; fmeaRows?: FmeaRow[]; fmeaMapping?: MappingConfig }) => void
  switchProject: (wid: string) => void
  closeProject: (wid: string) => void

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

const pfdsOf = (etas: ProjectEta[]): Record<string, Record<string, number>> =>
  Object.fromEntries(etas.map((e) => [e.key, { ...(e.pfds ?? {}) }]))

/** 把顶层(活动槽)打包为停放槽。 */
const packActive = (s: ProjectStore): ParkedSlot => ({
  past: s.past, present: s.present, future: s.future,
  activeKey: s.activeKey, checkedKeys: s.checkedKeys, pfds: s.pfds, identity: s.identity,
  fmeaRows: s.fmeaRows, fmeaMapping: s.fmeaMapping,
})

/** 把停放槽展开为顶层字段。 */
const unpackSlot = (slot: ParkedSlot) => ({
  past: slot.past, present: slot.present, future: slot.future,
  activeKey: slot.activeKey, checkedKeys: slot.checkedKeys, pfds: slot.pfds, identity: slot.identity,
  fmeaRows: slot.fmeaRows, fmeaMapping: slot.fmeaMapping,
})

export const useProjectStore = create<ProjectStore>()((set) => {
  const push = (f: (doc: ProjectDoc) => ProjectDoc) =>
    set((s) => ({ past: [...s.past, s.present], present: f(s.present), future: [] }))
  const firstWid = nextDraftId()

  return {
    past: [],
    present: initialDoc,
    future: [],
    activeKey: '',
    checkedKeys: {},
    pfds: {},

    identity: EMPTY_IDENTITY,
    workspaceId: firstWid,
    parked: {},
    openOrder: [firstWid],
    fmeaRows: [],
    fmeaMapping: freshMapping(),

    setIdentity: (patch) => set((s) => ({ identity: { ...s.identity, ...patch } })),
    setIdentityFor: (wid, patch) =>
      set((s) => {
        if (wid === s.workspaceId) return { identity: { ...s.identity, ...patch } }
        const slot = s.parked[wid]
        if (!slot) return s   // 槽已关闭:身份写入丢弃(落到别的项目头上 = 跨项目存档覆盖)
        return { parked: { ...s.parked, [wid]: { ...slot, identity: { ...slot.identity, ...patch } } } }
      }),
    rekeyWorkspace: (oldWid, newWid) =>
      set((s) => {
        if (!newWid || oldWid === newWid) return s
        if (newWid === s.workspaceId || s.parked[newWid]) return s   // 目标键被占(防御):不动
        if (oldWid === s.workspaceId) {
          return { workspaceId: newWid, openOrder: s.openOrder.map((w) => (w === oldWid ? newWid : w)) }
        }
        const slot = s.parked[oldWid]
        if (!slot) return s
        const parked = { ...s.parked }
        delete parked[oldWid]
        parked[newWid] = slot
        return { parked, openOrder: s.openOrder.map((w) => (w === oldWid ? newWid : w)) }
      }),
    setFmea: (rows, mapping) => set(() => ({
      ...(rows !== undefined ? { fmeaRows: rows } : {}),
      ...(mapping !== undefined ? { fmeaMapping: mapping } : {}),
    })),

    openProject: (wid, init) =>
      set((s) => {
        // 去重:wid 或 savedId 命中打开集(含活动)→ 仅聚焦
        const hitActive = s.workspaceId === wid ||
          (init.identity.savedId !== '' && s.identity.savedId === init.identity.savedId)
        if (hitActive) return s
        const hitParked = Object.entries(s.parked).find(([w, slot]) =>
          w === wid || (init.identity.savedId !== '' && slot.identity.savedId === init.identity.savedId))
        if (hitParked) {
          const [targetWid, slot] = hitParked
          const parked = { ...s.parked, [s.workspaceId]: packActive(s) }
          delete parked[targetWid]
          return { ...unpackSlot(slot), workspaceId: targetWid, parked }
        }
        const parked = { ...s.parked, [s.workspaceId]: packActive(s) }
        return {
          past: [], future: [],
          present: { etas: init.etas, userFts: init.userFts ?? EMPTY_FTS },
          activeKey: init.activeKey, checkedKeys: init.checkedKeys,
          pfds: pfdsOf(init.etas),
          identity: init.identity,
          // 新槽的 FMEA 来自档案载荷;缺省 = 干净项目([] + 默认映射),绝不从 localStorage 渗入
          fmeaRows: init.fmeaRows ?? [],
          fmeaMapping: init.fmeaMapping ?? freshMapping(),
          workspaceId: wid, parked,
          openOrder: [...s.openOrder.filter((w) => w !== s.workspaceId), s.workspaceId, wid]
            .filter((w, i, a) => a.indexOf(w) === i),
        }
      }),

    switchProject: (wid) =>
      set((s) => {
        if (wid === s.workspaceId) return s
        const slot = s.parked[wid]
        if (!slot) return s
        const parked = { ...s.parked, [s.workspaceId]: packActive(s) }
        delete parked[wid]
        return { ...unpackSlot(slot), workspaceId: wid, parked }
      }),

    closeProject: (wid) =>
      set((s) => {
        if (wid !== s.workspaceId) {
          if (!s.parked[wid]) return s
          const parked = { ...s.parked }
          delete parked[wid]
          return { parked, openOrder: s.openOrder.filter((w) => w !== wid) }
        }
        // 关活动槽:切到打开顺序里的下一个;一个不剩 → 重置为新草稿
        const rest = s.openOrder.filter((w) => w !== wid && s.parked[w])
        if (rest.length) {
          const nextWid = rest[rest.length - 1]
          const slot = s.parked[nextWid]
          const parked = { ...s.parked }
          delete parked[nextWid]
          return { ...unpackSlot(slot), workspaceId: nextWid, parked,
                   openOrder: s.openOrder.filter((w) => w !== wid) }
        }
        const freshWid = nextDraftId()
        return {
          past: [], present: initialDoc, future: [], activeKey: '', checkedKeys: {}, pfds: {},
          identity: EMPTY_IDENTITY, workspaceId: freshWid, parked: {}, openOrder: [freshWid],
          fmeaRows: [], fmeaMapping: freshMapping(),
        }
      }),

    load: (etas, activeKey, checkedKeys, userFts) =>
      set({ past: [], future: [], present: { etas, userFts: userFts ?? EMPTY_FTS }, activeKey, checkedKeys, pfds: pfdsOf(etas) }),

    applyProject: ({ etas, checkedKeys, activeKey, userFts }) =>
      set((s) => ({
        past: [...s.past, s.present],
        present: { etas, userFts: userFts ?? s.present.userFts },
        future: [],
        activeKey,
        checkedKeys,
        pfds: { ...s.pfds, ...pfdsOf(etas) },
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
        pfds: { ...s.pfds, [tab.key]: { ...(tab.pfds ?? {}) } },
        ...(opts?.activate !== false ? { activeKey: tab.key } : {}),
        ...(opts?.checked !== false ? { checkedKeys: { ...s.checkedKeys, [tab.key]: true } } : {}),
      })),

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

    // 解除挂载时把当前派生 PFD 物化进内容层(数值不跳变,之后可手工编辑)
    detachFt: (key, feIndex) =>
      set((s) => {
        const doc = mapEta(s.present, key, (e) => {
          const fe = e.model.functionalEvents[feIndex]
          const derived = fe ? (s.pfds[key]?.[fe.id] ?? e.pfds?.[fe.id]) : undefined
          let m = setLinkFt(e.model, feIndex, undefined)
          if (fe && derived != null) {
            m = { ...m, functionalEvents: m.functionalEvents.map((f) => (f.id === fe.id ? { ...f, failProb: derived } : f)) }
          }
          return { ...e, model: m }
        })
        return { past: [...s.past, s.present], present: doc, future: [] }
      }),

    // 派生量只写历史之外的缓存:undo/redo 对其透明
    setEtaPfd: (key, feId, prob) =>
      set((s) => ({ pfds: { ...s.pfds, [key]: { ...(s.pfds[key] ?? {}), [feId]: prob } } })),

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

/** 测试用:回到空项目(单一新草稿槽,注册表清空,草稿序号复位保证确定性)。 */
export function resetProjectStore() {
  _draftSeq = 1
  const wid = nextDraftId()
  useProjectStore.setState({
    past: [], present: initialDoc, future: [], activeKey: '', checkedKeys: {}, pfds: {},
    identity: EMPTY_IDENTITY, workspaceId: wid, parked: {}, openOrder: [wid],
    fmeaRows: [], fmeaMapping: freshMapping(),
  })
}

/** 打开集(树消费):按打开顺序,含活动标记与身份。 */
export const selectOpenProjects = (s: ProjectStore): { workspaceId: string; identity: ProjectIdentity; isActive: boolean }[] =>
  s.openOrder
    .map((w) => w === s.workspaceId
      ? { workspaceId: w, identity: s.identity, isActive: true }
      : s.parked[w] ? { workspaceId: w, identity: s.parked[w].identity, isActive: false } : null)
    .filter((x): x is { workspaceId: string; identity: ProjectIdentity; isActive: boolean } => x !== null)

/** 便捷选择器:活动 ETA(不存在时 null)。 */
export const selectActiveEta = (s: ProjectStore): ProjectEta | null =>
  s.present.etas.find((e) => e.key === s.activeKey) ?? null

/** 某 ETA 的有效派生缓存:侧表优先,载入时的静态 pfds 兜底(如撤销恢复的页签)。 */
export const selectEtaPfds = (s: ProjectStore, key: string): Record<string, number> =>
  s.pfds[key] ?? s.present.etas.find((e) => e.key === key)?.pfds ?? {}
