# ROADMAP E 小项打包 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 4 个小项:ETA 事件树 undo/redo、故障树 FV 重要度热力着色、事件树图 PNG/SVG 导出、UI 内 MEF XML 导入。

**Architecture:** 泛化历史 hook 给 ETA 加 undo/redo;`FaultTreeCanvas`/`BasicEventNode` 按 `heat` 上色;复用 `svgRef`/`svgToPng` 导图;后端 `/api/import/mef` 复用 `load_mef_xml`(临时文件)→ ModelJson。

**Tech Stack:** React/TS;FastAPI/pytest(仅 MEF 端点)。

**验证:** 后端 `pytest -q`;前端 `npm run build --prefix frontend` + `preview_eval`;**改后端后重启 uvicorn 预览**。一项一 commit,结尾 `Co-Authored-By: Claude Opus 4.8`。

---

## Task 1: ETA undo/redo(泛化 useHistory + App)

**Files:** Modify `frontend/src/useModel.ts`, `frontend/src/App.tsx`

- [ ] **Step 1: 泛化 `useModel.ts` 为 `useHistory<T>`**(支持值或更新函数;`useModel` 委托之)

```ts
import { useReducer, useCallback } from 'react'
import type { ModelJson } from './model'

interface Hist<T> { past: T[]; present: T | null; future: T[] }
type Updater<T> = T | ((prev: T | null) => T)
type Action<T> = { type: 'set'; m: Updater<T> } | { type: 'reset'; m: T | null } | { type: 'undo' } | { type: 'redo' }

function reducer<T>(s: Hist<T>, a: Action<T>): Hist<T> {
  switch (a.type) {
    case 'set': {
      const next = typeof a.m === 'function' ? (a.m as (p: T | null) => T)(s.present) : a.m
      return { past: s.present ? [...s.past, s.present] : s.past, present: next, future: [] }
    }
    case 'reset': return { past: [], present: a.m, future: [] }
    case 'undo': {
      if (!s.past.length) return s
      const prev = s.past[s.past.length - 1]
      return { past: s.past.slice(0, -1), present: prev, future: s.present ? [s.present, ...s.future] : s.future }
    }
    case 'redo': {
      if (!s.future.length) return s
      const next = s.future[0]
      return { past: s.present ? [...s.past, s.present] : s.past, present: next, future: s.future.slice(1) }
    }
  }
}

export function useHistory<T>(initial: T | null) {
  const [s, dispatch] = useReducer(reducer<T>, { past: [], present: initial, future: [] })
  return {
    model: s.present,
    set: useCallback((m: Updater<T>) => dispatch({ type: 'set', m }), []),
    reset: useCallback((m: T | null) => dispatch({ type: 'reset', m }), []),
    undo: useCallback(() => dispatch({ type: 'undo' }), []),
    redo: useCallback(() => dispatch({ type: 'redo' }), []),
    canUndo: s.past.length > 0,
    canRedo: s.future.length > 0,
  }
}

export function useModel(initial: ModelJson | null) { return useHistory<ModelJson>(initial) }
```

- [ ] **Step 2: `App.tsx` 用 `useHistory<EventTreeModel>`**

import 加 `useHistory`(`./useModel`)。把 `const [etModel, setEtModel] = useState<EventTreeModel | null>(null)` 改为:
```tsx
const etHist = useHistory<EventTreeModel>(null)
const etModel = etHist.model
```
替换所有 `setEtModel(` 调用:
- `EventTreeEditor` 的 `onChange={setEtModel}` → `onChange={etHist.set}`
- 加载类(loadEt 内 `setEtModel({...})`、`onLoadSaved`、`selectEta` custom 分支的 `setEtModel(c.model)`、`onNewEta` 的 `setEtModel(m)`)→ 改 `etHist.reset(...)`(清历史)
- `onAttachFt`/`onDetachFt` 的 `setEtModel(setLinkFt(...))` → `etHist.set(setLinkFt(...))`
- `onFtEdited` 的 `setEtModel((m) => ...)` → `etHist.set((m) => ...)`

- [ ] **Step 3: ETA 工具栏加 ↶/↷**(场景行 `+ 新建 ETA` 按钮之后)

```tsx
<button onClick={etHist.undo} disabled={!etHist.canUndo} title="撤销" style={{ fontSize: 12 }}>↶</button>
<button onClick={etHist.redo} disabled={!etHist.canRedo} title="重做" style={{ fontSize: 12 }}>↷</button>
```

- [ ] **Step 4: 构建 + 预览** — `npm run build --prefix frontend`;`preview_eval`:ETA 改一个屏障 failProb(input)→ 点 ↶ → 值还原;↷ → 重做。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/useModel.ts frontend/src/App.tsx
git commit -m "feat(frontend): ETA 事件树 undo/redo(泛化 useHistory<T>)"
```

## Task 2: 故障树 FV 重要度热力着色

**Files:** Modify `frontend/src/components/nodes.tsx`, `frontend/src/components/FaultTreeCanvas.tsx`, `frontend/src/App.tsx`

- [ ] **Step 1: `nodes.tsx` 基本事件按 heat 上色**

加颜色函数 + 改 `BasicEventNode` 圆填充:
```tsx
function heatColor(t: number): string {
  const c = Math.max(0, Math.min(1, t))
  const r = Math.round(22 + c * (220 - 22)), g = Math.round(163 + c * (38 - 163)), b = Math.round(74 + c * (38 - 74))
  return `rgb(${r},${g},${b})`
}
```
`BasicEventNode` 的 `<circle ... fill="#fef3c7" .../>` 改为:
```tsx
<circle cx="65" cy="20" r="17" fill={data.heat != null ? heatColor(data.heat) : '#fef3c7'} stroke="#d97706" strokeWidth="2" />
```

- [ ] **Step 2: `FaultTreeCanvas.tsx` 加 `heat` prop 并下发到 node data**

`Props` 加 `heat?: Record<string, number>`;签名解构加 `heat`;useEffect 内 setNodes 改:
```tsx
setNodes(pNodes.map((n) => ({ ...n, data: { ...n.data, highlighted: hot.has(n.id), heat: heat ? heat[n.id] : undefined } })))
```
依赖数组加 `heat`。

- [ ] **Step 3: `App.tsx` 热力开关 + 传 heat**

state 加 `const [heatOn, setHeatOn] = useState(false)`。helper:
```tsx
function buildHeat(importance: Record<string, { fv: number }>): Record<string, number> {
  const max = Math.max(...Object.values(importance).map((v) => v.fv), 1e-12)
  const h: Record<string, number> = {}
  for (const [k, v] of Object.entries(importance)) h[k] = v.fv / max
  return h
}
```
故障树标签工具栏(量化按钮旁)加开关:
```tsx
<label style={{ fontSize: 12 }}><input type="checkbox" checked={heatOn} onChange={(e) => setHeatOn(e.target.checked)} disabled={!result} /> 重要度热力</label>
```
`FaultTreeCanvas` 调用加:`heat={heatOn && result ? buildHeat(result.importance as any) : undefined}`。

- [ ] **Step 4: 构建 + 预览** — `preview_eval`:故障树标签选 bms_ft → 量化 → 勾「重要度热力」→ 基本事件圆 fill 变(非 `#fef3c7`);取消 → 复原。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/components/nodes.tsx frontend/src/components/FaultTreeCanvas.tsx frontend/src/App.tsx
git commit -m "feat(frontend): 故障树基本事件按 FV 重要度热力着色(可开关)"
```

## Task 3: 事件树图 PNG/SVG 导出

**Files:** Modify `frontend/src/components/EventTreeEditor.tsx`

- [ ] **Step 1: 加导出处理 + 两按钮**

在 `onExport` 附近加:
```tsx
const onExportImage = async (fmt: 'png' | 'svg') => {
  if (!svgRef.current) return
  let url: string, name = `event_tree.${fmt}`
  if (fmt === 'png') url = await svgToPng(svgRef.current)
  else {
    const xml = new XMLSerializer().serializeToString(svgRef.current)
    url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml' }))
  }
  const a = document.createElement('a'); a.href = url; a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  if (fmt === 'svg') setTimeout(() => URL.revokeObjectURL(url), 1000)
}
```
在「导出报告」行加两按钮:
```tsx
<button onClick={() => onExportImage('png')} style={{ fontSize: 12, border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', padding: '4px 10px' }}>图 PNG</button>
<button onClick={() => onExportImage('svg')} style={{ fontSize: 12, border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', padding: '4px 10px' }}>图 SVG</button>
```

- [ ] **Step 2: 构建 + 预览** — `preview_eval`:点「图 SVG」按钮(或直接调 `onExportImage`)不报错;svg 序列化文本含 `<svg`(可在 eval 中 `new XMLSerializer().serializeToString(document.querySelector('svg'))` 验证)。

- [ ] **Step 3: 提交**

```bash
git add frontend/src/components/EventTreeEditor.tsx
git commit -m "feat(frontend): 事件树图一键导出 PNG/SVG"
```

## Task 4: UI 内 MEF XML 导入

**Files:** Modify `backend/schemas.py`, `backend/app.py`, `frontend/src/api.ts`, `frontend/src/App.tsx`; Test `tests/backend/test_mef_import_api.py`

- [ ] **Step 1: 写失败测试** `tests/backend/test_mef_import_api.py`

```python
from fastapi.testclient import TestClient
from backend.app import app

client = TestClient(app)


def test_mef_import_roundtrip(tmp_path):
    from psaengine.model.pdag import PDAG, Op
    from psaengine.model.parameters import Parameter, ParameterLibrary
    from psaengine.model.fault_tree import FaultTree
    from psaengine.model.model import Model
    from psaengine.model.mef_xml import save_mef_xml
    g = PDAG(); g.basic("a"); g.basic("b"); g.gate("T", Op.OR, ["a", "b"]); g.top = "T"
    lib = ParameterLibrary(); lib.add(Parameter("a", "probability", 0.1)); lib.add(Parameter("b", "probability", 0.2))
    m = Model(parameters=lib, fault_trees={"FT": FaultTree("T", g)}, event_trees={}, ccf_groups=[])
    p = tmp_path / "m.xml"; save_mef_xml(m, str(p))
    r = client.post("/api/import/mef", json={"xml": p.read_text(encoding="utf-8")})
    assert r.status_code == 200
    d = r.json()
    assert d["fault_tree"] and d["model"]["fault_trees"]
    ids = [n["id"] for n in d["model"]["fault_trees"][0]["nodes"]]
    assert "a" in ids and "T" in ids


def test_mef_import_bad_xml():
    assert client.post("/api/import/mef", json={"xml": "<not-mef/>"}).status_code in (400, 422, 500)
```

(注:坏 XML 行为容忍 400/500;若想严格 400 可在端点 try/except 包 `load_mef_xml` 抛 HTTPException(400)。)

- [ ] **Step 2: 跑测试确认失败** → 404。

- [ ] **Step 3: `schemas.py` 加** `class MefImportRequest(BaseModel): xml: str`

- [ ] **Step 4: `backend/app.py` 加端点**(`/api/import/mef`)

```python
@app.post("/api/import/mef")
def api_import_mef(req: schemas.MefImportRequest):
    import tempfile, os
    from psaengine.model.mef_xml import load_mef_xml
    from psaengine.model.json_io import fault_tree_to_dict, parameters_to_json
    fd, path = tempfile.mkstemp(suffix=".xml")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(req.xml)
        try:
            model = load_mef_xml(path)
        except Exception as e:
            raise HTTPException(400, f"MEF 解析失败: {e}")
    finally:
        os.remove(path)
    fts = [fault_tree_to_dict(name, ft) for name, ft in model.fault_trees.items()]
    if not fts:
        raise HTTPException(400, "MEF 中无故障树")
    return {"model": {"model_data": {"parameters": parameters_to_json(model.parameters)},
                      "fault_trees": fts, "event_trees": [], "ccf_groups": []},
            "fault_tree": fts[0]["name"]}
```

- [ ] **Step 5: 跑测试 + 全量回归** → PASS(≥130 + 2 新)。

- [ ] **Step 6: `api.ts` 加 `importMef`**

```ts
export async function importMef(xml: string): Promise<{ model: any; fault_tree: string }> {
  const r = await fetch(`${BASE}/import/mef`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ xml }) })
  if (!r.ok) throw new Error(`mef import → ${r.status}`)
  return r.json()
}
```

- [ ] **Step 7: `App.tsx` 故障树标签加「导入 MEF XML」**(import `importMef`;工具栏)

```tsx
<label style={{ fontSize: 12, cursor: 'pointer', border: '1px solid #cbd5e1', borderRadius: 6, padding: '4px 10px' }}>
  导入 MEF
  <input type="file" accept=".xml" style={{ display: 'none' }} onChange={async (e) => {
    const f = e.target.files?.[0]; if (!f) return
    try { const d = await importMef(await f.text()); reset(d.model as ModelJson); setFtName(d.fault_tree); setSelected(null); setResult(null); setError(null) }
    catch (err: any) { setError(String(err?.message ?? err)) }
    e.target.value = ''
  }} />
</label>
```

- [ ] **Step 8: 构建 + 重启预览 + 验证** — `preview_stop`+`preview_start`;`preview_eval`:`fetch('/api/import/mef',{POST, body:{xml: <save_mef_xml 的样例>}})` 返回 200 + model.fault_trees 非空。(前端文件上传交互人工/旁路验证。)

- [ ] **Step 9: 提交**

```bash
git add backend/schemas.py backend/app.py tests/backend/test_mef_import_api.py frontend/src/api.ts frontend/src/App.tsx
git commit -m "feat: UI 内 MEF XML 导入(/api/import/mef 复用 load_mef_xml)"
```

## 收尾

- [ ] 全量回归 `pytest -q`(≥132,CUDD 仍 2 skip)。
- [ ] `npm run build --prefix frontend` 通过;`preview_eval` 端到端(undo/redo·热力·图导出·MEF 导入)。
- [ ] 更新 `docs/superpowers/ROADMAP.md`(E 小项:undo/redo·热力·图导出·MEF 导入完成;剩 拖拽位置持久化)。

## 自检(plan vs spec)

- spec 2.1 undo/redo → Task 1(useHistory + set 支持函数式更新 + load 类用 reset)。
- spec 2.2 热力 → Task 2(nodes heat 着色 + canvas heat prop + App 开关;importance=`{event:{fv}}`)。
- spec 2.3 图导出 → Task 3(svgToPng/序列化)。
- spec 2.4 MEF 导入 → Task 4(端点 + 测试 + 前端文件上传;load_mef_xml 经临时文件)。
- 类型一致:`useHistory/etHist`、`heat`/`buildHeat`/`heatColor`、`onExportImage`、`importMef`/`MefImportRequest` 跨任务一致。
- 坑:`etHist.set` 支持值或更新函数(onFtEdited);load 类清历史用 `reset`;改后端(Task4)须重启预览。
