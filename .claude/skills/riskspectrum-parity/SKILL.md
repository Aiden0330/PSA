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
| **Initiating-event fault trees**(手动/FTA 双通道初因) | ✅ 2026-07-13 | fault_tree_frequency:每割集恰好一个频率事件,F=Σ 率×Π使能概率(与 RS/SAPHIRE 同法);双向量纲护栏(频率参数进概率通道 raise、非相干门 NOT/XOR 拒绝、limit_order 整体移除);engine-reviewer 两轮(round-1 FAIL 6 项→整改→round-2 PASS);spec 2026-07-13-ie-fault-tree-frequency.md。**2026-07-14 增 method="exact" 逐初因精确模式**(F=Σλ_i·P(使能析取) BDD 精确,恢复物理上界 F≤Σλ;engine-reviewer 两轮 PASS,300 例随机模型 vs 独立求值器 <1e-12;spec 2026-07-14-ie-frequency-exact-mode.md)。残留:load-time 独立性 lint、UI 精确/Σ 切换(chip 级) |
| **Review/sign-off workflow**(状态机级) | ✅ exceeds 2026-07-12(商用工具均为外挂配置管理流程) | reviews 状态机(signed 终态 DB 触发器、每项目单在审部分唯一索引、角色快照入审计)+ 导出门=内容寻址幂等(签发页脚 vs 工作稿自动区分);spec 2026-07-12-phase5-review-signoff-spec.md |
| **Multi-project portfolio**(跨项目组合总览) | ✅ 2026-07-14(对标产品无对应物) | /api/portfolio 只读已钉扎案例(绝不现算);review 锚最新版 + open_review 防"看不见还能签";矩阵口径与报告同源(前后端 25 格金表互锁);domain-reviewer 落审 6 裁决 + F1/F2 修复 |

## Gaps (remaining)

| # | Gap | Why it matters | Notes |
|---|---|---|---|
| 7 | Exchange events; time-dependent Q(t) beyond core four; risk monitor | Long tail | Defer — not needed for BESS QRA near-term |
| 8 | Boundary-condition / post-processing / CCF-per-barrier UI(engine+API done) | Analyst ergonomics | API-first shipped 2026-07-09; UI slot: analysis settings panel |
| 9 | ~~逐初因精确模式~~(✅ 2026-07-14 关闭,见上)→ 收窄为:**序列级完整 LFT 集成**(IE 树与屏障树共享事件 → 合并 BDD 上 λ·P(E∧路径) 的序列频率) | 共享事件场景现被前端独立性 lint 拒绝而非精确处理 | = RS 序列割集法等价物;规格 2026-07-14 §6 |

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
