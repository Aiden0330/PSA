import { useProjectStore } from './projectStore'
import { EMPTY_FTS } from './projectStore'
import { composeModel, stripDerived } from './derived'
import type { EventTreeModel } from '../eventtree'
import type { ModelJson } from '../model'
import type { ProjectEta } from '../project'

/**
 * 项目文档订阅 + 活动 ETA 合成视图(内容 × 派生)+ 剥离式回写。
 * App 壳、ETA/FTA 工作台、后果页共用,保证「合成读 / 剥离写」口径一致。
 */
export function useActiveEta() {
  const etaTabs = useProjectStore((s) => s.present.etas)
  const userFtsModel = useProjectStore((s) => s.present.userFts)
  const activeKey = useProjectStore((s) => s.activeKey)
  const checkedKeys = useProjectStore((s) => s.checkedKeys)
  const pfdsMap = useProjectStore((s) => s.pfds)
  const docUndo = useProjectStore((s) => s.undo)
  const docRedo = useProjectStore((s) => s.redo)
  const docCanUndo = useProjectStore((s) => s.past.length > 0)
  const docCanRedo = useProjectStore((s) => s.future.length > 0)
  const P = useProjectStore.getState

  const etaPfds = (t: ProjectEta) => pfdsMap[t.key] ?? t.pfds ?? {}
  const activeEta = etaTabs.find((t) => t.key === activeKey) ?? null
  const pfds = activeEta ? etaPfds(activeEta) : {}
  const etModel = activeEta ? composeModel(activeEta.model, pfds) : null
  const etFtsModel: ModelJson = activeEta?.fts ?? EMPTY_FTS

  // 收值或更新函数:值式覆写来自渲染期旧快照,同拍两次编辑后写冲前写(丢改动
  // 报障 2026-07-17,与 FT 编辑同病)。函数式按**调用时**store 状态应用,同步序贯自然复合。
  const writeEtModel = (next: EventTreeModel | ((prev: EventTreeModel) => EventTreeModel)) => {
    const prev = P().present.etas.find((e) => e.key === P().activeKey)?.model
    if (!prev) return
    const nextVal = typeof next === 'function' ? next(prev) : next
    const stripped = stripDerived(nextVal, prev)
    if (JSON.stringify(stripped) === JSON.stringify(prev)) return   // 纯派生差异 → 不产生历史条目
    P().setEtaModel(P().activeKey, stripped)
  }

  return { etaTabs, userFtsModel, activeKey, checkedKeys, etaPfds, activeEta, pfds, etModel, etFtsModel, writeEtModel, docUndo, docRedo, docCanUndo, docCanRedo, P }
}

/** 页签显示名:未手动改名则跟随初始事件名, 否则用手动名。 */
export function etaDisplayName(t: ProjectEta, m: EventTreeModel | null): string {
  return t.renamed ? t.name : (m?.initEvent?.trim() || t.name)
}
