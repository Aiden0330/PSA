import { useEffect, useState } from 'react'
import { AuthRequiredError, SaveConflictError, deleteSaved, listSaved, saveWorkspace, wasSavedOffline } from '../../api'
import type { SavedItem } from '../../api'
import { deserializeProject, serializeProject } from '../../project'
import type { ProjectEta, ProjectPayload } from '../../project'
import { buildProjectFile, downloadProjectFile } from '../../projectFile'
import { getOverlay, mergeOverlay } from '../../libraryStore'
import { loadProjectArchive, importProjectText, projectToTabs, EMPTY_FTS } from './projectIo'
import { clearSessionDraft, peekSessionDraft, stageSessionDraft } from './sessionDraft'
import type { SessionDraftMeta } from './sessionDraft'
import { composeEta } from '../../stores/derived'
import { etaDisplayName, useActiveEta } from '../../stores/useActiveEta'
import { useProjectStore } from '../../stores/projectStore'
import { loadRows, saveRows } from '../../fmeaStore'
import { loadMapping, saveMapping } from '../../mappingStore'
import type { FmeaRow, MappingConfig } from '../../fmea'

/**
 * 项目持久化(存档/另存/读档/文件导入导出/删除)+ FMEA 工作台内容 + 证据链上下文。
 * 单实例挂在 App 壳,两个工作台与报告页共用;projectUuid 由 ADR-2 双写响应带回,
 * 用于报告钉扎(report auto-pin)与案例/版本查询。
 */
export function useProjectPersistence(onError: (msg: string) => void, onLibraryOverlayMerged: () => void) {
  const { etaTabs, userFtsModel, activeKey, checkedKeys, etaPfds, etModel, P } = useActiveEta()
  const [saved, setSaved] = useState<SavedItem[]>([])
  // R2:项目身份(savedId/projectUuid/lastVersionHash)随槽存于 projectStore ——
  // 切换项目时身份跟着槽走(乐观并发基线绝不能串项目)。hook 返回面保持不变。
  const savedId = useProjectStore((s) => s.identity.savedId)
  const projectUuid = useProjectStore((s) => s.identity.projectUuid)
  const lastVersionHash = useProjectStore((s) => s.identity.lastVersionHash)
  const setIdentity = useProjectStore((s) => s.setIdentity)
  const setIdentityFor = useProjectStore((s) => s.setIdentityFor)
  const rekeyWorkspace = useProjectStore((s) => s.rekeyWorkspace)
  const [archiveLocal, setArchiveLocal] = useState(false)
  const [loading, setLoading] = useState(false)      // 读档进行中(下拉禁用,防止值回弹误导)
  const [pendingId, setPendingId] = useState('')     // 读档期间受控下拉的乐观显示值
  // R2-审 F2:conflict 携带发起槽(wid)与发起存档(savedId)—— 409 可能在用户切走后才到,
  // 三路解决必须作用于发起保存的项目,而不是"当时活动的项目"。
  const [conflict, setConflict] = useState<{ serverHash: string; baseHash: string; name: string; payload: ProjectPayload; wid: string; savedId: string } | null>(null)
  // 会话过期(local 模式,401)暂存的草稿元信息;内容留在 localStorage,这里只镜像name/时间供 UI 显示。
  const [sessionDraft, setSessionDraft] = useState<SessionDraftMeta | null>(() => {
    const d = peekSessionDraft()
    return d ? { name: d.name, at: d.at } : null
  })
  // R2:FMEA 随槽(结构性隔离);启动草稿槽一次性从 localStorage 续接(与旧初始行为一致)
  const fmeaRows = useProjectStore((s) => s.fmeaRows)
  const fmeaMapping = useProjectStore((s) => s.fmeaMapping)
  useEffect(() => {
    const st = useProjectStore.getState()
    if (st.identity.savedId === '' && st.fmeaRows.length === 0) st.setFmea(loadRows(), loadMapping())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { listSaved().then((s) => { setSaved(s); setArchiveLocal(wasSavedOffline()) }).catch(() => {}) }, [])

  // R2-审 F6:localStorage 镜像只服务"未存档草稿的跨会话续接"。已存档项目的 FMEA 随
  // payload 进版本库;若也写镜像,启动种子会把存档内容渗入下一次会话的全新草稿(跨会话串染)。
  const persistFmeaRows = (next: FmeaRow[]) => {
    P().setFmea(next, undefined)
    if (useProjectStore.getState().identity.savedId !== '') return
    try { saveRows(next) } catch (e: any) { onError(String(e?.message ?? e)) }
  }
  const persistFmeaMapping = (next: MappingConfig) => {
    P().setFmea(undefined, next)
    if (useProjectStore.getState().identity.savedId !== '') return
    try { saveMapping(next) } catch (e: any) { onError(String(e?.message ?? e)) }
  }
  const buildPayload = (): ProjectPayload =>
    serializeProject(etaTabs.map((t) => composeEta({ ...t, pfds: etaPfds(t) })), activeKey, checkedKeys, userFtsModel, fmeaRows, fmeaMapping)
  const applyProjectFmea = (proj: { fmeaRows?: FmeaRow[]; fmeaMapping?: MappingConfig }) => {
    if (proj.fmeaRows) persistFmeaRows(proj.fmeaRows)
    if (proj.fmeaMapping) persistFmeaMapping(proj.fmeaMapping)
  }

  const refreshList = async () => { setSaved(await listSaved()); setArchiveLocal(wasSavedOffline()) }
  // R2-审 F1:身份写回一律槽定向 —— await 归来时活动项目可能已不是发起者。
  const captureUuidFor = (wid: string, rec: unknown) => {
    const v = (rec as { version?: { project_uuid?: string; content_hash?: string } })?.version
    setIdentityFor(wid, {
      ...(v?.project_uuid ? { projectUuid: v.project_uuid } : {}),
      ...(v?.content_hash ? { lastVersionHash: v.content_hash } : {}),
    })
  }

  // 保存项目:identity.savedId 为权威(R2-审 F7:mount 时列表过期不得把原地更新降级为
  // 新建——那会分叉版本链);原地更新带 lastVersionHash(D-P5-4),服务器已前进则 409。
  const onSaveWorkspace = async () => {
    if (!etModel) return
    const wid = useProjectStore.getState().workspaceId   // 槽钉定:发起保存的项目
    const payload = buildPayload()
    const existing = saved.find((s) => s.id === savedId)
    // name 在 try 外解出:catch 分支(冲突/会话过期暂存)也要用到用户刚输入的名称 ——
    // 塞进 try 内的 else 分支会块作用域丢失,暂存草稿就会挂错名字(曾经的真实 bug)。
    let name: string
    if (savedId) {
      name = existing?.name || useProjectStore.getState().identity.displayName || 'ETA 项目'
    } else {
      const at = etaTabs.find((t) => t.key === activeKey)
      const dflt = (at ? etaDisplayName(at, etModel) : '') || etModel.initEvent || 'ETA 项目'
      const prompted = window.prompt('项目存档名称', dflt)
      if (!prompted) return
      name = prompted
    }
    try {
      if (savedId) {
        captureUuidFor(wid, await saveWorkspace(name, payload, savedId, lastVersionHash))
      } else {
        const rec = await saveWorkspace(name, payload)
        setIdentityFor(wid, { savedId: rec.id, displayName: name })
        captureUuidFor(wid, rec)
        rekeyWorkspace(wid, rec.id)   // wid 约定=savedId,防旧 wid 残留吞掉后续重开(F4)
      }
      await refreshList()
    } catch (e) {
      if (e instanceof SaveConflictError) {
        setConflict({ serverHash: e.serverHash, baseHash: e.baseHash, name, payload, wid, savedId })
        return
      }
      if (e instanceof AuthRequiredError) {
        // 会话过期(local 模式):编辑仍在内存里,但显式暂存一份 + 明确告知,
        // 绝不让保存动作静默失败(那样用户会误以为已存到服务器)。
        stageSessionDraft(name, payload, savedId)
        setSessionDraft({ name, at: new Date().toISOString() })
        onError('登录已过期,本次保存未写入服务器 —— 你的编辑仍在,已额外暂存一份草稿到本机;请重新登录后点「恢复草稿」。')
        return
      }
      throw e
    }
  }
  // 另存为新项目:总是新建一份副本, 并把当前项目切换为该副本(新建不带 base_version_hash,不可能冲突)
  const onSaveAs = async () => {
    if (!etModel) return
    const wid = useProjectStore.getState().workspaceId   // 槽钉定(F1)
    const at = etaTabs.find((t) => t.key === activeKey)
    const base = saved.find((s) => s.id === savedId)?.name || (at ? etaDisplayName(at, etModel) : '') || 'ETA 项目'
    const name = window.prompt('另存为新项目名称', base + ' 副本')
    if (!name) return
    const payload = buildPayload()
    try {
      const rec = await saveWorkspace(name, payload)
      setIdentityFor(wid, { savedId: rec.id, displayName: name })
      captureUuidFor(wid, rec)
      rekeyWorkspace(wid, rec.id)   // F4:旧存档 wid 让位,原存档此后可重新打开
      await refreshList()
    } catch (e) {
      if (e instanceof AuthRequiredError) {
        stageSessionDraft(name, payload, '')
        setSessionDraft({ name, at: new Date().toISOString() })
        onError('登录已过期,本次「另存为」未写入服务器 —— 你的编辑仍在,已额外暂存一份草稿到本机;请重新登录后点「恢复草稿」。')
        return
      }
      throw e
    }
  }

  // ── D-P5-4 冲突对话三路径:查看 diff(调用方负责切页)/ 另存副本 / 确认覆盖 ──
  // R2-审 F2:一律使用 conflict 携带的发起槽/发起存档 —— 409 到达时用户可能已切到别的项目,
  // 用"当前 savedId"会把发起项目的内容强写进当前项目的存档(跨项目覆盖)。
  const resolveConflictOverwrite = async () => {
    if (!conflict) return
    captureUuidFor(conflict.wid, await saveWorkspace(conflict.name, conflict.payload, conflict.savedId))   // 不带 base → 强制覆盖(现行为)
    setConflict(null)
    await refreshList()
  }
  const resolveConflictSaveAsCopy = async () => {
    if (!conflict) return
    const name = window.prompt('另存为新项目名称(避免覆盖冲突)', (conflict.name || 'ETA 项目') + ' 副本')
    setConflict(null)
    if (!name) return
    const rec = await saveWorkspace(name, conflict.payload)
    setIdentityFor(conflict.wid, { savedId: rec.id, displayName: name })
    captureUuidFor(conflict.wid, rec)
    rekeyWorkspace(conflict.wid, rec.id)
    await refreshList()
  }
  const dismissConflict = () => setConflict(null)

  // ── 会话过期草稿(规格 §9 验收):重新登录后显式恢复,不自动覆盖用户正在看的内容 ──
  // R2-审 F3:草稿按其 savedId **归位**,绝不拼接身份 —— 旧实现把草稿的 savedId 合并进
  // "当时活动"槽的身份(保留人家的 uuid/基线/名),既串染证据链又复制了去重键。
  // 现在:该项目已打开 → 聚焦它自己的槽再整体载入(uuid 随槽原有,即同一项目,正确;
  // 基线清空 = 下次保存为显式覆盖语义,与"恢复草稿"的用户意图一致);未打开 → 开新槽,身份完整重置。
  const restoreSessionDraft = () => {
    const d = peekSessionDraft()
    if (!d) { setSessionDraft(null); return }
    const proj = deserializeProject(d.payload, d.name)
    const tabs = projectToTabs(proj)
    const restoredActiveKey = tabs.some((t) => t.key === proj.activeKey) ? proj.activeKey : (tabs[0]?.key ?? '')
    if (!tabs.length) { onError('暂存草稿不含任何 ETA,已丢弃。'); clearSessionDraft(); setSessionDraft(null); return }
    const st = useProjectStore.getState()
    const isOpen = d.savedId !== '' &&
      (st.identity.savedId === d.savedId || Object.values(st.parked).some((sl) => sl.identity.savedId === d.savedId))
    if (isOpen) {
      st.openProject(d.savedId, { etas: [], activeKey: '', checkedKeys: {}, identity: { savedId: d.savedId, projectUuid: '', displayName: '' } })  // 去重命中 → 仅聚焦
      const cur = useProjectStore.getState()
      cur.load(tabs, restoredActiveKey, proj.checkedKeys, proj.userFts ?? EMPTY_FTS)
      cur.setIdentityFor(cur.workspaceId, { displayName: d.name, lastVersionHash: undefined })
      applyProjectFmea(proj)
    } else {
      useProjectStore.getState().openProject(d.savedId || `draft-restore:${d.at}`, {
        etas: tabs, activeKey: restoredActiveKey, checkedKeys: proj.checkedKeys, userFts: proj.userFts ?? EMPTY_FTS,
        identity: { savedId: d.savedId, projectUuid: '', lastVersionHash: undefined, displayName: d.name },
        fmeaRows: proj.fmeaRows, fmeaMapping: proj.fmeaMapping,
      })
    }
    clearSessionDraft()
    setSessionDraft(null)
  }
  const discardSessionDraft = () => { clearSessionDraft(); setSessionDraft(null) }

  // 读取项目存档(R2):已打开(活动/停放)→ 仅聚焦切换,绝不重载(保护未保存编辑);
  // 未打开 → fetch 后作为新槽打开(停放当前项目)。pendingId 保证受控下拉在 await 期间不回弹。
  const loadProject = async (id: string) => {
    const st = useProjectStore.getState()
    const isOpen = st.identity.savedId === id || Object.values(st.parked).some((sl) => sl.identity.savedId === id)
    if (isOpen) {
      st.openProject(id, { etas: [], activeKey: '', checkedKeys: {}, identity: { savedId: id, projectUuid: '', displayName: '' } })
      return
    }
    setPendingId(id)
    setLoading(true)
    try {
      const proj = await loadProjectArchive(id); setArchiveLocal(wasSavedOffline())
      if (!proj.tabs.length) {
        onError('该存档不含任何 ETA,未载入。')
        return
      }
      useProjectStore.getState().openProject(id, {
        etas: proj.tabs, activeKey: proj.activeKey, checkedKeys: proj.checkedKeys, userFts: proj.userFts ?? EMPTY_FTS,
        identity: { savedId: id, projectUuid: proj.projectUuid ?? '', lastVersionHash: proj.versionHash, displayName: proj.name },
        fmeaRows: proj.fmeaRows, fmeaMapping: proj.fmeaMapping,
      })
      // R2-审 F7:组合总览/他端可能打开 mount 后新建的存档 —— 列表跟上,防原地保存降级为新建
      void refreshList().catch(() => {})
    } catch (e: any) {
      onError(`读取存档失败:${String(e?.message ?? e)}`)
    } finally { setLoading(false); setPendingId('') }
  }
  // 导出项目为文件(含参考库覆盖层, 离线可用)
  const onExportFile = () => {
    if (!etModel) return
    const active = etaTabs.find((t) => t.key === activeKey)
    const name = active ? etaDisplayName(active, etModel) : 'bess-psa-project'
    downloadProjectFile(buildProjectFile(buildPayload(), getOverlay()), name)
  }
  // 从文件导入项目(替换全部页签);若文件携带参考库覆盖层则非破坏并入
  const onImportFile = async (file: File) => {
    const wid = useProjectStore.getState().workspaceId   // 槽钉定(F1:file.text() 也是 await)
    const importName = file.name.replace(/\.[^.]+$/, '')
    try {
      const proj = importProjectText(await file.text(), importName)
      if (!proj.tabs.length) return
      if (useProjectStore.getState().workspaceId !== wid) {
        onError('导入期间已切换项目,本次导入未应用 —— 请在目标项目处于活动状态时重新导入。')
        return
      }
      if (proj.libraryOverlay) { mergeOverlay(proj.libraryOverlay as any); onLibraryOverlayMerged() }
      // F8:导入内容以文件名为项目名 —— 保留上一个项目的 displayName 会让树把导入内容标成别人
      setIdentity({ savedId: '', projectUuid: '', lastVersionHash: undefined, displayName: importName })
      P().load(proj.tabs, proj.activeKey, proj.checkedKeys, proj.userFts ?? EMPTY_FTS)
      applyProjectFmea(proj)
    } catch (e: any) { onError(String(e?.message ?? e)) }
  }
  const onDeleteSaved = async () => {
    if (!savedId) return
    const wid = useProjectStore.getState().workspaceId   // 槽钉定(F1)
    const delId = savedId
    const name = saved.find((s) => s.id === delId)?.name ?? delId
    if (!window.confirm(`删除项目存档「${name}」?存档删除不可撤销(版本库中的历史版本仍保留)。`)) return
    await deleteSaved(delId)
    setIdentityFor(wid, { savedId: '', projectUuid: '', lastVersionHash: undefined })
    await refreshList()
  }

  return {
    saved, savedId: pendingId || savedId, archiveLocal, projectUuid, lastVersionHash, loading, conflict, sessionDraft,
    fmeaRows, fmeaMapping, persistFmeaRows, persistFmeaMapping,
    buildPayload, onSaveWorkspace, onSaveAs, loadProject, onExportFile, onImportFile, onDeleteSaved,
    resolveConflictOverwrite, resolveConflictSaveAsCopy, dismissConflict,
    restoreSessionDraft, discardSessionDraft,
  }
}

export type ProjectPersistence = ReturnType<typeof useProjectPersistence>
export type { ProjectEta }
