# 多 ETA 汇总到风险矩阵 + 故障树拖拽位置持久化 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A) 勾选多个 ETA 把 C1–C5 频率按类求和汇总到一张风险矩阵 + 贡献表;B) 故障树手动拖拽节点位置会话内持久化(结构编辑不被 dagre 覆盖)。

**Architecture:** 纯前端。A 复用 `RiskMatrix`,App 给每个 ETA 造 `resolve()` 闭包取后果,`MultiEtaAggregate` 自管勾选+求和。B `layoutFaultTree` 加位置覆盖 + `FaultTreeCanvas onNodeDragStop` + App `ftPos` 会话 map。

**Tech Stack:** React + TypeScript。后端无改动。

**验证:** 前端 `npm run build --prefix frontend` + `preview_eval`(后端未改,无需重启)。一项一 commit,结尾 `Co-Authored-By: Claude Opus 4.8`。

---

## Task A: 多 ETA 汇总到风险矩阵

**Files:** Create `frontend/src/components/MultiEtaAggregate.tsx`; Modify `frontend/src/App.tsx`

- [ ] **Step 1: 写 `components/MultiEtaAggregate.tsx`**

```tsx
import { useState } from 'react'
import type { CSSProperties } from 'react'
import { RiskMatrix } from './RiskMatrix'

const CONS = ['C1', 'C2', 'C3', 'C4', 'C5']
export interface EtaRef { key: string; name: string; resolve: () => Promise<Record<string, number>> }
const cell: CSSProperties = { border: '1px solid #e2e8f0', padding: '2px 6px', fontSize: 11 }

export function MultiEtaAggregate({ etas }: { etas: EtaRef[] }) {
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [totals, setTotals] = useState<Record<string, number>>({})
  const [rows, setRows] = useState<{ name: string; cons: Record<string, number> }[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const recompute = async (keys: Set<string>) => {
    setBusy(true); setErr(null)
    try {
      const chosen = etas.filter((e) => keys.has(e.key))
      const results = await Promise.all(chosen.map((e) => e.resolve()))
      const t: Record<string, number> = {}
      const rs: { name: string; cons: Record<string, number> }[] = []
      chosen.forEach((e, i) => {
        const c = results[i] || {}
        rs.push({ name: e.name, cons: c })
        for (const k of CONS) t[k] = (t[k] || 0) + (c[k] || 0)
      })
      setTotals(t); setRows(rs)
    } catch (e: any) { setErr(String(e?.message ?? e)) }
    finally { setBusy(false) }
  }
  const toggle = (key: string) => {
    const next = new Set(sel)
    if (next.has(key)) next.delete(key); else next.add(key)
    setSel(next); recompute(next)
  }

  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <div style={{ minWidth: 210 }}>
        <div style={{ fontSize: 12, color: '#475569', marginBottom: 4 }}>勾选要汇总的 ETA{busy ? '(计算中…)' : ''}</div>
        {etas.map((e) => (
          <label key={e.key} style={{ display: 'block', fontSize: 12, marginBottom: 2 }}>
            <input type="checkbox" checked={sel.has(e.key)} onChange={() => toggle(e.key)} /> {e.name}
          </label>
        ))}
        {err && <div style={{ color: '#b91c1c', fontSize: 11 }}>失败:{err}</div>}
      </div>
      <div>
        <RiskMatrix totals={totals} />
        {rows.length > 0 && (
          <table style={{ borderCollapse: 'collapse', marginTop: 8 }}>
            <thead><tr>{['ETA', ...CONS].map((h) => <th key={h} style={cell}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}><td style={cell}>{r.name}</td>{CONS.map((c) => <td key={c} style={cell}>{(r.cons[c] || 0).toExponential(1)}</td>)}</tr>
              ))}
              <tr><td style={{ ...cell, fontWeight: 700 }}>合计</td>{CONS.map((c) => <td key={c} style={{ ...cell, fontWeight: 700 }}>{(totals[c] || 0).toExponential(1)}</td>)}</tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: `App.tsx` import + 构建 `aggEtas`**

import 加:`import { MultiEtaAggregate } from './components/MultiEtaAggregate'`;在已有 api import 行加 `quantifyEventTree`;`import { ..., toEngineRequest } from './eventtree'`(现有 eventtree import 行加 `toEngineRequest`)。

在组件内(`onFtEdited` 之后、return 之前)构建:
```tsx
const aggEtas = useMemo(() => {
  const list: { key: string; name: string; resolve: () => Promise<Record<string, number>> }[] = []
  list.push({ key: 'default', name: '默认热失控级联', resolve: () => getBessEventTree().then((d) => d.consequences) })
  for (const s of scenarios) list.push({ key: 'scenario:' + s.id, name: s.name, resolve: () => getBessEventTree(s.id).then((d) => d.consequences) })
  for (const c of customEtas) list.push({ key: 'custom:' + c.id, name: c.name + '(自定义)', resolve: async () => (await quantifyEventTree(toEngineRequest(c.model))).consequences })
  for (const sv of saved) list.push({ key: 'saved:' + sv.id, name: sv.name + '(存档)', resolve: async () => { const r = await loadSaved(sv.id); return (await quantifyEventTree(toEngineRequest(r.payload.etModel, { fault_trees: r.payload.fts.fault_trees, parameters: r.payload.fts.model_data.parameters }))).consequences } })
  return list
}, [scenarios, customEtas, saved])
```

- [ ] **Step 3: `App.tsx` ETA 标签加可折叠汇总面板**(在 `<h3>BESS 事件树(ETA · 可编辑)</h3>` 之后)

```tsx
<details style={{ marginBottom: 10, border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', padding: '6px 10px' }}>
  <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>多 ETA 汇总(把所选 ETA 后果频率求和到一张风险矩阵)</summary>
  <div style={{ marginTop: 10 }}><MultiEtaAggregate etas={aggEtas} /></div>
</details>
```

- [ ] **Step 4: 构建 + 预览** — `npm run build --prefix frontend`;`preview_eval`:进 ETA,展开 `<details>`(`details.open=true`),勾选 2 个 ETA 的 checkbox(dispatch change),等待 → 出现风险矩阵(table td≈25)+ 明细表含「合计」行,且合计列=各行之和(取一列核对)。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/components/MultiEtaAggregate.tsx frontend/src/App.tsx
git commit -m "feat(frontend): 多 ETA 后果频率求和汇总到风险矩阵 + 贡献明细表"
```

## Task B: 故障树拖拽位置持久化(会话内)

**Files:** Modify `frontend/src/layout.ts`, `frontend/src/components/FaultTreeCanvas.tsx`, `frontend/src/App.tsx`

- [ ] **Step 1: `layout.ts` 加 `positions` 覆盖**

签名改 `export function layoutFaultTree(model: ModelJson, ftName: string, positions?: Record<string, { x: number; y: number }>)`;节点 position 计算改:
```ts
  const nodes: Node[] = ft.nodes.map((n) => {
    const p = g.node(n.id)
    const saved = positions?.[n.id]
    const type = n.basic ? 'basic' : n.house ? 'house' : 'gate'
    return {
      id: n.id,
      type,
      position: saved ?? { x: (p?.x ?? 0) - NODE_W / 2, y: (p?.y ?? 0) - NODE_H / 2 },
      data: { label: n.id, op: n.op, k: n.k, args: n.args, isTop: n.id === ft.top },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
    }
  })
```

- [ ] **Step 2: `FaultTreeCanvas.tsx` 加 `onNodeDragStop`**

`Props` 加 `onNodeDragStop?: (id: string, x: number, y: number) => void`;解构加 `onNodeDragStop`;`<ReactFlow>` 加 `onNodeDragStop={(_, n) => onNodeDragStop?.(n.id, n.position.x, n.position.y)}`。

- [ ] **Step 3: `App.tsx` ftPos + 接线 + 重置**

state 加 `const [ftPos, setFtPos] = useState<Record<string, Record<string, { x: number; y: number }>>>({})`。
`graph` useMemo 改:
```tsx
const graph = useMemo(
  () => (model ? layoutFaultTree(model, ftName, ftPos[ftName]) : { nodes: [], edges: [] }),
  [model, ftName, ftPos],
)
```
故障树标签的 `<FaultTreeCanvas ...>` 加:
```tsx
onNodeDragStop={(id, x, y) => setFtPos((m) => ({ ...m, [ftName]: { ...(m[ftName] ?? {}), [id]: { x, y } } }))}
```
工具栏(量化按钮附近)加「重置布局」:
```tsx
<button onClick={() => setFtPos((m) => ({ ...m, [ftName]: {} }))} style={iconBtn} title="重置自动布局">重置布局</button>
```

- [ ] **Step 4: 构建 + 预览** — `preview_eval`:故障树标签,记某节点 React Flow translate;`onNodeDragStop` 难以仿真拖拽,改为**验证逻辑链**:调用 `setFtPos` 等价——直接核实结构编辑(加门)后已有节点位置不被重置(可在 eval 里读取节点 transform,加门后比较被「记录」节点未回弹)。最简验证:`重置布局` 按钮存在;`layoutFaultTree` 接受 positions(单测式手验:同 model 传 positions 后该节点 position=传入值)。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/layout.ts frontend/src/components/FaultTreeCanvas.tsx frontend/src/App.tsx
git commit -m "feat(frontend): 故障树手动拖拽节点位置会话内持久化 + 重置布局"
```

## 收尾

- [ ] 后端 `pytest -q`(未动,≥132,CUDD 仍 2 skip)。
- [ ] `npm run build --prefix frontend` 通过;`preview_eval` 端到端(多 ETA 汇总求和上矩阵;拖拽位置不被结构编辑重置)。
- [ ] 更新 `docs/superpowers/ROADMAP.md`(多 ETA 汇总风险矩阵 + 拖拽位置持久化;E 全清)。

## 自检(plan vs spec)

- spec 2.1 多 ETA 汇总 → Task A(MultiEtaAggregate + aggEtas + 折叠面板;复用 RiskMatrix;求和)。
- spec 2.2 拖拽位置 → Task B(layoutFaultTree positions + onNodeDragStop + ftPos + 重置)。
- 类型一致:`EtaRef/aggEtas/resolve`、`MultiEtaAggregate`、`ftPos`、`onNodeDragStop`、`layoutFaultTree(…, positions?)` 跨任务一致。
- 依赖确认:`quantifyEventTree`(api)、`toEngineRequest`(eventtree)、`getBessEventTree`/`loadSaved`(api,App 已 import getBessEventTree/loadSaved)、`RiskMatrix` 均已存在。
- 纯前端,预览无需重启。
