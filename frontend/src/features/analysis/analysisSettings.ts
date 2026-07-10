import type { ModelJson } from '../../model'

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

/** 合成 /api/quantify 的可选参数:空则省略键,保持旧请求形状不变。 */
export function toQuantifyOptions(
  s: AnalysisSettings,
): { house_states?: Record<string, boolean>; post_rules?: PostRuleDraft[] } {
  const out: { house_states?: Record<string, boolean>; post_rules?: PostRuleDraft[] } = {}
  if (Object.keys(s.houseOverrides).length) out.house_states = s.houseOverrides
  const valid = s.postRules.filter((_, i) => validatePostRules(s.postRules)[i] === null)
  if (valid.length) out.post_rules = valid
  return out
}

/** 该设置是否有任何生效项(用于按钮徽标/提示)。 */
export function settingsActive(s: AnalysisSettings): boolean {
  return Object.keys(s.houseOverrides).length > 0 || s.postRules.length > 0
}
