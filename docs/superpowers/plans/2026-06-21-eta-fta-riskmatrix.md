# ETA 预置库 + 多事件树 + FTA 挂载 + 风险矩阵 + ROADMAP A/D 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 BESS PSA 工具加上带来源的预置数据库、多个场景事件树、FTA 挂载在 ETA 上的引擎精确定量、风险矩阵结果展示,并完成 ROADMAP A(事件树接回引擎)与 D(CUDD 后端抽象)。

**Architecture:** 后端 JSON 为唯一数据真源(`bess/reference_data.json` + `bess/scenarios.json`),`bess/scenarios.py` 用 library 构 `Model`;引擎已有的 `quantify_event_tree`(`link_ft` + 精确否定)直接支撑 FTA-on-ETA;`/api/event-tree/quantify` 复用 `load_model_from_dict` 把前端序列化的事件树转引擎模型;前端加场景下拉、参考库表、FE 下钻、风险矩阵;D 抽象 `BddManager` 遍历协议 + CUDD 适配器。

**Tech Stack:** Python 3.12 / FastAPI / pytest(后端);React 18 + Vite 5 + TypeScript + echarts 5 + ag-grid 32(前端);`dd.cudd`(P6,Linux/WSL)。

**运行/测试约定:** 后端测试 `.\.venv\Scripts\python.exe -m pytest -q`(当前 85 绿);前端构建 `npm run build --prefix frontend`;前端交互验证用 `preview_eval` 查 DOM(`preview_screenshot` 超时)。提交信息结尾 `Co-Authored-By: Claude Opus 4.8`。

---

## P1 — 预置数据库(带来源)

### Task 1: 参考数据库 JSON + 加载器 + 完整性测试

**Files:**
- Create: `bess/reference_data.json`
- Create: `bess/library.py`
- Test: `tests/test_library.py`

- [ ] **Step 1: 写失败测试** `tests/test_library.py`

```python
from bess.library import load_library

def test_three_sections_present_and_ids_unique():
    lib = load_library()
    for sec in ("component_failure_rates", "barrier_effectiveness", "initiating_events"):
        rows = lib[sec]
        assert rows, f"{sec} empty"
        ids = [r["id"] for r in rows]
        assert len(ids) == len(set(ids)), f"{sec} ids not unique"

def test_every_entry_has_nonempty_citation():
    lib = load_library()
    for sec in ("component_failure_rates", "barrier_effectiveness", "initiating_events"):
        for r in lib[sec]:
            assert r["source"]["citation"].strip(), f"{sec}:{r['id']} citation empty"

def test_barrier_pfd_in_open_interval():
    for b in load_library()["barrier_effectiveness"]:
        assert 0.0 < b["pfd"] < 1.0, f"{b['id']} pfd={b['pfd']}"

def test_component_rate_and_ie_freq_positive():
    lib = load_library()
    for c in lib["component_failure_rates"]:
        assert c["rate"] > 0
    for e in lib["initiating_events"]:
        assert e["freq_prior"] > 0

def test_disclaimer_present():
    assert load_library()["meta"]["disclaimer"].strip()
```

- [ ] **Step 2: 跑测试确认失败** — `.\.venv\Scripts\python.exe -m pytest tests/test_library.py -q` → ImportError（无 `bess.library`）。

- [ ] **Step 3: 写 `bess/reference_data.json`**(内容见 spec §2 P1;5 器件失效率、10 屏障、5 初因,均带 `source.citation`;`meta.disclaimer`)。初因沿用 `tr_model_data.json` 的 5 条,字段为 `{id,label,category,freq_prior,source:{citation,note}}`。

- [ ] **Step 4: 写 `bess/library.py`**

```python
from __future__ import annotations
import json, os

_DATA = os.path.join(os.path.dirname(__file__), "reference_data.json")

def load_library(path: str = _DATA) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)
```

- [ ] **Step 5: 跑测试确认通过** — `.\.venv\Scripts\python.exe -m pytest tests/test_library.py -q` → PASS。

- [ ] **Step 6: 提交**

```bash
git add bess/reference_data.json bess/library.py tests/test_library.py
git commit -m "feat(bess): 预置带来源的失效率/屏障有效性参考库 + 完整性测试"
```

### Task 2: `/api/bess/library` 端点

**Files:**
- Modify: `backend/app.py`
- Test: `tests/backend/test_library_api.py`

- [ ] **Step 1: 写失败测试** `tests/backend/test_library_api.py`

```python
from fastapi.testclient import TestClient
from backend.app import app

def test_library_endpoint_returns_sourced_data():
    c = TestClient(app)
    r = c.get("/api/bess/library")
    assert r.status_code == 200
    data = r.json()
    assert data["barrier_effectiveness"][0]["source"]["citation"]
    assert "disclaimer" in data["meta"]
```

- [ ] **Step 2: 跑测试确认失败** — `... -m pytest tests/backend/test_library_api.py -q` → 404。

- [ ] **Step 3: 在 `backend/app.py` 加端点**(放在 `/api/bess/event-tree` 附近)

```python
@app.get("/api/bess/library")
def api_bess_library():
    from bess.library import load_library
    return load_library()
```

- [ ] **Step 4: 跑测试确认通过**。

- [ ] **Step 5: 提交**

```bash
git add backend/app.py tests/backend/test_library_api.py
git commit -m "feat(api): GET /api/bess/library 暴露参考数据库"
```

### Task 3: 前端参考库视图

**Files:**
- Create: `frontend/src/components/ReferenceLibrary.tsx`
- Modify: `frontend/src/api.ts`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: `api.ts` 加类型与 getter**

```ts
export interface SourceRef { citation: string; url?: string; note?: string }
export interface LibraryData {
  meta: { disclaimer: string }
  component_failure_rates: { id: string; name: string; failure_mode: string; rate: number; unit: string; source: SourceRef }[]
  barrier_effectiveness: { id: string; name: string; category: string; pfd: number; eff?: number; source: SourceRef }[]
  initiating_events: { id: string; label: string; category: string; freq_prior: number; source: SourceRef }[]
}
export const getLibrary = () => jget<LibraryData>('/bess/library')
```

- [ ] **Step 2: 写 `ReferenceLibrary.tsx`**(三张只读表 + 顶部免责声明横幅)

```tsx
import { useEffect, useState } from 'react'
import { getLibrary } from '../api'
import type { LibraryData } from '../api'

export function ReferenceLibrary() {
  const [lib, setLib] = useState<LibraryData | null>(null)
  useEffect(() => { getLibrary().then(setLib).catch(() => {}) }, [])
  if (!lib) return <p style={{ padding: 24 }}>加载中…</p>
  const th: any = { textAlign: 'left', padding: '6px 10px', borderBottom: '2px solid #e2e8f0', fontSize: 12, color: '#334155' }
  const td: any = { padding: '6px 10px', borderBottom: '1px solid #f1f5f9', fontSize: 12 }
  return (
    <div style={{ padding: 24, overflowY: 'auto' }}>
      <div style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', padding: 12, borderRadius: 8, fontSize: 13, marginBottom: 18 }}>
        ⚠ {lib.meta.disclaimer}
      </div>
      <h3>器件基础失效率</h3>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead><tr><th style={th}>器件 / 失效模式</th><th style={th}>参考值</th><th style={th}>单位</th><th style={th}>来源</th></tr></thead>
        <tbody>{lib.component_failure_rates.map((c) => (
          <tr key={c.id}><td style={td}>{c.name} / {c.failure_mode}</td><td style={td}>{c.rate.toExponential(1)}</td><td style={td}>{c.unit}</td><td style={td}>{c.source.citation}{c.source.note ? `（${c.source.note}）` : ''}</td></tr>
        ))}</tbody>
      </table>
      <h3 style={{ marginTop: 24 }}>防护措施有效性（PFD）</h3>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead><tr><th style={th}>措施</th><th style={th}>类型</th><th style={th}>PFD</th><th style={th}>来源</th></tr></thead>
        <tbody>{lib.barrier_effectiveness.map((b) => (
          <tr key={b.id}><td style={td}>{b.name}</td><td style={td}>{b.category}</td><td style={td}>{b.pfd}</td><td style={td}>{b.source.citation}</td></tr>
        ))}</tbody>
      </table>
      <h3 style={{ marginTop: 24 }}>初始事件频率</h3>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead><tr><th style={th}>初因</th><th style={th}>类别</th><th style={th}>频率/年</th><th style={th}>来源</th></tr></thead>
        <tbody>{lib.initiating_events.map((e) => (
          <tr key={e.id}><td style={td}>{e.label}</td><td style={td}>{e.category}</td><td style={td}>{e.freq_prior.toExponential(1)}</td><td style={td}>{e.source.citation}</td></tr>
        ))}</tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 3: `App.tsx` 加标签**：`tab` 类型加 `'library'`;header 加按钮 `<button onClick={() => setTab('library')} style={tabBtn(tab === 'library')}>参考库</button>`;主体加分支 `tab === 'library' ? <ReferenceLibrary /> : ...`(import 之)。

- [ ] **Step 4: 构建验证** — `npm run build --prefix frontend` → 成功;`run.ps1` 起服务,`preview_eval` 取 `document.querySelectorAll('table').length >= 3` 与免责声明文本存在。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/components/ReferenceLibrary.tsx frontend/src/api.ts frontend/src/App.tsx
git commit -m "feat(frontend): 参考库只读视图 + 免责声明"
```

---

## P2 — 内置多个 ETA（场景模板）

### Task 4: 场景定义 + 构建器 + 守恒测试

**Files:**
- Create: `bess/scenarios.json`
- Create: `bess/scenarios.py`
- Test: `tests/test_scenarios.py`

- [ ] **Step 1: 写失败测试** `tests/test_scenarios.py`

```python
from bess.scenarios import load_scenarios, build_scenario_model
from psaengine.eta.sequence import quantify_event_tree

def test_five_scenarios_listed():
    ids = {s["id"] for s in load_scenarios()}
    assert {"SC_ISC", "SC_OVERCHARGE", "SC_COOLANT", "SC_EXT_FIRE", "SC_MECH_WATER"} <= ids

def test_each_scenario_conserves_frequency():
    for s in load_scenarios():
        model = build_scenario_model(s["id"])
        et = model.event_trees["TR"]
        total = sum(quantify_event_tree(model, "TR")["sequences"].values())
        assert abs(total - et.init_frequency) <= 1e-9 * et.init_frequency

def test_consequences_nonneg_and_capped_c5():
    model = build_scenario_model("SC_ISC")
    cons = quantify_event_tree(model, "TR")["consequences"]
    assert all(v >= 0 for v in cons.values())
    assert set(cons) <= {"C1", "C2", "C3", "C4", "C5"}
```

- [ ] **Step 2: 跑测试确认失败** → ImportError。

- [ ] **Step 3: 写 `bess/scenarios.json`**

```json
{
  "scenarios": [
    {"id": "SC_ISC", "name": "电芯内短 → 热失控", "init_event": "IE_ISC",
     "barriers": ["B_OFFGAS", "B_BMS", "B_THERMAL", "B_DEFLAG", "B_SPACING", "B_RESPONSE"],
     "decompose": {"B_BMS": "bms", "B_OFFGAS": "offgas_shared"}},
    {"id": "SC_OVERCHARGE", "name": "过充 / BMS 失效", "init_event": "IE_OVERCHARGE",
     "barriers": ["B_BMS", "B_OFFGAS", "B_THERMAL", "B_DEFLAG"],
     "decompose": {"B_BMS": "bms"}},
    {"id": "SC_COOLANT", "name": "液冷泄漏 → 外短", "init_event": "IE_COOLANT",
     "barriers": ["B_OFFGAS", "B_BMS", "B_THERMAL", "B_DEFLAG", "B_SPACING"]},
    {"id": "SC_EXT_FIRE", "name": "外部火 / 邻舱热辐射", "init_event": "IE_EXT_FIRE",
     "barriers": ["B_THERMAL", "B_DEFLAG", "B_SPACING", "B_RESPONSE"]},
    {"id": "SC_MECH_WATER", "name": "机械损伤 / 进水", "init_event": "IE_MECH_WATER",
     "barriers": ["B_OFFGAS", "B_BMS", "B_THERMAL", "B_DEFLAG"]}
  ]
}
```

- [ ] **Step 4: 写 `bess/scenarios.py`**（含 P3 的真故障树构建器与共享事件)

```python
from __future__ import annotations
import json, os
from psaengine.model.pdag import PDAG, Op
from psaengine.model.parameters import Parameter, ParameterLibrary, Distribution
from psaengine.model.fault_tree import FaultTree
from psaengine.model.event_tree import EventTree, FunctionalEvent
from psaengine.model.model import Model
from bess.library import load_library
from bess.tr_model import CONSEQUENCE_AT_DEPTH

_SCEN = os.path.join(os.path.dirname(__file__), "scenarios.json")

def load_scenarios(path: str = _SCEN) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        return json.load(f)["scenarios"]

def _scenario(sid: str) -> dict:
    for s in load_scenarios():
        if s["id"] == sid:
            return s
    raise KeyError(sid)

def _trivial_ft(bid: str) -> FaultTree:
    g = PDAG(); g.basic(bid + "_E", param_ref=bid)
    g.gate(bid, Op.NULL, [bid + "_E"]); g.top = bid
    return FaultTree(bid, g)

# ft_kind -> () -> (FaultTree, {param_id: (value, citation)})
def _ft_bms():
    g = PDAG()
    g.basic("BMS_SENSOR_FAIL", param_ref="BMS_SENSOR_FAIL")
    g.basic("BMS_LOGIC_FAIL", param_ref="BMS_LOGIC_FAIL")
    g.basic("BMS_CONTACTOR_FAIL", param_ref="BMS_CONTACTOR_FAIL")
    g.gate("B_BMS", Op.OR, ["BMS_SENSOR_FAIL", "BMS_LOGIC_FAIL", "BMS_CONTACTOR_FAIL"])
    g.top = "B_BMS"
    params = {"BMS_SENSOR_FAIL": (0.03, "DNV/Gully 2019 传感失效"),
              "BMS_LOGIC_FAIL": (0.01, "IEC 61508 SIL 逻辑"),
              "BMS_CONTACTOR_FAIL": (0.06, "OREDA/exida 接触器拒动")}
    return FaultTree("B_BMS", g), params

def _ft_offgas_shared():
    g = PDAG()
    g.basic("OFFGAS_DET_FAIL", param_ref="OFFGAS_DET_FAIL")
    g.basic("BMS_CONTACTOR_FAIL", param_ref="BMS_CONTACTOR_FAIL")  # 与 B_BMS 共享
    g.gate("B_OFFGAS", Op.OR, ["OFFGAS_DET_FAIL", "BMS_CONTACTOR_FAIL"])
    g.top = "B_OFFGAS"
    params = {"OFFGAS_DET_FAIL": (0.008, "Li-ion Tamer/Honeywell 离气探测"),
              "BMS_CONTACTOR_FAIL": (0.06, "OREDA/exida 接触器拒动")}
    return FaultTree("B_OFFGAS", g), params

_FT_BUILDERS = {"bms": _ft_bms, "offgas_shared": _ft_offgas_shared}

def build_scenario_model(scenario_id: str) -> Model:
    lib = load_library()
    barrier_by_id = {b["id"]: b for b in lib["barrier_effectiveness"]}
    ie_by_id = {e["id"]: e for e in lib["initiating_events"]}
    sc = _scenario(scenario_id)
    bids = sc["barriers"]
    decompose = sc.get("decompose", {})
    ie_freq = ie_by_id[sc["init_event"]]["freq_prior"]

    plib = ParameterLibrary()
    fts: dict[str, FaultTree] = {}
    added: set[str] = set()

    def add_param(pid: str, val: float, src: str):
        if pid not in added:
            plib.add(Parameter(pid, "probability", val,
                     distribution=Distribution("lognormal", {"median": val, "error_factor": 3}),
                     source=src))
            added.add(pid)

    for bid in bids:
        if bid in decompose:
            ft, params = _FT_BUILDERS[decompose[bid]]()
            fts[bid] = ft
            for pid, (val, src) in params.items():
                add_param(pid, val, src)
        else:
            pfd = barrier_by_id[bid]["pfd"]
            add_param(bid, pfd, barrier_by_id[bid]["source"]["citation"])
            fts[bid] = _trivial_ft(bid)
    fes = [FunctionalEvent(bid, link_ft=bid) for bid in bids]

    sequences, bins = [], {}
    for j in range(len(bids) + 1):
        path = {bids[k]: "failure" for k in range(j)}
        if j < len(bids):
            path[bids[j]] = "success"
        end = f"D{j}"
        bins[end] = CONSEQUENCE_AT_DEPTH[min(j, len(CONSEQUENCE_AT_DEPTH) - 1)]
        sequences.append({"path": path, "end_state": end})
    et = EventTree(sc["init_event"], ie_freq, fes, sequences, bins)
    return Model(parameters=plib, fault_trees=fts, event_trees={"TR": et}, ccf_groups=[])
```

- [ ] **Step 5: 跑测试确认通过** — `... -m pytest tests/test_scenarios.py -q` → PASS。

- [ ] **Step 6: 全量回归** — `.\.venv\Scripts\python.exe -m pytest -q` → 仍 ≥85 绿。

- [ ] **Step 7: 提交**

```bash
git add bess/scenarios.json bess/scenarios.py tests/test_scenarios.py
git commit -m "feat(bess): 5 个场景事件树模板 + BMS/离气真故障树(含共享事件)"
```

### Task 5: 场景列表/选择 API

**Files:**
- Modify: `backend/app.py`
- Test: `tests/backend/test_scenarios_api.py`

- [ ] **Step 1: 写失败测试** `tests/backend/test_scenarios_api.py`

```python
from fastapi.testclient import TestClient
from backend.app import app

def test_scenarios_list():
    c = TestClient(app)
    r = c.get("/api/bess/scenarios")
    assert r.status_code == 200
    assert any(s["id"] == "SC_ISC" for s in r.json())

def test_event_tree_for_scenario():
    c = TestClient(app)
    r = c.get("/api/bess/event-tree", params={"scenario": "SC_OVERCHARGE"})
    assert r.status_code == 200
    d = r.json()
    assert d["functional_events"][0] == "B_BMS"
    assert d["init_event"] == "IE_OVERCHARGE"

def test_event_tree_default_unchanged():
    c = TestClient(app)
    r = c.get("/api/bess/event-tree")          # 无 scenario = 原行为
    assert r.status_code == 200
    assert r.json()["init_event"] == "IE_TR"
```

- [ ] **Step 2: 跑测试确认失败**。

- [ ] **Step 3: 改 `backend/app.py`** — 加 `/api/bess/scenarios`,并把 `api_bess_event_tree` 改为接受 `scenario` 查询参数(默认走原 `build_thermal_runaway_model`,保证 `test_event_tree_default_unchanged`)

```python
@app.get("/api/bess/scenarios")
def api_bess_scenarios():
    from bess.scenarios import load_scenarios
    return [{"id": s["id"], "name": s["name"]} for s in load_scenarios()]

@app.get("/api/bess/event-tree")
def api_bess_event_tree(scenario: str | None = None):
    from bess.report import _barrier_importance
    from psaengine.eta.sequence import quantify_event_tree
    if scenario:
        from bess.scenarios import build_scenario_model
        from bess.library import load_library
        model = build_scenario_model(scenario)
        lib = load_library()
        labels = {b["id"]: b["name"] for b in lib["barrier_effectiveness"]}
        fe_prob = {b["id"]: b["pfd"] for b in lib["barrier_effectiveness"]}
    else:
        from bess.tr_model import build_thermal_runaway_model, load_data
        model = build_thermal_runaway_model()
        data = load_data()
        labels = {b["id"]: b["label"] for b in data["barriers"]}
        fe_prob = {b["id"]: b["pfd_prior"] for b in data["barriers"]}
    et = model.event_trees["TR"]
    res = quantify_event_tree(model, "TR")
    sequences = [{
        "end_state": s["end_state"], "path": s["path"],
        "consequence": et.consequence_of(s["end_state"]),
        "frequency": res["sequences"].get(s["end_state"], 0.0),
    } for s in et.sequences]
    return {
        "init_event": et.init_event, "init_frequency": et.init_frequency,
        "functional_events": [fe.id for fe in et.functional_events],
        "labels": labels, "fe_prob": fe_prob, "sequences": sequences,
        "consequences": res["consequences"],
        "barrier_importance": _barrier_importance(model),
    }
```

(删除旧的 `api_bess_event_tree` 定义,替换为上面这版。)

- [ ] **Step 4: 跑测试确认通过 + 全量回归**。

- [ ] **Step 5: 提交**

```bash
git add backend/app.py tests/backend/test_scenarios_api.py
git commit -m "feat(api): 场景列表 + /api/bess/event-tree?scenario= (默认向后兼容)"
```

### Task 6: 前端场景下拉

**Files:**
- Modify: `frontend/src/api.ts`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: `api.ts`** 加 `export interface ScenarioItem { id: string; name: string }`、`export const getScenarios = () => jget<ScenarioItem[]>('/bess/scenarios')`,并让 `getBessEventTree` 接受可选 scenario:`export const getBessEventTree = (scenario?: string) => jget<BessEventTree>('/bess/event-tree' + (scenario ? \`?scenario=${scenario}\` : ''))`。

- [ ] **Step 2: `App.tsx`** — 加 `const [scenarios, setScenarios] = useState<ScenarioItem[]>([])`、`const [scenarioId, setScenarioId] = useState<string>('')`;`useEffect` 拉 `getScenarios`;`onBessTab` 与切换场景时调 `getBessEventTree(scenarioId || undefined)` 并重建 `etModel`(抽出 `loadEt(sid)` 函数:`const d = await getBessEventTree(sid || undefined); setBess(d); const fes=...; setEtModel(...)`)。在 BESS 标签顶部加 `<select value={scenarioId} onChange={e => { setScenarioId(e.target.value); loadEt(e.target.value) }}>` 含「默认热失控级联」空项 + scenarios。

- [ ] **Step 3: 构建 + `preview_eval`** 验证下拉切换后树重渲染(`document.querySelectorAll('svg circle').length` 随场景变化)。

- [ ] **Step 4: 提交**

```bash
git add frontend/src/api.ts frontend/src/App.tsx
git commit -m "feat(frontend): BESS 事件树场景下拉切换"
```

---

## P3 — FTA 挂载在 ETA 上（真故障树 + 共享事件验证）

> 真故障树构建器与共享事件已在 Task 4 的 `scenarios.py` 实现。本部分加验证测试 + 前端下钻。

### Task 7: 共享事件使引擎精确 ≠ 独立积式（测试）

**Files:**
- Test: `tests/test_fta_on_eta.py`

- [ ] **Step 1: 写测试** `tests/test_fta_on_eta.py`

```python
from bess.scenarios import build_scenario_model
from psaengine.eta.sequence import quantify_event_tree
from psaengine.bdd.kernel import BddManager, build_from_pdag
from psaengine.quantify.probability import exact_probability

def _standalone_fe_probs(model):
    """各功能事件独立看待时的顶事件概率（不考虑跨 FE 共享）。"""
    et = model.event_trees["TR"]
    out = {}
    for fe in et.functional_events:
        ft = model.fault_trees[fe.link_ft]
        basics = sorted(ft.pdag.basic_events())
        m = BddManager(basics)
        root = build_from_pdag(m, ft.pdag, ft.top)
        q = {b: model.parameters.get(ft.pdag.node(b).param_ref).unavailability() for b in basics}
        out[fe.id] = exact_probability(m, root, q)
    return out

def _independent_cascade(model):
    """用独立积式按级联算各 end_state 频率。"""
    et = model.event_trees["TR"]
    p = _standalone_fe_probs(model)
    bids = [fe.id for fe in et.functional_events]
    seqf = {}
    for seq in et.sequences:
        prob = 1.0
        for bid in bids:
            br = seq["path"].get(bid)
            if br == "failure": prob *= p[bid]
            elif br == "success": prob *= (1 - p[bid])
        seqf[seq["end_state"]] = et.init_frequency * prob
    return seqf

def test_shared_event_makes_exact_differ_from_independent():
    model = build_scenario_model("SC_ISC")   # B_OFFGAS 与 B_BMS 共享 BMS_CONTACTOR_FAIL
    exact = quantify_event_tree(model, "TR")["sequences"]
    indep = _independent_cascade(model)
    assert any(abs(exact[k] - indep[k]) > 1e-12 for k in exact), \
        "共享事件下引擎精确值应不同于独立积式"

def test_no_shared_event_matches_independent():
    model = build_scenario_model("SC_EXT_FIRE")  # 全平凡 FT, 无共享
    exact = quantify_event_tree(model, "TR")["sequences"]
    indep = _independent_cascade(model)
    for k in exact:
        assert abs(exact[k] - indep[k]) <= 1e-12 * max(1.0, abs(exact[k]))
```

- [ ] **Step 2: 跑测试** — `... -m pytest tests/test_fta_on_eta.py -q` → 应 PASS（若 `test_shared_event...` 失败,说明共享事件没生效,检查 `_ft_offgas_shared` 与 `_ft_bms` 都含 `BMS_CONTACTOR_FAIL` 且 `quantify_event_tree` 合并 PDAG）。

- [ ] **Step 3: 提交**

```bash
git add tests/test_fta_on_eta.py
git commit -m "test(bess): 验证 FTA 挂载 ETA 下共享事件的精确否定 ≠ 独立积式"
```

### Task 8: 前端功能事件下钻看故障树

**Files:**
- Modify: `backend/app.py`（event-tree 响应加 `fault_trees` + `parameters` 序列化）
- Modify: `psaengine/model/json_io.py`（抽出可复用序列化助手)
- Modify: `frontend/src/api.ts`、`frontend/src/components/EventTreeEditor.tsx`

- [ ] **Step 1: `json_io.py` 抽出助手**（重构 `save_model` 复用,行为不变）

```python
def node_to_json(n) -> dict:
    if n.is_basic: return {"id": n.id, "basic": True, "param_ref": n.param_ref}
    if n.is_house: return {"id": n.id, "house": True, "state": n.state}
    out = {"id": n.id, "op": n.op.value, "args": n.args}
    if n.k is not None: out["k"] = n.k
    return out

def fault_tree_to_dict(name: str, ft) -> dict:
    return {"name": name, "top": ft.top, "nodes": [node_to_json(ft.pdag.node(i)) for i in ft.pdag.nodes]}

def parameters_to_json(plib) -> list[dict]:
    return [{"id": p, **{k: v for k, v in vars(plib.get(p)).items()
             if k not in ("id", "distribution") and v is not None}} for p in plib.ids()]
```

然后把 `save_model` 内部改为调用 `node_to_json` / `fault_tree_to_dict` / `parameters_to_json`（保持输出结构一致）。跑现有 json_io 往返测试确认不破:`... -m pytest tests/ -k json -q`。

- [ ] **Step 2: `backend/app.py`** 在 scenario 分支为响应加 `fault_trees`(dict: fe_id → ft dict)与 `parameters`(list):

```python
    # 仅 scenario 分支:序列化供前端下钻与引擎精确量化复用
    from psaengine.model.json_io import fault_tree_to_dict, parameters_to_json
    ft_json = {name: fault_tree_to_dict(name, ft) for name, ft in model.fault_trees.items()}
    params_json = parameters_to_json(model.parameters)
```

并在返回 dict 加 `"fault_trees": ft_json if scenario else {}, "parameters": params_json if scenario else []`。

- [ ] **Step 3: `api.ts`** `BessEventTree` 接口加 `fault_trees?: Record<string, any>` 与 `parameters?: any[]`。

- [ ] **Step 4: `EventTreeEditor.tsx`** — 选中分支节点时,若该深度功能事件有非平凡 FT(`fault_trees[feId].nodes.length > 2`),显示「查看故障树」按钮,点开在内嵌只读 `FaultTreeCanvas`(复用)渲染该 FT。此步可与 P4 合并显示;最小实现先在右栏列出该 FT 的门/基本事件文本树。

- [ ] **Step 5: 构建 + `preview_eval`** 验证选中 B_BMS 深度的分支后出现其子事件（SENSOR/LOGIC/CONTACTOR）。

- [ ] **Step 6: 提交**

```bash
git add psaengine/model/json_io.py backend/app.py frontend/src/api.ts frontend/src/components/EventTreeEditor.tsx
git commit -m "feat: 事件树响应序列化故障树 + 前端 FE 下钻"
```

---

## P4 — ROADMAP A：可编辑事件树接回引擎精确定量

### Task 9: `/api/event-tree/quantify` 端点

**Files:**
- Create: `backend/et_builder.py`
- Modify: `backend/schemas.py`
- Modify: `backend/app.py`
- Test: `tests/backend/test_event_tree_quantify_api.py`

- [ ] **Step 1: 写失败测试** `tests/backend/test_event_tree_quantify_api.py`

```python
from fastapi.testclient import TestClient
from backend.app import app

def _pfd_only_request():
    # 两屏障级联, 纯 PFD, 无共享 → 引擎=独立积式
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

def test_pfd_only_matches_product():
    c = TestClient(app)
    r = c.post("/api/event-tree/quantify", json=_pfd_only_request())
    assert r.status_code == 200
    seq = r.json()["sequences"]
    assert abs(seq["L0"] - 0.9) < 1e-12
    assert abs(seq["L1"] - 0.1 * 0.8) < 1e-12
    assert abs(seq["L2"] - 0.1 * 0.2) < 1e-12

def test_shared_event_via_linked_ft_differs_from_product():
    # FE1, FE2 共享基本事件 X → 引擎精确否定 ≠ 朴素积式
    req = {
        "init_event": "IE", "init_frequency": 1.0,
        "functional_events": [{"id": "FE1", "link_ft": "FT1"}, {"id": "FE2", "link_ft": "FT2"}],
        "fault_trees": {
            "FT1": {"name": "FT1", "top": "FE1", "nodes": [
                {"id": "X", "basic": True, "param_ref": "X"},
                {"id": "A", "basic": True, "param_ref": "A"},
                {"id": "FE1", "op": "or", "args": ["X", "A"]}]},
            "FT2": {"name": "FT2", "top": "FE2", "nodes": [
                {"id": "X", "basic": True, "param_ref": "X"},
                {"id": "B", "basic": True, "param_ref": "B"},
                {"id": "FE2", "op": "or", "args": ["X", "B"]}]},
        },
        "parameters": {"X": {"value": 0.1}, "A": {"value": 0.1}, "B": {"value": 0.1}},
        "sequences": [
            {"path": {"FE1": "failure", "FE2": "failure"}, "end_state": "LL"},
            {"path": {"FE1": "success"}, "end_state": "S"},
            {"path": {"FE1": "failure", "FE2": "success"}, "end_state": "FS"},
        ],
        "consequence_bins": {"LL": "C3", "FS": "C2", "S": "C1"},
    }
    c = TestClient(app)
    seq = c.post("/api/event-tree/quantify", json=req).json()["sequences"]
    # P(FE1)=P(X∪A)=0.19; 独立积式 LL≈0.19*0.19=0.0361
    # 精确: P(FE1∧FE2)=P((X∪A)∧(X∪B)) 因共享 X 而 >0.0361
    assert seq["LL"] > 0.0361 + 1e-6
```

- [ ] **Step 2: 跑测试确认失败** → 404。

- [ ] **Step 3: `schemas.py` 加模型**

```python
class FuncEventIn(BaseModel):
    id: str
    pfd: Optional[float] = None
    link_ft: Optional[str] = None

class EtQuantifyRequest(BaseModel):
    init_event: str
    init_frequency: float
    functional_events: list[FuncEventIn]
    fault_trees: dict[str, Any] = {}
    parameters: dict[str, Any] = {}
    sequences: list[dict]
    consequence_bins: dict[str, str]

class EtQuantifyResponse(BaseModel):
    sequences: dict[str, float]
    consequences: dict[str, float]
```

- [ ] **Step 4: 写 `backend/et_builder.py`**（复用 `load_model_from_dict`,DRY）

```python
from __future__ import annotations
from psaengine.model.json_io import load_model_from_dict
from psaengine.model.model import Model

def build_model_from_request(req: dict) -> Model:
    params: list[dict] = []
    fault_trees: list[dict] = []
    fes: list[dict] = []
    for fe in req["functional_events"]:
        fid = fe["id"]
        if fe.get("link_ft"):
            spec = req["fault_trees"][fe["link_ft"]]
            fault_trees.append({"name": fid, "top": spec["top"], "nodes": spec["nodes"]})
        else:
            params.append({"id": fid, "kind": "probability", "value": float(fe["pfd"])})
            fault_trees.append({"name": fid, "top": fid, "nodes": [
                {"id": fid + "_E", "basic": True, "param_ref": fid},
                {"id": fid, "op": "null", "args": [fid + "_E"]}]})
        fes.append({"id": fid, "link_ft": fid})
    for pid, spec in req.get("parameters", {}).items():
        val = spec["value"] if isinstance(spec, dict) else spec
        params.append({"id": pid, "kind": "probability", "value": float(val)})
    model_dict = {
        "model_data": {"parameters": params},
        "fault_trees": fault_trees,
        "event_trees": [{
            "name": "TR", "init_event": req["init_event"],
            "init_frequency": req["init_frequency"], "functional_events": fes,
            "sequences": req["sequences"], "consequence_bins": req["consequence_bins"]}],
        "ccf_groups": [],
    }
    return load_model_from_dict(model_dict)
```

注:`load_model_from_dict` 对每个 FT 单独建 PDAG;`quantify_event_tree` 再把所有 FT 节点按 id 合并到一个大 PDAG（共享 `X` 自动合并）→ 精确否定生效。

- [ ] **Step 5: `backend/app.py` 加端点**

```python
@app.post("/api/event-tree/quantify", response_model=schemas.EtQuantifyResponse)
def api_event_tree_quantify(req: schemas.EtQuantifyRequest):
    from backend.et_builder import build_model_from_request
    from psaengine.eta.sequence import quantify_event_tree
    model = build_model_from_request(req.model_dump())
    res = quantify_event_tree(model, "TR")
    return schemas.EtQuantifyResponse(sequences=res["sequences"], consequences=res["consequences"])
```

- [ ] **Step 6: 跑测试确认通过 + 全量回归**。

- [ ] **Step 7: 提交**

```bash
git add backend/et_builder.py backend/schemas.py backend/app.py tests/backend/test_event_tree_quantify_api.py
git commit -m "feat(api): POST /api/event-tree/quantify 引擎精确定量(ROADMAP A)"
```

### Task 10: 前端 `toEngineRequest` + 引擎精确量化按钮

**Files:**
- Modify: `frontend/src/eventtree.ts`
- Modify: `frontend/src/api.ts`
- Modify: `frontend/src/components/EventTreeEditor.tsx`

- [ ] **Step 1: `eventtree.ts` 加序列化**（DFS 枚举叶 → sequences；功能事件默认带 pfd,若 model 携带 `linkedFts` 则用 link_ft）

```ts
export interface EtQuantifyRequest {
  init_event: string; init_frequency: number
  functional_events: { id: string; pfd?: number; link_ft?: string }[]
  fault_trees: Record<string, any>; parameters: Record<string, any>
  sequences: { path: Record<string, string>; end_state: string }[]
  consequence_bins: Record<string, string>
}

export function toEngineRequest(
  m: EventTreeModel,
  linked?: { fault_trees: Record<string, any>; parameters: any[] },
): EtQuantifyRequest {
  const seqs: { path: Record<string, string>; end_state: string }[] = []
  const bins: Record<string, string> = {}
  let leaf = 0
  function walk(n: EtNode, path: Record<string, string>, depth: number) {
    if (n.kind === 'leaf') {
      const es = `L${leaf++}`; seqs.push({ path: { ...path }, end_state: es }); bins[es] = n.consequence; return
    }
    const feId = m.functionalEvents[depth]?.id ?? `FE${depth}`
    walk(n.success, { ...path, [feId]: 'success' }, depth + 1)
    walk(n.failure, { ...path, [feId]: 'failure' }, depth + 1)
  }
  walk(m.root, {}, 0)
  const ftMap = linked?.fault_trees ?? {}
  const fes = m.functionalEvents.map((fe) =>
    ftMap[fe.id] && ftMap[fe.id].nodes && ftMap[fe.id].nodes.length > 2
      ? { id: fe.id, link_ft: fe.id }
      : { id: fe.id, pfd: fe.failProb })
  const parameters: Record<string, any> = {}
  for (const p of linked?.parameters ?? []) parameters[p.id] = { value: p.value }
  return { init_event: m.initEvent, init_frequency: m.initFreq, functional_events: fes,
           fault_trees: ftMap, parameters, sequences: seqs, consequence_bins: bins }
}
```

- [ ] **Step 2: `api.ts`** 加 `export const quantifyEventTree = (req: any) => fetch(\`${BASE}/event-tree/quantify\`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(req) }).then(r => { if(!r.ok) throw new Error('et quantify '+r.status); return r.json() })`,返回类型 `{ sequences: Record<string,number>; consequences: Record<string,number> }`。

- [ ] **Step 3: `EventTreeEditor.tsx`** 加 props `linked?: { fault_trees; parameters }`;加「引擎精确量化」按钮,点后 `const res = await quantifyEventTree(toEngineRequest(model, linked))`,存 `engineSeq` state;在叶子频率旁,若 `engineSeq[end_state]` 与前端 `freq` 相对差 >1e-9 则显示引擎值并标橙 + tooltip「含共享事件,以引擎精确值为准」。需要把 layout 的 leaf 顺序与 `toEngineRequest` 的 `L{i}` 对齐(两者都按 DFS success 优先,顺序一致)。

- [ ] **Step 4: `App.tsx`** 把 `bess.fault_trees`/`bess.parameters` 作为 `linked` 传入 `EventTreeEditor`。

- [ ] **Step 5: 构建 + `preview_eval`** 验证:选 SC_ISC → 点引擎精确量化 → 至少一个叶显示引擎值且与前端积式不同(共享事件)。

- [ ] **Step 6: 提交**

```bash
git add frontend/src/eventtree.ts frontend/src/api.ts frontend/src/components/EventTreeEditor.tsx frontend/src/App.tsx
git commit -m "feat(frontend): 事件树引擎精确量化(ROADMAP A 前端接回)"
```

---

## P5 — 结果用风险矩阵

### Task 11: 风险矩阵纯函数 + 组件

**Files:**
- Create: `frontend/src/riskmatrix.ts`
- Create: `frontend/src/components/RiskMatrix.tsx`
- Modify: `frontend/src/components/EventTreeEditor.tsx`

- [ ] **Step 1: 写 `frontend/src/riskmatrix.ts`**（纯函数,带可配置常量）

```ts
// 频率带(/站·年),由低到高;severity C1..C5 = 1..5
export const FREQ_BANDS = [
  { code: 'F1', label: '极不可能', max: 1e-6 },
  { code: 'F2', label: '不可能', max: 1e-4 },
  { code: 'F3', label: '偶尔', max: 1e-2 },
  { code: 'F4', label: '可能', max: 1 },
  { code: 'F5', label: '频繁', max: Infinity },
]
export const SEVERITY = ['C5', 'C4', 'C3', 'C2', 'C1'] // 行:上=最严重
export const SEV_RANK: Record<string, number> = { C1: 1, C2: 2, C3: 3, C4: 4, C5: 5 }

export function freqBandIndex(freq: number): number {
  if (freq <= 0) return 0
  for (let i = 0; i < FREQ_BANDS.length; i++) if (freq < FREQ_BANDS[i].max) return i
  return FREQ_BANDS.length - 1
}
/** 风险指数 = 严重度秩 × 频率秩(1..25) → 四级。 */
export function riskLevel(sevRank: number, freqRank: number): 'low' | 'medium' | 'high' | 'extreme' {
  const s = sevRank * freqRank
  if (s <= 4) return 'low'
  if (s <= 9) return 'medium'
  if (s <= 14) return 'high'
  return 'extreme'
}
export const RISK_COLOR: Record<string, string> = {
  low: '#16a34a', medium: '#eab308', high: '#f97316', extreme: '#dc2626',
}
```

- [ ] **Step 2: 写 `RiskMatrix.tsx`**

```tsx
import { FREQ_BANDS, SEVERITY, SEV_RANK, freqBandIndex, riskLevel, RISK_COLOR } from '../riskmatrix'

const C_LABEL: Record<string, string> = {
  C1: '单体排气', C2: '模组蔓延', C3: '簇/舱火灾', C4: '多舱火灾', C5: '爆燃/爆炸',
}

export function RiskMatrix({ totals }: { totals: Record<string, number> }) {
  const placed: Record<string, number> = {} // Cx -> band index
  for (const c of Object.keys(totals)) if ((totals[c] ?? 0) > 0) placed[c] = freqBandIndex(totals[c])
  const th: any = { padding: '4px 6px', fontSize: 11, color: '#475569', border: '1px solid #e2e8f0' }
  return (
    <div>
      <table style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr><th style={th}></th>{FREQ_BANDS.map((f) => <th key={f.code} style={th}>{f.label}<br />{f.code}</th>)}</tr>
        </thead>
        <tbody>
          {SEVERITY.map((sev) => (
            <tr key={sev}>
              <th style={th}>{sev} {C_LABEL[sev]}</th>
              {FREQ_BANDS.map((_, fi) => {
                const lvl = riskLevel(SEV_RANK[sev], fi + 1)
                const here = placed[sev] === fi
                return (
                  <td key={fi} style={{ width: 78, height: 40, border: '1px solid #e2e8f0',
                    background: RISK_COLOR[lvl], opacity: here ? 1 : 0.28, textAlign: 'center',
                    color: '#fff', fontSize: 11, fontWeight: 700 }}>
                    {here ? `${sev}: ${totals[sev].toExponential(1)}` : ''}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ fontSize: 11, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a',
        padding: 8, borderRadius: 6, marginTop: 8 }}>
        ⚠ 频率带与可接受准则为示意默认值,须按项目/法规校核。颜色:绿低 / 黄中 / 橙高 / 红极高。
      </div>
    </div>
  )
}
```

- [ ] **Step 3: 接入 `EventTreeEditor.tsx`** — 在右栏「后果频率」条形图下方加 `<h4>风险矩阵</h4><RiskMatrix totals={engineSeq ? consequencesFromEngine : totals} />`。`totals` 已有(`consequenceTotals(model)`);若有引擎精确结果则用其 `consequences`。

- [ ] **Step 4: 纯函数手验**(在 node 内联或临时脚本):`freqBandIndex(5e-5)===1`、`freqBandIndex(0.5)===3`、`riskLevel(5,5)==='extreme'`、`riskLevel(1,1)==='low'`、`riskLevel(3,3)==='medium'`(9)、`riskLevel(4,3)==='high'`(12)。

- [ ] **Step 5: 构建 + `preview_eval`** 验证矩阵渲染(`document.querySelectorAll('table td').length` ≈ 25)且有高亮格。

- [ ] **Step 6: 提交**

```bash
git add frontend/src/riskmatrix.ts frontend/src/components/RiskMatrix.tsx frontend/src/components/EventTreeEditor.tsx
git commit -m "feat(frontend): 风险矩阵(频率×严重度)结果展示"
```

---

## P6 — ROADMAP D：引擎 CUDD 后端（抽象 + 适配器，Linux 验证）

### Task 12: BddManager 遍历协议 + exact_probability 走协议

**Files:**
- Modify: `psaengine/bdd/kernel.py`
- Modify: `psaengine/quantify/probability.py`
- Test: `tests/test_bdd_protocol.py`

- [ ] **Step 1: 读 `psaengine/quantify/probability.py`** 看 `exact_probability` 当前如何遍历(是否直接用 `m._nodes`/`m._top_var`/`m._cofactor`)。记录需要的遍历原语。

- [ ] **Step 2: `kernel.py` 暴露公有遍历协议**(在 `BddManager` 加,薄封装现有内部方法,行为不变)

```python
    # ---- 遍历协议(供量化与替代后端共用) ----
    def is_terminal(self, h) -> bool:
        return h in (self.ZERO, self.ONE)
    def terminal_value(self, h) -> int:
        return 1 if h == self.ONE else 0
    def top_var_index(self, h) -> int:
        return self._top_var(h)
    def cofactor(self, h, var_index: int, val: int):
        return self._cofactor(h, var_index, val)
    def var_name(self, var_index: int) -> str:
        return self.var_order[var_index]
```

- [ ] **Step 3: 写测试** `tests/test_bdd_protocol.py`（协议自洽 + 与旧路径结果一致)

```python
from psaengine.bdd.kernel import BddManager, build_from_pdag
from psaengine.model.pdag import PDAG, Op
from psaengine.quantify.probability import exact_probability

def _model():
    g = PDAG(); g.basic("a"); g.basic("b"); g.gate("T", Op.OR, ["a", "b"]); g.top = "T"
    m = BddManager(["a", "b"]); root = build_from_pdag(m, g, "T")
    return m, root, {"a": 0.1, "b": 0.2}

def test_protocol_methods_consistent():
    m, root, q = _model()
    assert not m.is_terminal(root)
    assert m.is_terminal(m.one) and m.terminal_value(m.one) == 1
    ti = m.top_var_index(root)
    assert m.var_name(ti) in ("a", "b")

def test_exact_probability_or():
    m, root, q = _model()
    assert abs(exact_probability(m, root, q) - (1 - 0.9 * 0.8)) < 1e-12
```

- [ ] **Step 4: 重构 `exact_probability`** 改用协议方法(`m.is_terminal/terminal_value/top_var_index/cofactor/var_name`)替代直接访问 `m._nodes` 等。保持算法(Shannon 展开 + 记忆化)与签名不变。

- [ ] **Step 5: 跑测试 + 全量回归** — `... -m pytest tests/test_bdd_protocol.py -q` 与 `... -m pytest -q`(必须仍 ≥85 绿,证明重构行为不变)。

- [ ] **Step 6: 提交**

```bash
git add psaengine/bdd/kernel.py psaengine/quantify/probability.py tests/test_bdd_protocol.py
git commit -m "refactor(engine): BddManager 遍历协议; exact_probability 走协议(为 CUDD 后端铺路)"
```

### Task 13: CUDD 适配器 + 工厂 + 跳过式 parity 测试 + 文档

**Files:**
- Create: `psaengine/bdd/cudd_backend.py`
- Modify: `psaengine/bdd/kernel.py`（加 `make_manager`)
- Test: `tests/test_cudd_parity.py`
- Modify: `docs/superpowers/ROADMAP.md`

- [ ] **Step 1: 写 `psaengine/bdd/cudd_backend.py`**（包 `dd.cudd`,实现同协议 + `build_from_pdag` 兼容;import 失败时本模块仍可被导入但 `CuddBddManager()` 抛 RuntimeError)

```python
from __future__ import annotations
try:
    from dd import cudd as _cudd
    _HAVE = True
except Exception:
    _cudd = None
    _HAVE = False

class CuddBddManager:
    """dd.cudd 后端, 暴露与纯 Python BddManager 相同的遍历协议。
    handle = dd.cudd.Function。需 Cython+CUDD 编译(见 ROADMAP D 注记)。"""
    def __init__(self, var_order: list[str]):
        if not _HAVE:
            raise RuntimeError("dd.cudd 不可用; 需在 Linux/WSL 编译 dd 的 CUDD 扩展")
        self.var_order = list(var_order)
        self.var_index = {v: i for i, v in enumerate(var_order)}
        self._bdd = _cudd.BDD()
        self._bdd.declare(*var_order)
    @property
    def one(self): return self._bdd.true
    @property
    def zero(self): return self._bdd.false
    def var(self, name: str): return self._bdd.var(name)
    def apply_and(self, f, g): return f & g
    def apply_or(self, f, g): return f | g
    def apply_not(self, f): return ~f
    def ite(self, f, g, h): return self._bdd.ite(f, g, h)
    # ---- 协议 ----
    def is_terminal(self, h) -> bool: return h == self._bdd.true or h == self._bdd.false
    def terminal_value(self, h) -> int: return 1 if h == self._bdd.true else 0
    def top_var_index(self, h) -> int:
        return len(self.var_order) if self.is_terminal(h) else self.var_index[h.var]
    def cofactor(self, h, var_index: int, val: int):
        if self.is_terminal(h) or self.var_index[h.var] != var_index: return h
        return h.high if val == 1 else h.low
    def var_name(self, var_index: int) -> str: return self.var_order[var_index]
```

- [ ] **Step 2: `kernel.py` 加工厂**

```python
def make_manager(var_order: list[str], backend: str = "python"):
    if backend == "cudd":
        from psaengine.bdd.cudd_backend import CuddBddManager
        return CuddBddManager(var_order)
    return BddManager(var_order)
```

- [ ] **Step 3: 写 `tests/test_cudd_parity.py`**（`dd.cudd` 不可用即 skip)

```python
import pytest
cudd = pytest.importorskip("dd.cudd")
from psaengine.bdd.kernel import make_manager, build_from_pdag
from psaengine.model.pdag import PDAG, Op
from psaengine.quantify.probability import exact_probability

def _pdag():
    g = PDAG(); g.basic("a"); g.basic("b"); g.basic("c")
    g.gate("g1", Op.AND, ["a", "b"]); g.gate("T", Op.OR, ["g1", "c"]); g.top = "T"
    return g

def test_cudd_matches_python_top_probability():
    g = _pdag(); order = ["a", "b", "c"]; q = {"a": 0.1, "b": 0.2, "c": 0.05}
    mp = make_manager(order, "python"); rp = build_from_pdag(mp, g, "T")
    mc = make_manager(order, "cudd");  rc = build_from_pdag(mc, g, "T")
    assert abs(exact_probability(mp, rp, q) - exact_probability(mc, rc, q)) < 1e-12
```

- [ ] **Step 4: 跑测试** — `... -m pytest tests/test_cudd_parity.py -q`。本机预期 **SKIPPED**(`dd.cudd` 未编译)。记录该结果,不得伪称通过。

- [ ] **Step 5: 试装 `dd`(诚实探测)** — `.\.venv\Scripts\python.exe -c "import dd.cudd"`;若 ImportError,在 ROADMAP D 写明:Windows 无预编译 CUDD 轮子,须 WSL/Linux `pip install dd --install-option=--fetch --install-option=cudd` 或源码 `python setup.py install --fetch --cudd` 后 `pytest tests/test_cudd_parity.py` 验证。

- [ ] **Step 6: 更新 `docs/superpowers/ROADMAP.md`** — A 标记完成(指向 `/api/event-tree/quantify`);D 标记「接口抽象 + CUDD 适配器已交付,完整 parity 验证待 Linux/WSL」;新增「预置库 / 多场景 / 风险矩阵」到现状快照。

- [ ] **Step 7: 提交**

```bash
git add psaengine/bdd/cudd_backend.py psaengine/bdd/kernel.py tests/test_cudd_parity.py docs/superpowers/ROADMAP.md
git commit -m "feat(engine): CUDD 后端适配器 + make_manager 工厂 + 跳过式 parity 测试(ROADMAP D 抽象)"
```

---

## 收尾

- [ ] **全量回归** — `.\.venv\Scripts\python.exe -m pytest -q`(后端全绿 + 新增;CUDD parity SKIPPED 合理)。
- [ ] **前端构建** — `npm run build --prefix frontend` 成功。
- [ ] **端到端 `preview_eval` 巡检** — 参考库三表 / 场景切换 / 引擎精确量化差异 / 风险矩阵高亮。
- [ ] **更新 MEMORY**(若有 Phase 进展值得记)。

## 自检(写完计划对照 spec)

- spec P1→Task1-3;P2→Task4-6;P3→Task4(构建)+7-8;P4(ROADMAP A)→Task9-10;P5→Task11;P6(ROADMAP D)→Task12-13。全覆盖。
- 类型一致:`load_library`/`build_scenario_model`/`load_scenarios`/`toEngineRequest`/`build_model_from_request`/`make_manager`/`riskLevel`/`freqBandIndex` 跨任务命名一致。
- 无占位符:各步含可执行代码与命令。
- 风险:Task5 替换旧 `api_bess_event_tree`(注意删旧定义避免重复路由);Task8/12 重构既有文件须立即全量回归;Task13 CUDD 本机 skip(诚实交付)。
