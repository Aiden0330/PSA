# 库驱动编辑(从参考库选条目入树)实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从参考库一键把屏障(barrier_effectiveness)加入 ETA、把器件(component_failure_rates)加入故障树,自动带入数值+名称+来源。

**Architecture:** App 取 `getLibrary()` 传入编辑器;`addBarrierFromLib`/`addBasicFromLib` 纯函数追加节点并记 source;共用 `LibPicker` 下拉。后端无改动(纯元数据,不影响引擎定量)。

**Tech Stack:** React + TypeScript。

**验证:** 后端 `pytest -q`(未动应不变);前端 `npm run build --prefix frontend` + `preview_eval`。提交结尾 `Co-Authored-By: Claude Opus 4.8`。

---

## Task 1: 纯函数 + LibPicker 组件

**Files:** Modify `frontend/src/eventtree.ts`, `frontend/src/model.ts`; Create `frontend/src/components/LibPicker.tsx`

- [ ] **Step 1: `eventtree.ts` 加 `source` + `uniqId` + `addBarrierFromLib`**

`FuncEvent` 改:
```ts
export interface FuncEvent { id: string; label: string; failProb: number; linkFt?: string; source?: string }
```
在 `addFe` 后加:
```ts
function uniqId(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base
  let i = 2
  while (taken.includes(`${base}_${i}`)) i++
  return `${base}_${i}`
}
export interface LibBarrier { id: string; name: string; pfd: number; source?: { citation?: string } }
export function addBarrierFromLib(m: EventTreeModel, b: LibBarrier): EventTreeModel {
  const id = uniqId(b.id, m.functionalEvents.map((f) => f.id))
  const fe: FuncEvent = { id, label: b.name, failProb: b.pfd, source: b.source?.citation }
  return { ...m, functionalEvents: [...m.functionalEvents, fe] }
}
```

- [ ] **Step 2: `model.ts` 加 `addBasicFromLib`**(在 `attachStarterFt` 后)

```ts
export interface LibComponent { id: string; name: string; failure_mode?: string; rate: number; unit: string; source: { citation: string } }
/** 从器件失效率库追加基本事件(值=rate, 不做单位换算; 来源含单位标注)。 */
export function addBasicFromLib(m: ModelJson, ftName: string, c: LibComponent): ModelJson {
  const nm = clone(m), ft = getFt(nm, ftName)
  const taken = ft.nodes.map((n) => n.id).concat(nm.model_data.parameters.map((p) => p.id))
  let id = c.id, i = 2
  while (taken.includes(id)) { id = `${c.id}_${i}`; i++ }
  ft.nodes.push({ id, basic: true, param_ref: id })
  const src = `${c.name}${c.failure_mode ? '/' + c.failure_mode : ''} — ${c.source.citation}(${c.unit})`
  nm.model_data.parameters.push({ id, kind: 'probability', value: c.rate, source: src })
  return nm
}
```

- [ ] **Step 3: 写 `frontend/src/components/LibPicker.tsx`**

```tsx
export function LibPicker(
  { items, label, onPick }:
  { items: { id: string; name: string; unit?: string }[]; label: string; onPick: (id: string) => void },
) {
  return (
    <select value="" onChange={(e) => { if (e.target.value) onPick(e.target.value) }} style={{ fontSize: 12 }}>
      <option value="">{label}</option>
      {items.map((it) => <option key={it.id} value={it.id}>{it.name}{it.unit ? ` (${it.unit})` : ''}</option>)}
    </select>
  )
}
```

- [ ] **Step 4: 构建确认无类型错误** — `npm run build --prefix frontend`(调用处 Task 2 才加;此步仅验证新代码本身编译)。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/eventtree.ts frontend/src/model.ts frontend/src/components/LibPicker.tsx
git commit -m "feat(frontend): 库驱动纯函数 addBarrierFromLib/addBasicFromLib + LibPicker"
```

## Task 2: 接线(App / EventTreeEditor / BarrierFtModal)+ 验证

**Files:** Modify `frontend/src/App.tsx`, `frontend/src/components/EventTreeEditor.tsx`, `frontend/src/components/BarrierFtModal.tsx`

- [ ] **Step 1: `App.tsx` 取库 + 传参**

import 加 `getLibrary`(`./api`)、`type LibraryData`(`./api`)、`addBasicFromLib`(`./model`)、`LibPicker`(`./components/LibPicker`)。state 加 `const [lib, setLib] = useState<LibraryData | null>(null)`;effect `useEffect(() => { getLibrary().then(setLib).catch(() => {}) }, [])`。

故障树标签工具栏(`tab === 'ft'` 的 `<div style={toolbar}>` 内,`Palette` 之后)加器件选择器:
```tsx
{model && lib && (
  <LibPicker label="＋从库加基本事件" items={lib.component_failure_rates.map((c) => ({ id: c.id, name: c.name, unit: c.unit }))}
    onPick={(id) => { const c = lib.component_failure_rates.find((x) => x.id === id); if (c) set(addBasicFromLib(model, ftName, c)) }} />
)}
```

`EventTreeEditor` 调用处加 props:
```tsx
libBarriers={lib?.barrier_effectiveness ?? []}
libComponents={lib?.component_failure_rates ?? []}
```

- [ ] **Step 2: `EventTreeEditor.tsx` 屏障库选择器 + 源展示 + 透传**

import 加 `LibPicker`(`./LibPicker`)、`addBarrierFromLib`(`../eventtree`)。props 加:
```tsx
libBarriers?: { id: string; name: string; pfd: number; source?: { citation?: string } }[]
libComponents?: any[]
```
「功能事件(屏障)」标题那行加库选择器(在 `<h4>功能事件(屏障)</h4>` 之后、屏障列表之前):
```tsx
{libBarriers && libBarriers.length > 0 && (
  <div style={{ marginBottom: 6 }}>
    <LibPicker label="＋从库加屏障" items={libBarriers.map((b) => ({ id: b.id, name: b.name }))}
      onPick={(id) => { const b = libBarriers.find((x) => x.id === id); if (b) onChange(addBarrierFromLib(model, b)) }} />
  </div>
)}
```
选中分支面板显示来源(在「分支:决定 …」块内,`selIdx>=0` 时):
```tsx
{selIdx >= 0 && model.functionalEvents[selIdx]?.source && (
  <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>来源:{model.functionalEvents[selIdx].source}</div>
)}
```
把 `libComponents` 透传给模态:
```tsx
<BarrierFtModal model={fts} ftName={editingFt} api={ftsApi} pfd={pfds?.[editingFt]} libComponents={libComponents}
  onClose={() => { const id = editingFt; setEditingFt(null); onFtEdited?.(id) }} />
```

- [ ] **Step 3: `BarrierFtModal.tsx` 器件库选择器**

import 加 `LibPicker`(`./LibPicker`)、`addBasicFromLib`(`../model`)。props 加 `libComponents?: any[]`。工具栏 `bar` 内(`Palette` 之后、undo 之前)加:
```tsx
{libComponents && libComponents.length > 0 && (
  <LibPicker label="＋从库加基本事件" items={libComponents.map((c: any) => ({ id: c.id, name: c.name, unit: c.unit }))}
    onPick={(id) => { const c = libComponents.find((x: any) => x.id === id); if (c) api.set(addBasicFromLib(model, ftName, c)) }} />
)}
```
组件签名加 `libComponents`:
```tsx
{ model, ftName, api, pfd, onClose, libComponents }:
{ model: ModelJson; ftName: string; api: Api; pfd?: number; onClose: () => void; libComponents?: any[] }
```

- [ ] **Step 4: 构建** — `npm run build --prefix frontend` 通过(修 TS)。

- [ ] **Step 5: 预览验证**(`preview_eval`,无需重启——后端未改)
  - 进 ETA(默认),记当前功能事件数;通过「＋从库加屏障」select 选一个库屏障(set value + dispatch change);确认功能事件 +1,新屏障 label=库名;选中其分支圆点 → 面板显「来源:…」。
  - 故障树标签:记当前 svg 节点数;「＋从库加基本事件」选一器件;确认节点 +1。
  - (模态器件选择器:打开某 FTA 屏障的「编辑故障树」→ 模态内有「＋从库加基本事件」select。)

- [ ] **Step 6: 提交**

```bash
git add frontend/src/App.tsx frontend/src/components/EventTreeEditor.tsx frontend/src/components/BarrierFtModal.tsx
git commit -m "feat(frontend): ETA/FT 从参考库选条目入树(带数值+名称+来源)"
```

## 收尾

- [ ] 后端 `pytest -q`(未动,≥130 绿)。
- [ ] `npm run build --prefix frontend` 通过;`preview_eval` 端到端(ETA 加屏障 / FT 加基本事件 / 模态选择器)。
- [ ] 更新 `docs/superpowers/ROADMAP.md`(库驱动编辑);如系列(参考 ETA_claude 的 8 项)收尾,可在 ROADMAP 标注 5–8 全完成。

## 自检(plan vs spec)

- spec 2.1 App 取库传参 → Task 2 Step 1。
- spec 2.2 ETA 屏障(addBarrierFromLib + FuncEvent.source + 选择器 + 源展示)→ Task 1 Step1 + Task 2 Step2。
- spec 2.3 FT 基本事件(addBasicFromLib + LibPicker,模态 + FT 标签)→ Task 1 Step2/3 + Task 2 Step1/3。
- 类型一致:`addBarrierFromLib/addBasicFromLib/uniqId/LibPicker/LibBarrier/LibComponent/FuncEvent.source` 跨任务一致。
- 不做单位换算(spec §2.4):addBasicFromLib 直接用 rate,source 标注单位。
- 无后端改动 → 预览无需重启(与前几批不同)。
