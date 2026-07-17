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

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)

/** 递归校验事件树节点形状(branch:feId+success+failure;leaf:consequence)。返回带路径的错误或 null。 */
function validateEtNode(node: unknown, path: string): string | null {
  if (!isObj(node)) return `${path} 不是对象`
  if (node.kind === 'leaf') {
    if (typeof node.consequence !== 'string') return `${path}.consequence 应为字符串`
    return null
  }
  if (node.kind === 'branch') {
    if (typeof node.feId !== 'string' || !node.feId) return `${path}.feId 应为非空字符串`
    return validateEtNode(node.success, `${path}.success`) ?? validateEtNode(node.failure, `${path}.failure`)
  }
  return `${path}.kind 非法(应为 branch/leaf):${String(node.kind)}`
}

/**
 * v2 项目 payload 深校验(FE-10):etas 数组、每 eta {key,name,model{initEvent,initFreq 有限,
 * functionalEvents[],root 树形},fts 形状}。返回首个带路径错误或 null(通过)。绝不半载入的前置门。
 */
export function validateProjectPayload(payload: unknown): string | null {
  if (!isObj(payload)) return '项目 payload 不是对象'
  if (payload.v !== 2) return `不支持的项目 payload 版本:${String(payload.v)}`
  if (!Array.isArray(payload.etas)) return 'etas 应为数组'
  for (let i = 0; i < payload.etas.length; i++) {
    const e = payload.etas[i]
    const at = `etas[${i}]`
    if (!isObj(e)) return `${at} 不是对象`
    if (typeof e.key !== 'string' || !e.key) return `${at}.key 应为非空字符串`
    if (typeof e.name !== 'string') return `${at}.name 应为字符串`
    if (!isObj(e.model)) return `${at}.model 不是对象`
    const m = e.model
    if (typeof m.initEvent !== 'string') return `${at}.model.initEvent 应为字符串`
    if (typeof m.initFreq !== 'number' || !Number.isFinite(m.initFreq)) return `${at}.model.initFreq 应为有限数`
    if (!Array.isArray(m.functionalEvents)) return `${at}.model.functionalEvents 应为数组`
    const treeErr = validateEtNode(m.root, `${at}.model.root`)
    if (treeErr) return `${at}.model.root 畸形:${treeErr}`
    if (e.fts !== undefined && (!isObj(e.fts) || !Array.isArray((e.fts as Record<string, unknown>).fault_trees))) return `${at}.fts 形状非法(fault_trees 应为数组)`
  }
  return null
}

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
