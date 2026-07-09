import { useEffect, useState } from 'react'
import { draftAiModel } from '../../api'
import type { LibraryData } from '../../api'
import { applyAiDraftToProject } from '../../aiDraft'
import type { AiApplyMode, AiDraftResponse, AiDraftTarget } from '../../aiDraft'
import type { ProjectEta, ProjectPayload } from '../../project'
import { etaDisplayName, useActiveEta } from '../../stores/useActiveEta'
import { useViewStore } from '../../stores/viewStore'

export type AiAppliedResult =
  | { kind: 'eta'; mode: 'new_eta' | 'complete_eta'; etaKey: string; etaName: string; at: number }
  | { kind: 'fta'; etaKey: string; etaName: string; treeName: string; barrierId: string; barrierLabel: string; at: number }
  | { kind: 'standalone_fta'; treeName: string; at: number }

type AiDraftContext = {
  mode: AiApplyMode
  etaKey: string
  etaName: string
  targetFeId?: string
  targetFeLabel?: string
}

function aiTargetForMode(mode: AiApplyMode): AiDraftTarget {
  return mode === 'fta_for_barrier' || mode === 'standalone_fta' ? 'fta' : 'eta'
}

function compactLibraryContext(lib: LibraryData | null): Record<string, unknown> | undefined {
  if (!lib) return undefined
  return {
    initiating_events: lib.initiating_events.map((x) => ({
      id: x.id, label: x.label, category: x.category, freq_prior: x.freq_prior, source: x.source?.citation,
    })),
    barrier_effectiveness: lib.barrier_effectiveness.map((x) => ({
      id: x.id, name: x.name, category: x.category, pfd: x.pfd, grade: x.grade, source: x.source?.citation,
    })),
    component_failure_rates: lib.component_failure_rates.map((x) => ({
      id: x.id, name: x.name, failure_mode: x.failure_mode, rate: x.rate, unit: x.unit, grade: x.grade, source: x.source?.citation,
    })),
  }
}

/** AI 建模助手状态机(生成 → 审阅 → 应用/导航),出 App(蓝图 §三 features/ai-draft)。 */
export function useAiDraft(lib: LibraryData | null, buildPayload: () => ProjectPayload, activeName: string) {
  const { etaTabs, userFtsModel, activeKey, checkedKeys, etModel, P } = useActiveEta()
  const setTab = useViewStore((s) => s.setTab)
  const setFtEditTarget = useViewStore((s) => s.setFtEditTarget)
  const setSelected = useViewStore((s) => s.setSelected)

  const [aiOpen, setAiOpen] = useState(false)
  const [aiGoal, setAiGoal] = useState('电池舱液冷泄漏导致外短')
  const [aiMode, setAiMode] = useState<AiApplyMode>('new_eta')
  const [aiTargetFeId, setAiTargetFeId] = useState('')
  const [aiDraft, setAiDraft] = useState<AiDraftResponse | null>(null)
  const [aiDraftContext, setAiDraftContext] = useState<AiDraftContext | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiNotice, setAiNotice] = useState<string | null>(null)
  const [aiAppliedResult, setAiAppliedResult] = useState<AiAppliedResult | null>(null)

  useEffect(() => {
    if (!etModel?.functionalEvents.length) return
    if (!aiTargetFeId || !etModel.functionalEvents.some((fe) => fe.id === aiTargetFeId)) {
      setAiTargetFeId(etModel.functionalEvents[0].id)
    }
  }, [etModel, aiTargetFeId])

  const onGenerateAiDraft = async () => {
    if (!etModel) return
    if (aiMode === 'fta_for_barrier' && !aiTargetFeId) {
      setAiError('请先选择一个屏障')
      return
    }
    const targetFe = etModel.functionalEvents.find((fe) => fe.id === aiTargetFeId)
    const context: AiDraftContext = {
      mode: aiMode,
      etaKey: activeKey,
      etaName: activeName,
      targetFeId: aiMode === 'fta_for_barrier' ? aiTargetFeId : undefined,
      targetFeLabel: aiMode === 'fta_for_barrier' ? (targetFe?.label ?? aiTargetFeId) : undefined,
    }
    setAiBusy(true); setAiError(null); setAiNotice(null); setAiDraft(null); setAiDraftContext(context)
    try {
      const draft = await draftAiModel({
        goal: aiGoal,
        target: aiTargetForMode(aiMode),
        current_project: buildPayload() as unknown as Record<string, unknown>,
        active_eta_key: activeKey,
        user_context: {
          mode: aiMode,
          target_fe_id: aiMode === 'fta_for_barrier' ? aiTargetFeId : undefined,
          target_fe_label: aiMode === 'fta_for_barrier' ? (targetFe?.label ?? aiTargetFeId) : undefined,
          library: compactLibraryContext(lib),
        },
      })
      setAiDraft(draft)
    } catch (e: any) {
      setAiError(String(e?.message ?? e))
    } finally {
      setAiBusy(false)
    }
  }

  const onApplyAiDraft = () => {
    if (!aiDraft) return
    try {
      let seq = 0
      const applyEtaKey = (aiMode === 'fta_for_barrier' || aiMode === 'complete_eta')
        ? (aiDraftContext?.etaKey ?? activeKey)
        : activeKey
      const applyTargetFeId = aiMode === 'fta_for_barrier'
        ? (aiDraftContext?.targetFeId ?? aiTargetFeId)
        : aiTargetFeId
      const result = applyAiDraftToProject({
        etaTabs,
        activeKey: applyEtaKey,
        checkedKeys,
        userFts: userFtsModel,
        draft: aiDraft,
        mode: aiMode,
        targetFeId: applyTargetFeId,
        makeKey: () => `ai${Date.now().toString(36)}${(seq++).toString(36)}`,
      })
      const tabs = result.etaTabs as ProjectEta[]
      const active = tabs.find((t) => t.key === result.activeKey) ?? tabs[0]
      // AI 应用 = 一条文档历史(整体替换,可一键撤销)
      P().applyProject({
        etas: tabs,
        checkedKeys: result.checkedKeys,
        activeKey: active?.key ?? result.activeKey,
        userFts: aiMode === 'standalone_fta' ? result.userFts : undefined,
      })
      if (aiMode === 'fta_for_barrier' && applyTargetFeId) {
        setFtEditTarget({ src: 'eta', etaKey: result.activeKey, name: applyTargetFeId })
        setTab('ft')
        const targetFe = active?.model.functionalEvents.find((fe) => fe.id === applyTargetFeId)
        const etaName = active ? etaDisplayName(active, active.model) : '当前 ETA'
        const barrierLabel = aiDraftContext?.targetFeLabel || targetFe?.label || applyTargetFeId
        setAiAppliedResult({ kind: 'fta', etaKey: result.activeKey, etaName, treeName: applyTargetFeId, barrierId: applyTargetFeId, barrierLabel, at: Date.now() })
        setAiNotice(`AI 已打开 FTA: ${barrierLabel}`)
      } else if (aiMode === 'standalone_fta') {
        const incomingCount = aiDraft.fts?.fault_trees?.length ?? 0
        const mergedTrees = result.userFts.fault_trees ?? []
        const firstNewIdx = Math.max(0, mergedTrees.length - incomingCount)
        const openedName = mergedTrees[firstNewIdx]?.name ?? mergedTrees[mergedTrees.length - 1]?.name ?? 'AI_FTA'
        setTab('ft')
        setFtEditTarget({ src: 'standalone', name: openedName })
        setAiAppliedResult({ kind: 'standalone_fta', treeName: openedName, at: Date.now() })
        setAiNotice(`AI 已打开自建 FTA: ${openedName}`)
      } else {
        setTab('bess')
        const etaName = active ? etaDisplayName(active, active.model) : 'AI 草案'
        setAiAppliedResult({ kind: 'eta', mode: aiMode === 'complete_eta' ? 'complete_eta' : 'new_eta', etaKey: result.activeKey, etaName, at: Date.now() })
        setAiNotice(`${aiMode === 'complete_eta' ? 'AI 已补全并切换到 ETA' : 'AI 已新增并切换到 ETA'}: ${etaName}`)
      }
      setAiDraft(null)
      setAiDraftContext(null)
      setAiError(null)
      setAiOpen(false)
    } catch (e: any) {
      setAiError(String(e?.message ?? e))
    }
  }

  const openAiAppliedResult = () => {
    if (!aiAppliedResult) return
    const selectEta = (key: string) => { if (key !== P().activeKey && P().present.etas.some((t) => t.key === key)) P().setActive(key) }
    if (aiAppliedResult.kind === 'eta') {
      selectEta(aiAppliedResult.etaKey)
      setTab('bess')
      return
    }
    if (aiAppliedResult.kind === 'fta') {
      selectEta(aiAppliedResult.etaKey)
      setFtEditTarget({ src: 'eta', etaKey: aiAppliedResult.etaKey, name: aiAppliedResult.treeName })
      setTab('ft')
      setSelected(null)
      return
    }
    setFtEditTarget({ src: 'standalone', name: aiAppliedResult.treeName })
    setTab('ft')
    setSelected(null)
  }

  return {
    aiOpen, setAiOpen, aiGoal, setAiGoal, aiMode, setAiMode, aiTargetFeId, setAiTargetFeId,
    aiDraft, setAiDraft, aiDraftContext, setAiDraftContext, aiBusy, aiError, setAiError, aiNotice,
    aiAppliedResult, onGenerateAiDraft, onApplyAiDraft, openAiAppliedResult,
  }
}

export type AiDraftState = ReturnType<typeof useAiDraft>
