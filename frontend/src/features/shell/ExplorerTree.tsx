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

  // 打开区同样名称稳定序(报障 2026-07-21:openOrder 是使用序,开/关/切都会跳)。
  // openOrder 仅保留给切换语义,呈现按显示名排序;同名(如两份 IE_TR)加 #id 短码可辨。
  const openSorted = openProjects.slice().sort((x, y) =>
    (x.identity.displayName || '未命名项目').localeCompare(y.identity.displayName || '未命名项目', 'zh')
    || x.workspaceId.localeCompare(y.workspaceId))
  const openSavedIds = new Set(openProjects.map((o) => o.identity.savedId).filter(Boolean))
  // 稳定序(报障 2026-07-20):后端列表按"最近保存"排序,每次保存都重排 + 刷新后
  // 自动重开又置顶,树观感乱跳。改为名称字典序(中文拼音感知)+ id 决胜,永远可预测。
  const archived = persistence.saved.filter((s) => !openSavedIds.has(s.id))
    .slice().sort((x, y) => x.name.localeCompare(y.name, 'zh') || x.id.localeCompare(y.id))
  // 统一稳定序(报障 2026-07-25:点开存档会"随机换位")——此前打开项目置顶成组、
  // 存档排后,点开/关闭即跨组迁移,观感乱跳。改为单一列表按名排序,打开态原位标注
  // (▾/▸ + 存档徽章),条目位置不因打开/关闭而移动。同名去歧义跨两类统一判定。
  type Row =
    | { kind: 'open'; name: string; sortId: string; o: (typeof openSorted)[number] }
    | { kind: 'arch'; name: string; sortId: string; a: (typeof archived)[number] }
  const rows: Row[] = [
    ...openSorted.map((o) => ({ kind: 'open' as const, name: o.identity.displayName || '未命名项目', sortId: o.identity.savedId || o.workspaceId, o })),
    ...archived.map((a) => ({ kind: 'arch' as const, name: a.name, sortId: a.id, a })),
  ].sort((x, y) => x.name.localeCompare(y.name, 'zh') || x.sortId.localeCompare(y.sortId))
  const dupName = (name: string) => rows.filter((r) => r.name === name).length > 1
  const etaCount = etaTabs.length
  const ftCount = (userFtsModel?.fault_trees?.length ?? 0)

  const onPage = (t: MainTab) => setTab(t)
  const onEta = (key: string) => { P().setActive(key); setTab('bess') }

  return (
    <nav className="exp-tree" role="tree" aria-label="项目与页面导航">
      <div className="grp" role="presentation">项目({openProjects.length + archived.length})</div>

      {rows.map((row) => {
        if (row.kind === 'arch') {
          const a = row.a
          return (
            <TreeItem key={a.id} className="it prj" onActivate={() => persistence.loadProject(a.id)} title={`打开该存档项目(id ${a.id})`}
              style={{ opacity: persistence.loading ? 0.6 : 1 }}>
              ▸ {a.name}{dupName(a.name) && <span style={{ color: 'var(--psa-faint)', fontFamily: 'var(--psa-font-mono)', fontSize: 10 }}> #{a.id.slice(0, 4)}</span>}<span className="st arch">存档</span>
            </TreeItem>
          )
        }
        const o = row.o
        const active = o.workspaceId === activeWid
        const name = row.name
        const tag = dupName(name) ? <span style={{ color: 'var(--psa-faint)', fontFamily: 'var(--psa-font-mono)', fontSize: 10 }}> #{(o.identity.savedId || o.workspaceId).slice(0, 4)}</span> : null
        if (!active) {
          return (
            <TreeItem key={o.workspaceId} className="it prj" onActivate={() => switchProject(o.workspaceId)} title="切换到该项目">
              ▸ {name}{tag}{!o.identity.savedId && <span className="st dft">草稿</span>}
            </TreeItem>
          )
        }
        return (
          <div key={o.workspaceId} role="group" aria-label={name}>
            <TreeItem className="it prj on" selected onActivate={() => onPage('home')}>▾ {name}{tag}{!o.identity.savedId && <span className="st dft">草稿</span>}</TreeItem>
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

      <div className="grp" role="presentation">全局</div>
      <TreeItem className={'it' + (tab === 'portfolio' ? ' on' : '')} selected={tab === 'portfolio'} onActivate={() => onPage('portfolio')}>多项目组合总览</TreeItem>
      <TreeItem className={'it' + (tab === 'compare' ? ' on' : '')} selected={tab === 'compare'} onActivate={() => onPage('compare')}>系统对比</TreeItem>
      <TreeItem className={'it' + (tab === 'station' ? ' on' : '')} selected={tab === 'station'} onActivate={() => onPage('station')}>站级评估</TreeItem>
      <TreeItem className={'it' + (tab === 'library' ? ' on' : '')} selected={tab === 'library'} onActivate={() => onPage('library')}>参考库</TreeItem>

      {/* FE-09:示例参数库 / CCF —— 全局教学模型,独立于任何项目,改动不入项目版本/证据链。 */}
      <div className="grp" role="presentation">示例 / 教学(全局)</div>
      <TreeItem className={'it' + (tab === 'params' ? ' on' : '')} selected={tab === 'params'} onActivate={() => onPage('params')}
        title="示例参数库 / CCF —— 独立于项目,改动不进入当前项目与报告">参数库 / CCF</TreeItem>
    </nav>
  )
}
