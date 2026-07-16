---
name: riskspectrum-parity
description: The living RiskSpectrum-parity ledger — where this tool already meets/exceeds the commercial reference and what's missing, in priority order. Consult when planning engine/backend roadmap work, scoping "world-class backend" claims, or when the user says 对标/parity/差距/RiskSpectrum. UPDATE the ledger whenever a gap closes or new intel arrives (via reference-hunt).
---

# RiskSpectrum parity ledger

Target: **RiskSpectrum-parity backend** (user decision, 2026-07-07). This
ledger is the single place that answers "how far are we?" — keep it current.

## At or above parity (claim these; keep them true)

| Capability | Status | Evidence |
|---|---|---|
| Exact BDD top-event probability | ✅ exceeds (RS default is MCS+MCUB) | benchmark corpus, closed-form anchors ≤1e-16 |
| **Exact success-branch negation in sequences** | ✅ **exceeds** (RS approximates via delete-term) | guard test: shared-event LL=0.109 ≠ product 0.0361 — sales point, protect it |
| MCS: ZBDD + MOCUS + truncation w/ ΔP_k error estimate | ✅ | tests + benchmark |
| Modularization (Dutuit-Rauzy), prime implicants (non-coherent) | ✅ (RS has no PI) | tests |
| Importance B/FV/RAW/RRW/DIM | ✅ | tests |
| MC uncertainty (lognormal-EF/normal/uniform/beta) + tornado | ✅ | tests |
| Field-Bayes updating (Beta-binomial, Poisson-Gamma) | ✅ exceeds (RS lacks it) | bayes.ts golden anchors |
| Reliability models: prob, λ·MTTR, λτ/2, λ·mission | ✅ core four | parameters.py |
| Open-PSA MEF XML I/O (incl. define-CCF-group nested placement + staggered via attributes) | ✅ | round-trip tests |
| Graded reference library w/ citations + A/B/C/D | ✅ exceeds | reference_data.json |
| **Alpha/MGL/phi CCF multi-level expansion** (+staggered alpha) | ✅ 2026-07-09 | NUREG/CR-5485 formulas SCRAM-source-verified; anchors rel 1e-12 + consistency-identity property tests + 2oo3 brute-force==BDD; ETA merged-PDAG expansion (shared CCF events in exact success negation); engine-reviewer 2-round PASS. Spec: `docs/superpowers/specs/2026-07-09-ccf-alpha-mgl-semantics.md` |
| **House events / boundary-condition sets** per-analysis API | ✅ 2026-07-09 | Named bc_sets + house_states on quantify/ET/uncertainty/importance; model never mutated; loud errors. tests/unit/test_boundary_conditions.py |
| **Cut-set post-processing** (mutually-exclusive / delete / recovery) | ✅ 2026-07-09 | MCS-list-only by design — exact BDD channel untouched (guarded test); REA/MCUB over processed list. tests/unit/test_postprocess.py |
| **Analysis cases** (report + uncertainty + importance auto-pin) | ✅ 2026-07-09 | version hash + engine version + settings + results per run; audit actions; dossier ledgers |
| **Model compare / diff** | ✅ 2026-07-09 | Identity-keyed structural diff over canonical versions + dossier compare view. tests/backend/test_diff.py |
| CUDD backend correctness (coherent + non-coherent) | ✅ 2026-07-09 · **Linux CI 阻断门 2026-07-15** | dd.cudd built on macOS arm64 + GitHub Actions Linux 源码编译(--fetch --cudd)首跑即过,continue-on-error 已移除(Gap 6b 收口);complement-mark cofactor fix + NOT/XOR/success-branch locks; 1000-event closed-form; iterative Shannon traversal |
| **Sequence-level LFT integration**(序列级完整链接故障树) | ✅ **exceeds** 2026-07-15 | rate(s)=Σλ_i·P(E_i∧Path_s) 合并 BDD 精确(IE 使能与屏障共享事件自动正确,成功分支精确否定);守恒 Σ_s=F_exact;锚点 C:两段式把物理不可能的成功序列算出 1.44e-4、失败序列低估 3.6×——集成通道恒零/精确。engine-reviewer 两轮(round-1 FAIL 六类 id 碰撞静默错数 88×@200 → 碰撞护栏+六锁 → round-2 PASS,合法共享逐位不扰动);前端 lint 翻转为路由(fe 320 实测集成口径渲染+400 逐字上屏);spec 2026-07-15-sequence-lft-integration.md |
| **Exact Q(t) reliability models**(exponential/GLM/Weibull/periodic-test) | ✅ 2026-07-15 | MEF/SCRAM/XFTA 同式四模型为新 kind(旧三线性化 300 例逐位不变);periodic_test 灾难性消去被审查抓获(x=1e-9 曾 56× 高估、772/2000 点负值)→ 泰勒级数+expm1,Decimal-60 逐点锚+q̄∈[0,1] 500 例性质锁;weibull β=1 与 exponential 逐位退化恢复为锁定不变量;两轮评审 FAIL→PASS;spec 2026-07-15-gap7-qt-models-exchange.md |
| **Exchange events**(MEF 替换三联补齐) | ✅ 2026-07-15 | PostRule kind=exchange(XFTA §7.2:唯一不可布尔编译的替换,恰属 MCS-list 后处理通道,精确 BDD 通道不动);×q_t/q_s 集合语义 + 事件集去重防 REA 双计(评审 G2);regime-A 参数重绑定后门 v1 响亮拒绝;MEF define-substitution XML I/O 记 v2 |
| **Analysis-settings UI 全套**(bc-set 管理器 + ETA 侧 house/bc + CCF 分组选择器) | ✅ 2026-07-15(Gap 8 收口) | 命名边界条件集 CRUD(模型内持久化,undo 历史内,旧档零迁移往返锁)+ ETA ⚙ 弹出面板(house 覆盖/bc 集经 quantify+importance 真实载荷实测)+ CCF 成员选择器按源树分组;fe 313 |
| **Initiating-event fault trees**(手动/FTA 双通道初因) | ✅ 2026-07-13 | fault_tree_frequency:每割集恰好一个频率事件,F=Σ 率×Π使能概率(与 RS/SAPHIRE 同法);双向量纲护栏(频率参数进概率通道 raise、非相干门 NOT/XOR 拒绝、limit_order 整体移除);engine-reviewer 两轮(round-1 FAIL 6 项→整改→round-2 PASS);spec 2026-07-13-ie-fault-tree-frequency.md。**2026-07-14 增 method="exact" 逐初因精确模式**(F=Σλ_i·P(使能析取) BDD 精确,恢复物理上界 F≤Σλ;engine-reviewer 两轮 PASS,300 例随机模型 vs 独立求值器 <1e-12;spec 2026-07-14-ie-frequency-exact-mode.md)。残留:load-time 独立性 lint(UI 精确/Σ 切换 ✅ 2026-07-15 `81987e0`) |
| **Review/sign-off workflow**(状态机级) | ✅ exceeds 2026-07-12(商用工具均为外挂配置管理流程) | reviews 状态机(signed 终态 DB 触发器、每项目单在审部分唯一索引、角色快照入审计)+ 导出门=内容寻址幂等(签发页脚 vs 工作稿自动区分);spec 2026-07-12-phase5-review-signoff-spec.md |
| **Multi-project portfolio**(跨项目组合总览) | ✅ 2026-07-14(对标产品无对应物) | /api/portfolio 只读已钉扎案例(绝不现算);review 锚最新版 + open_review 防"看不见还能签";矩阵口径与报告同源(前后端 25 格金表互锁);domain-reviewer 落审 6 裁决 + F1/F2 修复 |

## Gaps (remaining)

**空(2026-07-15)** —— Gap 7/8/9 全部关闭(见上表),风险监视器经语义卷宗裁决
**收窄出 parity 范围**(RiskWatcher 为在线运营产品;本工具为设计/评估产品,BESS 无
核电 tech-spec 式在线 AOT 监管需求;其计算原语——点态风险=一次量化、RIF≡RAW、
RWF≡RRW、停役≡house 强制、ICCDP 平凡后算——本仓库已全部具备)。

### v2 候选(非 parity 缺口,按价值排序)

| 候选 | 出处 | 状态 |
|---|---|---|
| 集成模式的 MC 不确定性/屏障重要度(初因分组进抽样/扰动语义) | LFT 规格 §6 | 未启动(禁独改,需 Fable 规格) |
| periodic-test 10 参 Complete(Markov 迭代)+ 瞬时 Q(t) 曲线 + IEC/PDS 显示分解 | Gap 7 规格 §1 | **已 BANKED 2026-07-15**:规格 `2026-07-15-periodic-test-complete-banked.md` + 26 锚点 `tests/banked/`(探针自动激活)——SCRAM 逐行转录 × Decimal-60 × 独立 MC 三角验证;λ≈μ 朴素形负概率缺陷预捕获入 §3 强制条款。后 Fable 可机械实现 |
| exchange regime-A(house 条件参数重绑定,精确且 BDD 兼容)+ MEF define-substitution XML I/O | Gap 7 卷宗 §1.2 | **已 BANKED 2026-07-15**:规格 `2026-07-15-regime-a-rebind-mef-substitution-banked.md` + 23 锚点(双探针分组激活)——单一咽喉有效库视图设计(unavailability() 10+ 调用点普查),映射表对照 SCRAM substitution.cc + input.rng L435-468 |
| 「配置风险 Δ」分析案例薄片(baseline 钉扎 + 强制停役 → ΔP+RAW/RRW+ICCDP) | Gap 7 卷宗 §3 | 未启动(可放行级,任意模型可做) |
| 组合聚合「勾选集」不确定性 UI 触发(通道已实现无调用点) | spec A 实现报告 | 未启动(半天级前端) |

## Adjacent-tool intel (2026-07-14, TD-001 §9 调研)

**Isograph FaultTree+**(Reliability Workbench;航空/轨道/国防主力):MCS + 精确上界
后处理(其公开文档未宣称 BDD 主通道);CCF β/MGL/α/**β-BFR**;**initiator–enabler
分析**(与我们 §4.13 频率通道同族语义——对拍候选);ETA 模块厂商宣称"成功态完全处理"
(口径未公开验证);无 MEF、无贝叶斯更新、无 AI。对比全表:TD-001 表 11。

## Rules

- Before implementing any gap: `reference-hunt` its exact semantics (SCRAM
  source / RS theory manual / NUREG) + secure a numeric anchor for
  `tests/benchmark/`.
- When a gap closes: move the row up with evidence, note the date. When
  claiming "exceeds", there must be a test demonstrating the difference.
- 面向外部的能力声明(文档/对比表)与本账本必须同步——TD-001 表 11/12 改动时回写此处。
