# ETA 预置库 + 多事件树 + FTA 挂载 + 风险矩阵 + ROADMAP A/D — 设计文档

- 日期:2026-06-21 · 分支 `main`
- 状态:**待用户批准**
- 方法:TDD(先写失败测试)、每部分一 commit、结尾 `Co-Authored-By: Claude Opus 4.8`
- 参考:`D:\ETA_claude\eta-tool`(设计文档 `docs/superpowers/specs/2026-06-10-eta-tool-design.md`)

## 0. 目标

在现有 BESS PSA 工具(引擎 `psaengine/` + 领域 `bess/` + Web `backend/`+`frontend/`)上,参考 `D:\ETA_claude` 工具,完成:

1. **预置基础失效率与防护措施有效性数据**(带来源引用)。
2. **内置多个 ETA**(多场景事件树模板)。
3. **FTA 挂载在 ETA 上**(功能事件由故障树支撑,引擎精确定量)。
4. **结果用风险矩阵显示**(频率 × 严重度)。
5. ROADMAP **A**(可编辑事件树接回引擎精确定量)。
6. ROADMAP **D**(引擎 CUDD 后端,接口抽象 + 适配器,Linux 验证)。

## 1. 现状关键事实(决定设计)

- **引擎已支持 FTA-on-ETA**:`psaengine/model/event_tree.py` 的 `FunctionalEvent.link_ft`;`psaengine/eta/sequence.py` 的 `quantify_event_tree` 把所有功能事件链接的故障树合并进一个 `PDAG`、用同一 `BddManager` 做**精确否定**(成功分支 = `apply_not`),跨序列共享基本事件自动正确。→ 任务 3 与 ROADMAP A 是同一能力的两面;缺的是**数据预置**与**前端接回**。
- **现有数据** `bess/tr_model_data.json`:5 初因(`freq_prior`)、6 屏障(`pfd_prior`,含 source/note,B_DEFLAG 带 `eff`)、5 后果 C1–C5、precursors、domain_anchors。
- **参考工具精华**:器件基础失效率库 + 防护措施有效性库,每条带 `SourceRef {citation,url,note}`;终态按 severity 着色;UI 免责声明(参考量级,工程须校核)。
- **前端**:3 标签(故障树可编辑 / 参数库·CCF / BESS 事件树);`EventTreeEditor` 用**前端积式频率**(独立屏障下精确);结果用条形图。
- **BddManager 接口**(`psaengine/bdd/kernel.py`):`one/zero/var/ite/apply_and|or|not/eval`;`exact_probability` 等量化函数依赖内部 `_top_var/_cofactor/_nodes`(D 的抽象点)。
- **约束**(ROADMAP §4):Node 20.12 → Vite5/React18/echarts5/ag-grid32;引擎 CLI `python -m psaengine.cli`;后端测试 `.\.venv\Scripts\python.exe -m pytest -q`(当前 85 绿);前端 `preview_screenshot` 对重前端超时,用 `preview_eval` 验 DOM。

## 2. 设计:六部分

### P1 — 预置数据库(带来源)

**新增** `bess/reference_data.json`(纯增量,不动 `tr_model_data.json`):

```jsonc
{
  "meta": { "disclaimer": "内置数值为公开来源参考量级,用于演示与初筛;正式工程分析须按项目实测数据校核替换。" },
  "component_failure_rates": [
    {"id":"CFR_CELL_TR","name":"锂离子电芯 / 热失控","failure_mode":"热失控","rate":1e-7,"unit":"/cell·yr",
     "source":{"citation":"EPRI BESS Failure Incident Database (2023)","note":"场致失效约 ppm 级/电芯寿命期"}},
    {"id":"CFR_BMS","name":"BMS 模块 / 功能失效","failure_mode":"功能失效","rate":1e-5,"unit":"/h",
     "source":{"citation":"NPRD-2016; IEEE Std 493-2007"}},
    {"id":"CFR_CONTACTOR","name":"直流接触器 / 拒动","failure_mode":"拒动","rate":1e-3,"unit":"/demand",
     "source":{"citation":"OREDA Handbook; exida 通用失效率库"}},
    {"id":"CFR_PCS","name":"PCS(变流器)/ 功能失效","failure_mode":"功能失效","rate":3e-5,"unit":"/h",
     "source":{"citation":"IEEE Std 493-2007; NPRD-2016"}},
    {"id":"CFR_COOLANT","name":"液冷系统 / 冷却能力丧失","failure_mode":"冷却丧失","rate":1e-5,"unit":"/h",
     "source":{"citation":"OREDA Handbook(泵阀类比)"}}
  ],
  "barrier_effectiveness": [
    // 合并参考工具 10 条 + 现有 6 条;按 category: warning|active|passive 分类;pfd = 1 - 有效性
    {"id":"B_OFFGAS","name":"早期离气探测+联动","category":"warning","pfd":0.01,
     "source":{"citation":"IEEE/CCPS LOPA; UL 9540A 排气特性","note":"窗口最长,起火前 2–30 分钟"}},
    {"id":"B_AI_WARN","name":"AI 数据驱动早期预警","category":"warning","pfd":0.10,
     "source":{"citation":"BESS 故障预警算法综述(示例值)"}},
    {"id":"B_GAS_DET","name":"气体探测预警(H₂/CO)","category":"warning","pfd":0.07,
     "source":{"citation":"UL 9540A 排气特性研究"}},
    {"id":"B_BMS","name":"BMS 切断/隔离","category":"active","pfd":0.10,
     "source":{"citation":"DNV/Gully 2019; IEC 61508 SIL 类比","note":"=传感∧逻辑∧接触器,可挂故障树"}},
    {"id":"B_THERMAL","name":"电芯间热障阻断蔓延","category":"passive","pfd":0.10,
     "source":{"citation":"DNV/Gully 2019;气凝胶/云母/膨胀型"}},
    {"id":"B_DEFLAG","name":"舱内泄爆/防爆","category":"passive","pfd":0.10,"eff":0.953,
     "source":{"citation":"PFD: LOPA; η: Landucci 2017; NFPA68/69"}},
    {"id":"B_SUPPRESS","name":"舱级气体灭火(全氟己酮)","category":"passive","pfd":0.10,
     "source":{"citation":"NFPA 855; FM Global 5-33"}},
    {"id":"B_WATER","name":"水消防/喷淋","category":"passive","pfd":0.12,
     "source":{"citation":"NFPA 自动喷淋有效性统计 88–96%"}},
    {"id":"B_SPACING","name":"舱间距阻断多舱蔓延","category":"passive","pfd":0.10,
     "source":{"citation":"NFPA 855 默认 ≥3ft/914mm"}},
    {"id":"B_RESPONSE","name":"应急响应(避免开门引气)","category":"passive","pfd":0.10,
     "source":{"citation":"LOPA 人因; McMicken 范式"}}
  ],
  "initiating_events": [ /* 沿用 tr_model_data 的 5 条, 补 source 结构化 */ ]
}
```

- **后端**:`GET /api/bess/library` → 返回 `reference_data.json`。`bess/library.py` 加 `load_library()`(带 schema 校验:source.citation 非空、rate/pfd 在域)。
- **前端**:新增「参考库」标签(只读表,可用现成 ag-grid 或简单表)+ 顶部免责声明。
- **测试**(pytest):`tests/backend/test_library.py` — 每条 source.citation 非空;`0<pfd<1`;`rate>0`;id 唯一。

### P2 — 内置多个 ETA(场景模板)

**新增** `bess/scenarios.json`(场景=初因 + 有序屏障 id + 后果映射)与 `bess/scenarios.py`:

```jsonc
{
  "scenarios": [
    {"id":"SC_ISC","name":"电芯内短 → 热失控","init_event":"IE_ISC",
     "barriers":["B_OFFGAS","B_BMS","B_THERMAL","B_DEFLAG","B_SPACING","B_RESPONSE"]},
    {"id":"SC_OVERCHARGE","name":"过充 / BMS 失效","init_event":"IE_OVERCHARGE",
     "barriers":["B_BMS","B_OFFGAS","B_THERMAL","B_DEFLAG"]},
    {"id":"SC_COOLANT","name":"液冷泄漏 → 外短","init_event":"IE_COOLANT",
     "barriers":["B_OFFGAS","B_BMS","B_THERMAL","B_DEFLAG","B_SPACING"]},
    {"id":"SC_EXT_FIRE","name":"外部火 / 邻舱热辐射","init_event":"IE_EXT_FIRE",
     "barriers":["B_THERMAL","B_DEFLAG","B_SPACING","B_RESPONSE"]},
    {"id":"SC_MECH_WATER","name":"机械损伤 / 进水","init_event":"IE_MECH_WATER",
     "barriers":["B_OFFGAS","B_BMS","B_THERMAL","B_DEFLAG"]}
  ]
}
```

- `build_scenario_model(scenario_id) -> Model`:从 library 取初因频率与屏障 PFD,按级联语义(连续失败 j 道 → 后果 `CONSEQUENCE_AT_DEPTH[j]`,封顶 C5)生成 `EventTree`;屏障默认挂 1-基本事件平凡故障树(`_barrier_ft`),除非 P3 声明了真故障树。
- 复用现有 `CONSEQUENCE_AT_DEPTH`。`build_thermal_runaway_model`(现 `tr_model.py`)保留不动,保证现有测试与 `/api/bess/thermal-runaway` 不破。
- **后端**:`GET /api/bess/scenarios` 列表;`GET /api/bess/event-tree?scenario=SC_ISC`(无参=现行为,向后兼容)。
- **前端**:BESS 事件树标签加场景下拉,切换重建 `EventTreeModel`。
- **测试**:每场景 `quantify_event_tree` 后 `sum(sequences) ≈ init_frequency`(守恒,相对 1e-9);后果频率非负。

### P3 — FTA 挂载在 ETA 上(真故障树)

- `bess/scenarios.json` 屏障项支持 `"decompose":"ft_id"`;`bess/barrier_fts.json`(或在 scenarios.py 内构造)定义真故障树。**至少** B_BMS:

  ```
  B_BMS_TOP = OR(BMS_SENSOR_FAIL, BMS_LOGIC_FAIL, BMS_CONTACTOR_FAIL)
  ```
  基本事件参数(先验,可在参考库登记):传感 0.03、逻辑 0.01、接触器拒动(共享 CFR_CONTACTOR 量级)0.06 → PFD≈0.097,贴近 0.10 先验。

- **共享事件设计(关键)**:在 `SC_ISC` 中让 `B_OFFGAS` 的联动跳闸也依赖 `BMS_CONTACTOR_FAIL`(或共享一条通信总线基本事件),使 `B_OFFGAS` 与 `B_BMS` 跨功能事件**共享基本事件**。→ 引擎精确否定值 ≠ 前端独立积式值,验证 P4。
- `build_scenario_model` 对带 `decompose` 的屏障用真故障树作 `FunctionalEvent.link_ft`,其余用平凡故障树。
- **前端**:功能事件可下钻——点屏障显示其故障树(复用 `FaultTreeCanvas` 只读渲染)。
- **测试**:含共享事件的场景,`quantify_event_tree`(精确)与「各 FE 独立 PFD 积式」给出**不同**后果频率;断言差异 > 容差。

### P4 — ROADMAP A:可编辑事件树接回引擎精确定量

- **后端** `POST /api/event-tree/quantify`(`schemas.py` 加请求/响应模型):
  ```jsonc
  // 请求
  { "init_event": "...", "init_frequency": 1e-3,
    "functional_events": [ {"id":"FE1","pfd":0.1} | {"id":"FE2","link_ft":"<ftName>"} ],
    "fault_trees": { "<ftName>": <PDAG/FT json> },          // 仅被 link_ft 引用者
    "parameters": { "<param>": {"value":...} },              // 真故障树基本事件
    "sequences": [ {"path":{"FE1":"success"},"end_state":"L0"} , ...],
    "consequence_bins": { "L0":"C1", ... } }
  // 响应
  { "sequences": {"L0": 9.0e-4, ...}, "consequences": {"C1": ..., "C5": ...} }
  ```
  实现:用 `pfd` 屏障构平凡故障树(`_barrier_ft` 思路)、`link_ft` 屏障用提供的 FT,合成 `Model` 调 `quantify_event_tree`。
- **前端** `eventtree.ts` 加 `toEngineRequest(model): EtQuantifyRequest`:DFS 枚举叶→`sequences`(path 以 `functionalEvents[depth].id` 为键)、`end_state`=唯一叶 id、`consequence_bins`=叶后果;功能事件默认带 `pfd`(可选 `link_ft`)。
- **前端** `EventTreeEditor`:加「引擎精确量化」按钮,调 `/api/event-tree/quantify`,叶上/结果区显示**引擎精确频率**(与前端积式并列;不一致时高亮,提示「存在共享事件,以引擎精确值为准」)。
- **测试**:`tests/backend/test_event_tree_api.py` — 无共享事件时引擎=积式;含共享事件时引擎≠积式且=`quantify_event_tree`。

### P5 — 结果用风险矩阵

- **前端** `components/RiskMatrix.tsx`(5×5 HTML 表,纯函数):
  - 行(上→下严重)= C5 灾难 / C4 重大 / C3 严重 / C2 中等 / C1 轻微(severity 5→1)。
  - 列 = 频率带 /站·年:`F1 <1e-6` / `F2 1e-6–1e-4` / `F3 1e-4–1e-2` / `F4 1e-2–1` / `F5 ≥1`。
  - 风险指数 = severityRank × freqRank(1–25);着色:**绿 ≤4 / 黄 5–9 / 橙 10–14 / 红 ≥15**。
  - 把每个 Cx 的计算频率落到 (该后果行, 频率所在列),单元格标记数值 + 描点。
  - 阈值与配色为 `riskmatrix.ts` 可配置常量;面板底部免责声明「频率带与可接受准则为示意默认,须按项目/法规校核」。
  - 函数 `placeConsequences(totals: Record<Cx,number>) -> 落格`,`riskLevel(sev,freq)`。
- 接入:BESS 事件树标签结果区(条形图旁/下加风险矩阵);故障树标签可复用(顶事件概率×单一严重度)为后续留口,本期先接 ETA。
- **测试**(vitest,若前端测试栈在位则补;否则纯函数手验):`riskLevel`/`placeConsequences` 边界(频率落带、severity 映射)。

### P6 — ROADMAP D:引擎 CUDD 后端

- **抽象**:在 `kernel.py` 给 `BddManager` 暴露遍历协议方法 `top_var(h) / cofactor(h,var,val) / is_terminal(h) / terminal_value(h)`(把现有 `_top_var/_cofactor` 提为公有或加薄封装);**重构** `quantify/probability.py::exact_probability` 改走该协议(**行为不变,85 测试须仍绿**)。必要时同样处理 cutsets/importance 的 BDD 遍历;若改动面过大,本期仅保证 `exact_probability` 走协议(parity 验收用顶事件概率)。
- **CUDD 适配器**:`psaengine/bdd/cudd_backend.py::CuddBddManager` 包 `dd.cudd`,实现同协议 + `build_from_pdag` 兼容(handle 为 `dd.cudd.Function`,经协议方法暴露 top var / cofactor / 终端)。
- **工厂**:`make_manager(var_order, backend="python"|"cudd")`;`Analysis` 可选 `backend=` 透传。
- **测试**:`tests/test_cudd_parity.py` — `importorskip("dd.cudd")`;对已知模型断言 CUDD 顶事件概率 == 纯 Python(1e-12)。`dd.cudd` 不可用即 skip。
- **诚实声明 + 文档**:`dd.cudd` 需 Cython + CUDD 源码编译,Windows 上几乎装不上 → 本机 parity 测试 **skip**;在 `docs/superpowers/` 或 ROADMAP 注记 WSL/Linux 安装与验证步骤(`pip install dd --install-option="--fetch" ...` 或源码构建)。**不声称未经运行验证的 CUDD 结果**。
- **风险**:此部分触碰 `probability.py`(85 测试依赖)→ 重构须行为保持,改完立即全量跑测试;若 parity 无法在本机验证,交付物为「抽象 + 适配器 + 跳过的 parity 测试 + WSL 文档」,完整验证记为 Linux 待办。

## 3. 文件改动清单

**新增**
- `bess/reference_data.json` `bess/library.py`
- `bess/scenarios.json` `bess/scenarios.py` (`bess/barrier_fts.json` 或内置)
- `psaengine/bdd/cudd_backend.py`
- `frontend/src/components/RiskMatrix.tsx` `frontend/src/riskmatrix.ts`
- `frontend/src/components/ReferenceLibrary.tsx`
- 测试:`tests/backend/test_library.py` `tests/backend/test_event_tree_api.py` `tests/test_scenarios.py` `tests/test_cudd_parity.py` (+ FTA-on-ETA 共享事件测试)

**修改**
- `backend/app.py`(+library/scenarios/event-tree quantify 端点;event-tree 加 `scenario` 参数)
- `backend/schemas.py`(EtQuantify 请求/响应)
- `psaengine/bdd/kernel.py`(遍历协议公有化 + `make_manager`)
- `psaengine/quantify/probability.py`(`exact_probability` 走协议)
- `psaengine/analysis.py`(可选 `backend=`)
- `frontend/src/api.ts`(getLibrary/getScenarios/quantifyEventTree + 类型)
- `frontend/src/eventtree.ts`(`toEngineRequest`)
- `frontend/src/components/EventTreeEditor.tsx`(引擎精确量化 + 风险矩阵接入 + FE 下钻)
- `frontend/src/App.tsx`(参考库标签 + 场景下拉)
- `docs/superpowers/ROADMAP.md`(完工后更新 A 完成、D 部分完成/Linux 待办)

## 4. 构建顺序与验收

P1 → P2 → P3 → P4 → P5 → P6,每部分一 commit。

| 部分 | 验收 |
|---|---|
| P1 | `/api/bess/library` 返回带 source 的三类数据;数据完整性测试绿;前端参考库表+免责声明 |
| P2 | 5 场景可选;每场景守恒 ∑=f0;前端下拉切换重建树 |
| P3 | B_BMS 真故障树;含共享事件场景引擎精确 ≠ 独立积式(测试断言) |
| P4 | `/api/event-tree/quantify` 返回精确值;含共享事件时前端显示引擎值且 ≠ 积式 |
| P5 | 风险矩阵把 C1–C5 频率正确落格着色;阈值可配置 + 免责声明 |
| P6 | 抽象后 85 测试仍绿;CUDD parity 测试在 `dd.cudd` 可用时通过、否则 skip;WSL 文档 |

全量回归:`.\.venv\Scripts\python.exe -m pytest -q`(应 ≥85 绿 + 新增);前端 `npm run build --prefix frontend` 通过;`preview_eval` 验 DOM 交互。

## 5. 取默认值的设计决定(可调整)

- **风险矩阵频率带与配色**:采用教科书 5×5(指数=严重度×频率秩,绿/黄/橙/红),标注示意默认、可配置。非特定法规 F-N/ALARP 准则。
- **数据来源**:后端 JSON 为唯一真源,前端 fetch(契合引擎为真源的架构),不在前端硬编码副本。
- **向后兼容**:不动 `tr_model_data.json` 与 `build_thermal_runaway_model`,新增并行;`/api/bess/event-tree` 无参保持现行为。
- **D 的范围**:接口抽象 + CUDD 适配器 + 跳过式 parity 测试 + WSL 文档;完整 CUDD 验证因 Windows 编译限制留作 Linux 待办(ROADMAP 已预期)。

## 6. 风险与声明

- 内置数据为公开来源参考量级,不可直接用于安全许可类正式分析(UI/库均展示免责声明)。
- P6 重构 `probability.py` 有回归风险 → 行为保持 + 立即全量测试。
- CUDD 完整验证依赖 Linux/WSL 环境,本机仅交付抽象与适配器。
