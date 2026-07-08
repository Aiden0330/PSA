# BESS PSA 工具 — Phase 1:精确量化引擎(设计 / Spec)

*日期:2026-06-20 · 范围:Phase 1「BESS 完整内核」· 状态:待用户评审*

---

## 1. 背景与目标

构建一套面向**储能(BESS)热失控概率安全评价(QRA)**的 PSA 工具,达到 SOTA 水平。完整工具分三层(引擎 / BESS 领域 / Web 前端),分阶段建。**本 spec 只覆盖 Phase 1 = 量化引擎内核 + BESS 热失控应用**,产出一个能算出真实 BESS 风险数的、严谨可审计的 Python QRA 计算核。

### SOTA 定位(为什么这样建)
现有标杆:RiskSpectrum / CAFTA / SAPHIRE(商业桌面)、SCRAM / XFTA / OpenPRA(开源)。本引擎在三点上对标并超越:

1. **算法严谨**:BESS 屏障的失效概率(PFD)普遍是**非稀有的(0.01–0.5)**。稀有事件近似(REA)与最小割集上界(MCUB)在此区间会**显著高估**顶事件概率。本引擎**默认用精确 BDD**(Shannon 分解,Bryant 1986),消除近似误差,并保留 REA/MCUB 仅作对比展示。
2. **事件树成功分支精确处理**:屏障"动作成功"是补事件,使序列**非相干**。本引擎对成功分支用**精确 BDD 否定**(失败/成功分别建 BDD 再合并,RSAT 路线),而非 SAPHIRE 式删除项近似。
3. **领域特化**:直接消费 `bess-tr-event-tree` 技能的热失控模型(初始事件→屏障→C1–C5 后果),产出完整 QRA 报告(后果频率、屏障重要度排序、不确定性带)。

### 技能资产复用
- `fta-eta-quantification-engine` 技能自带脚手架:`bdd_engine.py`、`mocus.py`、`variable_ordering.py`、`preprocess.py`、`quantify.py`、`importance.py`、`model.py` —— 作为引擎自建内核的起点,扩展而非从零写。Phase 1 主要复用 `bdd_engine`/`variable_ordering`/`preprocess`/`quantify`/`importance`/`model`;割集走 **ZBDD** 路线,`mocus.py` 作参考但独立 MOCUS 求解路径顺延 Phase 1.5。
- `bess-tr-event-tree` 技能自带:`tr_model.json`(热失控事件树模型)、`tr_event_tree.py` —— 作为 BESS 领域层的数据与构建逻辑来源。

---

## 2. 范围(Phase 1 边界)

### 做(BESS 完整内核)
- 模型层:PDAG + 参数库(逻辑—数据分离)+ 故障树 + 事件树 + CCF 组 + MEF 对齐的 JSON 读写。
- 预处理:常量传播、house 事件代入、门归一化/coalescing、k-of-n 展开、CCF 展开(Beta/MGL/Alpha)。
- 变量序:DFLM(默认)/ WDFLM / RDFLM。
- BDD 内核:自建 ITE + 唯一表 + 计算表 + 补边(complemented edges)。
- ZBDD:集合操作 + 相干简化(Jung-Han-Ha 2004)+ 构造中截断与 subsume。
- 定量:精确 Shannon 顶事件概率;REA / MCUB 作对比;ZBDD 割集抽取(概率截断 + 阶数截断)。
- 重要度:Birnbaum / Fussell-Vesely / RAW / RRW / DIM(BDD cofactor 单遍历)。
- 不确定性:蒙特卡洛(对数正态/正态/均匀/Beta)→ 分布 + 百分位 + 龙卷风敏感性。
- 事件树:序列定量,成功分支精确否定,功能事件链接故障树顶门(小 ET/大 FT),C1–C5 末态分箱。
- BESS 应用:由 `tr_model.json` 建热失控 ET/FT,挂屏障 PFD 先验,跑 QRA,出报告。
- 接口:Python API + CLI。
- 验证:解析解 + 不变量自检 + FFORT 基准回归;`dd` / SCRAM 可选对拍。

### 不做(顺延 Phase 1.5 / 全功能 / 后续层)
Dutuit-Rauzy 模块化、独立 MOCUS 求解路径、截断误差估计(ΔP_k 收敛)、**完整 Open-PSA MEF XML** 解析(Phase 1 用 MEF 对齐的 JSON)、非相干素蕴涵(prime implicants)、动态变量重排序(CUDD sifting)、Web 前端。

---

## 3. 架构(模块化,单一职责)

```
bess_psa/                       # 项目根
  psaengine/                    # 通用 FTA/ETA 量化引擎(领域无关)
    model/
      pdag.py          # 布尔逻辑 DAG:Gate(AND/OR/NOT/ATLEAST k/n)、BasicEvent、HouseEvent — 唯一真相源
      parameters.py    # 可靠性参数 + 分布 + 共享引用(逻辑—数据分离)
      fault_tree.py    # FaultTree:顶门 + 结构,引用参数
      event_tree.py    # EventTree:功能事件、分支、序列、末态/后果类
      ccf.py           # CCFGroup:Beta/MGL/Alpha/Phi
      json_io.py       # MEF 对齐 JSON 的 load/save + schema 校验
    preprocess/
      normalize.py     # 常量传播、house 代入、门归一化与 coalescing、循环检测
      expand.py        # k-of-n 展开、CCF 展开 → 基本事件
    ordering/
      heuristics.py    # DFLM / WDFLM / RDFLM
    bdd/
      kernel.py        # ITE、唯一表、计算表、补边、apply(AND/OR/NOT)
      zbdd.py          # ZBDD:subset0/1、change、union/intersect/diff、count、product;相干 Jung 公式
    quantify/
      probability.py   # 精确 Shannon 自底向上遍历;REA / MCUB
      cutsets.py       # ZBDD 割集抽取 + 截断(cut-off / limit-order)+ subsume
    importance/
      measures.py      # Birnbaum/FV/RAW/RRW/DIM(cofactor 单遍历)
    uncertainty/
      montecarlo.py    # 参数重采样 → 分布 + 百分位 + 龙卷风
    eta/
      sequence.py      # 序列定量、成功分支精确否定、功能事件→FT 链接、C1–C5 分箱
    analysis.py        # 高层门面:Analysis(model).probability()/cutsets()/importance()/uncertainty()
    cli.py             # bpsa quantify model.json --exact --importance …
  bess/                         # BESS 领域应用(消费 psaengine + bess-tr-event-tree)
    tr_model.py        # 由 tr_model.json 建热失控 ET/FT + 屏障 PFD 先验
    consequences.py    # C1–C5 分级 + HF/爆燃后果标签
    report.py          # QRA 报告:C1–C5 频率 · 屏障重要度排序 · 不确定性带
  tests/
    analytical/        # 手算小树(AND/OR/2oo3/含重复事件)+ 不变量
    benchmark/         # FFORT 回归
    cross/             # 可选:dd.autoref / SCRAM 对拍
  examples/
    bess_grid_container.json    # 完整 BESS QRA 算例
  docs/
  pyproject.toml
```

**模块依赖方向**(单向,无环):`model` ← `preprocess` ← `ordering` ← `bdd` ← {`quantify`,`importance`,`uncertainty`} ← `eta` ← `analysis` ← `cli`;`bess/*` 仅依赖 `psaengine` 的公共 API(`analysis` + `model`)。

---

## 4. 数据模型

### 4.1 PDAG(唯一真相源)
布尔逻辑有向无环图,是所有视图(故障树/事件树)的公共底层表示(参照 SCRAM 的 pdag)。
- `Node`:抽象基类,有稳定 `id`。
- `BasicEvent(id, param_ref)`:叶,引用参数库中的共享参数。
- `HouseEvent(id, state: bool)`:常量布尔(预处理时代入)。
- `Gate(id, op, args)`:`op ∈ {AND, OR, NOT, ATLEAST(k,n), XOR, NULL}`;`args` 为子节点引用(可重复,即重复事件)。
- **同名即同事件**语义:相同 `id` 即同一节点引用(UI 层将来需显式提示,引擎层直接按引用处理)。

### 4.2 参数库(逻辑—数据分离)
- `Parameter(id, kind, value, distribution?, source?, version?)`。
- `kind ∈ {probability(PFD), rate(λ,每小时), frequency(每年), mttr, test_interval(T), mission_time}`。
- **可用度模型**(基本事件 q 的来源):
  - 常量概率:`q = p`
  - 不可修复:`q ≈ λ·t`(任务时间 t)
  - 定期检测:`q ≈ λ·T/2`(检测间隔 T)
  - 可修复:`q ≈ λ·MTTR`(或 `λ/(λ+μ)`,μ=1/MTTR)
- `distribution`:`lognormal(median, error_factor)` / `normal` / `uniform` / `beta`,供不确定性采样。
- 多个基本事件可引用**同一** `Parameter`(共享),改一处即改全部。

### 4.3 故障树 / 事件树
- `FaultTree(top_gate_id, pdag)`。
- `EventTree(init_event, functional_events[], sequences[], consequence_bins{})`:
  - `functional_event`:链接到某 `FaultTree` 顶门(小 ET/大 FT),或直接挂基本事件;持有"成功向上/失败向下"约定。
  - `sequence`:一条从初始事件出发、每个功能事件取 成功(¬)/失败 的路径,映射到一个末态。
  - `consequence_bin`:末态 → 后果类(C1…C5)。

### 4.4 CCF 组
- `CCFGroup(id, members[], model, factors)`,`model ∈ {beta, mgl, alpha, phi}`。
- 预处理阶段展开为基本事件(见 §5.2)。

### 4.5 JSON 序列化(MEF 对齐)
- 顶层:`{model_data:{parameters,...}, fault_trees:[...], event_trees:[...], ccf_groups:[...]}`,字段命名对齐 Open-PSA MEF 的概念分层(参数层 / 事件层 / 元逻辑层 / 后果层),以便 Phase 1.5 无损接 MEF XML 与前端。
- 用 JSON Schema 做加载校验(未定义引用、非法概率、k>n、空门等在加载即报错)。

---

## 5. 算法设计

### 5.1 预处理(`preprocess/normalize.py`, `expand.py`)
顺序:**循环检测 → 常量传播 → house 事件代入 → 门归一化/coalescing → k-of-n 展开 → CCF 展开**。
- 循环检测:DFS 检出逻辑环,报 `CyclicLogicError`(指出环上节点)。
- 常量传播:`AND(...,FALSE)=FALSE`、`OR(...,TRUE)=TRUE`、删除恒等子项。
- coalescing:合并同类型嵌套门(`OR(a, OR(b,c)) → OR(a,b,c)`)。
- k-of-n 展开:`ATLEAST(k,n)` 在需要时展开为 OR-of-AND(或在 BDD 层直接用 ITE 递归构造,避免组合膨胀;默认后者)。
- 幂等:重复预处理结果不变(作为不变量测试)。

### 5.2 CCF 展开(`expand.py`)
- **Beta 因子**:对成员 `BE_i` 构造 `G_i = BE_indep_i ∨ BE_CCF`,其中 `Pr(BE_indep)=(1−β)Q`、`Pr(BE_CCF)=βQ`(全组同因失效)。
- **MGL(多希腊字母)**:组大小 m,参数 ρ₁=1, ρ₂=β, ρ₃=γ, ρ₄=δ, …, ρ_{m+1}=0;k 阶基本事件概率
  `Q_k = [1/C(m−1, k−1)] · (∏_{i=2}^{k} ρ_i) · (1 − ρ_{k+1}) · Q_t`。
- **Alpha 因子**:用 α_k 分数与总需求 Q_t,按交错/非交错测试给出 k 阶组合概率(NUREG/CR-5485 标准式)。
- **Phi**:直接给定各阶 CCF 概率。
- 默认对**≥4 阶**组合做截断(可配置,参照工业实践)。
- 参考:NUREG/CR-5485《Guidelines on Modeling Common-Cause Failures in PRA》;Open-PSA MEF 元逻辑层。

### 5.3 变量序(`ordering/heuristics.py`)
- **DFLM**(深度优先最左):对 PDAG 做 DFS,首次访问基本事件即赋递增序号,线性复杂度,默认。
- **WDFLM**:按子树权重(如重复出现次数)排序子节点后再 DFLM。
- **RDFLM**:重复事件优先。
- 接口预留 CUDD sifting(Phase 1.5)。
- 参考:Bouissou/Bruyère/Rauzy ESREL'97;Mo et al. 2013。

### 5.4 BDD 内核(`bdd/kernel.py`)
- Shannon 分解 `f = x·f_{x=1} + x̄·f_{x=0}`(Bryant 1986)。
- 核心算子 `ite(F,G,H)`;`AND=ite(F,G,0)`、`OR=ite(F,1,G)`、`NOT=ite(F,0,1)`。
- **唯一表**(hash-consing,保证强规范型)+ **计算表**(memoization)+ **补边**(complemented edges,Brace-Rudell-Bryant 1990)。
- 故障树自底向上对每个门递归调用 ite → ROBDD。
- 规范型不变量:同一布尔函数 → 同一根节点(测试项)。

### 5.5 ZBDD 割集(`bdd/zbdd.py`, `quantify/cutsets.py`)
- 零抑制约简:节点 1-边指向 0-终端则删除(Minato 1993)。
- 操作:`subset0/subset1/change/union/intersect/diff/count/product`,`Getnode(top,P0,P1)` 维护唯一性。
- **相干简化**(Jung-Han-Ha 2004,设 x<y,h=ite(y,H₁,H₂)):
  - OR:`ite(x,G₁,G₂) + ite(y,H₁,H₂) = ite(x, G₁, G₂+h)`
  - AND(x<y):`ite(x,G₁,G₂)·ite(y,H₁,H₂) = ite(x, G₁·h, G₂·h)`
  - AND(x=x):`ite(x,G₁,G₂)·ite(x,H₁,H₂) = ite(x, G₁H₁+G₁H₂+G₂H₁, G₂H₂)`
- **构造中截断**:中间分支下界概率 < cut-off 或阶数 > limit-order 即剪枝;截断在 subsume 之前应用(Matuzas & Contini 2015)。
- 输出:按概率排序的支配 MCS 列表(事件、阶数、概率、百分比贡献)。

### 5.6 概率定量(`quantify/probability.py`)
- **精确(默认)**:BDD 线性自底向上遍历,`pr(n) = pr(x)·pr(hi) + (1−pr(x))·pr(lo)`;因 Shannon 两项互斥,结果精确,无近似误差。
- **REA**:`Q_TE ≤ Σ Q_i`(最保守上界)。
- **MCUB**:`Q_TE ≤ 1 − ∏(1−Q_i)`(Esary-Proschan)。
- 关系不变量:`Q_exact ≤ MCUB ≤ REA`(测试项)。
- 频率:`W_E = Q_E · Σ_i w_i/q_i`(割集频率)。

### 5.7 重要度(`importance/measures.py`)
单次/少数 BDD 遍历,基于 cofactor:
- **Birnbaum(MIF)**:`I^B_i = h(1_i,p) − h(0_i,p) = ∂h/∂p_i`。
- **Fussell-Vesely**:`I^FV_i = [h(p) − h(0_i,p)] / h(p)`。
- **RAW**:`I^RAW_i = h(1_i,p) / h(p)`。
- **RRW**:`I^RRW_i = h(p) / h(0_i,p)`。
- **DIM**:微分重要度,由 Birnbaum 加权。
- `h(1_i,p)`/`h(0_i,p)` 由 BDD 对变量 i 的 cofactor(restrict)求得。
- 参考:Dutuit & Rauzy 2000(RESS 72(2):213–222)。

### 5.8 不确定性 / 敏感性(`uncertainty/montecarlo.py`)
- 对每个带分布的参数采样(对数正态用 median + error factor;另支持正态/均匀/Beta)。
- 每个样本重算精确顶值 → 顶事件概率分布;输出均值、中位、5/50/95 百分位、直方图数据。
- 龙卷风敏感性:逐参数取分布上下界,看顶值摆幅,排序。
- **可复现**:固定随机种子;记录样本数 N。

### 5.9 事件树定量(`eta/sequence.py`)
- 功能事件取值:链接的故障树顶门 BDD(失败=G,成功=¬G)。
- 序列布尔式:`S = (∏_{failed} G_i) · (∏_{succeeded} ¬G_j)`;含补事件 → 非相干。
- **精确处理**:把整条序列(含 ¬)建成一个 BDD → 精确序列概率;`序列频率 = 初始事件频率 × Pr(S)`。
- 末态分箱:每序列末态映射到 C1–C5,**按后果类汇总频率**。
- 边界条件下传、序列再链接(若模型需要)。

---

## 6. BESS 领域应用(`bess/`)

### 6.1 由 `tr_model.json` 建模(`tr_model.py`)
- 初始事件(IE,带频率先验):电芯内短、过充/BMS 失效、液冷泄漏→电弧、外部火/邻舱热辐射、机械损伤/进水。
- 功能事件(屏障,按演化时序排列,各带 PFD 先验):
  `早期离气探测 → BMS 切断/隔离 → 电芯间热障 → 舱内泄爆/防爆(NFPA 68/69)→ 单元间距 → 应急响应(避免开门引气)`。
- 每个屏障失败使后果升一级。屏障 PFD 与 IE 频率取自 `bess-tr-event-tree` 技能的先验值(标注出处与不确定性)。

### 6.2 后果分级(`consequences.py`)
- C1 单体排气 → C2 模组蔓延 → C3 单舱火 → C4 多舱火 → C5 爆燃/爆炸+毒气。
- 附后果标签:HF 产量(20–200 mg/Wh)、爆燃(舱内可燃气云)、毒气(POF₃/HCl/HCN)。

### 6.3 QRA 报告(`report.py`)
- 各后果类(C1–C5)年频率 + 不确定性带(5/95 百分位)。
- 屏障重要度排序(哪个屏障对降低 C4/C5 最关键,用 FV/RAW)。
- 敏感性:屏障 PFD / IE 频率的龙卷风图数据。
- 可选场景模板:电网集装箱 / 户用 / 数据中心 UPS(不同屏障配置)。
- 输出:结构化 dict + Markdown 报告(供人读);数值表(CSV)。

---

## 7. 公共 API 与 CLI

### Python API
```python
from psaengine import Model, Analysis

model = Model.from_json("bess_grid_container.json")     # 或 Model.builder()... 程序化构建
an = Analysis(model)

p     = an.probability(method="exact")                  # 精确顶值;method ∈ exact|mcub|rea
mcs   = an.cutsets(cutoff=1e-9, limit_order=6)          # 排序割集
imp   = an.importance(measures=["FV","RAW","Birnbaum"]) # 重要度表
unc   = an.uncertainty(samples=10000, seed=42)          # 分布+百分位
seqs  = an.event_tree("TR_propagation").quantify()      # 序列频率 + C1–C5 分箱
```

### BESS 应用
```python
from bess import ThermalRunawayQRA
qra = ThermalRunawayQRA.from_skill_model()              # 载入 tr_model.json
rpt = qra.run(scenario="grid_container", samples=10000)
rpt.to_markdown("bess_qra_report.md")
```

### CLI
```
bpsa quantify model.json --method exact --importance FV,RAW --cutoff 1e-9
bpsa bess --scenario grid_container --samples 10000 -o report.md
```

---

## 8. 错误处理与边界情形
- **结构错误**(加载/预处理即报、定位到节点):循环逻辑、未连接节点、未定义参数引用、k>n、CCF 成员不在模型、空门。
- **数值**:概率越界(<0 或 >1)报错;乘积下溢用稳健求和顺序;频率/概率单位一致性检查。
- **BDD 膨胀守卫**:节点数超阈值 → 告警并建议换变量序(Phase 1.5 提供模块化/重排序;Phase 1 仅告警,不静默失败)。
- **可复现**:蒙特卡洛固定种子;同输入同输出(确定性)。
- **失败要诚实**:任何近似/截断/被禁用能力在结果对象与报告中显式标注(method、cutoff、samples、未收敛警告)。

---

## 9. 测试与验证策略(SOTA「严谨」的背书)
1. **解析解**(`tests/analytical/`):单 AND(∏)、单 OR(1−∏(1−q))、串并联、**2-out-of-3**(精确 vs MCUB vs REA 的已知差值)、**含重复事件**的树(MCUB≠精确,验证精确法不被近似带偏)。
2. **不变量自检**:`Q_exact ≤ MCUB ≤ REA`;BDD 规范型(同函数同根);预处理幂等;重要度恒等式(Birnbaum 数值偏导一致、FV/RAW 一致性);事件树各分支条件概率和为 1。
3. **属性测试**(hypothesis):随机相干树,小规模下精确 BDD 概率 == 暴力枚举真值表。
4. **FFORT 基准回归**(`tests/benchmark/`):导入若干标准基准树,顶值对published 值。
5. **可选对拍**(`tests/cross/`):`dd.autoref`(纯 Python,构同函数对比概率)作独立第二预言机;若环境可装 SCRAM,同一 MEF 模型逐项对拍顶值与重要度。
6. **事件树成功分支**:构造跨成功/失败分支共享同一事件的小 ET,验证精确否定与删除项近似分道(精确法给对、近似给偏)。
7. **BESS 端到端**:从 `tr_model.json` 跑出完整 QRA,后果频率量级合理、屏障重要度排序符合领域直觉(离气探测/热障/应急响应应居前)。

---

## 10. 验收标准(Phase 1 完成的定义)
- [ ] 精确 BDD 顶值在全部解析算例上与手算吻合到 ≤1e-12 相对误差。
- [ ] 在非稀有 2oo3 上量化展示 MCUB/REA 相对精确值的高估缺口(写入报告与测试)。
- [ ] 事件树成功分支用精确否定;共享事件算例上精确法正确、近似法可见偏差。
- [ ] ZBDD 割集 + 截断:输出按概率排序的支配 MCS,与精确顶值在收敛后一致。
- [ ] 重要度(FV/RAW/Birnbaum/RRW)通过恒等式与数值偏导校验。
- [ ] CCF(Beta/MGL/Alpha)展开正确(对小组手算核对)。
- [ ] 蒙特卡洛不确定性可复现(固定种子),输出百分位 + 龙卷风。
- [ ] 属性测试:精确 BDD 概率 == 暴力真值表(随机 k/n 树)。
- [ ] FFORT 子集回归通过(**可选**,需联网取基准库;不可得时以解析解 + 属性测试 + `dd` 对拍构成等效正确性背书)。
- [ ] **从 `tr_model.json` 产出完整 BESS 热失控 QRA 报告**:C1–C5 频率 + 不确定性带 + 屏障重要度排序。
- [ ] CLI `bpsa quantify` 与 `bpsa bess` 可跑通示例。
- [ ] 全部测试绿;关键模块有 docstring 与参考文献标注。

---

## 11. 依赖与运行时
- **运行时**:Python 3.11+,纯 Python 标准库 + `numpy`(数值)+ `scipy.stats`(分布采样)。**无编译依赖**。
- **可选(仅测试/加速,不进运行时必需路径)**:`dd`(autoref,纯 Python,测试对拍);SCRAM(若可得,外部对拍);未来 `dd.cudd`(CUDD,上万事件时切换内核)。
- **打包**:`pyproject.toml`,`bpsa` 控制台入口。
- **平台**:Windows 优先验证(开发机为 Win11),Linux/Mac 兼容。

---

## 12. 风险与缓解
- **自建 BDD 正确性风险** → 解析解 + 不变量 + 属性测试 + `dd` 对拍四重背书;复用技能脚手架降低从零写的风险。
- **纯 Python BDD 性能** → BESS 规模(数百事件)在精确 BDD 舒适区;内核接口预留,超大模型切 CUDD。
- **屏障 PFD / IE 频率数据稀缺**(领域固有)→ 不在引擎里假装确定:一律带分布,用不确定性/敏感性覆盖,报告显式标注数据出处与置信度。
- **GB/T 46261-2025 等标准具体阈值需原文核验** → 先验值标注"待核验",参数化便于替换。

---

## 13. Phase 1.5 / 后续(明确不在本 spec)
模块化(Dutuit-Rauzy)、独立 MOCUS、截断误差估计、完整 MEF XML、非相干素蕴涵、动态重排序;之后是 Web 前端(React Flow 故障树/事件树编辑器 + AG Grid 参数库 + ECharts 可视化 + Yjs 协作),复用本引擎作为后端量化服务。
