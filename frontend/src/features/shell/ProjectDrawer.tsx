import type { CSSProperties } from 'react'
import { useViewStore } from '../../stores/viewStore'
import { useActiveEta, etaDisplayName } from '../../stores/useActiveEta'
import type { ProjectPersistence } from '../persistence/useProjectPersistence'

const mono = 'var(--psa-font-mono)'

/**
 * 项目树左抽屉(外壳决策记录 A):ETA / 挂载 FTA / 自建 FTA / 报告与案例 / 存档
 * 的统一导航形 —— 即 ADR-2 数据模型在壳层的投影。可折叠,状态持久化。
 */
export function ProjectDrawer({ persistence }: { persistence: ProjectPersistence }) {
  const open = useViewStore((s) => s.drawerOpen)
  const setTab = useViewStore((s) => s.setTab)
  const setFtEditTarget = useViewStore((s) => s.setFtEditTarget)
  const { etaTabs, userFtsModel, activeKey, P } = useActiveEta()
  if (!open) return null

  const projName = persistence.saved.find((s) => s.id === persistence.savedId)?.name ?? '未存档项目'
  const gotoEta = (key: string) => { P().setActive(key); setTab('bess') }
  const gotoFt = (etaKey: string, name: string) => { P().setActive(etaKey); setFtEditTarget({ src: 'eta', etaKey, name }); setTab('ft') }
  const gotoUserFt = (name: string) => { setFtEditTarget({ src: 'standalone', name }); setTab('ft') }

  return (
    <div style={drawer}>
      <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--psa-line)' }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--psa-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{projName}</div>
        {persistence.projectUuid && <div style={{ fontFamily: mono, fontSize: 10, color: 'var(--psa-faint)' }}>{persistence.projectUuid.slice(0, 8)}</div>}
      </div>

      <div style={group}>事件树(ETA)</div>
      {etaTabs.map((t) => (
        <div key={t.key} style={row(t.key === activeKey)} onClick={() => gotoEta(t.key)} title={etaDisplayName(t, t.model)}>
          <span style={ellipsis}>{etaDisplayName(t, t.model)}</span>
        </div>
      ))}

      <div style={group}>挂载故障树</div>
      {etaTabs.flatMap((t) =>
        t.model.functionalEvents.filter((fe) => fe.linkFt).map((fe) => (
          <div key={t.key + ':' + fe.id} style={row(false)} onClick={() => gotoFt(t.key, fe.id)} title={`${etaDisplayName(t, t.model)} / ${fe.label || fe.id}`}>
            <span style={ellipsis}>{fe.label || fe.id}</span>
            <span style={dim}>{fe.id}</span>
          </div>
        )))}

      <div style={group}>自建故障树</div>
      {userFtsModel.fault_trees.length === 0
        ? <div style={empty}>(无)</div>
        : userFtsModel.fault_trees.map((ft) => (
          <div key={ft.name} style={row(false)} onClick={() => gotoUserFt(ft.name)} title={ft.name}>
            <span style={ellipsis}>{ft.name}</span>
          </div>
        ))}

      <div style={group}>报告与证据</div>
      <div style={row(false)} onClick={() => setTab('report')}><span style={ellipsis}>分析案例 / 版本台账</span></div>
      <div style={row(false)} onClick={() => setTab('home')}><span style={ellipsis}>项目总览(驾驶舱)</span></div>

      <div style={group}>存档</div>
      {persistence.saved.length === 0
        ? <div style={empty}>(无存档)</div>
        : persistence.saved.map((s) => (
          <div key={s.id} style={row(s.id === persistence.savedId)} onClick={() => persistence.loadProject(s.id)} title={s.name}>
            <span style={ellipsis}>{s.name}</span>
          </div>
        ))}
    </div>
  )
}

const drawer: CSSProperties = { width: 200, flexShrink: 0, borderRight: '1px solid var(--psa-line)', background: 'var(--psa-soft)', overflowY: 'auto', display: 'flex', flexDirection: 'column', paddingBottom: 12 }
const group: CSSProperties = { padding: '10px 12px 4px', fontSize: 10.5, fontWeight: 700, color: 'var(--psa-muted)', textTransform: 'uppercase', letterSpacing: '.5px' }
const row = (active: boolean): CSSProperties => ({ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', cursor: 'pointer', fontSize: 12, background: active ? 'var(--psa-primary-soft)' : 'transparent', borderLeft: active ? '3px solid var(--psa-primary)' : '3px solid transparent', color: active ? 'var(--psa-primary-strong)' : 'var(--psa-ink-2)' })
const ellipsis: CSSProperties = { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
const dim: CSSProperties = { marginLeft: 'auto', fontFamily: mono, fontSize: 10, color: 'var(--psa-faint)', flexShrink: 0 }
const empty: CSSProperties = { padding: '4px 12px', fontSize: 11.5, color: 'var(--psa-faint)', fontStyle: 'italic' }
