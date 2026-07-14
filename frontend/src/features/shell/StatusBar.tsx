import type { MainTab } from '../../stores/viewStore'
import type { ProjectPersistence } from '../persistence/useProjectPersistence'
import { useProjectStore } from '../../stores/projectStore'

const TAB_NAME: Record<MainTab, string> = {
  home: '项目总览', bess: '事件树（ETA）', ft: '故障树（FTA）', params: '参数库 / CCF',
  library: '参考库', cons: '后果', fmea: 'FMEA', report: '报告与证据链', portfolio: '多项目组合总览',
}

/** Explorer 壳(R3)状态栏:真实信息(活动项目名/项目数/版本哈希/离线)——不放假指标。 */
export function StatusBar({ tab, persistence }: { tab: MainTab; persistence: ProjectPersistence }) {
  const displayName = useProjectStore((s) => s.identity.displayName)
  const openCount = useProjectStore((s) => s.openOrder.length)
  const hash = persistence.lastVersionHash

  return (
    <footer className="exp-status">
      <span>{TAB_NAME[tab]}</span>
      <span>活动项目 <span className="num">{displayName || '未命名'}</span></span>
      <span>打开 <span className="num">{openCount}</span></span>
      {persistence.projectUuid && <span>项目 <span className="num">{persistence.projectUuid.slice(0, 8)}</span></span>}
      {hash && <span>版本 <span className="num">{hash.slice(0, 8)}</span></span>}
      {persistence.archiveLocal && <span style={{ color: 'var(--exp-acc)' }}>离线存档</span>}
      <span style={{ marginLeft: 'auto' }} className="num">v2.0</span>
    </footer>
  )
}
