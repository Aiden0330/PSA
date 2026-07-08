# 深化 QRA:事件树不确定性带 + 真实(扰动法)屏障重要度 — 设计文档

- 日期:2026-06-21 · 分支 `feat/qra-uncertainty-importance`
- 状态:**已确认方案 A(扰动法/屏障级 FV/RAW)+ 带表+误差棒展示,待 spec 复核**
- 方法:TDD(后端 pytest 先写失败测试);前端 build + `preview_eval`;每部分一 commit

## 0. 目标(任务 5)

把 ETA 量化从"点估计"深化为可支撑决策:
1. **不确定性带**:对事件树各底事件做蒙特卡洛(对数正态 EF=3),给每个后果 C1–C5 出 p05/p50/p95 + 点估计。
2. **真实屏障重要度**:用**扰动法**算各屏障对**所选后果**频率的 Fussell-Vesely(FV)与 Risk Achievement Worth(RAW),取代现严重度加权代理。

适用于预置场景与前端编辑/自定义 ETA(均经 `EtQuantifyRequest` 路径)。后续 6/7/8 独立。

## 1. 现状关键事实

- `psaengine/eta/sequence.py::quantify_event_tree(model, et_name)`:合并各功能事件链接的 FT 到一个 PDAG、同一 `BddManager`、精确否定;返回 `{sequences, consequences}`。
- `bess/report.py::_uncertainty(model, samples, seed)`:对 PFD 采样(对数正态 EF=3)重算事件树出 p05/p50/p95,但**硬编码 `load_data()["barriers"]` 与按 barrier id 取参数** → 仅适配默认 TR 模型,不适配带分解 FT 的场景(其参数是底事件 id)。
- `bess/report.py::_barrier_importance(model)`:严重度加权**代理**(非引擎 FV/RAW)。
- `Analysis.importance` 给单 FT 的 FV/RAW,但事件树无单一顶事件 → 需针对"后果频率"定义重要度。
- 后端 `POST /api/event-tree/quantify`(`backend/et_builder.py::build_model_from_request` 复用 `load_model_from_dict`)已可由前端序列化 ETA 构 `Model`。
- 前端 `EventTreeEditor.tsx` 已有「引擎精确量化」+ 后果条形图 + 风险矩阵;`api.ts::quantifyEventTree`。

## 2. 设计

### 2.1 引擎:抽出构建 + 扰动支持(`psaengine/eta/sequence.py`)

抽出 `_build_event_tree(model, et_name)`(合并 PDAG + 建 BDD,**一次**),返回 `(et, big, m, all_basics, fe_bdd)`。`quantify_event_tree` 复用之,并加可选参数:

```python
def quantify_event_tree(model, et_name, fe_overrides: dict | None = None) -> dict:
    et, big, m, all_basics, fe_bdd = _build_event_tree(model, et_name)
    if fe_overrides:
        for fid, mode in fe_overrides.items():
            fe_bdd[fid] = m.one if mode == "fail" else m.zero   # 强制 FE 顶为常量
    q = {b: model.parameters.get(big.nodes[b].param_ref).unavailability() for b in all_basics}
    # ... 原序列循环不变 ...
```

`fe_overrides=None` 时**行为完全不变**(回归须全绿)。`"fail"`→FE 顶=1(必失效,success 序列归零);`"work"`→FE 顶=0(必有效,failure 序列归零)。强制的是 FE 顶 BDD,**不动其底事件**,故共享底事件场景下其他屏障不受影响 → 正确。

### 2.2 引擎:事件树蒙特卡洛(新 `psaengine/eta/uncertainty.py`)

```python
def event_tree_uncertainty(model, et_name, samples=1000, seed=42, error_factor=3.0) -> dict:
    # 建一次: 合并 PDAG + BDD + 各序列 expr(成功用 not、失败用 g 的 apply_and 积)
    # 每样本仅重采样 q(各底事件 lognormal(median=nominal, EF), clip[0,1]; 共享底事件一次采样→相关)
    # 对每序列 exact_probability(m, expr, q) → 聚合到后果; 收集 samples 条
    # 返回 {"point": {Cx: f}, "bands": {Cx: {"p05","p50","p95"}}}
```

要点:**结构建一次、只变概率**(比 `report.py` 每样本重建快得多)。`init_frequency` 本身视为定值(仅 PFD/底事件不确定;若后续要采样 IE 频率再扩展)。退化:某 nominal=0 → 该底事件恒 0。

### 2.3 引擎:扰动法屏障重要度(`psaengine/eta/uncertainty.py`)

```python
def barrier_importance_exact(model, et_name) -> dict:
    base = quantify_event_tree(model, et_name)["consequences"]
    pert = {}
    for fe in et.functional_events:
        pert[(fe.id, "work")] = quantify_event_tree(model, et_name, {fe.id: "work"})["consequences"]
        pert[(fe.id, "fail")] = quantify_event_tree(model, et_name, {fe.id: "fail"})["consequences"]
    # 每后果 c: R=base[c]; FV=(R-R_work)/R; RAW=R_fail/R(R=0 时记 0)
    return {c: sorted([...{"barrier","fv","raw"}], key=-fv) for c in C1..C5}
```

共 2N+1 次量化(每次给全部后果),N=屏障数 → 小模型 <1s。

### 2.4 后端端点(`backend/app.py` + `schemas.py`)

```python
class EtUncertaintyRequest(EtQuantifyRequest):
    samples: int = 1000
    seed: int = 42
    error_factor: float = 3.0

# POST /api/event-tree/uncertainty -> {"point": {...}, "bands": {Cx: {p05,p50,p95}}}
# POST /api/event-tree/importance  (入参 EtQuantifyRequest) -> {"importance": {Cx: [{barrier,fv,raw}]}}
```

两端点都 `build_model_from_request(req)` 后调上面引擎函数。

### 2.5 前端

- `api.ts`:`uncertaintyEventTree(req)`、`importanceEventTree(req)` + 类型。
- `EventTreeEditor.tsx`:加「**深化分析**(不确定性+重要度)」按钮(与「引擎精确量化」并列,独立以免拖慢快路径)。点击后:
  - **不确定性**:后果**带表**(后果 / 点估计 / p05 / p50 / p95);并给现有后果条形图加**误差棒**(echarts `custom` renderItem,按 p05–p95 画竖线+端帽)。
  - **重要度**:**后果选择器**(C1–C5,默认 C5)+ 该后果下各屏障 **FV/RAW 表**(降序),取代严重度加权代理列表。
- 屏障标签:预置用 `bess.labels`,自定义用 `fe.id`。

## 3. 文件改动

**新增**:`psaengine/eta/uncertainty.py`;测试 `tests/test_eta_uncertainty.py`、`tests/test_eta_importance.py`、`tests/backend/test_qra_api.py`。
**修改**:`psaengine/eta/sequence.py`(抽 `_build_event_tree` + `fe_overrides`);`backend/schemas.py`(+2 模型);`backend/app.py`(+2 端点);`frontend/src/api.ts`、`frontend/src/components/EventTreeEditor.tsx`。

## 4. 构建顺序与验收

| # | 部分 | 验收 |
|---|---|---|
| 1 | 引擎 `_build_event_tree` + `fe_overrides` | 重构后全量回归仍绿;override "fail"/"work" 使对应序列归零(单测) |
| 2 | `event_tree_uncertainty` | p05≤p50≤p95;点估计落区间内;退化(EF→1)带≈点;含共享事件场景可跑(单测) |
| 3 | `barrier_importance_exact` | FV≤1、RAW≥0(**良性后果**如 C1 需屏障成功 → FV 可为负、RAW 可<1,属正常);最严重后果(全失效=C5)每屏障 FV=1(强制其 work → C5 归零);不在该后果任何序列里的屏障 FV=0(单测) |
| 4 | 两后端端点 | TestClient 返回结构正确;与引擎函数一致 |
| 5 | 前端深化分析 | 带表 4 列;条形图有误差棒;重要度表随后果切换;`preview_eval` 验证 |

全量:`.\.venv\Scripts\python.exe -m pytest -q`(≥108 绿 + 新增,CUDD 仍 2 skip);`npm run build --prefix frontend` 通过。

## 5. 取默认值 / 风险

- **方案 A 扰动法**(已确认),屏障级,强制 FE 顶 BDD。
- **MC 默认**:samples=1000、EF=3、seed=42;建一次 BDD 仅重采样 → 快。仅采样底事件 PFD(IE 频率定值,后续可扩)。
- **重构 `sequence.py`** 触碰被测函数 → `fe_overrides=None` 保行为不变 + 立即全量回归。
- **不确定性独立按钮**:与引擎精确量化分开,避免 MC 拖慢基本量化。
