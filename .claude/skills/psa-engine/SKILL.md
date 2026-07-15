---
name: psa-engine
description: 本项目 FTA/ETA 定量引擎(psaengine/)的实现与维护技能。修改或扩展引擎任何部分(BDD/ZBDD 内核、最小割集、精确概率、重要度、不确定性、CCF、事件树序列定量、MEF XML、预处理/模块化)、排查数值差异、评估算法取舍(精确 vs REA/MCUB、截断、变量序)、或推进 RiskSpectrum 对标缺口(alpha/MGL CCF、house event、后处理规则)时使用。触发词:psaengine、割集/MCS/MOCUS、BDD/ZBDD、Shannon、顶事件概率、重要度、截断、变量序、CCF、序列定量、成功分支、基准对标、benchmark。
---

# psaengine 引擎实现与维护(psa-engine)

**引擎已经存在并通过外部对标验证**——本技能不是"如何从零写引擎"(那是蓝图时代的问题),而是"如何在不破坏已验证正确性的前提下修改/扩展它"。理论深度见 `references/`(算法四篇,仍是权威理论库);本文给出真实架构、既定偏离、不变量与验证门。

## 一、真实架构(2026-07)

```
psaengine/
  model/       pdag·parameters·fault_tree·event_tree·ccf·model·json_io(load_model_from_dict)·mef_xml(Open-PSA XML 读写)
  preprocess/  normalize(常量传播/coalescing/k-of-n)·expand·modules(Dutuit-Rauzy)·ccf_expand(beta 接入)
  ordering/    heuristics(DFLM/WDFLM/RDFLM)
  bdd/         kernel(平凡 ROBDD:ITE+unique/computed table)·zbdd·dd_backend(DdBddManager 适配 dd.autoref/dd.cudd)
  quantify/    probability(精确 Shannon)·cutsets·mocus(金标准对拍)·truncation(ΔP_k)·prime_implicants(Coudert-Madre)
  importance/  measures(Birnbaum/FV/RAW/RRW/DIM)
  uncertainty/ montecarlo(lognormal-EF/normal/uniform/beta)
  eta/         sequence(_build_event_tree 建一次 BDD + quantify_event_tree(fe_overrides=))·uncertainty(MC + barrier_importance_exact)
  quantify/frequency.py  ★初因频率通道:fault_tree_frequency——每割集恰好一个频率事件
               (initiator),F = Σ λ·Πq(/yr,互斥割集求和,绝不 1−Π(1−q));违规
               FrequencyRuleError 响亮拒绝;规范化图上拒 NOT/XOR;无 limit_order(截断
               先于校验会造成规则逃逸,评审 F2 整体移除)。共享使能精确,共享初因保守。
  analysis.py  Analysis 门面(CCF 在此接入)      cli.py(python -m psaengine.cli)
```

参数模型(`model/parameters.py`):`probability` | `rate`(λ·MTTR / λτ/2 / λ·mission_time)| `frequency`;分布 lognormal(median+EF)/normal/uniform/beta。**双向量纲护栏**:frequency 参数进概率语境(`unavailability()`)即 raise;负 λ / 负时间参数源头拒绝——量纲静默混算是这类工具最危险的缺陷类。

## 二、既定偏离(有意为之,勿"修复")

1. **平凡 ROBDD,不用补边(complement edges)。** 蓝图的补边方案有终端/LSB 冲突 bug,已被弃置;如要重新引入必须先立 ADR + 全量基准回归。
2. **事件树成功分支做精确否定**,不是 delete-term 近似——共享基本事件下序列频率 ≠ 独立积式(守护用例:精确 LL=0.109 vs 积式 0.0361)。**这点优于 RiskSpectrum,是卖点,别退化。**
3. **纯 Python、零运行时编译依赖**。CUDD 只经可选 `dd` 后端(`make_manager(order, backend="python"|"autoref"|"cudd")`),`exact_probability` 走 BddManager 遍历协议(is_terminal/terminal_value/top_var_index/cofactor/var_name),与后端无关。
4. **BESS 屏障概率非稀有(0.01–0.5)→ 默认精确 BDD**;REA 禁用于交付数字,MCUB 仅作对照。

## 三、不变量与验证门(引擎改动的硬门槛)

- **TDD**:先写失败测试。数值断言给出解析解或 MOCUS 对拍来源。
- **每次 psaengine/bess 数值改动必跑**:`make test-py` + **`make benchmark`**(17 个标准基准 vs SCRAM/OpenFTA 锚定值,含 Aralia `chinese`/`baobab1`/`cea9601`,报告 `docs/benchmark/engine-benchmark-validation.md`)。CI 已把 benchmark 设为门禁。
- 现有护栏:hypothesis 属性测试(vs 暴力真值表)、`tests/test_dd_parity.py`(与 dd 库 1e-12 对拍)、闭式锚点(voting_2of3/bridge/shared_event ≤1e-16)、`tests/test_event_tree_skip.py`(有序可跳过分支)。
- 改动 BDD 内核/变量序/预处理 → 必须解释基准数值为什么**逐位不变**(或给出新锚定的依据)。

## 四、当前对标缺口(扩展路线,详见技能 riskspectrum-parity)

历史缺口已陆续关闭(CCF 全模型展开、house/边界条件集、后处理规则、分析案例、模型 diff、
CUDD 本机验证、初因频率通道——均见 parity 账本"至/超对标"区,附证据与日期)。剩余:
Gap 6b(CUDD Linux CI,待 GitHub 远程)、Gap 9(逐初因精确模式/完整 LFT 序列集成)、
长尾(交换事件、时变 Q(t))。新缺口实现前先 `reference-hunt` 语义 + 锚定基准数。

## 五、references(写对应模块前精读)

- `mcs-algorithms.md` — MOCUS/MICSUP、截断与 ΔP_k、Dutuit-Rauzy 模块化、素蕴涵。
- `bdd-zbdd-algorithms.md` — ROBDD/ITE/unique+computed table、变量序、精确概率遍历、Minato ZBDD、Jung 相干公式。
- `quantification.md` — REA/MCUB/容斥、成功分支与删除项、重要度、CCF 集成。
- `tools-and-libraries.md` — SCRAM/XFTA/FTREX/RSAT 实践对照、dd/CUDD 适配、基准与一手文献。

> 原蓝图 assets(bdd_engine.py 等草图)已被真实实现取代,归档于 `docs/archive/skill-blueprints/`——**别参照草图改真码**。
