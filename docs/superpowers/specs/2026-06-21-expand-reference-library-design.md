# 拓展参考库(并入 D:/ETA_claude 内置数据库)— 设计文档

- 日期:2026-06-21 · 分支 `feat/expand-reference-library`
- 状态:**已确认(补充式合并 + grade/url + 前端置信列),待 spec 复核**
- 方法:数据为主 + 小前端/测试;`pytest` + build + `preview_eval`。

## 0. 目标

把 `D:/ETA_claude/eta-tool/src/data/{barriers.ts,components.ts}` 内置库中我尚缺的条目**补充式**并入 `bess/reference_data.json`,并引入 `grade`(置信)与 `url` 字段、前端「参考库」加置信列。现有条目/ID/数值不动(scenarios 仍按 `B_*`/`CFR_*` 引用)。

## 1. 现状关键事实

- 我的 `bess/reference_data.json`:`barrier_effectiveness`(10,`{id,name,category,pfd,eff?,source:{citation,note?}}`)、`component_failure_rates`(5,`{id,name,failure_mode,rate,unit,source}`)、`initiating_events`(5)、`meta.disclaimer`。被 `bess/scenarios.py::build_scenario_model` 按 `barrier_by_id[bid]`、`ie_by_id` 引用,屏障 id = `B_OFFGAS/B_BMS/B_THERMAL/B_DEFLAG/B_SPACING/B_RESPONSE` 等;**不可改这些 id/结构键**。
- ETA_claude:`BARRIER_LIBRARY`(37 条,`successProb`+`category`(warning/active/passive)+`grade`(C/D)+`source{citation,url?,note?}`)、`COMPONENT_LIBRARY`(15 条,`rate`+`unit`('/cell·yr'|'/unit·yr'|'/demand'|'FIT')+`grade`+`source`)。
- 前端 `ReferenceLibrary.tsx` 三只读表;`library.py` 仅加载 JSON;`test_library.py` 断言 id 唯一/citation 非空/pfd∈(0,1)/freq>0/disclaimer。

## 2. 设计

### 2.1 数据合并(`bess/reference_data.json`)

- **屏障 +33**:并入 ETA_claude 全部屏障,**跳过与我同名的 4 条**(`warn-ai`、`warn-gas`、`pas-gas-suppression`、`pas-sprinkler`——与 B_AI_WARN/B_GAS_DET/B_SUPPRESS/B_WATER 同名)。其余沿用 ETA_claude 的 kebab id。
- **器件 +10**:并入 ETA_claude 全部器件,**跳过与我同名的 5 条**(`cell-thermal-runaway`、`bms-functional-failure`、`dc-contactor-fail-to-open`、`pcs-functional-failure`、`liquid-cooling-loss`)。
- **schema 映射**:
  - 屏障:`pfd = round(1 − successProb, 6)`;`category` 原样(warning/active/passive);`grade`、`source.citation`、可选 `source.url`、`source.note` 保留。(不写 `eff`,前端用 pfd。)
  - 器件:`failure_mode = failureMode`;`rate`/`unit`/`grade`/`source` 原样。
- **现有 15 条补 `grade`**:LOPA/NFPA/EPRI/OREDA 等统计来源→`C`;SIL 类比/示例/工程推断→`D`(逐条按其 citation 判定)。现有 id/pfd/rate/citation 不变。
- 结果:`barrier_effectiveness` 10→43,`component_failure_rates` 5→15。`initiating_events` 不变。

### 2.2 前端(`ReferenceLibrary.tsx`)

- 器件表、屏障表各加「置信」列(渲染 `grade`,空则 `—`)。
- 来源单元:若条目 `source.url` 存在,把 citation 渲染为 `<a href={url} target="_blank">`;否则纯文本(保留 note 括注)。
- 初因表不变(无 grade)。

### 2.3 测试(`tests/test_library.py`)

- 现有断言保留(id 唯一、citation 非空、pfd∈(0,1)、rate/freq>0、disclaimer)。
- 新增:每条 `barrier_effectiveness`/`component_failure_rates` 含 `grade ∈ {"C","D"}`;`len(barrier_effectiveness) >= 40`、`len(component_failure_rates) >= 14`;新增屏障 pfd 仍 ∈(0,1)。

### 2.4 不动

- `library.py`(仅加载);引擎;`scenarios.py`(现有 id 不变);`/api/bess/library`(透传新字段,前端/picker 自动获得更多条目)。
- 后端无新端点。

## 3. 文件改动

**修改**:`bess/reference_data.json`(+43 屏障/+15 器件总量、补 grade)、`frontend/src/components/ReferenceLibrary.tsx`(置信列 + url 链接 + `LibraryData` 类型加 `grade?`/`url?`)、`frontend/src/api.ts`(`LibraryData` 接口加 `grade?: 'C'|'D'`、`source.url?`)、`tests/test_library.py`(grade + 计数断言)。

## 4. 构建顺序与验收

| # | 部分 | 验收 |
|---|---|---|
| 1 | 数据合并 + grade | `test_library.py`:屏障≥40、器件≥14、每条有 grade、pfd∈(0,1)、id 唯一;全量回归 scenarios 仍量化(后端 ≥132 绿) |
| 2 | 前端置信列 + url | build 通过;`preview_eval`:参考库屏障表 ≥40 行、表头含「置信」、出现 C/D;含 url 的条目渲染 `<a>` |

## 5. 取默认值 / 风险

- 补充式;现有 id/值不动(scenarios 安全)。
- 跳过 4 屏障 + 5 器件同名重复;其余 ETA_claude 条目全并入。
- `pfd=1−successProb` 四舍六位;SIL3 successProb=0.999→pfd=0.001(>0,通过 (0,1) 断言)。
- grade 取自 ETA_claude;我现有 15 条按来源补 grade(主观但有据)。
- 「从库添加屏障/基本事件」picker 自动获得新条目(已有逻辑读 library);风险矩阵/引擎不受影响(纯参考数据)。
