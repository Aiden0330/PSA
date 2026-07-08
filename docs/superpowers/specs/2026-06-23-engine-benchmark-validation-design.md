# 引擎 vs 标准 PSA 基准模型 对标验证 — 设计文档

- 日期:2026-06-23 · 分支 `feat/engine-benchmark-validation`
- 状态:**已确认(对标层=引擎 vs 标准 PSA 基准、数据=联网选取、规模≈10+、分层容差),待 spec 复核**
- 方法:后端 TDD/数据驱动(pytest,`.venv/Scripts/python.exe -m pytest`);每部分一 commit;联网取模型与参考值用 WebFetch/WebSearch

## 0. 目标

用 PSA 界公认的标准基准故障树(Aralia / Open-PSA 套件)对标本引擎:导入基准模型 → 计算**精确顶事件概率**(及小模型的最小割集数)→ 断言与**公开发表/同行工具**的精确值一致。这在现有 `dd`/CUDD 对拍(`tests/test_dd_parity.py`,本实现 vs 另一 BDD 库)之上,补**面向文献/同行工具的外部佐证**(本实现 vs 公认基准的公布值)。产出:可复现的基准测试套件 + 一份对标验证报告。

## 1. 现状关键事实

- 引擎精确顶概率走 `Analysis(model, fault_tree=name).probability("exact")`(BDD);`.cutsets(cutoff,limit_order)` 出最小割集。已有 `tests/test_dd_parity.py` 对拍 `dd`(autoref;CUDD 需 Linux,本机 2 skipped)到 1e-12。
- MEF 导入 `psaengine/model/mef_xml.py::load_mef_xml(path)`:支持 `and/or/not/atleast(min=k)/xor` 门 + `define-basic-event`(`<float value>`)+ `define-house-event`(constant)+ 顶门自动识别(不被引用的 `define-gate`)。**不支持**:`<define-parameter>`/表达式(λ/exponential)、MEF 内 CCF 组、`<define-component>`、属性扩展。→ 仅能吃「门 + 带 float 概率的基本事件」这一子集(标准 Aralia 结构基准正属此类)。
- 引擎定位**中小规模**(BDD 为朴素 ROBDD,无补边);超大 Aralia 模型(baobab/edf 类,数千门)可能 BDD 膨胀/超时——属已知尺度上限,非正确性问题。
- 已有领域参考库 `bess/reference_data.json`(EPRI/NFPA/UL9540A/DNV/McMicken… priors)——本任务**不**用它(那是领域层;本任务是引擎层标准基准)。

## 2. 设计

### 2.1 语料(两层,合计 ≈10+,按引擎可行性取)

- **Tier 1 — 闭式解锚点(3 个,精确解已知、离线可算)**:手工编码为 MEF,参考值=教科书闭式公式。
  - `pressure_tank`(WASH-1400 经典压力罐 FT)、`voting_2of3`(2/3 表决,`atleast min=2`)、`bridge`(桥式不可化简结构,验证 BDD 对非串并联结构的精确性)。
- **Tier 2 — 命名标准基准(≥7,联网取)**:Aralia/Open-PSA 套件中**引擎可行**的中小模型,如 `chinese`、`das9601`、`isp9601`、`nus9601`、`ftr10`、`theatre`、`edf9206`、`baobab1` 等(最终名单由 §4 Task 1 据可获取性 + MEF 子集兼容 + 引擎可行性筛定;含 1–2 个较大模型探尺度上限)。

### 2.2 参考值与可复现策略

- 参考值来源(优先级):① 同行 BDD 工具的精确值(SCRAM/XFTA 公布结果);② 学术基准表(**Contini & Matuzas 2009**、**Jung et al. 2008**、**Wei et al. 2016**)的精确顶概率;③ 闭式解(Tier 1)。
- **可复现关键**:公布的精确顶概率对应**特定的基本事件概率赋值**。每个模型必须用与参考同一套赋值(取自参考表所述赋值,或随模型文件附带的概率;若参考用统一 q 如全 0.5,则照此赋)。Task 1 curation 须**逐模型记录**所用赋值与出处。
- **不可精确复现的模型**:若某模型的参考赋值无法确证、或引擎不可行(BDD 膨胀),**显式记录**(报告中列出原因),不静默丢弃;尺度不可行本身是有效发现。

### 2.3 度量与分层容差

- 主指标:精确顶事件概率(BDD)。次指标:最小割集数(仅**小模型**,大模型 MCS 爆炸→跳过并注明)。
- 分层容差:
  - Tier 1 闭式锚点:相对误差 ≤ **1e-9**。
  - Tier 2 命名基准:按文献公布精度——相对误差 ≤ **1e-3** 或匹配公布有效位数(论文多为舍入值;若取自同行工具高精度值则收紧到 1e-6)。
- 容差与参考精度逐模型记录于 manifest(见 2.4)。

### 2.4 语料清单(manifest,机器可读 + 人可读)

`tests/benchmark/corpus.json`:数组,每项:
```jsonc
{
  "id": "chinese",
  "model": "models/chinese.xml",        // 仓内 MEF 文件
  "tier": 2,
  "ref_top_prob": 1.23e-3,              // 参考精确顶概率
  "ref_mcs_count": 392,                 // 可选: 参考 MCS 数(小模型)
  "tol_rel": 1e-3,                      // 该项相对容差
  "assignment": "all basic events q=0.5", // 复现所用赋值说明
  "source": { "citation": "Contini & Matuzas 2009, Table 3", "url": "..." },
  "engine_feasible": true               // false → 报告记尺度上限, 测试 xfail/skip
}
```
基本事件概率随 MEF 文件内 `<float>` 携带(与 `assignment` 一致)。

### 2.5 Harness + 测试套件

- `tests/benchmark/harness.py`:`load_corpus()` 读 `corpus.json`;`solve(model_path) -> {top_prob, mcs_count}` 用 `load_mef_xml` + `Analysis`(`probability("exact")`;小模型 `cutsets()` 计数,设阶/概率 cutoff 防爆且与参考口径一致)。
- `tests/benchmark/test_psa_benchmarks.py`:参数化遍历 corpus;`engine_feasible` 为真则断言 `rel_err(top_prob, ref) ≤ tol_rel`(有 `ref_mcs_count` 且小模型则并断言 MCS 数);`engine_feasible` 为假 → `pytest.xfail`(记录尺度上限)。
- 大模型设单测超时保护(如 `pytest-timeout` 或在 harness 内限时),避免卡死套件。

### 2.6 对标验证报告

`docs/benchmark/engine-benchmark-validation.md`:方法学 + 结果表(模型 · tier · 来源/引用 · 参考顶概率 · 引擎顶概率 · 相对误差 · MCS 数对比 · 判定/尺度上限),由 harness 生成或半自动填(报告生成脚本 `tests/benchmark/make_report.py` 跑 corpus 输出表;committed 报告含定稿数值)。

### 2.7 范围守卫

- 仅相干(coherent)模型(引擎 MCS/重要度面向相干;非相干素蕴涵另有支持但不纳入本基准)。
- 仅 MEF 子集兼容模型;不兼容者由 Task 1 转换(若仅缺概率则补 `<float>`)或剔除并注明。
- 大模型:prob-only;不可行则 xfail 记上限。

## 3. 文件改动

**新增**:`tests/benchmark/`(`corpus.json`、`models/*.xml`、`harness.py`、`test_psa_benchmarks.py`、`make_report.py`)、`docs/benchmark/engine-benchmark-validation.md`。
**修改**:可能 `requirements*`/dev 依赖(若用 `pytest-timeout`);`psaengine/model/mef_xml.py` **仅在**发现基准必需但缺失的 MEF 子集特性时**最小**补强(谨慎,另立小 commit + 测试)。
**不改**:引擎核心/领域模型/前端。

## 4. 构建顺序与验收

| # | 部分 | 验收 |
|---|---|---|
| 1 | **语料 curation**(联网取模型+参考值,建 `corpus.json` + `models/*.xml` + 逐项 provenance/assignment) | corpus.json 校验通过(字段齐全、每项有来源与赋值);Tier1 3 个 + Tier2 ≥7;模型 MEF 可被 `load_mef_xml` 解析 |
| 2 | Tier 1 闭式锚点(模型 + 测试) | 3 锚点引擎顶概率 vs 闭式解 rel ≤ 1e-9;桥式结构正确(非串并联) |
| 3 | harness + 参数化测试 | `pytest tests/benchmark` 跑通;每可行模型 rel ≤ 其 tol_rel;小模型 MCS 数匹配;不可行模型 xfail |
| 4 | 报告生成 + 定稿报告 | `make_report.py` 输出结果表;`engine-benchmark-validation.md` committed,含数值与方法学/尺度上限说明 |
| 5 | 回归 | 全量 `pytest -q` 不回归(基准套件可标记 slow / 单独目录);文档链接自 ROADMAP/memory |

## 5. 取默认值 / 风险

- **可复现风险(主要)**:公布精确值依赖特定基本事件赋值;缓解=优先 model+value 自洽来源(闭式/同行工具高精度值/赋值明确的表),逐项记录赋值,不可复现者显式记上限/原因。
- **引擎尺度风险**:大 Aralia 模型 BDD 可能膨胀;策略=以中小模型为主 + 1–2 大模型探界,xfail 记上限(尺度上限是有效结论,非 fail)。
- **MEF 子集风险**:基准若用本读器不支持的构造(参数/表达式/组件)→ 转换或剔除并注明;必要时最小补强读器(单独 commit + 测试)。
- **MCS 口径**:割集数受 cutoff 影响;仅对小模型、且按参考同口径(全枚举或同 cutoff)比对。
- **范围**:仅引擎层标准基准对标;领域层(BESS 真实 QRA 研究)不在本spec(可作后续单独 spec)。
