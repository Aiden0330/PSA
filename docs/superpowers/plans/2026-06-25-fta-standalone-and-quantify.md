# FTA Standalone Workspace + Quantify-All-Targets — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Frontend code changes MUST go through the project's `frontend-dev` subagent; `test-runner` runs vitest; `code-reviewer` reviews the diff.

**Goal:** (1) Make the 量化 button + results available for ALL FTA targets (example / ETA-mounted / standalone), not just example models; (2) add a "新增 FTA" button that creates standalone fault trees in a user workspace, listed in a sidebar group, persisted in the project file.

**Architecture:** Frontend-only. Two new pure functions in `model.ts` (`addFaultTree`/`deleteFaultTree`); a `userFts?: ModelJson` field added to the project payload (`project.ts`); App holds a `userFts` model, adds a `'standalone'` FTA edit target, routes `cv*` three ways, generalizes `onQuantify`/`onCutsetClick` to the active `cvModel`/`cvFtName`, and wires save/load. Engine/MEF/backend contract unchanged.

**Tech Stack:** React 18, TypeScript (strict, `import type`), Vite 5, vitest 2. Tests: `npm run test --prefix frontend`. Build: `npm run build --prefix frontend`. Rebuild offline single file: `npm run bundle --prefix frontend`. End commit bodies with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `frontend/src/model.ts` | modify | `addFaultTree(m,name)` / `deleteFaultTree(m,name)`. |
| `frontend/src/model.test.ts` | modify | vitest for the two new fns. |
| `frontend/src/project.ts` | modify | `ProjectPayload.userFts` + serialize/deserialize. |
| `frontend/src/project.test.ts` | modify | `userFts` round-trip. |
| `frontend/src/App.tsx` | modify | `userFts` state + `'standalone'` target + cv* routing; `onAddFt`/`onDeleteFt` + sidebar; quantify generalization; save/load wiring. |
| `docs/superpowers/ROADMAP.md` | modify | Record the change. |

---

## Task 1: `model.ts` — `addFaultTree` / `deleteFaultTree` (TDD)

**Files:** Modify `frontend/src/model.ts`; Modify `frontend/src/model.test.ts`.

Context: `ModelJson = { model_data:{parameters:ParamJson[]}, fault_trees:FaultTreeJson[] }`. `FaultTreeJson = { name, top, nodes:FtNodeJson[] }`. The file already has local `const clone` and exported `uid(prefix)`. A standalone tree = an OR gate (the `top`) + one basic event + its probability parameter, mirroring `attachStarterFt` but with a user-chosen `name` and clean `uid` node ids.

- [ ] **Step 1: Add failing tests** — append to `frontend/src/model.test.ts`:

```ts
import { addFaultTree, deleteFaultTree } from './model'
import type { ModelJson } from './model'

const emptyM = (): ModelJson => ({ model_data: { parameters: [] }, fault_trees: [] })

describe('addFaultTree / deleteFaultTree', () => {
  it('addFaultTree 追加起始树(OR 门 top + 基本事件 + 参数)', () => {
    const m = addFaultTree(emptyM(), '我的树')
    expect(m.fault_trees).toHaveLength(1)
    const ft = m.fault_trees[0]
    expect(ft.name).toBe('我的树')
    expect(ft.nodes.find((n) => n.id === ft.top)!.op).toBe('or')
    expect(ft.nodes.some((n) => n.basic)).toBe(true)
    expect(m.model_data.parameters).toHaveLength(1)
  })
  it('addFaultTree name 去重(A → A_2)', () => {
    const m = addFaultTree(addFaultTree(emptyM(), 'A'), 'A')
    expect(m.fault_trees.map((f) => f.name)).toEqual(['A', 'A_2'])
  })
  it('addFaultTree 不改原对象', () => {
    const m0 = emptyM(); addFaultTree(m0, 'A'); expect(m0.fault_trees).toHaveLength(0)
  })
  it('deleteFaultTree 移除指定树 + 清理独占参数', () => {
    const m = deleteFaultTree(addFaultTree(emptyM(), 'A'), 'A')
    expect(m.fault_trees).toHaveLength(0)
    expect(m.model_data.parameters).toHaveLength(0)
  })
  it('deleteFaultTree 保留被其他树引用的共享参数', () => {
    const m0: ModelJson = {
      model_data: { parameters: [{ id: 'SH', kind: 'probability', value: 0.1 }] },
      fault_trees: [
        { name: 'A', top: 'GA', nodes: [{ id: 'SH', basic: true, param_ref: 'SH' }, { id: 'GA', op: 'or', args: ['SH'] }] },
        { name: 'B', top: 'GB', nodes: [{ id: 'SH', basic: true, param_ref: 'SH' }, { id: 'GB', op: 'or', args: ['SH'] }] },
      ],
    }
    const m = deleteFaultTree(m0, 'A')
    expect(m.fault_trees.map((f) => f.name)).toEqual(['B'])
    expect(m.model_data.parameters.map((p) => p.id)).toEqual(['SH'])
  })
  it('deleteFaultTree 删不存在 → 返回原对象', () => {
    const m = emptyM(); expect(deleteFaultTree(m, 'X')).toBe(m)
  })
})
```

- [ ] **Step 2: Run, verify FAIL.** `npm run test --prefix frontend`.

- [ ] **Step 3: Implement** — append to `frontend/src/model.ts`:

```ts
/** 追加一棵起始故障树(OR 门 top + 1 基本事件 + 概率参数);name 去空格 + 唯一化(name/name_2…);节点 id 用 uid。 */
export function addFaultTree(m: ModelJson, name: string): ModelJson {
  const nm = clone(m)
  const base = (name ?? '').trim() || '新建 FTA'
  const taken = nm.fault_trees.map((f) => f.name)
  let nmName = base, i = 2
  while (taken.includes(nmName)) { nmName = `${base}_${i}`; i++ }
  const gid = uid('G'), bid = uid('BE')
  nm.fault_trees.push({ name: nmName, top: gid, nodes: [
    { id: bid, basic: true, param_ref: bid },
    { id: gid, op: 'or', args: [bid] },
  ] })
  nm.model_data.parameters.push({ id: bid, kind: 'probability', value: 0.1 })
  return nm
}

/** 按 name 删除一棵故障树;清理仅被它引用的参数(被其他树引用的保留)。删不存在 → 原对象。 */
export function deleteFaultTree(m: ModelJson, name: string): ModelJson {
  const ft = m.fault_trees.find((f) => f.name === name)
  if (!ft) return m
  const nm = clone(m)
  nm.fault_trees = nm.fault_trees.filter((f) => f.name !== name)
  const others = new Set<string>()
  for (const f of nm.fault_trees) for (const n of f.nodes) if (n.param_ref) others.add(n.param_ref)
  const removed = ft.nodes.filter((n) => n.param_ref).map((n) => n.param_ref as string)
  nm.model_data.parameters = nm.model_data.parameters.filter((p) => !removed.includes(p.id) || others.has(p.id))
  return nm
}
```

- [ ] **Step 4: Run, verify PASS.** `npm run test --prefix frontend` (6 new green). `npm run build --prefix frontend` (tsc clean).

- [ ] **Step 5: Commit.**
```bash
git add frontend/src/model.ts frontend/src/model.test.ts
git commit -m "feat(fta): addFaultTree/deleteFaultTree(自建故障树纯函数) + vitest"
```

---

## Task 2: `project.ts` — `userFts` in payload (TDD)

**Files:** Modify `frontend/src/project.ts`; Modify `frontend/src/project.test.ts`.

Context: `ProjectPayload` (v2) currently `{ v:2, etas, activeKey, checkedKeys }`; `serializeProject(etas, activeKey, checkedKeys)`; `deserializeProject(payload, fallbackName)`. Add optional `userFts?: ModelJson` (standalone fault-tree workspace). Backward compatible: old payloads have no `userFts` → `deserialize` returns `undefined` (the App caller defaults to empty).

- [ ] **Step 1: Add failing tests** — append a new `describe` to `frontend/src/project.test.ts` (it already imports `serializeProject`/`deserializeProject` and has the `mkEta` helper; add a `ModelJson` import at the top: `import type { ModelJson } from './model'`):

```ts
describe('project userFts 字段', () => {
  const uf: ModelJson = {
    model_data: { parameters: [{ id: 'X', kind: 'probability', value: 0.2 }] },
    fault_trees: [{ name: 'T', top: 'G', nodes: [{ id: 'G', op: 'or', args: ['X'] }, { id: 'X', basic: true, param_ref: 'X' }] }],
  }
  it('userFts 往返保留', () => {
    const got = deserializeProject(serializeProject([mkEta('a', 'A')], 'a', { a: true }, uf), 'x')
    expect(got.userFts?.fault_trees.map((f) => f.name)).toEqual(['T'])
  })
  it('不传 userFts → payload 无该键', () => {
    expect('userFts' in serializeProject([mkEta('a', 'A')], 'a', { a: true })).toBe(false)
  })
  it('旧 payload 缺 userFts → deserialize 得 undefined', () => {
    const got = deserializeProject({ v: 2, etas: [mkEta('a', 'A')], activeKey: 'a', checkedKeys: { a: true } }, 'x')
    expect(got.userFts).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run, verify FAIL.** `npm run test --prefix frontend` (the `serializeProject(...4 args)` call won't typecheck → build/test fails; that's the red).

- [ ] **Step 3: Implement** in `frontend/src/project.ts`:
  - Add to `interface ProjectPayload` (after `checkedKeys`):
```ts
  checkedKeys: Record<string, boolean>
  userFts?: ModelJson
```
  - Change `serializeProject` signature + return to thread `userFts`:
```ts
export function serializeProject(
  etas: ProjectEta[],
  activeKey: string,
  checkedKeys: Record<string, boolean>,
  userFts?: ModelJson,
): ProjectPayload {
  return {
    v: 2,
    etas: etas.map((e) => ({
      key: e.key,
      name: e.name,
      renamed: e.renamed,
      model: e.model,
      fts: e.fts ?? EMPTY_FTS,
      pfds: e.pfds ?? {},
    })),
    activeKey,
    checkedKeys: { ...checkedKeys },
    ...(userFts ? { userFts } : {}),
  }
}
```
  - In `deserializeProject` **v2 branch**, change the return to carry `userFts`:
```ts
    return {
      v: 2, etas, activeKey, checkedKeys,
      userFts: (p.userFts && typeof p.userFts === 'object' && Array.isArray((p.userFts as { fault_trees?: unknown }).fault_trees))
        ? (p.userFts as ModelJson) : undefined,
    }
```
  (The legacy single-ETA branch is unchanged — it returns no `userFts`, i.e. `undefined`.)

- [ ] **Step 4: Run, verify PASS.** `npm run test --prefix frontend` (3 new + existing green). `npm run build --prefix frontend` (tsc clean).

- [ ] **Step 5: Commit.**
```bash
git add frontend/src/project.ts frontend/src/project.test.ts
git commit -m "feat(project): ProjectPayload.userFts(自建 FTA 工作区)持久化 + vitest"
```

---

## Task 3: App.tsx — `userFts` state + `'standalone'` target + cv* routing

**Files:** Modify `frontend/src/App.tsx`. Depends on Tasks 1-2.

Read the file first. State is at ~L44-75; `ftEditTarget` at L70; cv* block at L321-353; `cvTreeExists`/`cvGraph` at L377-379. `EMPTY_FTS` is a module const (already used). `useModel` returns `{ model, set, reset, undo, redo, canUndo, canRedo }`.

- [ ] **Step 1: Imports.** Add `addFaultTree, deleteFaultTree` to the existing `from './model'` import (the line importing `addGate, addBasic, …, renameNode`).

- [ ] **Step 2: `userFts` state.** After `const etFts = useModel(null)` (~L49) add:
```ts
  const userFts = useModel(EMPTY_FTS)             // 自建独立故障树工作区(一份模型多棵树)
```

- [ ] **Step 3: `ftEditTarget` gains a standalone variant.** Change (L70):
```ts
  const [ftEditTarget, setFtEditTarget] = useState<{ src: 'model' } | { src: 'eta'; name: string } | { src: 'standalone'; name: string }>({ src: 'model' })
```

- [ ] **Step 4: cv* three-way routing.** Replace the block at L322-325:
```ts
  const ftIsEta = ftEditTarget.src === 'eta'
  const ftEtaName = ftIsEta ? (ftEditTarget as { src: 'eta'; name: string }).name : ''
  const cvModel  = ftIsEta ? (etFts.model ?? EMPTY_FTS) : model
  const cvFtName = ftIsEta ? ftEtaName : ftName
```
with:
```ts
  const ftIsEta = ftEditTarget.src === 'eta'
  const ftIsStandalone = ftEditTarget.src === 'standalone'
  const ftEtaName = ftIsEta ? (ftEditTarget as { src: 'eta'; name: string }).name : ''
  const ftStandaloneName = ftIsStandalone ? (ftEditTarget as { src: 'standalone'; name: string }).name : ''
  const cvModel  = ftIsStandalone ? (userFts.model ?? EMPTY_FTS) : ftIsEta ? (etFts.model ?? EMPTY_FTS) : model
  const cvFtName = ftIsStandalone ? ftStandaloneName : ftIsEta ? ftEtaName : ftName
```
Then replace the `cvSet`…`cvCanRedo` block (L349-353):
```ts
  const cvSet     = ftIsEta ? etaSet : set
  const cvUndo    = ftIsEta ? etFts.undo : undo
  const cvRedo    = ftIsEta ? etFts.redo : redo
  const cvCanUndo = ftIsEta ? etFts.canUndo : canUndo
  const cvCanRedo = ftIsEta ? etFts.canRedo : canRedo
```
with:
```ts
  const cvSet     = ftIsStandalone ? userFts.set : ftIsEta ? etaSet : set
  const cvUndo    = ftIsStandalone ? userFts.undo : ftIsEta ? etFts.undo : undo
  const cvRedo    = ftIsStandalone ? userFts.redo : ftIsEta ? etFts.redo : redo
  const cvCanUndo = ftIsStandalone ? userFts.canUndo : ftIsEta ? etFts.canUndo : canUndo
  const cvCanRedo = ftIsStandalone ? userFts.canRedo : ftIsEta ? etFts.canRedo : canRedo
```

- [ ] **Step 5: `cvTreeExists` / `cvGraph` handle standalone.** Replace (L377-379):
```ts
  const cvTreeExists = ftIsEta ? !!(cvModel?.fault_trees?.some((f: any) => f.name === cvFtName)) : !!cvModel
  const cvGraph = cvTreeExists
    ? layoutFaultTree(cvModel!, cvFtName, ftIsEta ? undefined : ftPos[cvFtName])
```
with:
```ts
  const cvTreeExists = (ftIsEta || ftIsStandalone) ? !!(cvModel?.fault_trees?.some((f: any) => f.name === cvFtName)) : !!cvModel
  const cvGraph = cvTreeExists
    ? layoutFaultTree(cvModel!, cvFtName, (ftIsEta || ftIsStandalone) ? undefined : ftPos[cvFtName])
```

- [ ] **Step 6: Verify.** `npm run build --prefix frontend` (tsc clean). `npm run test --prefix frontend` (green). (No visible change yet — standalone unreachable until Task 4.)

- [ ] **Step 7: Commit.**
```bash
git add frontend/src/App.tsx
git commit -m "feat(fta): userFts 状态 + standalone 编辑目标 + cv* 三路由"
```

---

## Task 4: App.tsx — 新增/删除 FTA + 自建 FTA 侧栏分组

**Files:** Modify `frontend/src/App.tsx`. Depends on Task 3.

The FTA sidebar is at ~L410-444 (the `ETA 挂载 FTA` group + `示例模型` group). `ftSidebarGroup`/`ftSidebarRow`/`ftSidebarEmpty` styles and the `Icon` component already exist.

- [ ] **Step 1: Add `onAddFt` / `onDeleteFt`.** Add near `onDeleteSaved` (~after L260):
```ts
  const onAddFt = () => {
    const n = (userFts.model?.fault_trees.length ?? 0) + 1
    const name = window.prompt('新建 FTA 名称', '我的故障树 ' + n)
    if (!name || !name.trim()) return
    const m2 = addFaultTree(userFts.model ?? EMPTY_FTS, name.trim())
    userFts.set(m2)
    const created = m2.fault_trees[m2.fault_trees.length - 1].name
    setFtEditTarget({ src: 'standalone', name: created }); setSelected(null); setResult(null); setError(null)
  }
  const onDeleteFt = (name: string) => {
    if (!window.confirm(`删除自建 FTA「${name}」?`)) return
    userFts.set(deleteFaultTree(userFts.model ?? EMPTY_FTS, name))
    if (ftEditTarget.src === 'standalone' && ftEditTarget.name === name) { setFtEditTarget({ src: 'model' }); setSelected(null); setResult(null) }
  }
```

- [ ] **Step 2: Add the 自建 FTA sidebar group.** Find the end of the 示例模型 block in the FTA sidebar:
```tsx
            <div style={{ ...ftSidebarGroup, marginTop: 10 }}>示例模型</div>
            {examples.map((e) => (
              <div key={e.id}
                style={ftSidebarRow(!ftIsEta && current === e.id)}
                onClick={() => { setCurrent(e.id); setFtEditTarget({ src: 'model' }); setSelected(null); setResult(null); setError(null) }}
                title={e.name}
              >
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</span>
              </div>
            ))}
          </div>
```
Replace it with (same example block, then a new 自建 FTA group before the sidebar's closing `</div>`):
```tsx
            <div style={{ ...ftSidebarGroup, marginTop: 10 }}>示例模型</div>
            {examples.map((e) => (
              <div key={e.id}
                style={ftSidebarRow(!ftIsEta && !ftIsStandalone && current === e.id)}
                onClick={() => { setCurrent(e.id); setFtEditTarget({ src: 'model' }); setSelected(null); setResult(null); setError(null) }}
                title={e.name}
              >
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</span>
              </div>
            ))}
            <div style={{ ...ftSidebarGroup, marginTop: 10 }}>自建 FTA</div>
            <button onClick={onAddFt} className="psa-btn" style={{ margin: '4px 10px', width: 'calc(100% - 20px)', justifyContent: 'center', fontSize: 12 }}><Icon name="plus" size={13} />新增 FTA</button>
            {(userFts.model?.fault_trees ?? []).map((ft) => (
              <div key={'u:' + ft.name}
                style={{ ...ftSidebarRow(ftIsStandalone && ftStandaloneName === ft.name), flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
                onClick={() => { setFtEditTarget({ src: 'standalone', name: ft.name }); setSelected(null); setResult(null); setError(null) }}
                title={ft.name}
              >
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ft.name}</span>
                <span onClick={(e) => { e.stopPropagation(); onDeleteFt(ft.name) }} title="删除" style={{ color: 'var(--psa-faint)', fontSize: 13, flexShrink: 0, paddingLeft: 6 }}>✕</span>
              </div>
            ))}
          </div>
```
(If the `Icon` set has no `plus` glyph, use the text `＋` instead: replace `<Icon name="plus" size={13} />新增 FTA` with `＋ 新增 FTA`. Check `frontend/src/components/icons.tsx` first.)

- [ ] **Step 3: Verify.** `npm run build --prefix frontend` (tsc clean). `npm run test --prefix frontend` (green). Controller preview-DOM: the FTA sidebar shows a 自建 FTA group with a 新增 FTA button; clicking it prompts a name and creates an editable tree selected as the standalone target; the ✕ deletes it.

- [ ] **Step 4: Commit.**
```bash
git add frontend/src/App.tsx
git commit -m "feat(fta): 新增/删除 FTA + 自建 FTA 侧栏分组"
```

---

## Task 5: App.tsx — quantify + results for all FTA targets

**Files:** Modify `frontend/src/App.tsx`. Depends on Task 3.

Currently `onCutsetClick`/`onQuantify` (L92-101) are defined **before** the cv* block and hardcode `model`/`ftName`; the 量化 button (L494-500) and the results panel (L542-551) are gated by `!ftIsEta`.

- [ ] **Step 1: Relocate + generalize `onCutsetClick`/`onQuantify`.** Delete the existing definitions (L92-101):
```ts
  const onCutsetClick = (events: string[]) => {
    if (model) setHighlight(activatedNodes(getFt(model, ftName), new Set(events)))
  }
  const onQuantify = async () => {
    if (!model) return
    setBusy(true); setError(null)
    try { setResult(await quantify(model, ftName)) }
    catch (e: any) { setError(String(e?.message ?? e)); setResult(null) }
    finally { setBusy(false) }
  }
```
and add them back **after** the `cvGraph` definition (~after L379), using the active target:
```ts
  const onCutsetClick = (events: string[]) => {
    if (cvModel) setHighlight(activatedNodes(getFt(cvModel, cvFtName), new Set(events)))
  }
  const onQuantify = async () => {
    if (!cvModel || !cvTreeExists) return
    setBusy(true); setError(null)
    try { setResult(await quantify(cvModel, cvFtName)) }
    catch (e: any) { setError(String(e?.message ?? e)); setResult(null) }
    finally { setBusy(false) }
  }
```

- [ ] **Step 2: Toolbar — 量化 + 热力 for all; 重置布局 only for example.** Find (L494-500):
```tsx
              {!ftIsEta && (
                <>
                  <button onClick={onQuantify} disabled={busy || !model} className="psa-btn psa-btn--dark"><Icon name="bolt" size={14} />{busy ? '计算中…' : '量化'}</button>
                  <label style={{ fontSize: 12 }} title="按基本事件 FV 着色"><input type="checkbox" checked={heatOn} onChange={(e) => setHeatOn(e.target.checked)} disabled={!result} /> 重要度热力</label>
                  <button onClick={() => setFtPos((m) => ({ ...m, [ftName]: {} }))} className="psa-btn" title="重置自动布局"><Icon name="arrow-up" size={13} />重置布局</button>
                </>
              )}
```
Replace with:
```tsx
              <button onClick={onQuantify} disabled={busy || !cvTreeExists} className="psa-btn psa-btn--dark"><Icon name="bolt" size={14} />{busy ? '计算中…' : '量化'}</button>
              <label style={{ fontSize: 12 }} title="按基本事件 FV 着色"><input type="checkbox" checked={heatOn} onChange={(e) => setHeatOn(e.target.checked)} disabled={!result} /> 重要度热力</label>
              {!ftIsEta && !ftIsStandalone && (
                <button onClick={() => setFtPos((m) => ({ ...m, [ftName]: {} }))} className="psa-btn" title="重置自动布局"><Icon name="arrow-up" size={13} />重置布局</button>
              )}
```

- [ ] **Step 3: Canvas — enable highlight/heat for all; drag-persist only for example.** Find (the `FaultTreeCanvas` props, L508-517):
```tsx
                  highlight={ftIsEta ? new Set<string>() : highlight}
                  heat={!ftIsEta && heatOn && result ? buildHeat(result.importance as any) : undefined}
```
Replace with:
```tsx
                  highlight={highlight}
                  heat={heatOn && result ? buildHeat(result.importance as any) : undefined}
```
Then find:
```tsx
                  onNodeDragStop={!ftIsEta ? (id, x, y) => setFtPos((m) => ({ ...m, [ftName]: { ...(m[ftName] ?? {}), [id]: { x, y } } })) : undefined}
```
Replace with:
```tsx
                  onNodeDragStop={(!ftIsEta && !ftIsStandalone) ? (id, x, y) => setFtPos((m) => ({ ...m, [ftName]: { ...(m[ftName] ?? {}), [id]: { x, y } } })) : undefined}
```

- [ ] **Step 4: Results panel for all targets.** Find (L542-551):
```tsx
            {!ftIsEta && (
              <div>
                <div className="psa-ch"><span className="t">量化结果</span></div>
                {error && <div style={{ margin: 14, padding: 10, background: 'var(--psa-danger-soft)', color: 'var(--psa-danger-strong)', borderRadius: 6, fontSize: 12 }}>量化失败:{error}</div>}
                <ResultsPanel result={result} onCutsetClick={onCutsetClick} />
              </div>
            )}
            {ftIsEta && error && (
              <div style={{ margin: 14, padding: 10, background: 'var(--psa-danger-soft)', color: 'var(--psa-danger-strong)', borderRadius: 6, fontSize: 12 }}>错误:{error}</div>
            )}
```
Replace with (single results block for all targets):
```tsx
            <div>
              <div className="psa-ch"><span className="t">量化结果</span></div>
              {error && <div style={{ margin: 14, padding: 10, background: 'var(--psa-danger-soft)', color: 'var(--psa-danger-strong)', borderRadius: 6, fontSize: 12 }}>量化失败:{error}</div>}
              <ResultsPanel result={result} onCutsetClick={onCutsetClick} />
            </div>
```

- [ ] **Step 5: Verify.** `npm run build --prefix frontend` (tsc clean). `npm run test --prefix frontend` (green). Controller preview-DOM: select an ETA-mounted FTA → 量化 button present → click → results (cutsets / importance) show; same for a standalone FTA.

- [ ] **Step 6: Commit.**
```bash
git add frontend/src/App.tsx
git commit -m "feat(fta): 量化按钮+结果面板对所有 FTA 目标开放(onQuantify 走 cvModel/cvFtName)"
```

---

## Task 6: App.tsx — persist `userFts` in save / load / file

**Files:** Modify `frontend/src/App.tsx`. Depends on Tasks 2-3.

`serializeProject` is called in `onSaveWorkspace` (L189), `onSaveAs` (L210), `onExportFile` (L236); restore happens in `loadProject` (L219-230) and `onImportFile` (L246-254).

- [ ] **Step 1: Pass `userFts` to all three `serializeProject` calls.** In each, append `, userFts.model ?? EMPTY_FTS` as the 4th argument:
  - L189: `const payload = serializeProject(snapshotActive(etaTabs), activeKey, checkedKeys, userFts.model ?? EMPTY_FTS)`
  - L210: `const rec = await saveWorkspace(name, serializeProject(snapshotActive(etaTabs), activeKey, checkedKeys, userFts.model ?? EMPTY_FTS))`
  - L236: `const payload = serializeProject(snapshotActive(etaTabs), activeKey, checkedKeys, userFts.model ?? EMPTY_FTS)`

- [ ] **Step 2: Restore `userFts` on load + import.** In `loadProject`, after `loadIntoActive(...)` (~L230) add:
```ts
      userFts.reset(proj.userFts ?? EMPTY_FTS)
```
In `onImportFile`, after `loadIntoActive(...)` (~L254) add the same line:
```ts
      userFts.reset(proj.userFts ?? EMPTY_FTS)
```

- [ ] **Step 3: Verify.** `npm run build --prefix frontend` (tsc clean). `npm run test --prefix frontend` (green). Controller preview-DOM: create a standalone FTA → 导出文件 → reload → 导入文件 → the standalone FTA is restored in the 自建 FTA group.

- [ ] **Step 4: Commit.**
```bash
git add frontend/src/App.tsx
git commit -m "feat(fta): 自建 FTA 随项目保存/读取/导出导入持久化"
```

---

## Task 7: Regression + rebuild standalone + docs

**Files:** Rebuild `bess-eta-standalone.html`; Modify `docs/superpowers/ROADMAP.md`.

- [ ] **Step 1: Full regression.**
  - `npm run test --prefix frontend` → all vitest green (incl. Task 1: 6, Task 2: 3 new).
  - `npm run build --prefix frontend` → clean.
  - `.venv/Scripts/python.exe -m pytest -q` → backend unchanged.
- [ ] **Step 2: Rebuild offline single file.** `npm run bundle --prefix frontend`.
- [ ] **Step 3: Smoke-check (preview).** Controller (servers on :5173/:8000): (a) ETA-mounted FTA → 量化 → results; (b) 新增 FTA → edit → 量化 → results; (c) delete standalone FTA; (d) export → import project → standalone FTA restored.
- [ ] **Step 4: Docs.** Add a bullet to `docs/superpowers/ROADMAP.md` (frontend section, after the latest entry): "FTA 自建工作区 + 全目标量化(2026-06-25,分支 feat/fta-standalone-and-quantify):① 量化按钮+结果(割集/FV重要度/热力)对示例/ETA挂载/自建全开放(`onQuantify`/`onCutsetClick` 走活动 `cvModel`/`cvFtName`);② 自建 FTA 工作区(`userFts` 一份模型多棵树,`model.ts::addFaultTree`/`deleteFaultTree`,侧栏「自建 FTA」分组 + 新增/✕,`ftEditTarget` 增 `standalone` + cv* 三路由)+ 存入项目文件(`ProjectPayload.userFts`)。不改 id/引擎/MEF。重建 bess-eta-standalone.html。spec/plan docs/superpowers/{specs,plans}/2026-06-25-fta-standalone-and-quantify*"
- [ ] **Step 5: Commit.**
```bash
git add docs/superpowers/ROADMAP.md
git commit -m "chore(fta): ROADMAP 记录 自建 FTA + 全目标量化(离线单文件已重建)"
```

---

## Self-Review

**Spec coverage:**
- §2.1 quantify-all-targets (`onQuantify`/`onCutsetClick` → `cvModel`/`cvFtName`, relocate; 量化+热力+results for all; 重置布局/drag only example) → Task 5. ✓
- §2.2 standalone workspace: `addFaultTree`/`deleteFaultTree` → Task 1; `userFts` state + `'standalone'` target + cv* routing → Task 3; `onAddFt`/`onDeleteFt` + 自建 FTA sidebar → Task 4. ✓
- §2.3 persistence (`ProjectPayload.userFts` + serialize/deserialize; App save/load/import wiring; `projectFile.ts` untouched) → Task 2 + Task 6. ✓
- §3 compatibility (id/feId stable, engine/MEF/backend unchanged; old payload → `userFts` undefined → empty) → Tasks 1-2-6. ✓
- §4 tests (model.ts 6, project.ts 3 vitest; UI via preview) → Tasks 1,2 + Task 4/5/6 Step "Verify" + Task 7 Step 3. ✓
- §6 build order → Tasks 1→2→3→4→5→6→7. ✓

**Placeholder scan:** Tasks 1-2 complete fns + tests. Tasks 3-6 exact find/replace blocks with full code. Task 7 exact commands. No TBD/TODO. ✓

**Type consistency:** `addFaultTree(m,name)`/`deleteFaultTree(m,name)` signatures match Task 1 (def+tests), Task 4 (callers). `serializeProject(…, userFts?)` / `ProjectPayload.userFts?: ModelJson` match Task 2 (def+tests) and Task 6 (callers passing `userFts.model ?? EMPTY_FTS`) + `proj.userFts` consumer. `ftIsStandalone`/`ftStandaloneName` defined Task 3, used Tasks 4-5. `userFts` (`useModel`) — `.model/.set/.reset/.undo/.redo/.canUndo/.canRedo` used consistently. `cvModel`/`cvFtName`/`cvTreeExists` are the existing derived names. ✓
