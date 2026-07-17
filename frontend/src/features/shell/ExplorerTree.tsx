import { useMemo } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { MainTab } from '../../stores/viewStore'
import type { ProjectPersistence } from '../persistence/useProjectPersistence'
import { useProjectStore } from '../../stores/projectStore'
import type { ProjectIdentity } from '../../stores/projectStore'
import { useActiveEta, etaDisplayName } from '../../stores/useActiveEta'
import { activateOnKey } from './a11y'

/**
 * Explorer 壳(R3):常驻工程树 = 主导航(替代顶部页签 + 抽屉)。
 * 顶层 = 项目库(打开的项目在 R2 槽注册表里,含活动标记;未打开的取存档列表)。
 * 活动项目展开页节点;点页节点 = setTab;点其他打开项目 = switchProject;点存档 = loadProject(open/switch)。
 *
 * FE-09:「参数库 / CCF」编辑的是全局示例模型(非项目文档),不进项目版本/证据链——
 * 因此移出「当前项目」子树,单列到「示例 / 教学(全局)」区,避免误以为在改项目参数。
 * FE-13:主导航从 div onClick 升级为 role=tree/treeitem + tabIndex + Enter/Space 键盘激活。
 */
const PAGE_NODES: { tab: MainTab; label: string }[] = [
  { tab: 'home', label: '项目总览' },
  { tab: 'bess', label: '事件树' },
  { tab: 'ft', label: '故障树' },
  { tab: 'cons', label: '后果定义' },
  { tab: 'fmea', label: 'FMEA' },
  { tab: 'report', label: '报告与证据链' },
]

/** 键盘可达的树项:div → role=treeitem + tabIndex + Enter/Space 激活(与点击等效)。 */
function TreeItem({ className, selected, onActivate, title, style, children }: {
  className: string
  selected?: boolean
  onActivate: () => void
  title?: string
  style?: CSSProperties
  children: ReactNode
}) {
  return (
    <div className={className} role="treeitem" tabIndex={0} aria-selected={selected}
      title={title} style={style} onClick={onActivate} onKeyDown={activateOnKey(onActivate)}>
      {children}
    </div>
  )
}

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
    <nav className="exp-tree" role="tree" aria-label="项目与页面导航">
      <div className="grp" role="presentation">项目({openProjects.length + archived.length})</div>

      {openProjects.map((o) => {
        const active = o.workspaceId === activeWid
        const name = o.identity.displayName || '未命名项目'
        if (!active) {
          return (
            <TreeItem key={o.workspaceId} className="it prj" onActivate={() => switchProject(o.workspaceId)} title="切换到该项目">
              ▸ {name}{!o.identity.savedId && <span className="st dft">草稿</span>}
            </TreeItem>
          )
        }
        return (
          <div key={o.workspaceId} role="group" aria-label={name}>
            <TreeItem className="it prj on" selected onActivate={() => onPage('home')}>▾ {name}{!o.identity.savedId && <span className="st dft">草稿</span>}</TreeItem>
            {PAGE_NODES.map((p) => {
              if (p.tab === 'bess') {
                return (
                  <div key={p.tab} role="group" aria-label={p.label}>
                    <TreeItem className={'it sub' + (tab === 'bess' ? ' on' : '')} selected={tab === 'bess'} onActivate={() => onPage('bess')}>
                      {p.label}<span className="n">{etaCount}</span>
                    </TreeItem>
                    {etaTabs.map((t) => {
                      const ie = t.model?.initFreqSource === 'ft'
                      const label = etaDisplayName(t, t.key === activeKey ? etModel : t.model)
                      return (
                        <TreeItem key={t.key} className={'it sub2' + (tab === 'bess' && t.key === activeKey ? ' on' : '')}
                          selected={tab === 'bess' && t.key === activeKey} onActivate={() => onEta(t.key)} title={label}>
                          · {label}{ie && <span className="n">⚡FT</span>}
                        </TreeItem>
                      )
                    })}
                  </div>
                )
              }
              if (p.tab === 'ft') {
                return <TreeItem key={p.tab} className={'it sub' + (tab === 'ft' ? ' on' : '')} selected={tab === 'ft'} onActivate={() => onPage('ft')}>{p.label}<span className="n">{ftCount || ''}</span></TreeItem>
              }
              return <TreeItem key={p.tab} className={'it sub' + (tab === p.tab ? ' on' : '')} selected={tab === p.tab} onActivate={() => onPage(p.tab)}>{p.label}</TreeItem>
            })}
          </div>
        )
      })}

      {archived.map((a) => (
        <TreeItem key={a.id} className="it prj" onActivate={() => persistence.loadProject(a.id)} title="打开该存档项目"
          style={{ opacity: persistence.loading ? 0.6 : 1 }}>
          ▸ {a.name}<span className="st arch">存档</span>
        </TreeItem>
      ))}

      <div className="grp" role="presentation">全局</div>
      <TreeItem className={'it' + (tab === 'portfolio' ? ' on' : '')} selected={tab === 'portfolio'} onActivate={() => onPage('portfolio')}>多项目组合总览</TreeItem>
      <TreeItem className={'it' + (tab === 'library' ? ' on' : '')} selected={tab === 'library'} onActivate={() => onPage('library')}>参考库</TreeItem>

      {/* FE-09:示例参数库 / CCF —— 全局教学模型,独立于任何项目,改动不入项目版本/证据链。 */}
      <div className="grp" role="presentation">示例 / 教学(全局)</div>
      <TreeItem className={'it' + (tab === 'params' ? ' on' : '')} selected={tab === 'params'} onActivate={() => onPage('params')}
        title="示例参数库 / CCF —— 独立于项目,改动不进入当前项目与报告">参数库 / CCF</TreeItem>
    </nav>
  )
}
