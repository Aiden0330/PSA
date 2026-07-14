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
  const [archiveLocal, setArchiveLocal] = useState(false)
  const [loading, setLoading] = useState(false)      // 读档进行中(下拉禁用,防止值回弹误导)
  const [pendingId, setPendingId] = useState('')     // 读档期间受控下拉的乐观显示值
  const [conflict, setConflict] = useState<{ serverHash: string; baseHash: string; name: string; payload: ProjectPayload } | null>(null)
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

  const persistFmeaRows = (next: FmeaRow[]) => {
    P().setFmea(next, undefined)
    try { saveRows(next) } catch (e: any) { onError(String(e?.message ?? e)) }
  }
  const persistFmeaMapping = (next: MappingConfig) => {
    P().setFmea(undefined, next)
    try { saveMapping(next) } catch (e: any) { onError(String(e?.message ?? e)) }
  }
  const buildPayload = (): ProjectPayload =>
    serializeProject(etaTabs.map((t) => composeEta({ ...t, pfds: etaPfds(t) })), activeKey, checkedKeys, userFtsModel, fmeaRows, fmeaMapping)
  const applyProjectFmea = (proj: { fmeaRows?: FmeaRow[]; fmeaMapping?: MappingConfig }) => {
    if (proj.fmeaRows) persistFmeaRows(proj.fmeaRows)
    if (proj.fmeaMapping) persistFmeaMapping(proj.fmeaMapping)
  }

  const refreshList = async () => { setSaved(await listSaved()); setArchiveLocal(wasSavedOffline()) }
  const captureUuid = (rec: unknown) => {
    const v = (rec as { version?: { project_uuid?: string; content_hash?: string } })?.version
    setIdentity({
      ...(v?.project_uuid ? { projectUuid: v.project_uuid } : {}),
      ...(v?.content_hash ? { lastVersionHash: v.content_hash } : {}),
    })
  }

  // 保存项目:已载入存档(savedId 命中)→ 原地更新(沿用原名, 不再追问);否则新建并记住其 id。
  // 原地更新带上 lastVersionHash(D-P5-4)——服务器版本已前进则 409,弹冲突对话而非静默覆盖。
  const onSaveWorkspace = async () => {
    if (!etModel) return
    const payload = buildPayload()
    const existing = saved.find((s) => s.id === savedId)
    // name 在 try 外解出:catch 分支(冲突/会话过期暂存)也要用到用户刚输入的名称 ——
    // 塞进 try 内的 else 分支会块作用域丢失,暂存草稿就会挂错名字(曾经的真实 bug)。
    let name: string
    if (savedId && existing) {
      name = existing.name
    } else {
      const at = etaTabs.find((t) => t.key === activeKey)
      const dflt = (at ? etaDisplayName(at, etModel) : '') || etModel.initEvent || 'ETA 项目'
      const prompted = window.prompt('项目存档名称', dflt)
      if (!prompted) return
      name = prompted
    }
    try {
      if (savedId && existing) {
        captureUuid(await saveWorkspace(name, payload, savedId, lastVersionHash))
      } else {
        const rec = await saveWorkspace(name, payload)
        setIdentity({ savedId: rec.id, displayName: name })
        captureUuid(rec)
      }
      await refreshList()
    } catch (e) {
      if (e instanceof SaveConflictError) {
        setConflict({ serverHash: e.serverHash, baseHash: e.baseHash, name, payload })
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
    const at = etaTabs.find((t) => t.key === activeKey)
    const base = saved.find((s) => s.id === savedId)?.name || (at ? etaDisplayName(at, etModel) : '') || 'ETA 项目'
    const name = window.prompt('另存为新项目名称', base + ' 副本')
    if (!name) return
    const payload = buildPayload()
    try {
      const rec = await saveWorkspace(name, payload)
      setIdentity({ savedId: rec.id, displayName: name })
      captureUuid(rec)
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
  const resolveConflictOverwrite = async () => {
    if (!conflict) return
    const name = saved.find((s) => s.id === savedId)?.name ?? conflict.name
    captureUuid(await saveWorkspace(name, conflict.payload, savedId))   // 不带 base → 强制覆盖(现行为)
    setConflict(null)
    await refreshList()
  }
  const resolveConflictSaveAsCopy = async () => {
    if (!conflict) return
    const base = saved.find((s) => s.id === savedId)?.name || conflict.name || 'ETA 项目'
    const name = window.prompt('另存为新项目名称(避免覆盖冲突)', base + ' 副本')
    setConflict(null)
    if (!name) return
    const rec = await saveWorkspace(name, conflict.payload)
    setIdentity({ savedId: rec.id, displayName: name })
    captureUuid(rec)
    await refreshList()
  }
  const dismissConflict = () => setConflict(null)

  // ── 会话过期草稿(规格 §9 验收):重新登录后显式恢复,不自动覆盖用户正在看的内容 ──
  const restoreSessionDraft = () => {
    const d = peekSessionDraft()
    if (!d) { setSessionDraft(null); return }
    const proj = deserializeProject(d.payload, d.name)
    const tabs = projectToTabs(proj)
    const restoredActiveKey = tabs.some((t) => t.key === proj.activeKey) ? proj.activeKey : (tabs[0]?.key ?? '')
    if (!tabs.length) { onError('暂存草稿不含任何 ETA,已丢弃。'); clearSessionDraft(); setSessionDraft(null); return }
    setIdentity({ savedId: d.savedId })
    P().load(tabs, restoredActiveKey, proj.checkedKeys, proj.userFts ?? EMPTY_FTS)
    applyProjectFmea(proj)
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
    try {
      const proj = importProjectText(await file.text(), file.name.replace(/\.[^.]+$/, ''))
      if (!proj.tabs.length) return
      if (proj.libraryOverlay) { mergeOverlay(proj.libraryOverlay as any); onLibraryOverlayMerged() }
      setIdentity({ savedId: '', projectUuid: '', lastVersionHash: undefined })
      P().load(proj.tabs, proj.activeKey, proj.checkedKeys, proj.userFts ?? EMPTY_FTS)
      applyProjectFmea(proj)
    } catch (e: any) { onError(String(e?.message ?? e)) }
  }
  const onDeleteSaved = async () => {
    if (!savedId) return
    const name = saved.find((s) => s.id === savedId)?.name ?? savedId
    if (!window.confirm(`删除项目存档「${name}」?存档删除不可撤销(版本库中的历史版本仍保留)。`)) return
    await deleteSaved(savedId); setIdentity({ savedId: '', projectUuid: '', lastVersionHash: undefined }); await refreshList()
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
