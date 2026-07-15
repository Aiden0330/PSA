# Gap 7 裁决:精确 Q(t) 模型 + exchange 替换(+ 风险监视器收窄)

*2026-07-15 · 状态:已裁决,随批实现(Fable)· 依据:reference-hunt 语义卷宗
(MEF §5/§6 原文、SCRAM input.rng+expression 源码、Rauzy XFTA 书 §6.4/§7.2、
Rausand Ch.8——全一手来源,锚点手算并交叉核对)*

## 1 · 裁决一:时变不可用度模型(核心价值)

现有 `rate` 三变体(λ·MTTR / λτ/2 / λt)全部是指数族的**一阶稀有事件线性化**
(方向恒保守高估)。新增四个**精确**模型为新 kind(既有 kind 零扰动,存档零迁移),
MEF/SCRAM/XFTA 三方同一公式集:

| kind | 公式 | 参数 | 锚点(测试内独立编码公式,此处数字仅注释) |
|---|---|---|---|
| `exponential` | Q = 1−e^(−λt) | value=λ, mission_time=t | λ=1e-3,t=100 → ≈0.0951626(λt=0.1 高估 +5.1%) |
| `glm` | Q = γ·e^(−(λ+μ)t) + λ/(λ+μ)·(1−e^(−(λ+μ)t));t 缺省 → 稳态 λ/(λ+μ) | value=λ, mttr=1/μ, gamma=γ(缺省 0), mission_time=t | λ=1e-3,MTTR=10 稳态 ≈0.00990099;+γ=0.005,t=24 ≈0.009467 |
| `weibull` | Q = 1−e^(−((t−t0)/α)^β)(t≤t0 → 0) | alpha, beta, t0(缺省 0), mission_time=t | α=1000,β=2,t=100 → ≈0.00995(老化模型,现库完全没有) |
| `periodic_test` | 周期平均 q̄ = 1−(1−e^(−λτ))/(λτ)(3 参形积分,Vesely/NUREG-0492) | value=λ, test_interval=τ | λ=1e-3,τ=100 → ≈0.0483742(λτ/2 高估 +3.4%) |

- 引擎消费标量 q → 周期检验用**周期平均**(与 λτ/2 同语义位,精确化);瞬时
  Q(t) 曲线与 10 参 Complete(Markov 迭代)留 v2。
- Rausand 四项工程分解(±检验/维修贡献,漏 ~30% 的实证)记入注释与账本,
  作为 `periodic_test` v2 扩展锚。
- 校验响亮:负参数、γ∉[0,1]、weibull α/β≤0、缺 mission_time(exponential/weibull
  必需;glm 缺省稳态)。json_io/MEF 往返随字段透传。

## 2 · 裁决二:exchange 替换(MEF 三联的最后一件)

卷宗关键发现(XFTA §7.2 原文):delete-terms 与 recovery 可编译为布尔逻辑,
**exchange 是唯一不能的**(它换的是参数不是逻辑)——恰与本仓库"后处理只作用于
MCS 列表、精确 BDD 通道不动"的既有架构同构。裁决:

- `PostRule` 增 kind=`exchange`:割集满足假设(events ⊆ C)且含 source →
  移除 source、并入 target(events=假设、source、add_event=target、
  prob=q_target、source_prob=q_source);割集概率 ×(q_target/q_source),
  target 已在割集中则只除不乘(集合语义)。阶不变(1 换 1)或 −1(target 已在)。
- 锚点(MEF §6 手算例):C={H,A},q_H=0.2,q_A=0.01,q_A′=0.10;
  规则 (H,{A},A′) → REA 0.002 → **0.02**(10×)。
- 卷宗 Regime A(house 条件下的参数重绑定——精确且 BDD 兼容,BESS 相关域)
  与 MEF define-substitution XML I/O:**显式留 v2**(账本记候选,附卷宗指引)。

## 3 · 裁决三:风险监视器——收窄出账本

RiskWatcher 是**在线运营**产品(实时配置风险/ACT/机组状态接入);本工具是
**设计/评估**产品,BESS 无核电 tech-spec 式在线 AOT 监管需求。裁决:live monitor
移出 parity 范围(记录理由);其计算原语本仓库已全部具备(点态风险=一次量化、
RIF≡RAW、RWF≡RRW、停役≡house 强制、ICCDP=(P_cfg−P_base)·d 平凡后算)——
「配置风险 Δ 分析案例」薄片记 backlog 候选(数日级,复用证据链)。

## 4 · 评审记录

- **round-1(2026-07-15,engine-reviewer 轻扫):FAIL** ——公式全部经 Decimal-60 独立
  复核正确(glm 与二态 Markov 解一致、weibull β=1 逐位退化指数、保守方向断言解析成立、
  旧三线性化 300 例逐位不变),但 **G1(必修)**:periodic_test 在 λτ≲1e-6 灾难性消去
  (x=1e-9 实测 56× 高估;[1e-15,1e-6] 扫描 772/2000 点**负值**静默入概率通道;现实
  可达 λ=1e-6/yr 日检)→ 小 x 泰勒级数 + expm1 无消去形 + Decimal-60 对照锚 +
  q̄∈[0,1] 500 例性质锁;**G2(应修)**:exchange 可把两割集映射同一事件集 → REA 双计
  (2.00× 实测)→ 应用后按事件集去重(merged 计数),非最小性在文档披露;
  注记:source==target 的 regime-A 后门改为响亮拒绝;exponential/glm 换 −expm1 抛光。

## 5 · 门禁

参数层公式实现,无 BDD 内核改动 → benchmark 必跑(应零差异,结构性:概率通道
只经 unavailability() 取标量);锚点先红后绿;engine-reviewer 并入本日 LFT 审查
批(round-2 时一并核)或单独轻审。
