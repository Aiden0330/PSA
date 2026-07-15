import type { ModelJson, BcSetJson } from '../../model'
export type { BcSetJson }

// 4a2/4a3 分析设置的纯层(spec 2026-07-10-analysis-settings-ui):从模型抽 house 事件、
// 后处理规则草稿 + 校验、合成 /api/quantify 的可选 options。真值由后端把关,此处只做即时反馈。

export interface HouseEventInfo {
  id: string
  label: string
  state: boolean            // 模型内声明状态(未覆盖时的基线)
}

export type PostRuleKind = 'mutually_exclusive' | 'delete_contains' | 'recovery'

export interface PostRuleDraft {
  kind: PostRuleKind
  events: string[]
  add_event?: string
  prob?: number
}

export interface AnalysisSettings {
  houseOverrides: Record<string, boolean>   // id → 覆盖状态(缺省=继承模型声明)
  boundaryConditionSet?: string             // 选中的命名边界条件集(按名引用;定义随模型 JSON)
  postRules: PostRuleDraft[]
}

export const EMPTY_SETTINGS: AnalysisSettings = { houseOverrides: {}, postRules: [] }

/** 从某棵故障树抽 house 事件(含声明状态与显示名)。 */
export function listHouseEvents(model: ModelJson | null | undefined, ftName: string): HouseEventInfo[] {
  const ft = model?.fault_trees?.find((f) => f.name === ftName)
  if (!ft) return []
  return ft.nodes
    .filter((n) => n.house)
    .map((n) => ({ id: n.id, label: n.label || n.id, state: !!n.state }))
}

/** ETA:跨给定故障树名抽 house 事件并按 id 去重(首现为准)。事件树量化把挂载屏障树合并为一个
 *  PDAG,house 覆盖按 id 全局生效,故对 id 去重即为可覆盖集合。ftNames 一般取各屏障的 linkFt。 */
export function listHouseEventsUnion(model: ModelJson | null | undefined, ftNames: string[]): HouseEventInfo[] {
  if (!model?.fault_trees) return []
  const want = new Set(ftNames)
  const seen = new Map<string, HouseEventInfo>()
  for (const ft of model.fault_trees) {
    if (!want.has(ft.name)) continue
    for (const n of ft.nodes) {
      if (n.house && !seen.has(n.id)) seen.set(n.id, { id: n.id, label: n.label || n.id, state: !!n.state })
    }
  }
  return [...seen.values()]
}

// ── 命名边界条件集编辑(纯函数,操作 BcSetJson[];写回经模型 setter,吃撤销历史)──
/** 追加空集合;名称去空格 + 唯一化(name/name_2…)。 */
export function addBcSet(sets: BcSetJson[], rawName: string): BcSetJson[] {
  const base = (rawName ?? '').trim() || '边界条件集'
  const taken = new Set(sets.map((s) => s.name))
  let name = base, i = 2
  while (taken.has(name)) { name = `${base}_${i}`; i++ }
  return [...sets, { name, house_states: {} }]
}
/** 重命名第 idx 个集合;空名/重名/越界 → 返回原数组(不改)。 */
export function renameBcSet(sets: BcSetJson[], idx: number, rawName: string): BcSetJson[] {
  const name = (rawName ?? '').trim()
  if (!name || idx < 0 || idx >= sets.length) return sets
  if (sets.some((s, j) => j !== idx && s.name === name)) return sets
  return sets.map((s, j) => (j === idx ? { ...s, name } : s))
}
/** 删除第 idx 个集合。 */
export function deleteBcSet(sets: BcSetJson[], idx: number): BcSetJson[] {
  return sets.filter((_, j) => j !== idx)
}
/** 设置第 idx 个集合内某 house 事件的成员状态;state=undefined 表示移出该集合。 */
export function setBcSetMember(sets: BcSetJson[], idx: number, houseId: string, state: boolean | undefined): BcSetJson[] {
  if (idx < 0 || idx >= sets.length) return sets
  return sets.map((s, j) => {
    if (j !== idx) return s
    const hs = { ...s.house_states }
    if (state === undefined) delete hs[houseId]
    else hs[houseId] = state
    return { ...s, house_states: hs }
  })
}

export function newPostRule(kind: PostRuleKind): PostRuleDraft {
  if (kind === 'recovery') return { kind, events: [], add_event: 'REC', prob: 0.1 }
  return { kind, events: [] }
}

/** 前端先验校验(与引擎 PostRule.from_dict 同规则):返回每条规则的错误文案(null=合法)。 */
export function validatePostRules(rules: PostRuleDraft[]): (string | null)[] {
  return rules.map((r) => {
    if (r.kind === 'mutually_exclusive' && r.events.length < 2) return '互斥组需 ≥2 个成员'
    if (r.kind === 'delete_contains' && r.events.length < 1) return '删除规则需 ≥1 个成员'
    if (r.kind === 'recovery') {
      if (!r.add_event || !r.add_event.trim()) return '恢复规则需填恢复事件名'
      if (r.prob == null || r.prob < 0 || r.prob > 1) return '恢复概率需在 [0,1]'
    }
    return null
  })
}

export function settingsHasErrors(rules: PostRuleDraft[]): boolean {
  return validatePostRules(rules).some((e) => e !== null)
}

/** 合成 /api/quantify 的可选参数(FTA):空则省略键,保持旧请求形状不变。
 *  命名集定义随 model 字典(boundary_condition_sets)提交,此处只带按名引用。 */
export function toQuantifyOptions(
  s: AnalysisSettings,
): { house_states?: Record<string, boolean>; boundary_condition_set?: string; post_rules?: PostRuleDraft[] } {
  const out: { house_states?: Record<string, boolean>; boundary_condition_set?: string; post_rules?: PostRuleDraft[] } = {}
  if (Object.keys(s.houseOverrides).length) out.house_states = s.houseOverrides
  if (s.boundaryConditionSet) out.boundary_condition_set = s.boundaryConditionSet
  const valid = s.postRules.filter((_, i) => validatePostRules(s.postRules)[i] === null)
  if (valid.length) out.post_rules = valid
  return out
}

/** ETA 侧:合成事件树 quantify/importance 调用的边界条件参数。post 规则是 FTA 专属语义,ETA 不含。
 *  命名集选中时同时透传集合定义(ET 请求无 model 字典,后端据此按名解析)。空则省略所有键,
 *  与既有 ET 请求逐字节一致。选中集合不在 bcSets 中(已删)则整体省略,避免后端 400。 */
export function toEtEngineOptions(
  s: AnalysisSettings,
  bcSets: BcSetJson[],
): { house_states?: Record<string, boolean>; boundary_condition_set?: string; boundary_condition_sets?: BcSetJson[] } {
  const out: { house_states?: Record<string, boolean>; boundary_condition_set?: string; boundary_condition_sets?: BcSetJson[] } = {}
  if (Object.keys(s.houseOverrides).length) out.house_states = s.houseOverrides
  if (s.boundaryConditionSet && bcSets.some((b) => b.name === s.boundaryConditionSet)) {
    out.boundary_condition_set = s.boundaryConditionSet
    out.boundary_condition_sets = bcSets
  }
  return out
}

/** 该设置是否有任何生效项(用于按钮徽标/提示)。 */
export function settingsActive(s: AnalysisSettings): boolean {
  return Object.keys(s.houseOverrides).length > 0 || !!s.boundaryConditionSet || s.postRules.length > 0
}
