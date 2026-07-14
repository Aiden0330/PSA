import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { MainTab } from '../../stores/viewStore'
import type { ProjectPersistence } from '../persistence/useProjectPersistence'
import { useAuthStore } from '../../stores/authStore'
import { useProjectStore } from '../../stores/projectStore'

const ROLE_LABEL: Record<string, string> = { admin: '管理员', analyst: '分析员', reviewer: '评审人' }

export interface MenuAction { label: string; run: () => void; disabled?: boolean; sep?: boolean }

/**
 * Explorer 壳(R3):菜单栏 = 既有命令的重新挂载(文件/编辑 = 真动作,其余 = 导航到控件所在页)。
 * 工作台自身的 ribbon(量化/AI/挂载 FTA 等)保持在各页内,菜单栏不重复承载 —— 每个控件仍有唯一的家。
 */
export function MenuBar({ persistence, setTab, onImportFile, onOpenAccounts }: {
  persistence: ProjectPersistence
  setTab: (t: MainTab) => void
  onImportFile: (f: File) => void
  onOpenAccounts: () => void
}) {
  const [open, setOpen] = useState<string | null>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const identity = useAuthStore((s) => s.identity)
  const doLogout = useAuthStore((s) => s.logout)
  const setPaletteOpen = (v: boolean) => import('../../stores/viewStore').then((m) => m.useViewStore.getState().setPaletteOpen(v))
  const undo = useProjectStore((s) => s.undo)
  const redo = useProjectStore((s) => s.redo)
  const canUndo = useProjectStore((s) => s.past.length > 0)
  const canRedo = useProjectStore((s) => s.future.length > 0)

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (barRef.current && !barRef.current.contains(e.target as Node)) setOpen(null) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const menus: { key: string; label: string; items: MenuAction[] }[] = [
    { key: 'file', label: '文件', items: [
      { label: '保存项目', run: persistence.onSaveWorkspace },
      { label: '另存为新项目…', run: persistence.onSaveAs },
      { label: '删除当前存档', run: persistence.onDeleteSaved, disabled: !persistence.savedId, sep: true },
      { label: '导入项目文件…', run: () => fileRef.current?.click() },
      { label: '导出项目文件', run: persistence.onExportFile },
    ] },
    { key: 'edit', label: '编辑', items: [
      { label: '撤销', run: undo, disabled: !canUndo },
      { label: '重做', run: redo, disabled: !canRedo },
    ] },
    { key: 'view', label: '视图', items: [
      { label: '项目总览', run: () => setTab('home') },
      { label: '事件树(ETA)', run: () => setTab('bess') },
      { label: '故障树(FTA)', run: () => setTab('ft') },
      { label: '多项目组合总览', run: () => setTab('portfolio'), sep: true },
    ] },
    { key: 'analysis', label: '分析', items: [
      { label: '事件树量化 / 不确定性 / 重要度…', run: () => setTab('bess') },
      { label: '故障树割集 / 频率初因…', run: () => setTab('ft') },
    ] },
    { key: 'data', label: '数据', items: [
      { label: '参数库 / CCF', run: () => setTab('params') },
      { label: '参考库(全局)', run: () => setTab('library') },
      { label: '后果定义 C1–C5', run: () => setTab('cons') },
      { label: 'FMEA / RPN', run: () => setTab('fmea') },
    ] },
    { key: 'review', label: '评审', items: [
      { label: '报告与证据链(送审/签发)', run: () => setTab('report') },
    ] },
    { key: 'help', label: '帮助', items: [
      { label: '命令板(⌘K / Ctrl+K)', run: () => setPaletteOpen(true) },
    ] },
  ]

  const pick = (a: MenuAction) => { if (!a.disabled) { setOpen(null); a.run() } }

  return (
    <div className="exp-menu" ref={barRef}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingRight: 6, marginRight: 2 }}>
        <div style={logo}><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 2c1 4-2 5-2 8a2 2 0 1 0 4 0c0-1 0-1.5.5-2 1 2 2.5 3 2.5 6a5 5 0 1 1-10 0c0-4 4-6 5-12z" fill="#fff" /></svg></div>
        <b style={{ fontSize: 12.5, color: 'var(--exp-ink)' }}>BESS&nbsp;PSA</b>
      </div>
      {menus.map((mn) => (
        <div key={mn.key} className={'m' + (open === mn.key ? ' open' : '')}
          onClick={() => setOpen(open === mn.key ? null : mn.key)}
          onMouseEnter={() => { if (open) setOpen(mn.key) }}>
          {mn.label}
          {open === mn.key && (
            <div className="drop" onClick={(e) => e.stopPropagation()}>
              {mn.items.map((a, i) => (
                <Frag key={i}>
                  {a.sep && <div className="sep" />}
                  <button disabled={a.disabled} onClick={() => pick(a)}>{a.label}</button>
                </Frag>
              ))}
            </div>
          )}
        </div>
      ))}

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
        {identity?.mode === 'local' && identity.role === 'admin' && (
          <span className="m" onClick={(e) => { e.stopPropagation(); setOpen(null); onOpenAccounts() }}>账户</span>
        )}
        <div title={identity ? `${identity.display_name ?? identity.username} · ${ROLE_LABEL[identity.role] ?? identity.role}${identity.mode === 'local' ? '' : '(单用户模式)'}` : ''}
          style={avatar}>{(identity?.display_name ?? identity?.username ?? '?').slice(0, 2).toUpperCase()}</div>
        {identity?.mode === 'local' && (
          <span className="m" onClick={(e) => { e.stopPropagation(); setOpen(null); void doLogout() }}>登出</span>
        )}
      </div>
      <input ref={fileRef} type="file" accept=".json,.psaproj.json" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onImportFile(f); e.currentTarget.value = '' }} />
    </div>
  )
}

function Frag({ children }: { children: ReactNode }) { return <>{children}</> }

const logo: CSSProperties = { width: 22, height: 22, borderRadius: 6, background: 'var(--psa-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }
const avatar: CSSProperties = { width: 24, height: 24, borderRadius: '50%', background: 'var(--exp-acc)', color: '#fff', fontSize: 10.5, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }
