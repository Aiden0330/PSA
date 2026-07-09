import { loadSaved } from '../../api'
import { normalizeEta } from '../../eventtree'
import type { EventTreeModel } from '../../eventtree'
import type { ModelJson } from '../../model'
import { deserializeProject } from '../../project'
import type { ProjectEta, ProjectPayload } from '../../project'
import { parseProjectFile } from '../../projectFile'
import type { FmeaRow, MappingConfig } from '../../fmea'

export const EMPTY_FTS: ModelJson = { model_data: { parameters: [] }, fault_trees: [] }

/** 读档/导入后交给工作台的完整项目状态(App 只负责把它写进 store)。 */
export interface LoadedProject {
  tabs: ProjectEta[]
  activeKey: string
  checkedKeys: Record<string, boolean>
  userFts?: ModelJson
  fmeaRows?: FmeaRow[]
  fmeaMapping?: MappingConfig
}

/** 归一化存档里的 ETA 列表(normalizeEta + fts/pfds 防御性回落)。 */
export function projectToTabs(proj: ProjectPayload): ProjectEta[] {
  return proj.etas.map((e) => ({
    key: e.key,
    name: e.name,
    renamed: e.renamed,
    model: normalizeEta(e.model as EventTreeModel),
    fts: (e.fts as ModelJson) ?? EMPTY_FTS,
    pfds: e.pfds ?? {},
  }))
}

function toLoaded(proj: ProjectPayload): LoadedProject {
  const tabs = projectToTabs(proj)
  return {
    tabs,
    activeKey: tabs.some((t) => t.key === proj.activeKey) ? proj.activeKey : (tabs[0]?.key ?? ''),
    checkedKeys: proj.checkedKeys,
    userFts: proj.userFts,
    fmeaRows: proj.fmeaRows,
    fmeaMapping: proj.fmeaMapping,
  }
}

/** 读取后端/离线存档并还原为项目状态(兼容旧版单 ETA 存档);后端在线时附带稳定项目 UUID。 */
export async function loadProjectArchive(id: string): Promise<LoadedProject & { name: string; projectUuid?: string }> {
  const rec = await loadSaved(id)
  const projectUuid = (rec as { project_uuid?: string }).project_uuid
  return { name: rec.name, projectUuid, ...toLoaded(deserializeProject(rec.payload, rec.name)) }
}

/** 解析 .psaproj.json 文件文本并还原为项目状态;携带参考库覆盖层时一并返回。 */
export function importProjectText(text: string, fallbackName: string): LoadedProject & { libraryOverlay?: unknown } {
  const { payload, libraryOverlay } = parseProjectFile(text)
  return { ...toLoaded(deserializeProject(payload, fallbackName)), libraryOverlay }
}
