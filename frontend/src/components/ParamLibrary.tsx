import { useState } from 'react'
import { AgGridReact } from 'ag-grid-react'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-quartz.css'
import type { ColDef, CellValueChangedEvent } from 'ag-grid-community'
import type { ModelJson, CcfGroupJson } from '../model'
import { Icon } from './icons'

interface Props {
  model: ModelJson
  onUpdateParam: (id: string, value: number) => void
  onSetCcf: (groups: CcfGroupJson[]) => void
}

const cols: ColDef[] = [
  { field: 'id', headerName: '参数 ID', flex: 2 },
  { field: 'kind', headerName: '类型', flex: 1 },
  { field: 'value', headerName: '值 (PFD / λ)', flex: 1, editable: true, cellEditor: 'agNumberCellEditor' },
]

const MGL_LEVELS = ['beta', 'gamma', 'delta', 'epsilon', 'mu', 'nu']
type CcfModel = 'beta' | 'mgl' | 'alpha' | 'phi'

/** 按模型与组规模列出因子键(与引擎 q_levels 约定一致,spec 2026-07-09)。 */
function factorKeys(model: CcfModel, m: number): string[] {
  if (model === 'beta') return ['beta']
  if (model === 'mgl') return MGL_LEVELS.slice(0, Math.max(1, m - 1))
  return Array.from({ length: Math.max(2, m) }, (_, i) => `${model}${i + 1}`)
}

function defaultFactors(model: CcfModel, m: number): Record<string, number> {
  if (model === 'beta') return { beta: 0.1 }
  if (model === 'mgl') return Object.fromEntries(factorKeys('mgl', m).map((k, i) => [k, i === 0 ? 0.1 : 0.2]))
  if (model === 'alpha') {
    const keys = factorKeys('alpha', m)
    const rest = 0.05 / (keys.length - 1)
    return Object.fromEntries(keys.map((k, i) => [k, i === 0 ? 0.95 : rest]))
  }
  const keys = factorKeys('phi', m)
  const rest = 0.1 / (keys.length - 1)
  return Object.fromEntries(keys.map((k, i) => [k, i === 0 ? 0.9 : rest]))
}

export function ParamLibrary({ model, onUpdateParam, onSetCcf }: Props) {
  const rows = model.model_data.parameters
  const basics = rows.map((r) => r.id)
  const groups = model.ccf_groups ?? []
  const [members, setMembers] = useState<string[]>([])
  const [ccfModel, setCcfModel] = useState<CcfModel>('beta')
  const [factors, setFactors] = useState<Record<string, number>>({ beta: 0.1 })
  const [staggered, setStaggered] = useState(false)
  const [showForm, setShowForm] = useState(false)

  const onCellValueChanged = (e: CellValueChangedEvent) => {
    if (e.colDef.field === 'value') onUpdateParam(e.data.id, Number(e.newValue))
  }
  const m = Math.max(2, members.length)
  const keys = factorKeys(ccfModel, m)
  const pickModel = (mod: CcfModel) => { setCcfModel(mod); setFactors(defaultFactors(mod, m)); if (mod !== 'alpha') setStaggered(false) }
  const phiSum = ccfModel === 'phi' ? keys.reduce((a, k) => a + (factors[k] ?? 0), 0) : 1
  const addGroup = () => {
    if (members.length < 2) return
    const fac = Object.fromEntries(keys.map((k) => [k, factors[k] ?? 0]))
    onSetCcf([...groups, {
      id: `G${groups.length + 1}`, members, model: ccfModel, factors: fac,
      ...(ccfModel === 'alpha' && staggered ? { staggered: true } : {}),
    }])
    setMembers([])
    setShowForm(false)
  }

  return (
    <div style={{ padding: 16, overflowY: 'auto', height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Parameter grid panel */}
      <div className="psa-panel" style={{ flex: 'none' }}>
        <div className="psa-ch">
          <span className="t">可靠性参数</span>
          <span className="meta">{rows.length} 个基本事件</span>
        </div>
        <div style={{ padding: '8px 10px 6px', fontSize: 11.5, color: 'var(--psa-muted)' }}>
          双击「值」单元格编辑 PFD；改后回「故障树」标签点「量化」即生效（逻辑—数据分离，共享参数）。
        </div>
        <div className="ag-theme-quartz psa-grid" style={{ height: 300 }}>
          <AgGridReact
            rowData={rows}
            columnDefs={cols}
            onCellValueChanged={onCellValueChanged}
            defaultColDef={{ sortable: true, filter: true, resizable: true }}
          />
        </div>
      </div>

      {/* CCF groups panel */}
      <div className="psa-panel" style={{ flex: 'none' }}>
        <div className="psa-ch">
          <span className="t">共因失效（CCF）组 — β / MGL / α / φ</span>
          <span className="meta">{groups.length} 组</span>
        </div>
        <div style={{ padding: '8px 10px 4px', fontSize: 11.5, color: 'var(--psa-muted)' }}>
          选 ≥2 个成员组成共因组；量化时成员被替换为 OR(独立, 共因事件)。MGL/α/φ 按 NUREG/CR-5485 全子集多层展开，α 支持错峰检验。
        </div>

        {/* CCF group tiles */}
        <div style={{ padding: '8px 10px 10px', display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {groups.map((g) => (
            <div key={g.id} className="psa-card" style={{ minWidth: 180, maxWidth: 260, padding: 0, overflow: 'hidden' }}>
              <div className="psa-ch" style={{ borderBottom: '1px solid var(--psa-line)' }}>
                <span className="t">{g.id}</span>
                <span className="psa-tag">{g.model}</span>
              </div>
              <div style={{ padding: '8px 10px' }}>
                <div style={{ fontSize: 11.5, color: 'var(--psa-muted)', marginBottom: 4 }}>
                  成员: <span style={{ color: 'var(--psa-ink)', fontFamily: 'var(--psa-font-mono)', fontSize: 11 }}>{g.members.join(', ')}</span>
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--psa-muted)', marginBottom: 8 }}>
                  {Object.entries(g.factors).map(([k, v]) => (
                    <span key={k} style={{ marginRight: 8 }}>{k} = <span className="psa-num" style={{ color: 'var(--psa-ink)' }}>{v}</span></span>
                  ))}
                  {g.staggered && <span className="psa-tag">错峰</span>}
                </div>
                <button className="psa-btn psa-btn--danger" style={{ height: 26, fontSize: 11.5, padding: '0 9px' }}
                  onClick={() => onSetCcf(groups.filter((x) => x.id !== g.id))}>
                  <Icon name="trash" size={13} /> 移除
                </button>
              </div>
            </div>
          ))}

          {/* Add-group dashed tile */}
          <div
            style={{
              minWidth: 140, minHeight: 90,
              border: '1px dashed var(--psa-line-2)',
              borderRadius: 'var(--psa-r-lg)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: 6, cursor: 'pointer', color: 'var(--psa-muted)', fontSize: 12,
              padding: '12px 16px',
            }}
            onClick={() => setShowForm((v) => !v)}
          >
            <Icon name="plus" size={18} />
            <span>新建 CCF 组</span>
          </div>
        </div>

        {/* Inline add form — shown when dashed tile is clicked */}
        {showForm && (
          <div style={{ padding: '0 10px 14px', borderTop: '1px solid var(--psa-line)', paddingTop: 12, display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 11.5, color: 'var(--psa-ink-2)', marginBottom: 4 }}>成员（多选）</div>
              <select multiple value={members} style={{ minWidth: 220, height: 120, fontSize: 12 }}
                onChange={(e) => setMembers(Array.from(e.target.selectedOptions, (o) => o.value))}>
                {basics.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 20 }}>
              <div className="psa-field">
                <label>模型</label>
                <select value={ccfModel} onChange={(e) => pickModel(e.target.value as CcfModel)} style={{ fontSize: 12 }}>
                  <option value="beta">Beta 因子</option>
                  <option value="mgl">MGL(多希腊字母)</option>
                  <option value="alpha">Alpha 因子</option>
                  <option value="phi">Phi 因子(直接)</option>
                </select>
                {ccfModel === 'alpha' && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, marginLeft: 8 }}>
                    <input type="checkbox" checked={staggered} onChange={(e) => setStaggered(e.target.checked)} />错峰检验
                  </label>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', maxWidth: 380 }}>
                {keys.map((k) => (
                  <div key={k} className="psa-field">
                    <label>{k} =</label>
                    <input type="number" step="0.01" min={0} max={1} value={factors[k] ?? 0} style={{ width: 76, fontSize: 12 }}
                      onChange={(e) => setFactors((f) => ({ ...f, [k]: Math.min(1, Math.max(0, +e.target.value)) }))} />
                  </div>
                ))}
              </div>
              {ccfModel === 'phi' && Math.abs(phiSum - 1) > 1e-6 && (
                <div style={{ fontSize: 11, color: 'var(--psa-amber)' }}>φ 各层之和须为 1(当前 {phiSum.toFixed(3)})</div>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="psa-btn psa-btn--primary" onClick={addGroup}
                  disabled={members.length < 2 || (ccfModel === 'phi' && Math.abs(phiSum - 1) > 1e-6)}>
                  <Icon name="plus" size={13} /> 添加 CCF 组
                </button>
                <button className="psa-btn" onClick={() => { setShowForm(false); setMembers([]) }}>
                  <Icon name="x" size={13} /> 取消
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
