import { useState, useCallback } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { LibraryData } from '../api'
import type { EventTreeModel } from '../eventtree'
import { layout, consLevel } from '../eventtree'
import type { FmeaRow, ApLevel, SxDZone, MappingConfig, FreqBin } from '../fmea'
import { rpn, ap, mustPrioritize, sxdCell, consequenceToS, freqToO, detectionToD, barrierS, componentS } from '../fmea'
import { loadRows, saveRows } from '../fmeaStore'
import { loadMapping, saveMapping, resetMapping } from '../mappingStore'

type LibComponent = LibraryData['component_failure_rates'][number]
type LibBarrier = LibraryData['barrier_effectiveness'][number]

// ── 样式辅助 ─────────────────────────────────────────────────────
const AP_BG: Record<ApLevel, string> = {
  '高': 'var(--psa-danger-soft)',
  '中': '#fffbeb',
  '低': '#f0fdf4',
}
const AP_FG: Record<ApLevel, string> = {
  '高': 'var(--psa-danger-strong)',
  '中': '#92400e',
  '低': '#166534',
}
const ZONE_BG: Record<SxDZone, string> = {
  high: 'var(--psa-zone-a)',
  mid:  'var(--psa-zone-b)',
  low:  'var(--psa-zone-c)',
}
const ZONE_LABEL: Record<SxDZone, string> = { high: '高风险', mid: '中风险', low: '低风险' }

// S/D 1-5 档标签(矩阵轴)
const BAND_LABELS = ['极低(1-2)', '低(3-4)', '中(5-6)', '高(7-8)', '极高(9-10)']

// 生成唯一 id
function uid(): string {
  return 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

// 把 rate(/h 或 /year) 转成 /year;单位字符串含 '/h' 则 *8760
function rateToPerYear(rate: number, unit: string): number {
  if (unit.toLowerCase().includes('/h')) return rate * 8760
  return rate
}

function clamp10(v: number): number {
  return Math.max(1, Math.min(10, Math.round(v || 1)))
}

// ── 导入行派生(纯函数,供「导入」与「按映射重算」复用)───────────
function deriveLibComponentRow(cfg: MappingConfig, c: LibComponent): FmeaRow {
  const ratePerYr = rateToPerYear(c.rate, c.unit)
  return {
    id: 'lib-c:' + c.id,
    object: c.name,
    mode: c.failure_mode,
    S: componentS(cfg),                       // 器件库无 category → 缺省 S
    O: freqToO(cfg, ratePerYr),
    D: detectionToD(cfg, c.detection?.difficulty),
    source: c.source?.citation,
  }
}

function deriveLibBarrierRow(cfg: MappingConfig, b: LibBarrier): FmeaRow {
  return {
    id: 'lib-b:' + b.id,
    object: b.name,
    mode: '屏障失效 / ' + b.category,
    S: barrierS(cfg, b.category),             // ① 按 category 推断严重度
    O: freqToO(cfg, b.pfd),                   // PFD 作年化概率近似(数量级)
    D: detectionToD(cfg, b.detection?.difficulty),
    source: b.source?.citation,
  }
}

function deriveLibRows(cfg: MappingConfig, lib: LibraryData): FmeaRow[] {
  return [
    ...lib.component_failure_rates.map((c) => deriveLibComponentRow(cfg, c)),
    ...lib.barrier_effectiveness.map((b) => deriveLibBarrierRow(cfg, b)),
  ]
}

function deriveEtaRows(cfg: MappingConfig, model: EventTreeModel, lib: LibraryData | null): FmeaRow[] {
  const out: FmeaRow[] = []
  const { nodes } = layout(model, 1, 0)
  const leaves = nodes.filter((n) => n.kind === 'leaf')

  // 每个屏障(功能事件 index)失败分支下可达末态的最重 S(用于回填更精细)
  const feMaxS: number[] = model.functionalEvents.map((_, i) => {
    let best = -1
    for (const leaf of leaves) {
      if (leaf.path[i] === 'failure') {
        best = Math.max(best, consequenceToS(cfg, consLevel(model, leaf.consequence!)))
      }
    }
    return best
  })

  // 末态叶节点行(S 用精确后果等级)
  for (const node of leaves) {
    const level = consLevel(model, node.consequence!)
    const S = consequenceToS(cfg, level)
    const O = freqToO(cfg, model.initFreq)
    // D:路径上最后一个失败屏障的探测难度
    const pathFes = node.path
      .map((step, i) => ({ step, branchIdx: i }))
      .filter((x) => x.step === 'failure')
    const lastFeIdx = pathFes.length > 0 ? pathFes[pathFes.length - 1].branchIdx : -1
    let D = cfg.detectionDefaultD
    if (lastFeIdx >= 0 && lastFeIdx < model.functionalEvents.length) {
      const fe = model.functionalEvents[lastFeIdx]
      const libBarrier = fe
        ? lib?.barrier_effectiveness.find((b) => b.id === fe.id || b.name === fe.label)
        : undefined
      D = detectionToD(cfg, libBarrier?.detection?.difficulty)
    }
    const consequence = node.consequence ?? 'C1'
    out.push({
      id: 'eta-leaf:' + node.path.join('/'),
      object: `${model.initEvent} → ${consequence}`,
      mode: `序列路径: ${node.path.join('/') || '直接末态'}`,
      S, O, D, source: 'ETA',
    })
  }

  // 每个屏障(功能事件)行
  model.functionalEvents.forEach((fe, i) => {
    const O = freqToO(cfg, fe.failProb)  // failProb 当概率近似年化频率
    const libBarrier = lib?.barrier_effectiveness.find((b) => b.id === fe.id || b.name === fe.label)
    const D = detectionToD(cfg, libBarrier?.detection?.difficulty)
    // S 更精细:取该屏障失败分支可达末态的最重严重度;无可达末态则按 lib category / 缺省
    const refined = feMaxS[i]
    const S = refined > 0 ? refined : barrierS(cfg, libBarrier?.category)
    out.push({ id: 'eta-fe:' + fe.id, object: fe.label, mode: '屏障失效', S, O, D, source: 'ETA' })
  })

  return out
}

// 矩阵:S 档(行 5→1 top-to-bottom)× D 档(列 1→5 left-to-right)
function SxDMatrix({ rows }: { rows: FmeaRow[] }) {
  // 统计每个 (sb,db) 格子有多少行
  const counts: Record<string, number> = {}
  for (const r of rows) {
    const sb = Math.ceil(r.S / 2)
    const db = Math.ceil(r.D / 2)
    const key = `${sb},${db}`
    counts[key] = (counts[key] ?? 0) + 1
  }

  const cellStyle = (sb: number, db: number): CSSProperties => {
    // sb=行(S 档)、db=列(D 档);prod = sb*db
    const zone = sxdCell(sb * 2 - 1, db * 2 - 1)  // 用档的中间值代入
    const cnt = counts[`${sb},${db}`] ?? 0
    return {
      width: 72,
      height: 48,
      borderRadius: 7,
      background: ZONE_BG[zone],
      border: cnt > 0 ? '2px solid var(--psa-ink)' : '1px solid rgba(15,25,40,.1)',
      textAlign: 'center',
      verticalAlign: 'middle',
      fontSize: cnt > 0 ? 14 : 11,
      fontWeight: cnt > 0 ? 700 : 400,
      color: cnt > 0 ? 'var(--psa-ink)' : 'rgba(22,32,43,.5)',
      boxShadow: cnt > 0 ? '0 0 0 3px rgba(31,111,224,.25)' : 'none',
      cursor: 'default',
      position: 'relative',
    }
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'separate', borderSpacing: 4, marginTop: 4 }}>
        <thead>
          <tr>
            <th style={{ padding: '4px 8px', fontSize: 10, color: 'var(--psa-faint)', textAlign: 'center', fontWeight: 500 }}>
              严重度 S<br />↓ / 可探测度 D →
            </th>
            {BAND_LABELS.map((l, i) => (
              <th key={i} style={{ padding: '4px 6px 9px', fontSize: 11, color: 'var(--psa-ink-2)', fontWeight: 600, textAlign: 'center', lineHeight: 1.2 }}>
                <div>D{i + 1}</div>
                <div style={{ fontSize: 9.5, color: 'var(--psa-faint)', fontWeight: 400 }}>{l}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[5, 4, 3, 2, 1].map((sb) => (
            <tr key={sb}>
              <th style={{ padding: '4px 10px', fontSize: 11, color: 'var(--psa-muted)', fontWeight: 500, textAlign: 'right', whiteSpace: 'nowrap' }}>
                <div>S{sb}</div>
                <div style={{ fontSize: 9.5, color: 'var(--psa-faint)', fontWeight: 400 }}>{BAND_LABELS[sb - 1]}</div>
              </th>
              {[1, 2, 3, 4, 5].map((db) => {
                const cnt = counts[`${sb},${db}`] ?? 0
                return (
                  <td key={db} style={cellStyle(sb, db)} title={ZONE_LABEL[sxdCell(sb * 2 - 1, db * 2 - 1)]}>
                    {cnt > 0 ? cnt : ''}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: 'flex', gap: 14, marginTop: 8, flexWrap: 'wrap', fontSize: 11, color: 'var(--psa-muted)' }}>
        {(['high', 'mid', 'low'] as SxDZone[]).map((z) => (
          <span key={z} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ display: 'inline-block', width: 13, height: 13, borderRadius: 3, background: ZONE_BG[z], border: '1px solid rgba(15,25,40,.15)' }} />
            {ZONE_LABEL[z]}
          </span>
        ))}
        <span style={{ color: 'var(--psa-faint)' }}>格中数字=落点行数;粗框=有数据</span>
      </div>
    </div>
  )
}

// ── 映射配置面板:小组件 ─────────────────────────────────────────
function LabeledNum({ label, value, onChange, sub }: { label: string; value: number; onChange: (v: number) => void; sub?: string }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--psa-ink-2)' }}>
      <span style={{ minWidth: 78, textAlign: 'right' }}>{label}</span>
      <input
        type="number" min={1} max={10} value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        style={numInput}
      />
      {sub && <span style={{ fontSize: 10.5, color: 'var(--psa-faint)' }}>{sub}</span>}
    </label>
  )
}

// 频率分档行:阈值可编辑(text + 草稿缓冲,允许键入 1e-3 这类科学计数法)+ O 数值
function FreqBinEditor({ bin, onTh, onO }: { bin: FreqBin; onTh: (th: number) => void; onO: (o: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? bin.th.toExponential(0)
  const commit = () => {
    if (draft == null) return
    const v = Number(draft)
    if (Number.isFinite(v) && v > 0) onTh(v)
    setDraft(null)
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--psa-ink-2)' }}>
      <span style={{ minWidth: 16, textAlign: 'right' }}>≥</span>
      <input
        type="text" value={shown}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        title="频率阈值(次/年),可键入科学计数法如 1e-3"
        style={{ ...numInput, width: 66, fontFamily: 'var(--psa-font-mono)' }}
      />
      <span style={{ color: 'var(--psa-faint)' }}>→ O</span>
      <input
        type="number" min={1} max={10} value={bin.o}
        onChange={(e) => onO(parseInt(e.target.value, 10))}
        style={numInput}
      />
    </div>
  )
}

function CfgGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset style={{ border: '1px solid var(--psa-line)', borderRadius: 8, padding: '8px 12px 10px', margin: 0 }}>
      <legend style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--psa-ink)', padding: '0 6px' }}>{title}</legend>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>{children}</div>
    </fieldset>
  )
}

// ── 主组件 ───────────────────────────────────────────────────────
interface Props {
  etModel: EventTreeModel | null
  lib: LibraryData | null
  rows?: FmeaRow[]
  onRowsChange?: (rows: FmeaRow[]) => void
  mapping?: MappingConfig
  onMappingChange?: (mapping: MappingConfig) => void
}

export function FmeaWorkbench({ etModel, lib, rows: controlledRows, onRowsChange, mapping, onMappingChange }: Props) {
  const [localRows, setLocalRows] = useState<FmeaRow[]>(() => loadRows())
  const [localCfg, setLocalCfg] = useState<MappingConfig>(() => loadMapping())
  const [mapOpen, setMapOpen] = useState(false)
  const rows = controlledRows ?? localRows
  const cfg = mapping ?? localCfg

  const persist = useCallback((next: FmeaRow[]) => {
    if (onRowsChange) onRowsChange(next)
    else { setLocalRows(next); saveRows(next) }
  }, [onRowsChange])

  const persistCfg = useCallback((next: MappingConfig) => {
    if (onMappingChange) onMappingChange(next)
    else { setLocalCfg(next); saveMapping(next) }
  }, [onMappingChange])

  // ── 汇总 metric ──
  const maxRpn = rows.length ? Math.max(...rows.map(rpn)) : 0
  const highS   = rows.filter((r) => r.S >= 9).length
  const highAp  = rows.filter((r) => ap(r) === '高').length

  // ── 编辑单元格 ──
  function updateCell(id: string, field: 'S' | 'O' | 'D', val: number) {
    const v = clamp10(val)
    persist(rows.map((r) => r.id === id ? { ...r, [field]: v } : r))
  }

  function deleteRow(id: string) {
    persist(rows.filter((r) => r.id !== id))
  }

  // ── 从参考库导入(跳过已有 id)──
  function importFromLib() {
    if (!lib) return
    const existIds = new Set(rows.map((r) => r.id))
    const add = deriveLibRows(cfg, lib).filter((r) => !existIds.has(r.id))
    persist([...rows, ...add])
  }

  // ── 从当前 ETA 取(跳过已有 id)──
  function importFromEta() {
    if (!etModel) return
    const existIds = new Set(rows.map((r) => r.id))
    const add = deriveEtaRows(cfg, etModel, lib).filter((r) => !existIds.has(r.id))
    persist([...rows, ...add])
  }

  // ── 按当前映射重算所有"导入行"的 S/O/D(保留手动行与名称)──
  function recomputeFromMapping() {
    const derived = new Map<string, FmeaRow>()
    if (lib) for (const r of deriveLibRows(cfg, lib)) derived.set(r.id, r)
    if (etModel) for (const r of deriveEtaRows(cfg, etModel, lib)) derived.set(r.id, r)
    let n = 0
    const next = rows.map((r) => {
      const d = derived.get(r.id)
      if (d && (r.S !== d.S || r.O !== d.O || r.D !== d.D)) { n++; return { ...r, S: d.S, O: d.O, D: d.D } }
      return r
    })
    if (n === 0) {
      window.alert('没有可重算的导入行(或 S/O/D 已与当前映射一致)。')
      return
    }
    if (window.confirm(`将按当前映射重算 ${n} 行导入数据的 S/O/D(覆盖这些行的手动调整,手动新增行不受影响)。继续?`)) {
      persist(next)
    }
  }

  function resetMappingCfg() {
    if (window.confirm('恢复出厂默认映射?当前自定义映射将丢失(已导入行的 S/O/D 不变,可随后点「按映射重算导入行」)。')) {
      persistCfg(resetMapping())
    }
  }

  // ── 导出 CSV ──
  function exportCsv() {
    const header = ['对象', '失效模式', 'S', 'O', 'D', 'RPN', 'AP', '需优先', '来源'].join(',')
    const dataLines = rows.map((r) => [
      `"${r.object}"`,
      `"${r.mode}"`,
      r.S, r.O, r.D,
      rpn(r),
      `"${ap(r)}"`,
      mustPrioritize(r) ? '是' : '',
      `"${r.source ?? ''}"`,
    ].join(','))
    const csv = [header, ...dataLines].join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'fmea.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  // ── 添加空行 ──
  function addRow() {
    const newRow: FmeaRow = { id: uid(), object: '新对象', mode: '失效模式', S: 5, O: 3, D: 6 }
    persist([...rows, newRow])
  }

  // ── 映射编辑器 setters ──
  const setConsq      = (level: string, v: number) => persistCfg({ ...cfg, consequenceToS: { ...cfg.consequenceToS, [level]: clamp10(v) } })
  const setFreqO      = (idx: number, v: number)    => persistCfg({ ...cfg, freqToO: cfg.freqToO.map((b, i) => i === idx ? { ...b, o: clamp10(v) } : b) })
  const setFreqTh     = (idx: number, th: number)   => persistCfg({ ...cfg, freqToO: cfg.freqToO.map((b, i) => i === idx ? { ...b, th } : b) })
  const setFreqFloor  = (v: number)                 => persistCfg({ ...cfg, freqFloorO: clamp10(v) })
  const setDet        = (d: string, v: number)      => persistCfg({ ...cfg, detectionToD: { ...cfg.detectionToD, [d]: clamp10(v) } })
  const setDetDefault = (v: number)                 => persistCfg({ ...cfg, detectionDefaultD: clamp10(v) })
  const setBarCat     = (cat: string, v: number)    => persistCfg({ ...cfg, barrierCategoryToS: { ...cfg.barrierCategoryToS, [cat]: clamp10(v) } })
  const setBarDefault = (v: number)                 => persistCfg({ ...cfg, barrierDefaultS: clamp10(v) })
  const setCompDefault= (v: number)                 => persistCfg({ ...cfg, componentDefaultS: clamp10(v) })

  // ── 渲染 ──
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: 'var(--psa-bg)', padding: 14 }}>
      {/* 汇总卡 */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <div className="psa-kpi">
          <div className="l">最高 RPN</div>
          <div className="v psa-num">{maxRpn}</div>
        </div>
        <div className="psa-kpi">
          <div className="l">S≥9(需优先)数</div>
          <div className="v psa-num" style={{ color: highS > 0 ? 'var(--psa-danger)' : 'var(--psa-ink)' }}>{highS}</div>
        </div>
        <div className="psa-kpi">
          <div className="l">AP 高 数量</div>
          <div className="v psa-num" style={{ color: highAp > 0 ? 'var(--psa-danger)' : 'var(--psa-ink)' }}>{highAp}</div>
        </div>
        <div className="psa-kpi">
          <div className="l">失效模式总数</div>
          <div className="v psa-num">{rows.length}</div>
        </div>
      </div>

      {/* 工具栏 */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
        <button className="psa-btn" onClick={addRow}>+ 新增行</button>
        <button className="psa-btn" onClick={importFromLib} disabled={!lib} title={lib ? '从参考库导入器件/屏障(跳过已有 id)' : '参考库未加载'}>
          从参考库导入
        </button>
        <button className="psa-btn" onClick={importFromEta} disabled={!etModel} title={etModel ? '从当前活动 ETA 取屏障与序列末态' : '暂无 ETA 模型'}>
          从当前 ETA 取
        </button>
        <button className="psa-btn" onClick={exportCsv} disabled={rows.length === 0}>导出 CSV</button>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--psa-faint)' }}>
          S/O/D 可直接点击编辑(1–10);数据自动保存至本地
        </span>
      </div>

      {/* 映射配置面板(可折叠) */}
      <div className="psa-panel" style={{ marginBottom: 12 }}>
        <div className="psa-ch" style={{ cursor: 'pointer' }} onClick={() => setMapOpen((o) => !o)}>
          <span className="t">⚙ 映射配置(S/O/D ↔ ETA / 参考库)</span>
          <span className="meta">{mapOpen ? '点击收起 ▲' : '点击展开 ▼'}</span>
        </div>
        {mapOpen && (
          <div style={{ padding: 14 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
              <CfgGroup title="后果等级 → S(严重度)">
                {['C1', 'C2', 'C3', 'C4', 'C5'].map((l) => (
                  <LabeledNum key={l} label={l} value={cfg.consequenceToS[l] ?? 6} onChange={(v) => setConsq(l, v)} />
                ))}
              </CfgGroup>

              <CfgGroup title="频率(次/年) → O(发生度)">
                {cfg.freqToO.map((b, i) => (
                  <FreqBinEditor key={i} bin={b} onTh={(th) => setFreqTh(i, th)} onO={(o) => setFreqO(i, o)} />
                ))}
                <LabeledNum label="更低 O" value={cfg.freqFloorO} onChange={setFreqFloor} sub="低于最小阈值" />
              </CfgGroup>

              <CfgGroup title="探测难度(1-5) → D(可探测度)">
                {['1', '2', '3', '4', '5'].map((d) => (
                  <LabeledNum key={d} label={`难度 ${d}`} value={cfg.detectionToD[d] ?? cfg.detectionDefaultD} onChange={(v) => setDet(d, v)} />
                ))}
                <LabeledNum label="缺省" value={cfg.detectionDefaultD} onChange={setDetDefault} sub="无探测信息" />
              </CfgGroup>

              <CfgGroup title="屏障类别 → S(严重度)">
                <LabeledNum label="预警 warning" value={cfg.barrierCategoryToS.warning ?? cfg.barrierDefaultS} onChange={(v) => setBarCat('warning', v)} />
                <LabeledNum label="主动 active" value={cfg.barrierCategoryToS.active ?? cfg.barrierDefaultS} onChange={(v) => setBarCat('active', v)} />
                <LabeledNum label="被动 passive" value={cfg.barrierCategoryToS.passive ?? cfg.barrierDefaultS} onChange={(v) => setBarCat('passive', v)} />
                <LabeledNum label="缺省" value={cfg.barrierDefaultS} onChange={setBarDefault} />
              </CfgGroup>

              <CfgGroup title="器件失效 → S">
                <LabeledNum label="缺省 S" value={cfg.componentDefaultS} onChange={setCompDefault} sub="器件库无类别字段" />
              </CfgGroup>
            </div>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 14 }}>
              <button className="psa-btn" onClick={recomputeFromMapping} disabled={rows.length === 0}>按映射重算导入行</button>
              <button className="psa-btn" onClick={resetMappingCfg}>恢复默认</button>
              <span style={{ fontSize: 11, color: 'var(--psa-faint)', flex: 1, minWidth: 220 }}>
                映射改动即时本地保存,影响后续导入;点「按映射重算导入行」把新映射套用到已导入的 库/ETA 行(保留手动行与名称)。
              </span>
            </div>
          </div>
        )}
      </div>

      {/* FMEA 表格 */}
      <div className="psa-panel" style={{ marginBottom: 16 }}>
        <div className="psa-ch">
          <span className="t">FMEA 失效模式影响分析</span>
          <span className="meta">{rows.length} 行</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: 'var(--psa-soft)', borderBottom: '1px solid var(--psa-line)' }}>
                {['对象', '失效模式', 'S', 'O', 'D', 'RPN', 'AP', '标记', '来源', ''].map((h, i) => (
                  <th key={i} style={{
                    padding: '8px 10px', textAlign: i >= 2 && i <= 6 ? 'center' : 'left',
                    fontSize: 11, fontWeight: 600, color: 'var(--psa-ink-2)',
                    whiteSpace: 'nowrap', borderRight: i < 9 ? '1px solid var(--psa-line)' : 'none',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={10} style={{ padding: 24, textAlign: 'center', color: 'var(--psa-faint)', fontSize: 13 }}>
                    暂无数据。点击「新增行」或使用工具栏导入。
                  </td>
                </tr>
              )}
              {rows.map((r, idx) => {
                const v = rpn(r)
                const level = ap(r)
                const prio = mustPrioritize(r)
                return (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--psa-line)', background: idx % 2 === 0 ? 'var(--psa-surface)' : 'var(--psa-soft-2)' }}>
                    <td style={tdStyle(false)}>{r.object}</td>
                    <td style={tdStyle(false)}>{r.mode}</td>
                    {(['S', 'O', 'D'] as const).map((field) => (
                      <td key={field} style={{ ...tdStyle(true), width: 54 }}>
                        <input
                          type="number" min={1} max={10} value={r[field]}
                          onChange={(e) => updateCell(r.id, field, parseInt(e.target.value, 10))}
                          style={numInput}
                        />
                      </td>
                    ))}
                    <td style={{ ...tdStyle(true), fontFamily: 'var(--psa-font-mono)', fontWeight: 700, background: AP_BG[level], color: AP_FG[level] }}>
                      {v}
                    </td>
                    <td style={{ ...tdStyle(true), padding: '4px 8px' }}>
                      <span style={{
                        display: 'inline-block', padding: '2px 8px', borderRadius: 12,
                        fontSize: 11.5, fontWeight: 600,
                        background: AP_BG[level], color: AP_FG[level],
                      }}>{level}</span>
                    </td>
                    <td style={{ ...tdStyle(true), textAlign: 'center' }}>
                      {prio && (
                        <span style={{ color: 'var(--psa-danger-strong)', fontWeight: 700, fontSize: 11.5 }} title="S≥9，需优先处理">
                          ●
                        </span>
                      )}
                    </td>
                    <td style={tdStyle(false)}>
                      <span style={{ fontSize: 11, color: 'var(--psa-faint)' }}>{r.source ?? ''}</span>
                    </td>
                    <td style={{ padding: '4px 8px', textAlign: 'center', borderRight: 'none' }}>
                      <button
                        onClick={() => deleteRow(r.id)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--psa-faint)', fontSize: 14, padding: '2px 4px', borderRadius: 4 }}
                        title="删除此行"
                        onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--psa-danger)')}
                        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--psa-faint)')}
                      >✕</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* S×D 矩阵 */}
      <div className="psa-panel">
        <div className="psa-ch">
          <span className="t">S×D 风险矩阵(严重度 × 可探测度)</span>
          <span className="meta">各档 = ceil(x/2),5×5</span>
        </div>
        <div style={{ padding: '12px 16px' }}>
          <SxDMatrix rows={rows} />
        </div>
      </div>

      <div style={{ height: 24 }} />
    </div>
  )
}

// ── 样式辅助 ─────────────────────────────────────────────────────
const tdStyle = (center: boolean): CSSProperties => ({
  padding: '6px 10px',
  textAlign: center ? 'center' : 'left',
  borderRight: '1px solid var(--psa-line)',
  color: 'var(--psa-ink)',
  fontSize: 12.5,
  whiteSpace: 'nowrap',
})

const numInput: CSSProperties = {
  width: 42,
  height: 26,
  border: '1px solid var(--psa-line-strong)',
  borderRadius: 5,
  textAlign: 'center',
  fontFamily: 'var(--psa-font-mono)',
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--psa-ink)',
  background: 'var(--psa-surface)',
  padding: '0 2px',
}
