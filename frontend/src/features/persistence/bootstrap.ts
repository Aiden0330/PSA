import { newBlankEta } from '../../eventtree'
import type { ProjectEta } from '../../project'
import { EMPTY_FTS, useProjectStore } from '../../stores/projectStore'
import { buildScenarioTab } from './scenarioLoader'

/**
 * 首次进入引导:载入默认级联作为第一个页签。
 *
 * 竞态守护(修复 2026-07-09 用户报障):
 * - 守卫必须在 await **之后**再查一次 —— StrictMode 双跑、慢后端下用户已读档/新建时,
 *   迟到的默认场景绝不能覆盖用户内容(旧实现只在 await 前查,存档"载入后被顶掉")。
 * - 请求失败不再静默:给一个空白 ETA 兜底(工作台永不空转),并把原因交给 onError 亮出。
 */
export async function ensureDefaultProject(onError?: (msg: string) => void): Promise<void> {
  const S = useProjectStore.getState
  if (S().present.etas.length) return
  let tab: ProjectEta
  try {
    tab = await buildScenarioTab('', '默认热失控级联')
  } catch (e) {
    const key = 'blank0'
    const name = '未命名 ETA'
    tab = { key, name, renamed: true, model: newBlankEta(name), fts: EMPTY_FTS, pfds: {} }
    onError?.(`默认场景载入失败(后端未就绪?):${String((e as Error)?.message ?? e)};已创建空白 ETA,可直接编辑或稍后「打开场景」。`)
  }
  if (S().present.etas.length) return          // 等待期间已有内容(读档/新建/双跑)→ 不覆盖
  S().load([tab], tab.key, { [tab.key]: true })
}
