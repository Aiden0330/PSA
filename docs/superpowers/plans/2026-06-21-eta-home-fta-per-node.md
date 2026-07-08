# ETA 主页化 + 多ETA + 每节点挂FTA + 风险矩阵互换 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 ETA 成为工具中心:ETA 作主页、可选预置/新建多个 ETA、每个屏障节点可挂载并编辑故障树(复用现有 FT 编辑器)其顶概率自动成为该屏障 PFD/有效性,并把风险矩阵坐标互换(后果 X、频率 Y)。

**Architecture:** 纯前端改动。ETA 旁挂第二个 `useModel` 持有 `fts: ModelJson`(各屏障故障树,FT 名=fe.id);`FuncEvent.linkFt` 标志挂载;屏障 PFD 由 `/api/quantify` 算 FT 顶概率得到并回写 `failProb`;ETA 精确定量走现有 `/api/event-tree/quantify`(按 `linkFt` 序列化)。后端不改。

**Tech Stack:** React 18 + Vite 5 + TypeScript;复用 `FaultTreeCanvas/Palette/Inspector` + `model.ts` 操作 + `useModel`。

**验证约定:** 每部分 `npm run build --prefix frontend` + 起 `bess-app` 预览 + `preview_eval` 查 DOM(本仓库前端无单测栈);改前端后必须重建(uvicorn 托管 dist)。提交结尾 `Co-Authored-By: Claude Opus 4.8`。

---

## 文件结构

**修改**
- `frontend/src/riskmatrix.ts` — 加 `SEVERITY_ASC`(列序)。
- `frontend/src/components/RiskMatrix.tsx` — 转置:列=后果 C1→C5,行=频率 F5→F1。
- `frontend/src/App.tsx` — 默认 ETA + 标签前置 + 挂载即载;`customEtas` 注册表 +「新建 ETA」;第二个 `useModel`(`etFts`)+ `pfds`;attach/detach/重算回调;传入编辑器。
- `frontend/src/eventtree.ts` — `FuncEvent.linkFt`;`toEngineRequest` 按 `linkFt`;`newBlankEta`、`setLinkFt`、`CONSEQUENCE_AT_DEPTH` 导出。
- `frontend/src/model.ts` — `attachStarterFt(fts, feId, failProb)`。
- `frontend/src/components/EventTreeEditor.tsx` — 屏障 PFD/FTA 开关 + 有效性 + 「编辑故障树」开模态;用 `pfds`。

**新增**
- `frontend/src/components/BarrierFtModal.tsx` — 全屏模态,复用 `FaultTreeCanvas/Palette/Inspector` 编辑某屏障 FT。

---

## Part 1 — 风险矩阵坐标互换

### Task 1: 转置风险矩阵

**Files:** Modify `frontend/src/riskmatrix.ts`, `frontend/src/components/RiskMatrix.tsx`

- [ ] **Step 1: `riskmatrix.ts` 加列序常量**

在 `SEVERITY` 之后加:
```ts
export const SEVERITY_ASC = ['C1', 'C2', 'C3', 'C4', 'C5']  // 列:左→右严重度递增
```

- [ ] **Step 2: 重写 `RiskMatrix.tsx`**(列=后果,行=频率 F5→F1)

```tsx
import type { CSSProperties } from 'react'
import { FREQ_BANDS, SEVERITY_ASC, SEV_RANK, freqBandIndex, riskLevel, RISK_COLOR } from '../riskmatrix'

const C_LABEL: Record<string, string> = {
  C1: '单体排气', C2: '模组蔓延', C3: '簇/舱火灾', C4: '多舱火灾', C5: '爆燃/爆炸',
}
const th: CSSProperties = { padding: '4px 6px', fontSize: 11, color: '#475569', border: '1px solid #e2e8f0', background: '#f8fafc' }

export function RiskMatrix({ totals }: { totals: Record<string, number> }) {
  const placed: Record<string, number> = {}   // Cx -> 频率带 index
  for (const c of Object.keys(totals)) if ((totals[c] ?? 0) > 0) placed[c] = freqBandIndex(totals[c])
  const rows = FREQ_BANDS.map((_, i) => i).reverse()   // [4,3,2,1,0] = F5..F1 从上到下

  return (
    <div>
      <table style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>频率＼后果</th>
            {SEVERITY_ASC.map((s) => <th key={s} style={th}>{s}<br />{C_LABEL[s]}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((fi) => (
            <tr key={fi}>
              <th style={th}>{FREQ_BANDS[fi].label}<br />{FREQ_BANDS[fi].code}</th>
              {SEVERITY_ASC.map((sev) => {
                const lvl = riskLevel(SEV_RANK[sev], fi + 1)
                const here = placed[sev] === fi
                return (
                  <td key={sev} title={`风险:${lvl}`} style={{
                    width: 88, height: 38, border: '1px solid #e2e8f0', textAlign: 'center',
                    background: RISK_COLOR[lvl], opacity: here ? 1 : 0.26,
                    color: '#fff', fontSize: 11, fontWeight: 700,
                    outline: here ? '2px solid #0f172a' : 'none',
                  }}>
                    {here ? `${sev}: ${totals[sev].toExponential(1)}` : ''}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ fontSize: 11, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', padding: 8, borderRadius: 6, marginTop: 8, maxWidth: 520 }}>
        ⚠ 频率带与可接受准则为示意默认值,须按项目/法规校核。配色:<b style={{ color: '#16a34a' }}>绿低</b> / <b style={{ color: '#a16207' }}>黄中</b> / <b style={{ color: '#c2410c' }}>橙高</b> / <b style={{ color: '#dc2626' }}>红极高</b>。
      </div>
    </div>
  )
}
```

- [ ] **Step 3: 构建** — `npm run build --prefix frontend` → 成功。

- [ ] **Step 4: 预览验证** — 起 `bess-app`,进 ETA 标签点「引擎精确量化」,`preview_eval`:
  最后一张 table 表头第 2 格含 `C1`,首数据行行首含 `频繁`/`F5`;`td` 数 25;落点单元格文本匹配 `C\d:`。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/riskmatrix.ts frontend/src/components/RiskMatrix.tsx
git commit -m "feat(frontend): 风险矩阵坐标互换(后果 X / 频率 Y)"
```

---

## Part 2 — 主页为 ETA + 标签前置 + 挂载即载

### Task 2: ETA 作默认首标签并在挂载时加载

**Files:** Modify `frontend/src/App.tsx`

- [ ] **Step 1: 默认标签改 ETA** — `App.tsx` 中 `useState<'ft'|'bess'|'params'|'library'>('ft')` 改默认 `'bess'`。

- [ ] **Step 2: 标签按钮前置** — header 按钮顺序改为 ETA 第一:

```tsx
<button onClick={onBessTab} style={tabBtn(tab === 'bess')}>BESS 事件树(ETA)</button>
<button onClick={() => setTab('ft')} style={tabBtn(tab === 'ft')}>故障树(可编辑)</button>
<button onClick={() => setTab('params')} style={tabBtn(tab === 'params')}>参数库 / CCF</button>
<button onClick={() => setTab('library')} style={tabBtn(tab === 'library')}>参考库</button>
```

- [ ] **Step 3: 挂载即载 ETA** — 加 `useEffect(() => { loadEt('') }, [])`(`loadEt` 在 Task 5 会被改造;此处先确保默认加载默认级联)。

- [ ] **Step 4: 构建 + 预览** — `preview_eval`:页面加载后 `document.querySelector('svg circle')` 存在(无需点击),首个 header 按钮文本含 `BESS`。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/App.tsx
git commit -m "feat(frontend): ETA 作默认首标签, 加载即显示"
```

---

## Part 3 — 多 ETA + 新建自定义

### Task 3: 事件树 helper + 新建/切换

**Files:** Modify `frontend/src/eventtree.ts`, `frontend/src/App.tsx`

- [ ] **Step 1: `eventtree.ts` 加 helper 与常量**

```ts
export const CONSEQUENCE_AT_DEPTH = ['C1', 'C2', 'C3', 'C4', 'C5', 'C5', 'C5']

export function newBlankEta(name: string): EventTreeModel {
  const fes: FuncEvent[] = [
    { id: 'FE1', label: '屏障1', failProb: 0.1 },
    { id: 'FE2', label: '屏障2', failProb: 0.1 },
  ]
  return { initEvent: name || '自定义事件', initFreq: 1e-3, functionalEvents: fes,
           root: buildCascade(fes, CONSEQUENCE_AT_DEPTH) }
}
```

（`FuncEvent` 在 Task 6 加 `linkFt?`;此处先用现有字段。）

- [ ] **Step 2: `App.tsx` 自定义 ETA 注册表 + 新建按钮**

state 加:`const [customEtas, setCustomEtas] = useState<{ id: string; name: string; model: EventTreeModel }[]>([])`。
下拉 `<select>` options 改为:默认项 + `scenarios` + `customEtas`(value 用 `custom:<id>`)。
切换逻辑:value 以 `custom:` 开头 → 取 `customEtas` 里的 model 直接 `setEtModel`(并清 `bess`/`fts`);否则 `loadEt(value)`。
加按钮:

```tsx
<button onClick={() => {
  const name = window.prompt('新 ETA 名称', '自定义 ETA')
  if (!name) return
  const id = 'c' + Date.now().toString(36)
  const model = newBlankEta(name)
  setCustomEtas((xs) => [...xs, { id, name, model }])
  setScenarioId('custom:' + id); setEtModel(model); setBess(null)
}}>+ 新建 ETA</button>
```

import `newBlankEta`。

- [ ] **Step 3: 构建 + 预览** — `preview_eval`:点击「+ 新建 ETA」(`window.prompt` 在 eval 里不可交互 → 改为在 eval 里直接调用组件不便;改用 DOM 验证 select 含自定义项的方式:先在 eval 中无法触发 prompt,故此步验证「select 选项数 = 1+场景数」且按钮存在)。新建交互在最终人工/整体预览时确认。

- [ ] **Step 4: 提交**

```bash
git add frontend/src/eventtree.ts frontend/src/App.tsx
git commit -m "feat(frontend): 多 ETA 下拉 + 新建自定义空白 ETA(内存态)"
```

---

## Part 4 — 每节点挂 FTA → 防护有效性(方案 A 模态)

### Task 4: 数据模型 + 序列化按 linkFt

**Files:** Modify `frontend/src/eventtree.ts`, `frontend/src/model.ts`

- [ ] **Step 1: `eventtree.ts` 加 `linkFt` 与 `setLinkFt`**

`FuncEvent` 改:
```ts
export interface FuncEvent { id: string; label: string; failProb: number; linkFt?: string }
```
加:
```ts
export function setLinkFt(m: EventTreeModel, idx: number, name: string | undefined): EventTreeModel {
  return { ...m, functionalEvents: m.functionalEvents.map((f, i) => (i === idx ? { ...f, linkFt: name } : f)) }
}
```

- [ ] **Step 2: `toEngineRequest` 改按 `linkFt`**(linked 形状改为数组)

```ts
export function toEngineRequest(
  m: EventTreeModel,
  linked?: { fault_trees: any[]; parameters: any[] },
): EtQuantifyRequest {
  const sequences: { path: Record<string, string>; end_state: string }[] = []
  const consequence_bins: Record<string, string> = {}
  let leaf = 0
  function walk(n: EtNode, path: Record<string, string>, depth: number): void {
    if (n.kind === 'leaf') {
      const es = `L${leaf++}`; sequences.push({ path: { ...path }, end_state: es }); consequence_bins[es] = n.consequence; return
    }
    const feId = m.functionalEvents[depth]?.id ?? `FE${depth}`
    walk(n.success, { ...path, [feId]: 'success' }, depth + 1)
    walk(n.failure, { ...path, [feId]: 'failure' }, depth + 1)
  }
  walk(m.root, {}, 0)

  const ftByName = new Map((linked?.fault_trees ?? []).map((f: any) => [f.name, f]))
  const functional_events = m.functionalEvents.map((fe) =>
    fe.linkFt && ftByName.has(fe.linkFt) ? { id: fe.id, link_ft: fe.id } : { id: fe.id, pfd: fe.failProb })
  const fault_trees: Record<string, any> = {}
  for (const fe of m.functionalEvents) if (fe.linkFt && ftByName.has(fe.linkFt)) fault_trees[fe.id] = ftByName.get(fe.linkFt)
  const parameters: Record<string, any> = {}
  for (const p of linked?.parameters ?? []) parameters[p.id] = { value: p.value }
  return { init_event: m.initEvent, init_frequency: m.initFreq, functional_events, fault_trees, parameters, sequences, consequence_bins }
}
```

- [ ] **Step 3: `model.ts` 加 `attachStarterFt`**

```ts
/** 为某屏障在 fts 中建启动故障树(名=feId, OR 门 + 1 基本事件=当前 PFD)。 */
export function attachStarterFt(fts: ModelJson, feId: string, failProb: number): ModelJson {
  const nm = clone(fts)
  const beId = feId + '_BE'
  nm.fault_trees = nm.fault_trees.filter((f) => f.name !== feId)
  nm.fault_trees.push({ name: feId, top: feId, nodes: [
    { id: beId, basic: true, param_ref: beId },
    { id: feId, op: 'or', args: [beId] },
  ]})
  nm.model_data.parameters = nm.model_data.parameters.filter((p) => p.id !== beId)
  nm.model_data.parameters.push({ id: beId, kind: 'probability', value: failProb })
  return nm
}
```

- [ ] **Step 4: 构建确认无类型错误** — `npm run build --prefix frontend`(EventTreeEditor 调用处 Task 7 再改;若此刻报 linked 形状不符,Task 7 一并修;允许本步骤后暂不通过,Task 7 后整体通过)。**实际执行:Task 4–7 一起改完再构建**,以避免中间态编译失败。

- [ ] **Step 5: 提交(与 Task 5–7 合并为一次前端构建后提交)**

### Task 5: App 装配 — etFts / pfds / loadEt / attach / detach / 重算

**Files:** Modify `frontend/src/App.tsx`

- [ ] **Step 1: 引入第二个 useModel 与 pfds**

```tsx
const etFts = useModel(null)                     // ETA 各屏障故障树 (ModelJson)
const [pfds, setPfds] = useState<Record<string, number>>({})
```
import:`import { quantify } from './api'`(已在);`import { attachStarterFt } from './model'`;`import { setLinkFt } from './eventtree'`。

- [ ] **Step 2: 重算 helper**

```tsx
async function computePfds(fts: ModelJson, model: EventTreeModel): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const fe of model.functionalEvents) {
    if (fe.linkFt) {
      try { out[fe.id] = (await quantify(fts, fe.id)).probability } catch {}
    }
  }
  return out
}
function syncFailProbs(model: EventTreeModel, p: Record<string, number>): EventTreeModel {
  return { ...model, functionalEvents: model.functionalEvents.map((f) => (f.id in p ? { ...f, failProb: p[f.id] } : f)) }
}
```

- [ ] **Step 3: 改造 `loadEt` 构建 fts + 标记 linkFt + 重算**

```tsx
const loadEt = async (sid: string) => {
  const d = await getBessEventTree(sid || undefined)
  setBess(d)
  const fts: ModelJson = { model_data: { parameters: d.parameters ?? [] }, fault_trees: Object.values(d.fault_trees ?? {}) as any }
  etFts.reset(fts)
  let fes = d.functional_events.map((id) => ({
    id, label: d.labels[id] ?? id, failProb: d.fe_prob[id] ?? 0.1,
    linkFt: (d.fault_trees?.[id]?.nodes?.length ?? 0) > 2 ? id : undefined,
  }))
  let model: EventTreeModel = { initEvent: d.init_event, initFreq: d.init_frequency, functionalEvents: fes, root: buildCascade(fes, CONSEQUENCE_AT_DEPTH) }
  const p = await computePfds(fts, model)
  setPfds(p); setEtModel(syncFailProbs(model, p))
}
```
import `CONSEQUENCE_AT_DEPTH` from `./eventtree`(替换 App 顶部原本地常量)。

- [ ] **Step 4: attach / detach / 关闭重算回调**

```tsx
const onAttachFt = (idx: number) => {
  if (!etModel) return
  const fe = etModel.functionalEvents[idx]
  const base = etFts.model ?? { model_data: { parameters: [] }, fault_trees: [] }
  etFts.set(attachStarterFt(base, fe.id, fe.failProb))
  setEtModel(setLinkFt(etModel, idx, fe.id))
}
const onDetachFt = (idx: number) => { if (etModel) setEtModel(setLinkFt(etModel, idx, undefined)) }
const onFtEdited = async (feId: string) => {
  if (!etFts.model || !etModel) return
  try {
    const prob = (await quantify(etFts.model, feId)).probability
    setPfds((x) => ({ ...x, [feId]: prob }))
    setEtModel((m) => (m ? { ...m, functionalEvents: m.functionalEvents.map((f) => (f.id === feId ? { ...f, failProb: prob } : f)) } : m))
  } catch {}
}
```

- [ ] **Step 5: 传参给 `EventTreeEditor`**

```tsx
<EventTreeEditor model={etModel} onChange={setEtModel}
  linked={{ fault_trees: etFts.model?.fault_trees ?? [], parameters: etFts.model?.model_data.parameters ?? [] }}
  fts={etFts.model} ftsApi={{ set: etFts.set, undo: etFts.undo, redo: etFts.redo, canUndo: etFts.canUndo, canRedo: etFts.canRedo }}
  pfds={pfds} onAttachFt={onAttachFt} onDetachFt={onDetachFt} onFtEdited={onFtEdited} />
```

### Task 6: BarrierFtModal（复用 FT 编辑器组件)

**Files:** Create `frontend/src/components/BarrierFtModal.tsx`

- [ ] **Step 1: 写模态**

```tsx
import { useState } from 'react'
import type { CSSProperties } from 'react'
import type { ModelJson } from '../model'
import { addGate, addBasic, connect, deleteNode, updateNode, updateParam, setTop } from '../model'
import { layoutFaultTree } from '../layout'
import { FaultTreeCanvas } from './FaultTreeCanvas'
import { Palette } from './Palette'
import { Inspector } from './Inspector'

interface Api { set: (m: ModelJson) => void; undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean }

export function BarrierFtModal(
  { model, ftName, api, pfd, onClose }:
  { model: ModelJson; ftName: string; api: Api; pfd?: number; onClose: () => void },
) {
  const [selected, setSelected] = useState<string | null>(null)
  const graph = layoutFaultTree(model, ftName)
  return (
    <div style={overlay} onClick={onClose}>
      <div style={panel} onClick={(e) => e.stopPropagation()}>
        <div style={bar}>
          <strong style={{ fontSize: 14 }}>编辑故障树:{ftName}</strong>
          <Palette onAddGate={(op) => api.set(addGate(model, ftName, op))} onAddBasic={() => api.set(addBasic(model, ftName))} />
          <button onClick={api.undo} disabled={!api.canUndo} style={icon}>↶</button>
          <button onClick={api.redo} disabled={!api.canRedo} style={icon}>↷</button>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 12, color: '#475569' }}>PFD={pfd != null ? pfd.toExponential(2) : '—'} · 有效性={pfd != null ? (1 - pfd).toFixed(4) : '—'}</span>
          <button onClick={onClose} style={done}>完成</button>
        </div>
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <FaultTreeCanvas nodes={graph.nodes} edges={graph.edges} editable highlight={new Set()}
              onConnectNodes={(s, t) => api.set(connect(model, ftName, s, t))}
              onDeleteNodes={(ids) => { let m = model; for (const id of ids) m = deleteNode(m, ftName, id); api.set(m); setSelected(null) }}
              onSelect={setSelected} />
          </div>
          <div style={{ width: 360, borderLeft: '1px solid #e2e8f0', overflowY: 'auto', background: '#fff' }}>
            <Inspector model={model} ftName={ftName} selected={selected}
              onUpdateNode={(id, patch) => api.set(updateNode(model, ftName, id, patch))}
              onUpdateParam={(id, v) => api.set(updateParam(model, id, v))}
              onSetTop={(id) => api.set(setTop(model, ftName, id))}
              onDelete={(id) => { api.set(deleteNode(model, ftName, id)); setSelected(null) }} />
          </div>
        </div>
      </div>
    </div>
  )
}

const overlay: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', zIndex: 50, display: 'flex', padding: 24 }
const panel: CSSProperties = { margin: 'auto', width: '92%', height: '88%', background: '#fff', borderRadius: 10, display: 'flex', flexDirection: 'column', overflow: 'hidden' }
const bar: CSSProperties = { display: 'flex', gap: 10, alignItems: 'center', padding: '8px 14px', borderBottom: '1px solid #e2e8f0' }
const icon: CSSProperties = { border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', padding: '4px 10px' }
const done: CSSProperties = { background: '#2563eb', color: '#fff', border: 0, borderRadius: 6, padding: '6px 16px' }
```

（验证 `Inspector`/`Palette`/`FaultTreeCanvas` 的 props 与 App.tsx 故障树标签中的用法一致;若签名不同,以 App.tsx 实际用法为准对齐。)

### Task 7: EventTreeEditor — 屏障 PFD/FTA 开关 + 开模态 + 用 pfds

**Files:** Modify `frontend/src/components/EventTreeEditor.tsx`

- [ ] **Step 1: 扩展 props**

```tsx
interface Linked { fault_trees: any[]; parameters: any[] }
export function EventTreeEditor(
  { model, onChange, linked, fts, ftsApi, pfds, onAttachFt, onDetachFt, onFtEdited }:
  { model: EventTreeModel; onChange: (m: EventTreeModel) => void; linked?: Linked
    fts?: any; ftsApi?: any; pfds?: Record<string, number>
    onAttachFt?: (idx: number) => void; onDetachFt?: (idx: number) => void; onFtEdited?: (feId: string) => void },
) {
```
import `BarrierFtModal`;加 `const [editingFt, setEditingFt] = useState<string | null>(null)`。

- [ ] **Step 2: 选中分支面板改为 PFD/FTA 开关**(替换原只读下钻块)

```tsx
) : (
  <div style={{ fontSize: 12 }}>
    <div>分支:决定 <b>{selFeId ?? '—'}</b></div>
    {(() => {
      const idx = sel!.length
      const fe = model.functionalEvents[idx]
      if (!fe) return null
      if (fe.linkFt) {
        const pfd = pfds?.[fe.id]
        return (
          <div style={{ marginTop: 6 }}>
            <div>挂载 FTA · PFD={pfd != null ? pfd.toExponential(2) : '—'} · 有效性={pfd != null ? (1 - pfd).toFixed(4) : '—'}</div>
            <button onClick={() => setEditingFt(fe.id)} style={{ marginTop: 6, background: '#2563eb', color: '#fff', border: 0, borderRadius: 6, padding: '5px 12px' }}>编辑故障树</button>
            <button onClick={() => onDetachFt?.(idx)} style={{ marginLeft: 8, color: '#dc2626' }}>改回直接 PFD</button>
          </div>
        )
      }
      return (
        <div style={{ marginTop: 6 }}>
          <div>直接 PFD={fe.failProb}</div>
          <button onClick={() => onAttachFt?.(idx)} style={{ marginTop: 6, background: '#0f766e', color: '#fff', border: 0, borderRadius: 6, padding: '5px 12px' }}>挂载 FTA</button>
        </div>
      )
    })()}
    <button onClick={() => onChange(collapseNode(model, sel!))} style={{ marginTop: 8, color: '#dc2626' }}>折叠为末态</button>
  </div>
)
```
（删去原 `selFt`/`selFtDecomposed` 只读渲染逻辑,替换为以上。`selFeId` 计算保留。）

- [ ] **Step 3: 渲染模态**（组件返回的根 `<div>` 内末尾加)

```tsx
{editingFt && fts && ftsApi && (
  <BarrierFtModal model={fts} ftName={editingFt} api={ftsApi} pfd={pfds?.[editingFt]}
    onClose={() => { const id = editingFt; setEditingFt(null); onFtEdited?.(id) }} />
)}
```

- [ ] **Step 4: 整体构建** — `npm run build --prefix frontend` → 通过(Task 4–7 一起)。修任何 TS 报错(尤其 linked 形状、props 可选性)。

- [ ] **Step 5: 预览端到端验证**(`preview_eval`)
  - 进 ETA(默认),选 `SC_OVERCHARGE`(B_BMS 首,已挂 FTA)→ 选中根分支 → 右栏出现「挂载 FTA · PFD=… · 有效性=…」+「编辑故障树」。
  - 点「编辑故障树」→ 出现模态(`document.querySelector('[data-modal]')` 或检测 overlay + 画布节点);改一个基本事件参数 → 完成 → 该屏障 PFD 更新。
  - 选一个直接 PFD 屏障(如某场景的 B_THERMAL)→「挂载 FTA」→ linkFt 生效、出现「编辑故障树」。
  - 点「引擎精确量化」→ 叶显示引擎值;风险矩阵列=C1→C5、行=F5→F1。

- [ ] **Step 6: 提交(Part 3+4 前端一次性)**

```bash
git add frontend/src/eventtree.ts frontend/src/model.ts frontend/src/App.tsx frontend/src/components/EventTreeEditor.tsx frontend/src/components/BarrierFtModal.tsx
git commit -m "feat(frontend): 每个 ETA 屏障可挂载/编辑故障树(模态复用 FT 编辑器), 顶概率自动为 PFD/有效性"
```

---

## 收尾

- [ ] `npm run build --prefix frontend` 通过。
- [ ] 后端 `.\.venv\Scripts\python.exe -m pytest -q` 仍全绿(本批未改后端)。
- [ ] `preview_eval` 端到端:主页 ETA、多 ETA 下拉+新建、屏障挂 FTA 编辑+有效性、风险矩阵互换、引擎精确量化差异。
- [ ] 更新 `docs/superpowers/ROADMAP.md` 现状快照(ETA 主页化 / 多 ETA / 每节点挂 FTA / 风险矩阵互换)。

## 自检(plan vs spec)

- spec ① 风险矩阵互换 → Task 1。
- spec ② 多 ETA + 新建 → Task 3。
- spec ③ 主页 ETA → Task 2。
- spec ④ 节点挂 FTA(方案 A)→ Task 4(模型/序列化)+5(App 装配)+6(模态)+7(编辑器面板)。
- 类型一致:`FuncEvent.linkFt`、`toEngineRequest(linked={fault_trees[],parameters[]})`、`attachStarterFt`、`setLinkFt`、`computePfds`、`onFtEdited`、`BarrierFtModal` props 跨任务一致。
- 注意:Task 4–7 中间态可能编译不过,**统一在 Task 7 Step 4 构建**;`window.prompt` 在 preview_eval 不可触发,新建 ETA 的交互在整体人工/DOM 旁路验证。
- 风险:`Palette/Inspector/FaultTreeCanvas` props 必须对齐 App.tsx 现用法(执行时先核对)。
