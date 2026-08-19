import { delFe } from './eventtree'
import type { EventTreeModel } from './eventtree'
import type { FaultTreeJson, FtNodeJson, ModelJson, ParamJson } from './model'
import type { ProjectEta } from './project'

export type AiDraftTarget = 'eta' | 'fta' | 'eta_with_fta'
export type AiApplyMode = 'new_eta' | 'complete_eta' | 'fta_for_barrier' | 'standalone_fta'

export interface AiDraftValidation {
  ok: boolean
  errors: string[]
  warnings: string[]
  stages?: Record<string, string[]>                  // 4b1:schema/lint/dry_run 分段
}

export interface AiDraftProvenance {
  model_id?: string
  served_by?: string
  prompt_version?: string
  rounds?: number
  tool_trace?: { name: string }[]
}

export interface AiDraftResponse {
  draft_id: string
  summary: string
  assumptions: string[]
  questions: string[]
  etas: ProjectEta[]
  fts: ModelJson
  traceability: Record<string, unknown>[]
  warnings: string[]
  validation: AiDraftValidation
  provenance?: AiDraftProvenance                     // 4b1
  ai_draft_id?: number                               // 4b2:溯源行 id(应用回执)
}

export interface AiDraftImage {
  media_type: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
  data: string                                       // 纯 base64(不含 dataURL 前缀)
}

export interface AiDraftRequest {
  goal: string
  target: AiDraftTarget
  current_project: Record<string, unknown>
  active_eta_key?: string
  user_context?: Record<string, unknown>
  project_uuid?: string                              // 4b2:生成即落库 + 审计
  images?: AiDraftImage[]                            // 截图转录:任意工具的 ETA/FTA 截图(≤3 张)
}

/** dataURL → AiDraftImage;非白名单类型/畸形 dataURL 返回 null(调用方提示,不静默吞图)。 */
export function dataUrlToAiImage(dataUrl: string): AiDraftImage | null {
  const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/.exec(dataUrl)
  return m ? { media_type: m[1] as AiDraftImage['media_type'], data: m[2] } : null
}

// ── D7 ghost-diff:草案元素清单 + 逐元素接受 ──

export interface DraftElement {
  id: string                                         // 'eta:0' | 'eta:0/fe:B_X' | 'ft:NAME'
  kind: 'eta' | 'barrier' | 'fault_tree'
  label: string
  detail?: string
  parent?: string
}

/** 把草案拆成可逐个接受的元素(D7)。complete_eta 需 currentModel 以识别"新增屏障"。 */
export function draftElements(draft: AiDraftResponse, mode: AiApplyMode,
                              currentModel?: EventTreeModel | null): DraftElement[] {
  const out: DraftElement[] = []
  if (mode === 'new_eta' || mode === 'complete_eta') {
    const existing = new Set((currentModel?.functionalEvents ?? []).map((f) => f.id))
    ;(draft.etas ?? []).forEach((eta, i) => {
      const eid = `eta:${i}`
      const m = eta.model as EventTreeModel | undefined
      if (mode === 'new_eta') {
        out.push({ id: eid, kind: 'eta', label: eta.name || m?.initEvent || `ETA ${i + 1}`,
                   detail: `${m?.functionalEvents?.length ?? 0} 屏障` })
      }
      for (const fe of m?.functionalEvents ?? []) {
        if (mode === 'complete_eta' && existing.has(fe.id)) continue   // 已有屏障不是"新增元素"
        out.push({ id: `${eid}/fe:${fe.id}`, kind: 'barrier', label: fe.label || fe.id,
                   detail: `PFD ${fe.failProb}`, parent: mode === 'new_eta' ? eid : undefined })
      }
      if (mode === 'complete_eta') return            // complete 只对首个草案 ETA 生效
    })
  } else {
    for (const ft of draft.fts?.fault_trees ?? []) {
      out.push({ id: `ft:${ft.name}`, kind: 'fault_tree', label: ft.name,
                 detail: `${ft.nodes?.length ?? 0} 节点` })
    }
  }
  return out
}

export interface ApplyAiDraftInput {
  etaTabs: ProjectEta[]
  activeKey: string
  checkedKeys: Record<string, boolean>
  userFts: ModelJson
  draft: AiDraftResponse
  mode: AiApplyMode
  targetFeId?: string
  makeKey?: () => string
  /** D7 逐元素接受:缺省 = 全部接受(向后兼容)。 */
  accepted?: string[]
}

export interface ApplyAiDraftResult {
  etaTabs: ProjectEta[]
  activeKey: string
  checkedKeys: Record<string, boolean>
  userFts: ModelJson
}

const EMPTY_FTS: ModelJson = { model_data: { parameters: [] }, fault_trees: [] }

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))

function withModelDefaults(m?: ModelJson): ModelJson {
  const src = m ?? EMPTY_FTS
  return {
    ...clone(src),
    model_data: { parameters: clone(src.model_data?.parameters ?? []) },
    fault_trees: clone(src.fault_trees ?? []),
  }
}

function uniqueName(taken: Set<string>, baseName: string): string {
  const base = (baseName ?? '').trim() || 'AI_FT'
  if (!taken.has(base)) return base
  for (let i = 2; ; i++) {
    const candidate = `${base}_${i}`
    if (!taken.has(candidate)) return candidate
  }
}

function uniqueParamId(taken: Set<string>, baseId: string): string {
  const base = (baseId ?? '').trim() || 'AI_PARAM'
  if (!taken.has(base)) return base
  for (let i = 2; ; i++) {
    const candidate = `${base}_${i}`
    if (!taken.has(candidate)) return candidate
  }
}

function replaceParamRefs(nodes: FtNodeJson[], idMap: Map<string, string>): FtNodeJson[] {
  return nodes.map((node) => ({
    ...node,
    param_ref: node.param_ref ? (idMap.get(node.param_ref) ?? node.param_ref) : node.param_ref,
  }))
}

interface MergeFtsOptions {
  firstTreeName?: string
  replaceTreeName?: string
}

export function mergeAiDraftFts(baseFts: ModelJson, incomingFts?: ModelJson, options: MergeFtsOptions = {}): ModelJson {
  const merged = withModelDefaults(baseFts)
  const incoming = withModelDefaults(incomingFts)

  if (options.replaceTreeName) {
    merged.fault_trees = merged.fault_trees.filter((ft) => ft.name !== options.replaceTreeName)
  }

  const paramIds = new Set(merged.model_data.parameters.map((p) => p.id))
  const idMap = new Map<string, string>()
  const incomingParams: ParamJson[] = incoming.model_data.parameters.map((param) => {
    const nextId = uniqueParamId(paramIds, param.id)
    paramIds.add(nextId)
    if (nextId !== param.id) idMap.set(param.id, nextId)
    return { ...param, id: nextId }
  })

  const treeNames = new Set(merged.fault_trees.map((ft) => ft.name))
  const incomingTrees: FaultTreeJson[] = incoming.fault_trees.map((ft, idx) => {
    const desiredName = idx === 0 && options.firstTreeName ? options.firstTreeName : ft.name
    const name = uniqueName(treeNames, desiredName)
    treeNames.add(name)
    return {
      ...ft,
      name,
      nodes: replaceParamRefs(clone(ft.nodes ?? []), idMap),
    }
  })

  return {
    ...merged,
    model_data: { ...merged.model_data, parameters: [...merged.model_data.parameters, ...incomingParams] },
    fault_trees: [...merged.fault_trees, ...incomingTrees],
  }
}

function nextGeneratedKey(etas: ProjectEta[]): string {
  const taken = new Set(etas.map((eta) => eta.key))
  for (let i = 1; ; i++) {
    const key = `ai${i}`
    if (!taken.has(key)) return key
  }
}

function normalizeDraftEta(eta: ProjectEta, key: string): ProjectEta {
  const copied = clone(eta)
  const model = copied.model as EventTreeModel
  const name = (copied.name || model?.initEvent || key).trim() || key
  return {
    key,
    name,
    renamed: Boolean(copied.renamed || copied.name?.trim()),
    model,
    fts: withModelDefaults(copied.fts),
    pfds: copied.pfds ?? {},
  }
}

function requireValidDraft(draft: AiDraftResponse): void {
  if (draft.validation?.ok) return
  const errors = draft.validation?.errors?.length ? draft.validation.errors.join('; ') : 'unknown error'
  throw new Error(`AI 草案校验失败: ${errors}`)
}

function requireFtaDraft(draft: AiDraftResponse): void {
  if ((draft.fts?.fault_trees ?? []).length > 0) return
  throw new Error('AI 草案未包含 FTA')
}

function replaceActiveEta(etas: ProjectEta[], activeKey: string, patch: (eta: ProjectEta) => ProjectEta): ProjectEta[] {
  return etas.map((eta) => (eta.key === activeKey ? patch(clone(eta)) : clone(eta)))
}

/** 按接受清单收窄草案(D7):被拒的 ETA 整体剔除、被拒的屏障折叠、被拒的 FT 连同独占参数剔除。 */
export function filterDraftByAcceptance(draft: AiDraftResponse, mode: AiApplyMode,
                                        accepted: string[], currentModel?: EventTreeModel | null): AiDraftResponse {
  const acc = new Set(accepted)
  const out = clone(draft)
  if (mode === 'new_eta' || mode === 'complete_eta') {
    const kept: ProjectEta[] = []
    ;(out.etas ?? []).forEach((eta, i) => {
      const eid = `eta:${i}`
      if (mode === 'new_eta' && !acc.has(eid)) return
      let m = eta.model as EventTreeModel
      const existing = new Set((currentModel?.functionalEvents ?? []).map((f) => f.id))
      const rejected = (m.functionalEvents ?? []).filter((fe) => {
        if (mode === 'complete_eta' && existing.has(fe.id)) return false   // 既有屏障不受清单约束
        return !acc.has(`${eid}/fe:${fe.id}`)
      }).map((fe) => fe.id)
      for (const rid of rejected) {
        const idx = m.functionalEvents.findIndex((f) => f.id === rid)
        if (idx >= 0) m = delFe(m, idx)              // 折叠引用分支为末态(与编辑器删除屏障同语义)
      }
      kept.push({ ...eta, model: m })
    })
    out.etas = kept
  } else {
    const keptTrees = (out.fts?.fault_trees ?? []).filter((ft) => acc.has(`ft:${ft.name}`))
    const usedRefs = new Set(keptTrees.flatMap((ft) => (ft.nodes ?? []).map((n) => n.param_ref).filter(Boolean)))
    out.fts = {
      ...out.fts,
      model_data: { ...out.fts.model_data,
                    parameters: (out.fts.model_data?.parameters ?? []).filter((p) => usedRefs.has(p.id)) },
      fault_trees: keptTrees,
    }
  }
  return out
}

export function applyAiDraftToProject(input: ApplyAiDraftInput): ApplyAiDraftResult {
  requireValidDraft(input.draft)
  if (input.accepted) {
    const current = input.etaTabs.find((t) => t.key === input.activeKey)?.model ?? null
    input = { ...input, draft: filterDraftByAcceptance(input.draft, input.mode, input.accepted, current) }
  }

  const etaTabs = clone(input.etaTabs)
  const checkedKeys = { ...input.checkedKeys }
  const userFts = withModelDefaults(input.userFts)

  if (input.mode === 'new_eta') {
    const drafts = input.draft.etas ?? []
    if (!drafts.length) throw new Error('AI 草案未包含 ETA')
    let activeKey = input.activeKey
    const appended = drafts.map((eta, idx) => {
      const key = input.makeKey ? input.makeKey() : nextGeneratedKey([...etaTabs, ...drafts.slice(0, idx)])
      checkedKeys[key] = true
      if (idx === 0) activeKey = key
      return normalizeDraftEta(eta, key)
    })
    return { etaTabs: [...etaTabs, ...appended], activeKey, checkedKeys, userFts }
  }

  if (input.mode === 'complete_eta') {
    const draftEta = input.draft.etas?.[0]
    if (!draftEta) throw new Error('AI 草案未包含 ETA')
    return {
      etaTabs: replaceActiveEta(etaTabs, input.activeKey, (eta) => ({
        ...eta,
        name: draftEta.name || draftEta.model?.initEvent || eta.name,
        model: clone(draftEta.model),
        fts: withModelDefaults(draftEta.fts ?? eta.fts),
        pfds: clone(draftEta.pfds ?? eta.pfds ?? {}),
      })),
      activeKey: input.activeKey,
      checkedKeys,
      userFts,
    }
  }

  if (input.mode === 'fta_for_barrier') {
    const targetFeId = (input.targetFeId ?? '').trim()
    if (!targetFeId) throw new Error('需要选择一个 ETA 屏障')
    requireFtaDraft(input.draft)
    return {
      etaTabs: replaceActiveEta(etaTabs, input.activeKey, (eta) => ({
        ...eta,
        model: {
          ...eta.model,
          functionalEvents: eta.model.functionalEvents.map((fe) =>
            fe.id === targetFeId ? { ...fe, linkFt: targetFeId } : fe,
          ),
        },
        fts: mergeAiDraftFts(eta.fts, input.draft.fts, {
          firstTreeName: targetFeId,
          replaceTreeName: targetFeId,
        }),
      })),
      activeKey: input.activeKey,
      checkedKeys,
      userFts,
    }
  }

  requireFtaDraft(input.draft)
  return {
    etaTabs,
    activeKey: input.activeKey,
    checkedKeys,
    userFts: mergeAiDraftFts(userFts, input.draft.fts),
  }
}


// ── 用户级 AI 配置(2026-08-17):密钥只写不读,GET 只有掩码提示 ──
export interface AiConfig {
  enabled: boolean
  provider: 'example' | 'anthropic' | 'cloud' | 'local'
  model: string
  api_key_set: boolean
  api_key_hint: string
  models: string[]
}
export async function getAiConfig(): Promise<AiConfig> {
  const r = await fetch('/api/ai/config')
  if (!r.ok) throw new Error(`ai config → ${r.status}`)
  return r.json()
}
export async function putAiConfig(patch: { enabled?: boolean; provider?: 'example' | 'anthropic'; model?: string; api_key?: string }): Promise<AiConfig> {
  const r = await fetch('/api/ai/config', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
  if (!r.ok) {
    let detail = ''
    try { const d = await r.json(); detail = typeof d?.detail === 'string' ? d.detail : '' } catch { /* 非 JSON 错误体 */ }
    throw new Error(detail || `ai config → ${r.status}`)
  }
  return r.json()
}
