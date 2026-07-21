// 前端可编辑模型层(MEF 对齐 JSON)+ 纯编辑操作。所有操作返回新对象(便于撤销/重做)。

export interface FtNodeJson {
  id: string
  basic?: boolean
  house?: boolean
  op?: string
  args?: string[]
  k?: number
  state?: boolean
  param_ref?: string
  label?: string
}
export interface ParamJson { id: string; kind: string; value: number; [k: string]: any }
export interface FaultTreeJson { name: string; top: string; nodes: FtNodeJson[] }
export interface CcfGroupJson { id: string; members: string[]; model: string; factors: Record<string, number>; staggered?: boolean }
/** 命名边界条件集(4a2):一组 house 事件的强制状态,量化时按名整体套用。随模型 JSON 不透明往返。 */
export interface BcSetJson { name: string; house_states: Record<string, boolean> }
export interface ModelJson {
  model_data: { parameters: ParamJson[] }
  fault_trees: FaultTreeJson[]
  event_trees?: any[]
  ccf_groups?: CcfGroupJson[]
  boundary_condition_sets?: BcSetJson[]
}

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
let _seq = 0
export const uid = (p: string) => `${p}_${Date.now().toString(36)}${(_seq++).toString(36)}`

export function getFt(m: ModelJson, name: string): FaultTreeJson {
  return m.fault_trees.find((f) => f.name === name) ?? m.fault_trees[0]
}

/** mutator 严格守卫(白屏/误写审查 2026-07-17):命名树不存在 ⇒ 不可变更。
 *  此前 mutator 经 getFt 回退拿到 fault_trees[0],会把编辑**写进别的树**(数据损坏),
 *  空 fault_trees 时则直接抛(白屏)。缺树 = no-op,由调用方 UI 层负责呈现缺树态。 */
const hasFt = (m: ModelJson, name: string) => m.fault_trees.some((f) => f.name === name)

export function addBasic(m: ModelJson, ftName: string, value = 0.1, kind: 'probability' | 'frequency' = 'probability'): ModelJson {
  if (!hasFt(m, ftName)) return m
  const nm = clone(m), ft = getFt(nm, ftName), id = uid(kind === 'frequency' ? 'F' : 'BE')
  ft.nodes.push({ id, basic: true, param_ref: id })
  nm.model_data.parameters.push({ id, kind, value })
  return nm
}
/** 切换参数量纲(频率初因 /yr ↔ 使能概率)——仅初因树(频率模式)编辑面暴露。 */
export function setParamKind(m: ModelJson, id: string, kind: 'probability' | 'frequency'): ModelJson {
  const nm = clone(m)
  const p = nm.model_data.parameters.find((x) => x.id === id)
  if (p) p.kind = kind
  return nm
}
/** 初因树与其余树共享的基本事件参数(独立性护栏;非空 ⇒ 可分离量化假设不成立)。 */
export function sharedIeBarrierEvents(m: ModelJson, ieName = '__init__'): string[] {
  const refsOf = (name: string) => new Set(
    (m.fault_trees.find((f) => f.name === name)?.nodes ?? [])
      .filter((n) => n.basic).map((n) => n.param_ref ?? n.id))
  const ie = refsOf(ieName)
  const shared = new Set<string>()
  for (const f of m.fault_trees) {
    if (f.name === ieName) continue
    for (const n of f.nodes) {
      if (n.basic && ie.has(n.param_ref ?? n.id)) shared.add(n.param_ref ?? n.id)
    }
  }
  return [...shared].sort()
}
export function addGate(m: ModelJson, ftName: string, op: string, k = 2): ModelJson {
  if (!hasFt(m, ftName)) return m
  const nm = clone(m), ft = getFt(nm, ftName), id = uid('G')
  ft.nodes.push({ id, op, args: [], label: '中间事件', ...(op === 'atleast' ? { k } : {}) })
  return nm
}
export function connect(m: ModelJson, ftName: string, source: string, target: string): ModelJson {
  if (!hasFt(m, ftName)) return m
  const nm = clone(m), ft = getFt(nm, ftName)
  const g = ft.nodes.find((n) => n.id === source)
  if (g && g.op && !(g.args ?? []).includes(target) && source !== target) {
    g.args = [...(g.args ?? []), target]
  }
  return nm
}
export function deleteNode(m: ModelJson, ftName: string, id: string): ModelJson {
  if (!hasFt(m, ftName)) return m
  const nm = clone(m), ft = getFt(nm, ftName)
  ft.nodes = ft.nodes.filter((n) => n.id !== id)
  for (const n of ft.nodes) if (n.args) n.args = n.args.filter((a) => a !== id)
  nm.model_data.parameters = nm.model_data.parameters.filter((p) => p.id !== id)
  if (ft.top === id) ft.top = ft.nodes.find((n) => n.op)?.id ?? ft.nodes[0]?.id ?? ''
  return nm
}
export function updateNode(m: ModelJson, ftName: string, id: string, patch: Partial<FtNodeJson>): ModelJson {
  if (!hasFt(m, ftName)) return m
  const nm = clone(m), n = getFt(nm, ftName).nodes.find((x) => x.id === id)
  if (n) Object.assign(n, patch)
  return nm
}
export function setTop(m: ModelJson, ftName: string, id: string): ModelJson {
  if (!hasFt(m, ftName)) return m
  const nm = clone(m); getFt(nm, ftName).top = id; return nm
}

/** 重命名节点(事件名),级联更新所有引用:父门 args、自身 param_ref、ft.top、
 *  以及(自命名基本事件的)参数 id。newId 空/与现有节点重名/(自命名时)与现有参数重名 → 不改。 */
export function renameNode(m: ModelJson, ftName: string, oldId: string, newId: string): ModelJson {
  if (!hasFt(m, ftName)) return m
  newId = (newId ?? '').trim()
  const src = getFt(m, ftName)
  const node0 = src.nodes.find((n) => n.id === oldId)
  if (!newId || newId === oldId || !node0) return m
  if (src.nodes.some((n) => n.id === newId)) return m
  const selfParam = !!node0.basic && node0.param_ref === oldId
  if (selfParam && m.model_data.parameters.some((p) => p.id === newId)) return m
  const nm = clone(m), ft = getFt(nm, ftName)
  const node = ft.nodes.find((n) => n.id === oldId)!
  node.id = newId
  if (selfParam) node.param_ref = newId
  for (const n of ft.nodes) if (n.args) n.args = n.args.map((a) => (a === oldId ? newId : a))
  if (ft.top === oldId) ft.top = newId
  if (selfParam) { const p = nm.model_data.parameters.find((x) => x.id === oldId); if (p) p.id = newId }
  return nm
}
export function updateParam(m: ModelJson, id: string, value: number): ModelJson {
  const nm = clone(m), p = nm.model_data.parameters.find((x) => x.id === id)
  if (p) p.value = value
  return nm
}
export function setCcf(m: ModelJson, groups: CcfGroupJson[]): ModelJson {
  const nm = clone(m); nm.ccf_groups = groups; return nm
}
/** 覆写模型的命名边界条件集。空数组 → 删除该键,保持从未用过 bc-set 的模型形状(旧档往返零扰动)。 */
export function setBcSets(m: ModelJson, sets: BcSetJson[]): ModelJson {
  const nm = clone(m)
  if (sets.length) nm.boundary_condition_sets = sets
  else delete nm.boundary_condition_sets
  return nm
}

/** 为某 ETA 屏障在 fts 中建启动故障树(名=feId, OR 门 + 1 基本事件=当前 PFD)。 */
export function attachStarterFt(fts: ModelJson, feId: string, failProb: number,
                                kind: 'probability' | 'frequency' = 'probability'): ModelJson {
  const nm = clone(fts)
  const beId = feId + '_BE'
  nm.fault_trees = nm.fault_trees.filter((f) => f.name !== feId)
  nm.fault_trees.push({ name: feId, top: feId, nodes: [
    { id: beId, basic: true, param_ref: beId },
    { id: feId, op: 'or', args: [beId] },
  ] })
  nm.model_data.parameters = nm.model_data.parameters.filter((p) => p.id !== beId)
  // 初因树(kind='frequency')种子 = 单频率事件 = 当前手动值 → F 与切换前逐位一致,迁移零意外
  nm.model_data.parameters.push({ id: beId, kind, value: failProb })
  return nm
}

export interface LibComponent { id: string; name: string; failure_mode?: string; rate: number; unit: string; source: { citation: string } }
/** 从器件失效率库追加基本事件(值=rate, 不做单位换算; 来源含名称/失效模式/单位标注)。 */
/** 库条目单位 → 参数量纲(初因树导入用):`·yr`/`/yr` 结尾的速率单位 = 频率初因;
 *  /demand、PFD 等 = 使能概率。仅做标注推断,数值绝不转换(单位承重铁律)。 */
export function libKindForUnit(unit?: string): 'probability' | 'frequency' {
  return /(·|\/)yr\)?\s*$/.test((unit ?? '').trim()) ? 'frequency' : 'probability'
}

export function addBasicFromLib(m: ModelJson, ftName: string, c: LibComponent, kind: 'probability' | 'frequency' = 'probability'): ModelJson {
  if (!hasFt(m, ftName)) return m
  const nm = clone(m), ft = getFt(nm, ftName)
  const taken = ft.nodes.map((n) => n.id).concat(nm.model_data.parameters.map((p) => p.id))
  let id = c.id, i = 2
  while (taken.includes(id)) { id = `${c.id}_${i}`; i++ }
  ft.nodes.push({ id, basic: true, param_ref: id })
  const src = `${c.name}${c.failure_mode ? '/' + c.failure_mode : ''} — ${c.source.citation}(${c.unit})`
  nm.model_data.parameters.push({ id, kind, value: c.rate, source: src })
  return nm
}

/** 追加一棵起始故障树(OR 门 top + 1 基本事件 + 概率参数);name 去空格 + 唯一化(name/name_2…);节点 id 用 uid。 */
export function addFaultTree(m: ModelJson, name: string): ModelJson {
  const nm = clone(m)
  const base = (name ?? '').trim() || '新建 FTA'
  const taken = nm.fault_trees.map((f) => f.name)
  let nmName = base, i = 2
  while (taken.includes(nmName)) { nmName = `${base}_${i}`; i++ }
  const gid = uid('G'), bid = uid('BE')
  nm.fault_trees.push({ name: nmName, top: gid, nodes: [
    { id: bid, basic: true, param_ref: bid },
    { id: gid, op: 'or', args: [bid] },
  ] })
  nm.model_data.parameters.push({ id: bid, kind: 'probability', value: 0.1 })
  return nm
}

/** 按 name 删除一棵故障树;清理仅被它引用的参数(被其他树引用的保留)。删不存在 → 原对象。 */
export function deleteFaultTree(m: ModelJson, name: string): ModelJson {
  const ft = m.fault_trees.find((f) => f.name === name)
  if (!ft) return m
  const nm = clone(m)
  nm.fault_trees = nm.fault_trees.filter((f) => f.name !== name)
  const others = new Set<string>()
  for (const f of nm.fault_trees) for (const n of f.nodes) if (n.param_ref) others.add(n.param_ref)
  const removed = ft.nodes.filter((n) => n.param_ref).map((n) => n.param_ref as string)
  nm.model_data.parameters = nm.model_data.parameters.filter((p) => !removed.includes(p.id) || others.has(p.id))
  return nm
}

/** 割集回溯:把割集事件置真、其余置假,返回所有因此变真的节点(割集事件 + 一路到顶的门)。 */
export function activatedNodes(ft: FaultTreeJson, cutset: Set<string>): Set<string> {
  const byId = new Map(ft.nodes.map((n) => [n.id, n]))
  const memo = new Map<string, boolean>()
  function ev(id: string): boolean {
    if (memo.has(id)) return memo.get(id)!
    const n = byId.get(id)
    let v = false
    if (!n) v = false
    else if (n.basic) v = cutset.has(id)
    else if (n.house) v = !!n.state
    else {
      const ch = (n.args ?? []).map(ev)
      switch (n.op) {
        case 'and': v = ch.length > 0 && ch.every(Boolean); break
        case 'or': v = ch.some(Boolean); break
        case 'atleast': v = ch.filter(Boolean).length >= (n.k ?? 1); break
        case 'not': v = !ch[0]; break
        case 'xor': v = ch.filter(Boolean).length % 2 === 1; break
        case 'null': v = n.state != null ? !!n.state : !!ch[0]; break
      }
    }
    memo.set(id, v)
    return v
  }
  const hot = new Set<string>()
  for (const n of ft.nodes) if (ev(n.id)) hot.add(n.id)
  return hot
}
