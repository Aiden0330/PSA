import { useEffect, useState } from 'react'
import { deleteSaved, listSaved, saveWorkspace, wasSavedOffline } from '../../api'
import type { SavedItem } from '../../api'
import { serializeProject } from '../../project'
import type { ProjectEta, ProjectPayload } from '../../project'
import { buildProjectFile, downloadProjectFile } from '../../projectFile'
import { getOverlay, mergeOverlay } from '../../libraryStore'
import { loadProjectArchive, importProjectText, EMPTY_FTS } from './projectIo'
import { composeEta } from '../../stores/derived'
import { etaDisplayName, useActiveEta } from '../../stores/useActiveEta'
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
  const [savedId, setSavedId] = useState('')
  const [archiveLocal, setArchiveLocal] = useState(false)
  const [projectUuid, setProjectUuid] = useState('')
  const [loading, setLoading] = useState(false)      // 读档进行中(下拉禁用,防止值回弹误导)
  const [fmeaRows, setFmeaRows] = useState<FmeaRow[]>(() => loadRows())
  const [fmeaMapping, setFmeaMapping] = useState<MappingConfig>(() => loadMapping())

  useEffect(() => { listSaved().then((s) => { setSaved(s); setArchiveLocal(wasSavedOffline()) }).catch(() => {}) }, [])

  const persistFmeaRows = (next: FmeaRow[]) => {
    setFmeaRows(next)
    try { saveRows(next) } catch (e: any) { onError(String(e?.message ?? e)) }
  }
  const persistFmeaMapping = (next: MappingConfig) => {
    setFmeaMapping(next)
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
    const pu = (rec as { version?: { project_uuid?: string } })?.version?.project_uuid
    if (pu) setProjectUuid(pu)
  }

  // 保存项目:已载入存档(savedId 命中)→ 原地更新(沿用原名, 不再追问);否则新建并记住其 id
  const onSaveWorkspace = async () => {
    if (!etModel) return
    const payload = buildPayload()
    const existing = saved.find((s) => s.id === savedId)
    if (savedId && existing) {
      captureUuid(await saveWorkspace(existing.name, payload, savedId))
    } else {
      const at = etaTabs.find((t) => t.key === activeKey)
      const dflt = (at ? etaDisplayName(at, etModel) : '') || etModel.initEvent || 'ETA 项目'
      const name = window.prompt('项目存档名称', dflt)
      if (!name) return
      const rec = await saveWorkspace(name, payload)
      setSavedId(rec.id)
      captureUuid(rec)
    }
    await refreshList()
  }
  // 另存为新项目:总是新建一份副本, 并把当前项目切换为该副本
  const onSaveAs = async () => {
    if (!etModel) return
    const at = etaTabs.find((t) => t.key === activeKey)
    const base = saved.find((s) => s.id === savedId)?.name || (at ? etaDisplayName(at, etModel) : '') || 'ETA 项目'
    const name = window.prompt('另存为新项目名称', base + ' 副本')
    if (!name) return
    const rec = await saveWorkspace(name, buildPayload())
    setSavedId(rec.id)
    captureUuid(rec)
    await refreshList()
  }
  // 读取项目存档:完整还原全部 ETA(替换当前所有页签)。兼容旧版单 ETA 存档。
  // savedId 乐观置位:受控下拉在 await 期间不回弹到「—」;失败则回退并亮错。
  const loadProject = async (id: string) => {
    const prevId = savedId
    setSavedId(id)
    setLoading(true)
    try {
      const proj = await loadProjectArchive(id); setArchiveLocal(wasSavedOffline())
      if (!proj.tabs.length) {
        setSavedId(prevId)
        onError('该存档不含任何 ETA,未载入。')
        return
      }
      setProjectUuid(proj.projectUuid ?? '')
      P().load(proj.tabs, proj.activeKey, proj.checkedKeys, proj.userFts ?? EMPTY_FTS)
      applyProjectFmea(proj)
    } catch (e: any) {
      setSavedId(prevId)
      onError(`读取存档失败:${String(e?.message ?? e)}`)
    } finally { setLoading(false) }
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
      setSavedId(''); setProjectUuid('')
      P().load(proj.tabs, proj.activeKey, proj.checkedKeys, proj.userFts ?? EMPTY_FTS)
      applyProjectFmea(proj)
    } catch (e: any) { onError(String(e?.message ?? e)) }
  }
  const onDeleteSaved = async () => {
    if (!savedId) return
    const name = saved.find((s) => s.id === savedId)?.name ?? savedId
    if (!window.confirm(`删除项目存档「${name}」?存档删除不可撤销(版本库中的历史版本仍保留)。`)) return
    await deleteSaved(savedId); setSavedId(''); setProjectUuid(''); await refreshList()
  }

  return {
    saved, savedId, archiveLocal, projectUuid, loading,
    fmeaRows, fmeaMapping, persistFmeaRows, persistFmeaMapping,
    buildPayload, onSaveWorkspace, onSaveAs, loadProject, onExportFile, onImportFile, onDeleteSaved,
  }
}

export type ProjectPersistence = ReturnType<typeof useProjectPersistence>
export type { ProjectEta }
