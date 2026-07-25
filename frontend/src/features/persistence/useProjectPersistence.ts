import { useEffect, useRef, useState } from 'react'
import { AuthRequiredError, SaveConflictError, SavedNotFoundError, deleteSaved, listProjectVersions, listSaved, saveWorkspace, wasSavedOffline } from '../../api'
import type { SavedItem } from '../../api'
import { deserializeProject, serializeProject } from '../../project'
import type { ProjectEta, ProjectPayload } from '../../project'
import { buildProjectFile, downloadProjectFile } from '../../projectFile'
import { getOverlay, mergeOverlay } from '../../libraryStore'
import { loadProjectArchive, importProjectText, projectToTabs, EMPTY_FTS } from './projectIo'
import { clearSessionDraft, listSessionDrafts, stageSessionDraft, sessionDraftKey } from './sessionDraft'
import type { SessionDraftMeta } from './sessionDraft'
import { composeEta } from '../../stores/derived'
import { etaDisplayName, useActiveEta } from '../../stores/useActiveEta'
import { useProjectStore } from '../../stores/projectStore'
import { loadRows, saveRows } from '../../fmeaStore'
import { loadMapping, saveMapping } from '../../mappingStore'
import type { FmeaRow, MappingConfig } from '../../fmea'

// 刷新找回:记住上次打开的存档 id(localStorage;消费方为 loadProject 与 auto-reopen effect)
const LAST_KEY = 'psa.lastProject'

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
  // FE-04:草稿按项目为键(v2);UI 仍呈现最近一份可恢复(恢复/丢弃按其 key 定位)。
  const [sessionDraft, setSessionDraft] = useState<SessionDraftMeta | null>(() => {
    const d = listSessionDrafts()[0]
    return d ? { name: d.name, at: d.at, savedId: d.savedId } : null
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
  const persistFmeaRows = (next: FmeaRow[] | ((prev: FmeaRow[]) => FmeaRow[])) => {
    P().setFmea(next, undefined)
    if (useProjectStore.getState().identity.savedId !== '') return
    // 镜像取写后 store 值(函数式入参没有"值"可存;store 已同步应用)
    try { saveRows(useProjectStore.getState().fmeaRows) } catch (e: any) { onError(String(e?.message ?? e)) }
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
  // 导出钉扎基线同步(自冲突报障 2026-07-21):导出报告会 auto-pin 一个证据版本,
  // 前端基线若不跟进,下一次保存会把**自己钉的版本**当他人并发而 409。导出成功后调用:
  // 取服务器头版本推进发起槽基线。内容即刚导出的载荷,推进无数据风险;真正的并发仍受 CAS 保护。
  const syncBaselineAfterPin = async (wid: string) => {
    try {
      const st = useProjectStore.getState()
      const idn = wid === st.workspaceId ? st.identity : st.parked[wid]?.identity
      if (!idn?.projectUuid) return
      const versions = await listProjectVersions(idn.projectUuid)
      const head = versions[versions.length - 1]?.content_hash
      if (head) setIdentityFor(wid, { lastVersionHash: head })
    } catch { /* 同步失败不打扰导出成功;下一次保存最多多走一次冲突对话 */ }
  }
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
  // FE-08:保存 in-flight 守卫——按发起槽串行化 save/save-as,双击不创建两个服务端项目
  const savingRef = useRef<Set<string>>(new Set())
  const onSaveWorkspace = async () => {
    if (!etModel) return
    const wid = useProjectStore.getState().workspaceId   // 槽钉定:发起保存的项目
    if (savingRef.current.has(wid)) return               // FE-08:该槽保存进行中,忽略重入(双击不建两个项目)
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
    savingRef.current.add(wid)
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
        // FE-04:暂存带 CAS 基线 + projectUuid(恢复后保存仍受 409 保护);写入失败必须可见。
        const st = stageSessionDraft(name, payload, savedId, { projectUuid, lastVersionHash })
        setSessionDraft({ name, at: new Date().toISOString(), savedId })
        onError(st.ok
          ? '登录已过期,本次保存未写入服务器 —— 你的编辑仍在,已额外暂存一份草稿到本机;请重新登录后点「恢复草稿」。'
          : '登录已过期,且本机暂存失败(隐私模式/存储已满)—— 请立即用「导出项目文件」保存你的编辑,再重新登录。')
        return
      }
      throw e
    } finally { savingRef.current.delete(wid) }
  }
  // 另存为新项目:总是新建一份副本, 并把当前项目切换为该副本(新建不带 base_version_hash,不可能冲突)
  const onSaveAs = async () => {
    if (!etModel) return
    const wid = useProjectStore.getState().workspaceId   // 槽钉定(F1)
    const at = etaTabs.find((t) => t.key === activeKey)
    const base = saved.find((s) => s.id === savedId)?.name || (at ? etaDisplayName(at, etModel) : '') || 'ETA 项目'
    const name = window.prompt('另存为新项目名称', base + ' 副本')
    if (!name) return
    // 同名存档确认(报障 2026-07-20):同名双胞胎让用户在两份档案间无感横跳,
    // 编辑落错份 = "改动丢了"。允许但必须知情。
    if (saved.some((s2) => s2.name === name) &&
        !window.confirm(`已存在同名存档「${name}」。另存将创建**第二份**同名档案(树中以 #id 区分)。确定继续?建议改用不同名称。`)) return
    if (savingRef.current.has(wid)) return               // FE-08:重入守卫
    const payload = buildPayload()
    savingRef.current.add(wid)
    try {
      const rec = await saveWorkspace(name, payload)
      setIdentityFor(wid, { savedId: rec.id, displayName: name })
      captureUuidFor(wid, rec)
      rekeyWorkspace(wid, rec.id)   // F4:旧存档 wid 让位,原存档此后可重新打开
      await refreshList()
    } catch (e) {
      if (e instanceof AuthRequiredError) {
        const st = stageSessionDraft(name, payload, '', { projectUuid })
        setSessionDraft({ name, at: new Date().toISOString(), savedId: '' })
        onError(st.ok
          ? '登录已过期,本次「另存为」未写入服务器 —— 你的编辑仍在,已额外暂存一份草稿到本机;请重新登录后点「恢复草稿」。'
          : '登录已过期,且本机暂存失败(隐私模式/存储已满)—— 请立即用「导出项目文件」保存你的编辑,再重新登录。')
        return
      }
      throw e
    } finally { savingRef.current.delete(wid) }
  }

  // ── D-P5-4 冲突对话三路径:查看 diff(调用方负责切页)/ 另存副本 / 确认覆盖 ──
  // R2-审 F2:一律使用 conflict 携带的发起槽/发起存档 —— 409 到达时用户可能已切到别的项目,
  // 用"当前 savedId"会把发起项目的内容强写进当前项目的存档(跨项目覆盖)。
  // P4-C ①②:两路径包 try/catch——覆盖/另存再撞 401/网络错时,此前 promise 未捕获:
  // 覆盖路窗滞留无文案、另存路窗已关用户以为已存实则丢。失败必须可见 + 冲突条重现。
  const resolveConflictOverwrite = async () => {
    if (!conflict) return
    try {
      captureUuidFor(conflict.wid, await saveWorkspace(conflict.name, conflict.payload, conflict.savedId))   // 不带 base → 强制覆盖(现行为)
      setConflict(null)
      await refreshList()
    } catch (e) {
      onError(`覆盖保存失败(冲突未解决,可重试):${e instanceof Error ? e.message : String(e)}`)
    }
  }
  const resolveConflictSaveAsCopy = async () => {
    if (!conflict) return
    const name = window.prompt('另存为新项目名称(避免覆盖冲突)', (conflict.name || 'ETA 项目') + ' 副本')
    if (!name) return
    const keep = conflict
    setConflict(null)
    try {
      const rec = await saveWorkspace(name, keep.payload)
      setIdentityFor(keep.wid, { savedId: rec.id, displayName: name })
      captureUuidFor(keep.wid, rec)
      rekeyWorkspace(keep.wid, rec.id)
      await refreshList()
    } catch (e) {
      setConflict(keep)   // 副本没存上:冲突条重现,绝不让用户以为已存
      onError(`另存副本失败(冲突未解决):${e instanceof Error ? e.message : String(e)}`)
    }
  }
  const dismissConflict = () => setConflict(null)

  // ── 会话过期草稿(规格 §9 验收):重新登录后显式恢复,不自动覆盖用户正在看的内容 ──
  // R2-审 F3:草稿按其 savedId **归位**,绝不拼接身份 —— 旧实现把草稿的 savedId 合并进
  // "当时活动"槽的身份(保留人家的 uuid/基线/名),既串染证据链又复制了去重键。
  // 现在:该项目已打开 → 聚焦它自己的槽再整体载入(uuid 随槽原有,即同一项目,正确;
  // 基线清空 = 下次保存为显式覆盖语义,与"恢复草稿"的用户意图一致);未打开 → 开新槽,身份完整重置。
  const restoreSessionDraft = () => {
    const d = listSessionDrafts()[0]
    if (!d) { setSessionDraft(null); return }
    const dkey = sessionDraftKey(d)
    let proj: ReturnType<typeof deserializeProject>
    try {
      proj = deserializeProject(d.payload, d.name)
    } catch (e) {
      // P4-C ⑪:畸形/跨版本草稿反序列化抛错 → 可见报错并保留草稿(不销毁证据),按钮不再静默
      onError(`草稿无法恢复(已保留原始数据):${e instanceof Error ? e.message : String(e)}`)
      return
    }
    const tabs = projectToTabs(proj)
    const restoredActiveKey = tabs.some((t) => t.key === proj.activeKey) ? proj.activeKey : (tabs[0]?.key ?? '')
    if (!tabs.length) { onError('暂存草稿不含任何 ETA,已丢弃。'); clearSessionDraft(dkey); setSessionDraft(null); return }
    const st = useProjectStore.getState()
    const isOpen = d.savedId !== '' &&
      (st.identity.savedId === d.savedId || Object.values(st.parked).some((sl) => sl.identity.savedId === d.savedId))
    if (isOpen) {
      st.openProject(d.savedId, { etas: [], activeKey: '', checkedKeys: {}, identity: { savedId: d.savedId, projectUuid: '', displayName: '' } })  // 去重命中 → 仅聚焦
      const cur = useProjectStore.getState()
      cur.load(tabs, restoredActiveKey, proj.checkedKeys, proj.userFts ?? EMPTY_FTS)
      cur.setIdentityFor(cur.workspaceId, { displayName: d.name, lastVersionHash: d.lastVersionHash })
      applyProjectFmea(proj)
    } else {
      useProjectStore.getState().openProject(d.savedId || `draft-restore:${d.at}`, {
        etas: tabs, activeKey: restoredActiveKey, checkedKeys: proj.checkedKeys, userFts: proj.userFts ?? EMPTY_FTS,
        identity: { savedId: d.savedId, projectUuid: d.projectUuid, lastVersionHash: d.lastVersionHash, displayName: d.name },
        fmeaRows: proj.fmeaRows, fmeaMapping: proj.fmeaMapping,
      })
    }
    clearSessionDraft(dkey)
    setSessionDraft(listSessionDrafts()[0] ? { name: listSessionDrafts()[0].name, at: listSessionDrafts()[0].at, savedId: listSessionDrafts()[0].savedId } : null)
  }
  const discardSessionDraft = () => {
    const d = listSessionDrafts()[0]
    if (d) clearSessionDraft(sessionDraftKey(d))
    const next = listSessionDrafts()[0]
    setSessionDraft(next ? { name: next.name, at: next.at, savedId: next.savedId } : null)
  }

  // 读取项目存档(R2):已打开(活动/停放)→ 仅聚焦切换,绝不重载(保护未保存编辑);
  // 未打开 → fetch 后作为新槽打开(停放当前项目)。pendingId 保证受控下拉在 await 期间不回弹。
  const loadProject = async (id: string, opts?: { auto?: boolean }) => {
    try { localStorage.setItem(LAST_KEY, id) } catch { /* 隐私模式等:降级为不记忆 */ }
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
      // 自动恢复(非用户点击)撞上权威 404:上次打开的存档已被删除——自愈:清记忆键
      // 防每次启动复发,提示降为一次性说明;其余错误(含网络断)保留 LAST_KEY,
      // 后端恢复后下次启动仍能自动找回。
      if (opts?.auto && e instanceof SavedNotFoundError) {
        try { localStorage.removeItem(LAST_KEY) } catch { /* 隐私模式 */ }
        onError('上次打开的存档已在服务器上删除,已回到空白草稿(不影响其余存档)。')
      } else {
        onError(`读取存档失败:${String(e?.message ?? e)}`)
      }
    } finally { setLoading(false); setPendingId('') }
  }

  // 刷新找回(报障 2026-07-20):本应用无本地项目持久化,刷新后活动项目重置为空白草稿——
  // 用户以为"树全丢了"(其实档案完好,只是活动项目变了)。挂载后自动重开上次打开的存档;
  // 仅在"干净启动态"(无存档身份、无停放槽)时执行一次,绝不覆盖用户已在操作的内容。
  const autoReopened = useRef(false)
  useEffect(() => {
    if (autoReopened.current) return
    let last = ''
    try { last = localStorage.getItem(LAST_KEY) ?? '' } catch { /* 隐私模式:不记忆 */ }
    if (!last) { autoReopened.current = true; return }
    const st = useProjectStore.getState()
    if (st.identity.savedId !== '' || Object.keys(st.parked).length > 0) { autoReopened.current = true; return }
    listSaved().then((list) => {
      if (autoReopened.current) return
      autoReopened.current = true
      if (list.some((s2) => s2.id === last)) {
        void loadProject(last, { auto: true })
      } else if (!wasSavedOffline()) {
        // 服务器列表权威地不含该 id(离线回退列表不算数)⇒ 记忆键已失效,自愈防复发
        try { localStorage.removeItem(LAST_KEY) } catch { /* 隐私模式 */ }
      }
    }).catch(() => { autoReopened.current = true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
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
      if (!proj.tabs.length) { onError('导入文件不含任何 ETA(payload 为空或退化格式),未应用。'); return }
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
    if (!window.confirm(`删除项目存档「${name}」?存档删除不可撤销(版本库中的历史版本仍保留),其打开的工作区也将关闭。`)) return
    await deleteSaved(delId)
    setIdentityFor(wid, { savedId: '', projectUuid: '', lastVersionHash: undefined })
    // 幽灵槽修复(报障 2026-07-20):此前只清身份,已打开的工作区以「草稿」名残留在项目树,
    // 用户视为"删了还在"。删除 = 明确弃用,槽一并关闭。
    useProjectStore.getState().closeProject(wid)
    await refreshList()
  }

  return {
    saved, savedId: pendingId || savedId, archiveLocal, projectUuid, lastVersionHash, loading, conflict, sessionDraft,
    fmeaRows, fmeaMapping, persistFmeaRows, persistFmeaMapping,
    buildPayload, onSaveWorkspace, onSaveAs, loadProject, onExportFile, onImportFile, onDeleteSaved, syncBaselineAfterPin,
    resolveConflictOverwrite, resolveConflictSaveAsCopy, dismissConflict,
    restoreSessionDraft, discardSessionDraft,
  }
}

export type ProjectPersistence = ReturnType<typeof useProjectPersistence>
export type { ProjectEta }
