import type { EventTreeModel } from './eventtree'
import type { ModelJson } from './model'
import type { FmeaRow, MappingConfig } from './fmea'

// 一份项目存档里单个 ETA 页签的可持久化快照(与 App 的 EtaTab 结构对齐, 但不含运行期派生量)。
export interface ProjectEta {
  key: string
  name: string
  renamed?: boolean
  model: EventTreeModel
  fts: ModelJson
  pfds: Record<string, number>
}

// 项目级存档 payload(v2): 保存全部 ETA 的个数/名称/勾选/活动页, 解决单 ETA 存档丢失多页的问题。
export interface ProjectPayload {
  v: 2
  etas: ProjectEta[]
  activeKey: string
  checkedKeys: Record<string, boolean>
  userFts?: ModelJson
  fmeaRows?: FmeaRow[]
  fmeaMapping?: MappingConfig
}

const EMPTY_FTS: ModelJson = { model_data: { parameters: [] }, fault_trees: [] }
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))

function nextDuplicateName(names: Set<string>, baseName: string): string {
  const base = `${baseName.trim() || 'ETA'} 副本`
  if (!names.has(base)) return base
  for (let i = 2; ; i++) {
    const name = `${base} ${i}`
    if (!names.has(name)) return name
  }
}

export function duplicateProjectEta(
  etas: ProjectEta[],
  sourceKey: string,
  nextKey: string,
  displayName?: string,
): { etas: ProjectEta[]; eta: ProjectEta } | null {
  const idx = etas.findIndex((e) => e.key === sourceKey)
  if (idx < 0) return null
  const source = etas[idx]
  const existingNames = new Set<string>()
  for (const eta of etas) {
    existingNames.add(eta.name)
    if (eta.model?.initEvent) existingNames.add(eta.model.initEvent)
  }
  const name = nextDuplicateName(existingNames, displayName ?? source.name)
  const copied = clone(source)
  const eta: ProjectEta = {
    ...copied,
    key: nextKey,
    name,
    renamed: false,
    model: { ...copied.model, initEvent: name },
  }
  return { etas: [...etas.slice(0, idx + 1), eta, ...etas.slice(idx + 1)], eta }
}

/** 把当前所有 ETA 页签打包成一份项目存档 payload(深拷贝引用以与后续编辑解耦)。 */
export function serializeProject(
  etas: ProjectEta[],
  activeKey: string,
  checkedKeys: Record<string, boolean>,
  userFts?: ModelJson,
  fmeaRows?: FmeaRow[],
  fmeaMapping?: MappingConfig,
): ProjectPayload {
  return {
    v: 2,
    etas: etas.map((e) => ({
      key: e.key,
      name: e.name,
      renamed: e.renamed,
      model: e.model,
      fts: e.fts ?? EMPTY_FTS,
      pfds: e.pfds ?? {},
    })),
    activeKey,
    checkedKeys: { ...checkedKeys },
    ...(userFts ? { userFts: clone(userFts) } : {}),
    ...(fmeaRows ? { fmeaRows: clone(fmeaRows) } : {}),
    ...(fmeaMapping ? { fmeaMapping: clone(fmeaMapping) } : {}),
  }
}

/**
 * 反序列化项目存档, 兼容两种历史格式:
 *  - v2 项目:{ v:2, etas:[…], activeKey, checkedKeys } —— 完整还原多 ETA(个数 + 名称)。
 *  - 旧版单 ETA:{ etModel, fts } —— 包成 1 个 ETA, 名称取存档名 fallbackName(旧版 payload 不含 ETA 名)。
 * 对非法 activeKey / 缺失 checkedKeys 做防御性回落, 避免坏存档导致空白。
 */
export function deserializeProject(payload: unknown, fallbackName: string): ProjectPayload {
  const p = payload as Record<string, unknown> | null
  if (p && p.v === 2 && Array.isArray(p.etas)) {
    const etas: ProjectEta[] = (p.etas as unknown[]).map((raw, i) => {
      const e = (raw ?? {}) as Record<string, unknown>
      return {
        key: typeof e.key === 'string' && e.key ? e.key : `eta${i}`,
        name: typeof e.name === 'string' && e.name ? e.name : `ETA ${i + 1}`,
        renamed: typeof e.renamed === 'boolean' ? e.renamed : false,
        model: e.model as EventTreeModel,
        fts: (e.fts as ModelJson) ?? EMPTY_FTS,
        pfds: e.pfds && typeof e.pfds === 'object' ? (e.pfds as Record<string, number>) : {},
      }
    })
    const checkedKeys =
      p.checkedKeys && typeof p.checkedKeys === 'object'
        ? (p.checkedKeys as Record<string, boolean>)
        : Object.fromEntries(etas.map((e) => [e.key, true]))
    const activeKey =
      typeof p.activeKey === 'string' && etas.some((e) => e.key === p.activeKey)
        ? p.activeKey
        : etas[0]?.key ?? ''
    return {
      v: 2, etas, activeKey, checkedKeys,
      userFts: (p.userFts && typeof p.userFts === 'object' && Array.isArray((p.userFts as { fault_trees?: unknown }).fault_trees))
        ? (p.userFts as ModelJson) : undefined,
      fmeaRows: Array.isArray(p.fmeaRows) ? (p.fmeaRows as FmeaRow[]) : undefined,
      fmeaMapping: (p.fmeaMapping && typeof p.fmeaMapping === 'object') ? (p.fmeaMapping as MappingConfig) : undefined,
    }
  }

  // 旧版单 ETA 存档
  const key = 'saved0'
  const eta: ProjectEta = {
    key,
    name: fallbackName || 'ETA',
    renamed: true,
    model: (p?.etModel as EventTreeModel) ?? (p as unknown as EventTreeModel),
    fts: (p?.fts as ModelJson) ?? EMPTY_FTS,
    pfds: {},
  }
  return { v: 2, etas: [eta], activeKey: key, checkedKeys: { [key]: true } }
}
