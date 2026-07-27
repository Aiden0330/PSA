import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { ScenarioItem } from '../../api'
import type { EtaSummary } from '../../components/EventTreeEditor'
import { useViewStore } from '../../stores/viewStore'
import type { MainTab } from '../../stores/viewStore'
import { useActiveEta } from '../../stores/useActiveEta'
import type { ProjectPersistence } from '../persistence/useProjectPersistence'
import { useDialogA11y } from './a11y'

export interface PaletteCommand { id: string; group: string; label: string; hint?: string; run: () => void }

const TABS: [MainTab, string][] = [
  ['home', '项目总览(驾驶舱)'], ['bess', '事件树(ETA)'], ['ft', '故障树(FTA)'],
  ['params', '参数库 / CCF'], ['library', '参考库'], ['cons', '后果'], ['fmea', 'FMEA'], ['report', '报告与证据'],
  ['compare', '系统对比(跨项目)'], ['station', '站级评估(跨项目)'],
]

/**
 * ⌘K 命令板(外壳决策记录 C 的核心交互):导航 / ETA 切换 / 场景与存档打开 / 项目动作。
 * App 壳注册全局快捷键;本组件只负责渲染与执行。
 */
export function CommandPalette(
  { scenarios, summaries, persistence, onOpenScenario }: {
    scenarios: ScenarioItem[]
    summaries: EtaSummary[]
    persistence: ProjectPersistence
    onOpenScenario: (val: string) => void
  },
) {
  const open = useViewStore((s) => s.paletteOpen)
  const setOpen = useViewStore((s) => s.setPaletteOpen)
  const setTab = useViewStore((s) => s.setTab)
  const { P, docUndo, docRedo } = useActiveEta()
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  // FE-13:role=dialog + aria-modal + Esc 关闭 + Tab 焦点回环 + 关闭后焦点恢复
  const dialogRef = useDialogA11y(() => setOpen(false), open)

  useEffect(() => { if (open) { setQ(''); setIdx(0); setTimeout(() => inputRef.current?.focus(), 0) } }, [open])

  const commands: PaletteCommand[] = useMemo(() => [
    ...TABS.map(([t, label]): PaletteCommand => ({ id: 'tab:' + t, group: '导航', label, run: () => setTab(t) })),
    ...summaries.map((s): PaletteCommand => ({ id: 'eta:' + s.key, group: '切换 ETA', label: s.name, hint: `${s.leafCount} 序列`, run: () => { P().setActive(s.key); setTab('bess') } })),
    ...scenarios.map((s): PaletteCommand => ({ id: 'sc:' + s.id, group: '打开场景', label: s.name, run: () => onOpenScenario('sc:' + s.id) })),
    ...persistence.saved.map((s): PaletteCommand => ({ id: 'saved:' + s.id, group: '打开存档', label: s.name, run: () => persistence.loadProject(s.id) })),
    { id: 'act:save', group: '项目', label: '保存项目', run: () => persistence.onSaveWorkspace() },
    { id: 'act:saveas', group: '项目', label: '另存为新项目', run: () => persistence.onSaveAs() },
    { id: 'act:export', group: '项目', label: '导出项目文件(.psaproj.json)', run: () => persistence.onExportFile() },
    { id: 'act:undo', group: '编辑', label: '撤销', run: () => docUndo() },
    { id: 'act:redo', group: '编辑', label: '重做', run: () => docRedo() },
  ], [summaries, scenarios, persistence, setTab, P, docUndo, docRedo, onOpenScenario])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return commands
    return commands.filter((c) => (c.group + ' ' + c.label).toLowerCase().includes(needle))
  }, [commands, q])

  if (!open) return null
  const run = (c: PaletteCommand) => { setOpen(false); c.run() }

  return (
    <div style={backdrop} onClick={() => setOpen(false)}>
      <div ref={dialogRef} style={panel} role="dialog" aria-modal="true" aria-label="命令板" tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef} data-autofocus value={q} placeholder="输入命令、ETA、场景或存档名…  (Esc 关闭)"
          aria-label="命令、ETA、场景或存档搜索"
          onChange={(e) => { setQ(e.target.value); setIdx(0) }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, filtered.length - 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)) }
            else if (e.key === 'Enter' && filtered[idx]) run(filtered[idx])
          }}
          style={input}
        />
        <div style={{ maxHeight: 360, overflowY: 'auto' }}>
          {filtered.length === 0 && <div style={{ padding: 14, fontSize: 12.5, color: 'var(--psa-faint)' }}>无匹配命令</div>}
          {filtered.map((c, i) => (
            <div key={c.id} onClick={() => run(c)} onMouseEnter={() => setIdx(i)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', cursor: 'pointer', background: i === idx ? 'var(--psa-primary-soft)' : 'transparent' }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--psa-muted)', width: 64, flexShrink: 0, textTransform: 'uppercase', letterSpacing: '.4px' }}>{c.group}</span>
              <span style={{ fontSize: 13, color: 'var(--psa-ink)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.label}</span>
              {c.hint && <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--psa-faint)', flexShrink: 0 }}>{c.hint}</span>}
            </div>
          ))}
        </div>
        <div style={{ borderTop: '1px solid var(--psa-line)', padding: '6px 14px', fontSize: 10.5, color: 'var(--psa-faint)', display: 'flex', gap: 14 }}>
          <span>↑↓ 选择</span><span>Enter 执行</span><span>Esc 关闭</span><span style={{ marginLeft: 'auto' }}>⌘K / Ctrl+K</span>
        </div>
      </div>
    </div>
  )
}

const backdrop: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(9,14,22,.42)', zIndex: 90, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '12vh' }
const panel: CSSProperties = { width: 560, maxWidth: '92vw', background: 'var(--psa-surface)', borderRadius: 12, boxShadow: '0 18px 50px rgba(9,14,22,.35)', border: '1px solid var(--psa-line-2)', overflow: 'hidden' }
const input: CSSProperties = { width: '100%', border: 0, borderBottom: '1px solid var(--psa-line)', outline: 'none', padding: '13px 14px', fontSize: 14, background: 'transparent', color: 'var(--psa-ink)', boxSizing: 'border-box' }
