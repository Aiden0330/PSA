import type { EventTreeModel } from './eventtree'
import type { FaultTreeJson, FtNodeJson, ModelJson, ParamJson } from './model'
import type { ProjectEta } from './project'

export type AiDraftTarget = 'eta' | 'fta' | 'eta_with_fta'
export type AiApplyMode = 'new_eta' | 'complete_eta' | 'fta_for_barrier' | 'standalone_fta'

export interface AiDraftValidation {
  ok: boolean
  errors: string[]
  warnings: string[]
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
}

export interface AiDraftRequest {
  goal: string
  target: AiDraftTarget
  current_project: Record<string, unknown>
  active_eta_key?: string
  user_context?: Record<string, unknown>
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

export function applyAiDraftToProject(input: ApplyAiDraftInput): ApplyAiDraftResult {
  requireValidDraft(input.draft)

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
