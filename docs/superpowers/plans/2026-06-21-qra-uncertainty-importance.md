# 深化 QRA:事件树不确定性带 + 扰动法屏障重要度 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 事件树量化加上蒙特卡洛不确定性带(C1–C5 的 p05/p50/p95)与扰动法屏障级 FV/RAW 重要度(按后果),前端以带表+误差棒+可选后果的重要度表展示。

**Architecture:** 抽出 `_build_event_tree` 让 ETA 的 BDD 建一次:不确定性只重采样概率;重要度用 `fe_overrides` 把屏障顶 BDD 强制为常量(共享事件下正确)。两个后端端点复用 `build_model_from_request`。

**Tech Stack:** Python/numpy/FastAPI/pytest(后端);React+echarts(前端,`custom` renderItem 画误差棒)。

**验证:** 后端 `.\.venv\Scripts\python.exe -m pytest -q`;前端 `npm run build --prefix frontend` + `preview_eval`。提交结尾 `Co-Authored-By: Claude Opus 4.8`。

---

## Task 1: 抽出 `_build_event_tree` + `fe_overrides`(行为不变)

**Files:** Modify `psaengine/eta/sequence.py`; Test `tests/test_eta_overrides.py`

- [ ] **Step 1: 写失败测试** `tests/test_eta_overrides.py`

```python
from bess.scenarios import build_scenario_model
from psaengine.eta.sequence import quantify_event_tree


def test_override_none_matches_default():
    m = build_scenario_model("SC_OVERCHARGE")
    a = quantify_event_tree(m, "TR")
    b = quantify_event_tree(m, "TR", fe_overrides=None)
    assert a == b


def test_force_work_zeroes_failure_dependent_consequence():
    m = build_scenario_model("SC_OVERCHARGE")  # 4 屏障级联, C5=全部失效
    first = m.event_trees["TR"].functional_events[0].id
    base = quantify_event_tree(m, "TR")["consequences"]
    forced = quantify_event_tree(m, "TR", {first: "work"})["consequences"]
    assert base.get("C5", 0) > 0
    assert forced.get("C5", 0.0) == 0.0   # 首屏障必有效 → 不可能全失效


def test_force_fail_zeroes_success_consequence():
    m = build_scenario_model("SC_OVERCHARGE")
    first = m.event_trees["TR"].functional_events[0].id
    forced = quantify_event_tree(m, "TR", {first: "fail"})["consequences"]
    assert forced.get("C1", 0.0) == 0.0   # C1=首屏障成功; 强制失效 → C1=0
```

- [ ] **Step 2: 跑测试确认失败** — `... -m pytest tests/test_eta_overrides.py -q` → TypeError(`fe_overrides` 未知参数)。

- [ ] **Step 3: 重构 `psaengine/eta/sequence.py`**(全文替换)

```python
from __future__ import annotations
from dataclasses import dataclass
from psaengine.model.model import Model
from psaengine.model.pdag import PDAG
from psaengine.bdd.kernel import BddManager, build_from_pdag
from psaengine.quantify.probability import exact_probability


@dataclass
class EtBuild:
    et: object
    big: PDAG
    m: BddManager
    all_basics: list
    fe_bdd: dict


def _build_event_tree(model: Model, et_name: str) -> EtBuild:
    """合并各功能事件链接的故障树到一个 PDAG + 同一 BddManager + 各 FE 顶 BDD(建一次)。"""
    et = model.event_trees[et_name]
    big = PDAG()
    fe_top: dict[str, str] = {}
    for fe in et.functional_events:
        ft = model.fault_trees[fe.link_ft]
        for nid, n in ft.pdag.nodes.items():
            if nid not in big.nodes:
                big.nodes[nid] = n
        fe_top[fe.id] = ft.top
    all_basics = sorted(big.basic_events())
    m = BddManager(all_basics)
    fe_bdd = {fid: build_from_pdag(m, big, top) for fid, top in fe_top.items()}
    return EtBuild(et, big, m, all_basics, fe_bdd)


def quantify_event_tree(model: Model, et_name: str, fe_overrides: dict | None = None) -> dict:
    """事件树逐序列/逐后果精确定量。
    fe_overrides={fe_id:"fail"|"work"} 把该功能事件顶 BDD 强制为常量(必失效/必有效),
    用于扰动法重要度;默认 None = 原行为。"""
    b = _build_event_tree(model, et_name)
    et, big, m, all_basics = b.et, b.big, b.m, b.all_basics
    fe_bdd = dict(b.fe_bdd)
    if fe_overrides:
        for fid, mode in fe_overrides.items():
            fe_bdd[fid] = m.one if mode == "fail" else m.zero
    q = {bb: model.parameters.get(big.nodes[bb].param_ref).unavailability() for bb in all_basics}

    seq_freq: dict[str, float] = {}
    cons_freq: dict[str, float] = {}
    for seq in et.sequences:
        expr = m.one
        for fe_id, branch in seq["path"].items():
            g = fe_bdd[fe_id]
            expr = m.apply_and(expr, g if branch == "failure" else m.apply_not(g))
        p = exact_probability(m, expr, q)
        freq = et.init_frequency * p
        seq_freq[seq["end_state"]] = seq_freq.get(seq["end_state"], 0.0) + freq
        cls = et.consequence_of(seq["end_state"])
        cons_freq[cls] = cons_freq.get(cls, 0.0) + freq
    return {"sequences": seq_freq, "consequences": cons_freq}
```

- [ ] **Step 4: 跑测试 + 全量回归** — `... -m pytest tests/test_eta_overrides.py -q`(PASS)+ `... -m pytest -q`(≥108 绿,证明重构行为不变)。

- [ ] **Step 5: 提交**

```bash
git add psaengine/eta/sequence.py tests/test_eta_overrides.py
git commit -m "refactor(eta): 抽出 _build_event_tree + quantify_event_tree 加 fe_overrides(行为不变)"
```

## Task 2: 事件树蒙特卡洛不确定性

**Files:** Create `psaengine/eta/uncertainty.py`; Test `tests/test_eta_uncertainty.py`

- [ ] **Step 1: 写失败测试** `tests/test_eta_uncertainty.py`

```python
from bess.scenarios import build_scenario_model
from psaengine.eta.uncertainty import event_tree_uncertainty


def test_bands_ordered_and_spread():
    m = build_scenario_model("SC_ISC")
    r = event_tree_uncertainty(m, "TR", samples=400, seed=1)
    for c, b in r["bands"].items():
        assert b["p05"] <= b["p50"] <= b["p95"]
    assert any(r["bands"][c]["p95"] > r["bands"][c]["p05"] for c in r["bands"])


def test_ef1_collapses_to_point():
    m = build_scenario_model("SC_EXT_FIRE")
    r = event_tree_uncertainty(m, "TR", samples=30, seed=1, error_factor=1.0)
    for c in r["bands"]:
        for k in ("p05", "p50", "p95"):
            assert abs(r["bands"][c][k] - r["point"][c]) <= 1e-9 * max(1.0, r["point"][c])
```

- [ ] **Step 2: 跑测试确认失败** → ModuleNotFoundError。

- [ ] **Step 3: 写 `psaengine/eta/uncertainty.py`**

```python
from __future__ import annotations
from math import log
import numpy as np
from psaengine.model.model import Model
from psaengine.quantify.probability import exact_probability
from psaengine.eta.sequence import _build_event_tree, quantify_event_tree

_CLASSES = ["C1", "C2", "C3", "C4", "C5"]


def event_tree_uncertainty(model: Model, et_name: str, samples: int = 1000,
                           seed: int = 42, error_factor: float = 3.0) -> dict:
    """对各底事件做对数正态(median=nominal, EF)采样, 建一次 BDD 只重算概率,
    给每个后果 C1–C5 出 p05/p50/p95 + 点估计。共享底事件一次采样 → 自动相关。
    init_frequency 视为定值。"""
    b = _build_event_tree(model, et_name)
    et, big, m, all_basics, fe_bdd = b.et, b.big, b.m, b.all_basics, b.fe_bdd
    seq_exprs = []  # (consequence_class, expr)
    for seq in et.sequences:
        expr = m.one
        for fe_id, branch in seq["path"].items():
            g = fe_bdd[fe_id]
            expr = m.apply_and(expr, g if branch == "failure" else m.apply_not(g))
        seq_exprs.append((et.consequence_of(seq["end_state"]), expr))
    medians = {bb: model.parameters.get(big.nodes[bb].param_ref).unavailability() for bb in all_basics}
    rng = np.random.default_rng(seed)
    sigma = log(error_factor) / 1.645 if error_factor > 1 else 0.0
    series = {c: np.zeros(samples) for c in _CLASSES}
    for i in range(samples):
        if sigma > 0:
            q = {bb: float(np.clip(np.exp(rng.normal(log(mu), sigma)), 0.0, 1.0)) if mu > 0 else 0.0
                 for bb, mu in medians.items()}
        else:
            q = dict(medians)
        cons: dict[str, float] = {}
        for c, expr in seq_exprs:
            cons[c] = cons.get(c, 0.0) + et.init_frequency * exact_probability(m, expr, q)
        for c in _CLASSES:
            series[c][i] = cons.get(c, 0.0)
    point = quantify_event_tree(model, et_name)["consequences"]
    bands = {c: {"p05": float(np.percentile(series[c], 5)),
                 "p50": float(np.percentile(series[c], 50)),
                 "p95": float(np.percentile(series[c], 95))} for c in _CLASSES}
    return {"point": {c: float(point.get(c, 0.0)) for c in _CLASSES}, "bands": bands}
```

- [ ] **Step 4: 跑测试** — `... -m pytest tests/test_eta_uncertainty.py -q` → PASS。

- [ ] **Step 5: 提交**

```bash
git add psaengine/eta/uncertainty.py tests/test_eta_uncertainty.py
git commit -m "feat(eta): 事件树蒙特卡洛不确定性带(建一次BDD只重采样, C1-C5 p05/p50/p95)"
```

## Task 3: 扰动法屏障重要度(按后果 FV/RAW)

**Files:** Modify `psaengine/eta/uncertainty.py`; Test `tests/test_eta_importance.py`

- [ ] **Step 1: 写失败测试** `tests/test_eta_importance.py`

```python
from bess.scenarios import build_scenario_model
from psaengine.eta.uncertainty import barrier_importance_exact


def test_severe_consequence_all_barriers_necessary():
    m = build_scenario_model("SC_OVERCHARGE")  # C5=全部失效
    imp = barrier_importance_exact(m, "TR")
    for r in imp["C5"]:
        assert abs(r["fv"] - 1.0) < 1e-9     # 每屏障对 C5 都必需 → FV=1


def test_fv_bound_and_uninvolved_zero():
    m = build_scenario_model("SC_OVERCHARGE")
    imp = barrier_importance_exact(m, "TR")
    for c, rows in imp.items():
        for r in rows:
            assert r["fv"] <= 1.0 + 1e-9
            assert r["raw"] >= 0.0
    first = m.event_trees["TR"].functional_events[0].id
    for r in imp["C1"]:                       # C1=仅首屏障成功
        if r["barrier"] != first:
            assert abs(r["fv"]) < 1e-9        # 非首屏障对 C1 无贡献


def test_rows_sorted_by_fv_desc():
    imp = barrier_importance_exact(build_scenario_model("SC_ISC"), "TR")
    for c, rows in imp.items():
        fvs = [r["fv"] for r in rows]
        assert fvs == sorted(fvs, reverse=True)
```

- [ ] **Step 2: 跑测试确认失败** → ImportError(`barrier_importance_exact`)。

- [ ] **Step 3: 在 `psaengine/eta/uncertainty.py` 末尾加**

```python
def barrier_importance_exact(model: Model, et_name: str) -> dict:
    """扰动法屏障级重要度(按后果):
    FV = (R − R|该屏障必有效) / R;RAW = R|该屏障必失效 / R(R=0 记 0)。
    强制的是功能事件顶 BDD(经 fe_overrides),共享底事件下其他屏障不受影响。
    注意:对良性后果(需某屏障成功才达成,如 C1)FV 可为负、RAW 可 <1,属正常语义。"""
    et = model.event_trees[et_name]
    base = quantify_event_tree(model, et_name)["consequences"]
    pert: dict = {}
    for fe in et.functional_events:
        pert[(fe.id, "work")] = quantify_event_tree(model, et_name, {fe.id: "work"})["consequences"]
        pert[(fe.id, "fail")] = quantify_event_tree(model, et_name, {fe.id: "fail"})["consequences"]
    out: dict[str, list] = {}
    for c in _CLASSES:
        R = base.get(c, 0.0)
        rows = []
        for fe in et.functional_events:
            rw = pert[(fe.id, "work")].get(c, 0.0)
            rf = pert[(fe.id, "fail")].get(c, 0.0)
            fv = (R - rw) / R if R > 0 else 0.0
            raw = rf / R if R > 0 else 0.0
            rows.append({"barrier": fe.id, "fv": float(fv), "raw": float(raw)})
        rows.sort(key=lambda x: -x["fv"])
        out[c] = rows
    return out
```

- [ ] **Step 4: 跑测试 + 全量回归** — `... -m pytest tests/test_eta_importance.py -q`(PASS)+ `... -m pytest -q`。

- [ ] **Step 5: 提交**

```bash
git add psaengine/eta/uncertainty.py tests/test_eta_importance.py
git commit -m "feat(eta): 扰动法屏障级 FV/RAW 重要度(按后果)"
```

## Task 4: 后端端点

**Files:** Modify `backend/schemas.py`, `backend/app.py`; Test `tests/backend/test_qra_api.py`

- [ ] **Step 1: 写失败测试** `tests/backend/test_qra_api.py`

```python
from fastapi.testclient import TestClient
from backend.app import app

client = TestClient(app)


def _req():
    return {
        "init_event": "IE", "init_frequency": 1.0,
        "functional_events": [{"id": "FE1", "pfd": 0.1}, {"id": "FE2", "pfd": 0.2}],
        "fault_trees": {}, "parameters": {},
        "sequences": [
            {"path": {"FE1": "success"}, "end_state": "L0"},
            {"path": {"FE1": "failure", "FE2": "success"}, "end_state": "L1"},
            {"path": {"FE1": "failure", "FE2": "failure"}, "end_state": "L2"},
        ],
        "consequence_bins": {"L0": "C1", "L1": "C2", "L2": "C3"},
    }


def test_uncertainty_endpoint():
    r = client.post("/api/event-tree/uncertainty", json={**_req(), "samples": 200, "seed": 1})
    assert r.status_code == 200
    d = r.json()
    assert "bands" in d and "point" in d
    assert d["bands"]["C3"]["p05"] <= d["bands"]["C3"]["p95"]


def test_importance_endpoint():
    r = client.post("/api/event-tree/importance", json=_req())
    assert r.status_code == 200
    imp = r.json()["importance"]
    # C3 = 双失效, 两屏障都必需 → FV=1
    assert all(abs(row["fv"] - 1.0) < 1e-9 for row in imp["C3"])
```

- [ ] **Step 2: 跑测试确认失败** → 404。

- [ ] **Step 3: `schemas.py` 加请求模型**(在 `EtQuantifyResponse` 后)

```python
class EtUncertaintyRequest(EtQuantifyRequest):
    samples: int = 1000
    seed: int = 42
    error_factor: float = 3.0
```

- [ ] **Step 4: `backend/app.py` 加两端点**(在 `/api/event-tree/quantify` 附近)

```python
@app.post("/api/event-tree/uncertainty")
def api_event_tree_uncertainty(req: schemas.EtUncertaintyRequest):
    from backend.et_builder import build_model_from_request
    from psaengine.eta.uncertainty import event_tree_uncertainty
    model = build_model_from_request(req.model_dump())
    return event_tree_uncertainty(model, "TR", samples=req.samples, seed=req.seed, error_factor=req.error_factor)

@app.post("/api/event-tree/importance")
def api_event_tree_importance(req: schemas.EtQuantifyRequest):
    from backend.et_builder import build_model_from_request
    from psaengine.eta.uncertainty import barrier_importance_exact
    model = build_model_from_request(req.model_dump())
    return {"importance": barrier_importance_exact(model, "TR")}
```

- [ ] **Step 5: 跑测试 + 全量回归** → PASS。

- [ ] **Step 6: 提交**

```bash
git add backend/schemas.py backend/app.py tests/backend/test_qra_api.py
git commit -m "feat(api): POST /api/event-tree/uncertainty 与 /importance"
```

## Task 5: 前端深化分析(带表 + 误差棒 + 重要度表)

**Files:** Modify `frontend/src/api.ts`, `frontend/src/components/EventTreeEditor.tsx`

- [ ] **Step 1: `api.ts` 加类型与函数**

```ts
export interface EtBands { point: Record<string, number>; bands: Record<string, { p05: number; p50: number; p95: number }> }
export interface EtImportance { importance: Record<string, { barrier: string; fv: number; raw: number }[]> }

export async function uncertaintyEventTree(req: any): Promise<EtBands> {
  const r = await fetch(`${BASE}/event-tree/uncertainty`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req) })
  if (!r.ok) throw new Error(`uncertainty → ${r.status}`); return r.json()
}
export async function importanceEventTree(req: any): Promise<EtImportance> {
  const r = await fetch(`${BASE}/event-tree/importance`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req) })
  if (!r.ok) throw new Error(`importance → ${r.status}`); return r.json()
}
```

- [ ] **Step 2: `EventTreeEditor.tsx` 加 import 与 state**

import 加:`uncertaintyEventTree, importanceEventTree`(从 `../api`);state 加:
```tsx
const [unc, setUnc] = useState<{ point: Record<string, number>; bands: Record<string, any> } | null>(null)
const [imp, setImp] = useState<Record<string, { barrier: string; fv: number; raw: number }[]> | null>(null)
const [impC, setImpC] = useState('C5')
const [deepBusy, setDeepBusy] = useState(false)
```
`useEffect(() => { setUnc(null); setImp(null) }, [model])`(模型变 → 深化结果作废)。

- [ ] **Step 3: 深化分析处理函数**(组件内,`onEngineQuantify` 之后)

```tsx
const onDeepen = async () => {
  setDeepBusy(true)
  try {
    const req = toEngineRequest(model, linked)
    const [u, im] = await Promise.all([
      uncertaintyEventTree({ ...req, samples: 1000 }),
      importanceEventTree(req),
    ])
    setUnc(u); setImp(im.importance)
  } catch (e: any) { setQErr(String(e?.message ?? e)) }
  finally { setDeepBusy(false) }
}
```

- [ ] **Step 4: 按钮 + 误差棒 + 带表 + 重要度表**

按钮(放「引擎精确量化」按钮下):
```tsx
<button onClick={onDeepen} disabled={deepBusy}
  style={{ background: '#0f766e', color: '#fff', border: 0, borderRadius: 6, padding: '7px 14px', width: '100%', marginTop: 8 }}>
  {deepBusy ? '深化分析中…' : '📊 深化分析(不确定性+重要度)'}
</button>
```

后果条形图 `option.series` 在 `unc` 存在时追加误差棒 custom series:
```tsx
series: [
  { type: 'bar', data: CONSEQUENCES.map((c) => totals[c] || null), itemStyle: { color: '#dc2626' } },
  ...(unc ? [{
    type: 'custom', z: 10,
    renderItem: (params: any, api: any) => {
      const xi = api.value(0)
      const lo = api.coord([xi, api.value(1)]); const hi = api.coord([xi, api.value(2)])
      const x = lo[0], w = 5
      const ln = (x1: number, y1: number, x2: number, y2: number) => ({ type: 'line', shape: { x1, y1, x2, y2 }, style: { stroke: '#0f172a', lineWidth: 1.5 } })
      return { type: 'group', children: [ln(x, lo[1], x, hi[1]), ln(x - w, lo[1], x + w, lo[1]), ln(x - w, hi[1], x + w, hi[1])] }
    },
    encode: { x: 0, y: [1, 2] },
    data: CONSEQUENCES.map((c, i) => [i, unc.bands[c]?.p05 || null, unc.bands[c]?.p95 || null]),
  }] : []),
],
```

带表(条形图下):
```tsx
{unc && (
  <table style={{ borderCollapse: 'collapse', fontSize: 11, marginTop: 8 }}>
    <thead><tr>{['后果', '点估计', 'p05', 'p50', 'p95'].map((h) => <th key={h} style={{ border: '1px solid #e2e8f0', padding: '2px 6px' }}>{h}</th>)}</tr></thead>
    <tbody>{CONSEQUENCES.map((c) => (
      <tr key={c}>
        <td style={cell}>{c}</td>
        <td style={cell}>{(unc.point[c] || 0).toExponential(1)}</td>
        <td style={cell}>{(unc.bands[c]?.p05 || 0).toExponential(1)}</td>
        <td style={cell}>{(unc.bands[c]?.p50 || 0).toExponential(1)}</td>
        <td style={cell}>{(unc.bands[c]?.p95 || 0).toExponential(1)}</td>
      </tr>
    ))}</tbody>
  </table>
)}
```
(加 `const cell: CSSProperties = { border: '1px solid #e2e8f0', padding: '2px 6px' }`;`import type { CSSProperties } from 'react'`。)

重要度表(取代/补充现"屏障重要度"):
```tsx
{imp && (
  <div style={{ marginTop: 12 }}>
    <h4 style={{ margin: '8px 0 4px' }}>屏障重要度(FV/RAW · 按后果)</h4>
    <div style={{ fontSize: 12, marginBottom: 4 }}>后果:
      <select value={impC} onChange={(e) => setImpC(e.target.value)}>{CONSEQUENCES.map((c) => <option key={c} value={c}>{c}</option>)}</select>
    </div>
    <table style={{ borderCollapse: 'collapse', fontSize: 11 }}>
      <thead><tr>{['屏障', 'FV', 'RAW'].map((h) => <th key={h} style={cell}>{h}</th>)}</tr></thead>
      <tbody>{(imp[impC] || []).map((r) => (
        <tr key={r.barrier}><td style={cell}>{r.barrier}</td><td style={cell}>{r.fv.toFixed(3)}</td><td style={cell}>{r.raw.toFixed(2)}</td></tr>
      ))}</tbody>
    </table>
    <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>注:良性后果(需屏障成功)FV 可为负。默认看最严重 C5。</div>
  </div>
)}
```

- [ ] **Step 5: 构建** — `npm run build --prefix frontend` 通过(修 TS 报错,尤其 echarts custom 的 any 类型与 CSSProperties)。

- [ ] **Step 6: 预览验证**(`preview_eval`)
  - ETA 选 SC_ISC → 点「深化分析」→ 等待。
  - 带表出现(5 行 × 5 列,p05≤p95);条形图含误差棒(custom series 渲染的 line)。
  - 重要度表出现;切后果选择器(C5→C1)行随之变;C5 各屏障 FV≈1.000。

- [ ] **Step 7: 提交**

```bash
git add frontend/src/api.ts frontend/src/components/EventTreeEditor.tsx
git commit -m "feat(frontend): 深化分析—不确定性带表+条形图误差棒+按后果 FV/RAW 重要度表"
```

## 收尾

- [ ] 全量回归 `... -m pytest -q`(≥108 + 新增,CUDD 仍 2 skip)。
- [ ] `npm run build --prefix frontend` 通过;`preview_eval` 端到端巡检。
- [ ] 更新 `docs/superpowers/ROADMAP.md`(深化 QRA:不确定性带 + 扰动法 FV/RAW)。

## 自检(plan vs spec)

- spec 2.1 `_build_event_tree`+`fe_overrides` → Task 1。
- spec 2.2 不确定性 → Task 2。
- spec 2.3 扰动法重要度 → Task 3。
- spec 2.4 端点 → Task 4。
- spec 2.5 前端 → Task 5。
- 类型一致:`_build_event_tree`/`EtBuild`/`fe_overrides`/`event_tree_uncertainty`/`barrier_importance_exact`/`EtUncertaintyRequest`/`uncertaintyEventTree`/`importanceEventTree` 跨任务一致。
- 修正:per-consequence FV 可为负、RAW 可<1(良性后果),测试与 UI 已据此(默认 C5、不强制 RAW≥1);spec §4 验收行同步修正。
