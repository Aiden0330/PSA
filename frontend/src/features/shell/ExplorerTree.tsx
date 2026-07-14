import { useMemo } from 'react'
import type { MainTab } from '../../stores/viewStore'
import type { ProjectPersistence } from '../persistence/useProjectPersistence'
import { useProjectStore } from '../../stores/projectStore'
import type { ProjectIdentity } from '../../stores/projectStore'
import { useActiveEta, etaDisplayName } from '../../stores/useActiveEta'

/**
 * Explorer 壳(R3):常驻工程树 = 主导航(替代顶部页签 + 抽屉)。
 * 顶层 = 项目库(打开的项目在 R2 槽注册表里,含活动标记;未打开的取存档列表)。
 * 活动项目展开页节点;点页节点 = setTab;点其他打开项目 = switchProject;点存档 = loadProject(open/switch)。
 */
const PAGE_NODES: { tab: MainTab; label: string }[] = [
  { tab: 'home', label: '项目总览' },
  { tab: 'bess', label: '事件树' },
  { tab: 'ft', label: '故障树' },
  { tab: 'params', label: '参数库 / CCF' },
  { tab: 'cons', label: '后果定义' },
  { tab: 'fmea', label: 'FMEA' },
  { tab: 'report', label: '报告与证据链' },
]

export function ExplorerTree({ persistence, tab, setTab }: {
  persistence: ProjectPersistence
  tab: MainTab
  setTab: (t: MainTab) => void
}) {
  // 订阅稳定切片 + useMemo 派生打开集:selectOpenProjects 每次返回新数组,
  // 直接喂 useProjectStore 会违反 useSyncExternalStore 的稳定快照契约 → 无限渲染。
  const openOrder = useProjectStore((s) => s.openOrder)
  const activeWid = useProjectStore((s) => s.workspaceId)
  const activeIdentity = useProjectStore((s) => s.identity)
  const parked = useProjectStore((s) => s.parked)
  const switchProject = useProjectStore((s) => s.switchProject)
  const openProjects = useMemo(
    () => openOrder
      .map((w): { workspaceId: string; identity: ProjectIdentity; isActive: boolean } | null =>
        w === activeWid ? { workspaceId: w, identity: activeIdentity, isActive: true }
          : parked[w] ? { workspaceId: w, identity: parked[w].identity, isActive: false } : null)
      .filter((x): x is { workspaceId: string; identity: ProjectIdentity; isActive: boolean } => x !== null),
    [openOrder, activeWid, activeIdentity, parked],
  )
  const { etaTabs, activeKey, etModel, userFtsModel, P } = useActiveEta()

  const openSavedIds = new Set(openProjects.map((o) => o.identity.savedId).filter(Boolean))
  const archived = persistence.saved.filter((s) => !openSavedIds.has(s.id))
  const etaCount = etaTabs.length
  const ftCount = (userFtsModel?.fault_trees?.length ?? 0)

  const onPage = (t: MainTab) => setTab(t)
  const onEta = (key: string) => { P().setActive(key); setTab('bess') }

  return (
    <nav className="exp-tree">
      <div className="grp">项目({openProjects.length + archived.length})</div>

      {openProjects.map((o) => {
        const active = o.workspaceId === activeWid
        const name = o.identity.displayName || '未命名项目'
        if (!active) {
          return (
            <div key={o.workspaceId} className="it prj" onClick={() => switchProject(o.workspaceId)} title="切换到该项目">
              ▸ {name}{!o.identity.savedId && <span className="st dft">草稿</span>}
            </div>
          )
        }
        return (
          <div key={o.workspaceId}>
            <div className="it prj on" onClick={() => onPage('home')}>▾ {name}{!o.identity.savedId && <span className="st dft">草稿</span>}</div>
            {PAGE_NODES.map((p) => {
              if (p.tab === 'bess') {
                return (
                  <div key={p.tab}>
                    <div className={'it sub' + (tab === 'bess' ? ' on' : '')} onClick={() => onPage('bess')}>
                      {p.label}<span className="n">{etaCount}</span>
                    </div>
                    {etaTabs.map((t) => {
                      const ie = t.model?.initFreqSource === 'ft'
                      return (
                        <div key={t.key} className={'it sub2' + (tab === 'bess' && t.key === activeKey ? ' on' : '')}
                          onClick={() => onEta(t.key)} title={etaDisplayName(t, t.key === activeKey ? etModel : t.model)}>
                          · {etaDisplayName(t, t.key === activeKey ? etModel : t.model)}{ie && <span className="n">⚡FT</span>}
                        </div>
                      )
                    })}
                  </div>
                )
              }
              if (p.tab === 'ft') {
                return <div key={p.tab} className={'it sub' + (tab === 'ft' ? ' on' : '')} onClick={() => onPage('ft')}>{p.label}<span className="n">{ftCount || ''}</span></div>
              }
              return <div key={p.tab} className={'it sub' + (tab === p.tab ? ' on' : '')} onClick={() => onPage(p.tab)}>{p.label}</div>
            })}
          </div>
        )
      })}

      {archived.map((a) => (
        <div key={a.id} className="it prj" onClick={() => persistence.loadProject(a.id)} title="打开该存档项目"
          style={{ opacity: persistence.loading ? 0.6 : 1 }}>
          ▸ {a.name}<span className="st arch">存档</span>
        </div>
      ))}

      <div className="grp">全局</div>
      <div className={'it' + (tab === 'portfolio' ? ' on' : '')} onClick={() => onPage('portfolio')}>多项目组合总览</div>
      <div className={'it' + (tab === 'library' ? ' on' : '')} onClick={() => onPage('library')}>参考库</div>
    </nav>
  )
}
