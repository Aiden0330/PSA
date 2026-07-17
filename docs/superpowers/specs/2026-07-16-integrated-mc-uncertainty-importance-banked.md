# BANKED 规格:集成 LFT 模式的 MC 不确定性 + 屏障重要度

*2026-07-16 · Fable 5 铸造(禁独改类:数值语义新通道)· 状态:**入库待实现***
*锚点:`tests/banked/test_integrated_mc_banked.py`(探针门控,落地自动激活)*
*前置:序列级 LFT 集成(2026-07-15)、F3 证据重放 v2(含收口二轮,2026-07-16)*

## 0 · 激活探针与交付定义

探针:`psaengine.eta.uncertainty` 同时存在 `event_tree_uncertainty_integrated` 与
`barrier_importance_exact_integrated` 两属性 ⇒ 视为实现开始,全部锚点激活(此前跳过)。
探针只查属性存在,不构造不计算(banked D3 教训:构造期异常不得吞成跳过)。
交付 = 锚点全绿 + §4 清单逐项勾销 + engine-reviewer(抽样语义)收口。

## 1 · 病根与范围

集成 LFT 模式(`ie_fault_tree`,rate(s)=Σᵢλᵢ·P(Eᵢ∧Path_s))现有:精确点通道(quantify/
报告,F3 阶段 1)。**无** MC 不确定性、**无**屏障重要度——端点/报告对二者响亮 422(EB-01
止血口径),报告分位列退化为点值 + 注记。本规格补齐这两个通道,与普通 ETA 通道同一输出形。

范围内:引擎两新函数、两端点解除 422、报告集成分支接真实带并退役点值注记、G3 锚点翻转。
范围外(§5):checked_set × 集成聚合;逐初因频率带;per-param distribution 消费。

## 2 · 语义裁决(S1–S8)

- **S1 抽样单位 = 参数 ref(SOKC)**:每次迭代抽**一个联合参数向量**,键为参数 ref 名,
  作用域 = 合并 PDAG(屏障∪IE 树)全部底事件引用的 ref 并集。同 ref 的多个底事件节点
  (含 IE↔屏障共享事件)共享同一次抽样——认知不确定性的同源相关(state-of-knowledge
  correlation),与 `aggregate_event_tree_uncertainty` 的按 ref 联合向量同法则(单一 rng
  流、refs 排序后抽样,可复现)。**禁止**按底事件节点独立抽(见 §6 已知差异)。
- **S2 分布与量纲分流**:对数正态(median=nominal,σ=ln(EF)/1.645,全局 error_factor,
  与普通通道同参);**probability/Q(t) 类 ref 截断 [0,1];frequency 类 ref 只截 [0,∞),
  上不封顶**——频率不是概率,λ 中位 0.8/yr、EF=3 的 p95 就该是 2.4/yr,封 1.0 即量纲罪。
- **S3 频率参数入带**:初因 λᵢ(kind=frequency)**参与抽样**。普通通道"init_frequency
  视为定值"不构成先例——标量初频无分布信息可抽;IE-FT 模式的 λ 是带认知不确定性的
  库参数(该模式存在的意义)。EF=1 时退化为定值,与点通道逐位一致(A1 锁)。
- **S4 Q(t) 参数的带 = 施于不可用度**:median = `unavailability()`(普通通道现约定),
  认知谱施于 Q 而非底层 λ/α/β。per-param distribution 字段两通道现均不消费(既有缺口,
  不在本规格扩)。
- **S5 每样本量化 = 精确**:同一合并 BDD 结构建一次,逐样本换参数向量重算
  Σᵢλᵢ(sample)·P(Eᵢ∧Path_s)(sample)——结构与值分离,不逐样本重建。点估计 = 名义值
  精确积分(与 quantify 集成通道逐位同源)。
- **S6 重要度 = 普通通道同款扰动语义**:FV_c=(R−R|屏障必有效)/R,RAW_c=R|屏障必失效/R,
  R 为集成后果率;强制的是功能事件顶(fe_overrides work/fail),粒度 = 屏障(功能事件),
  IE 树内部事件不做扰动(初因贡献另有 exact 频率通道 by_initiator)。R=0 记 0、良性后果
  FV 可负 RAW 可 <1 的既有语义照搬。
- **S7 签名与输出形**:
  `event_tree_uncertainty_integrated(model, et_name, ie_ft_name, *, samples=1000, seed=42,
  error_factor=3.0, house_states=None, boundary_condition_set=None) -> {"point","bands"}`;
  `barrier_importance_exact_integrated(model, et_name, ie_ft_name, *, house_states=None,
  boundary_condition_set=None) -> {C: [{barrier,fv,raw}...]}`——与普通通道输出形逐键一致
  (报告/前端零改型消费)。入参校验复用 `_validate_mc_params`。
- **S8 边界条件透传**:house_states/boundary_condition_set 进合并构建(与点通道同点),
  EF=1 时与带边界的集成点结果逐位一致(A5 锁)。

## 3 · 锚点(文件同表;A7 不门控恒跑,其余探针门控)

| # | 断言 | 判别力 |
|---|---|---|
| A1 | EF=1 → bands p05=p50=p95 = 集成点通道逐位(anchor-C:C3=2e-4,C1=0) | 退化正确性 + 点带同源 |
| A2 | IE∧屏障共享 S(同节点 id):p50(C_fail) ∈ 2e-4×[0.7,1.45] | 合并语义在 MC 通道成立(断则 λ·q² ≈ 4e-5) |
| A3 | λ 中位 0.8 EF=3 恒失败路径:p95 ∈ [2.0,2.9]/yr | 频率不封顶(封 1 则 ≤1);对照概率参数 p95 ≤ λ·1.0 | 
| A5 | house 覆盖:EF=1 带 = 带 house 的集成点;on≠off | S8 透传 |
| A6 | 重要度手算:IE=AND(I,S) λ=1e-3 S=.2,屏障 OR(X) X=.1 → C3 базе 2e-5,FV=1.0、RAW=10.0 精确;共享变体(屏障 OR(S,X))→ RAW=1.0(S 已蕴含屏障失效,共享语义) | S6 扰动语义 + 共享事件 |
| A10 | 屏障 AND(A1,A2) 同 param_ref(中位 .1 EF3):p95(C_fail) ∈ [0.07,0.12] | S1 SOKC(独立抽 ≈0.047,实测现单树行为即此值) |
| A8 | 端点:集成 uncertainty/importance → 200 + 形状(替换 G3 的 422 锁) | API 解冻 |
| A9 | 集成报告 CSV:分位列非退化(p05<p95)且点估计仍 2.0000e-04 | 报告接真带 |
| A7 | **特征化锁(恒跑)**:普通通道 unc(seed42,N200,EF3)p05/p50/p95 = 1.37364901153765983e-04 / 3.08110156636124267e-04 / 6.47382403519241299e-04;imp FV=1.0 RAW=3.57142857142857117e+00 逐位 | 实现新通道不得扰动旧通道 |

MC 锚点区间依据(闭式):对数正态 p95 = median·EF(σ=ln EF/1.645 的构造);同抽 q² 的
p95 = (median·EF)²;独立积 σ_tot=σ√2 → p95 = median²·EF^{√2}≈0.047(N=4000 实测 0.0469,
见铸造日探针输出)。区间取 ±45% 容忍抽样噪声,判别间距 ≥1.9×。

## 4 · 实现清单(锚点执行级,可交 Opus;engine-reviewer 收口)

1. `psaengine/eta/uncertainty.py`:两新函数(S1–S8);复用 `_build_event_tree` 的集成
   变体/序列 expr 构造(与 `event_tree_sequences_integrated` 同源,勿复制粘贴分叉)。
2. `backend/app.py`:uncertainty/importance 端点集成分支 422 → 调新函数;`_single_resolved`
   已带 samples/seed,钉扎路径零改。
3. `backend/report_export.py`:integrated 分支退役点值带 + `integrated_note`,改真带 +
   重要度;`analysis_settings_note` 照旧。
4. `tests/backend/test_execution_replay_v2.py` **G3 两锚点翻转**(422 锁 → 200 形状锁,
   或直接删除让位 A8——保留翻转版,防回退 422)。
5. 门:banked 锚点全绿 + 全套件 + `make benchmark`(引擎面被触)+ engine-reviewer
   (抽样语义/SOKC/量纲分流三点冷读)。

## 5 · 非目标

checked_set × 集成聚合(勾选集含集成树的联合带);逐初因 λ 带分解;per-param
distribution(lognormal ef 字段)消费;重要度的 MC 置信区间。

## 6 · 已知差异记录(本规格发现,另行裁决)

**普通单树 MC 按底事件节点独立抽样**(uncertainty.py:44 `q = {bb: ...}` 逐 bb draw),
同 ref 多节点(冗余通道共用一个库参数)被当独立认知源 → 上分位非保守收窄
(实测判别例:AND(A1,A2) 同 ref 中位 .1 EF3,现 p95=0.0469 ≈ 独立积预测,SOKC 正确值
≈0.09,**收窄 ~1.9×**)。聚合通道(同文件 aggregate)已按 ref 联合抽——同一工具两口径。
修正会改既有 MC 数字(同 seed 不同流)→ 禁独改,须独立规格 + 迁移注记;本规格的集成
通道直接按 S1 落正确语义,不背历史包袱。A7 特征化锁同时把现行为定格为"已知状态"。
