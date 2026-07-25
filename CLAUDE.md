# CLAUDE.md — BESS PSA / QRA Tool

Probabilistic safety assessment (PSA/QRA) web tool for BESS lithium-battery
thermal-runaway risk. Product goal: **RiskSpectrum-parity backend +
next-generation UX + AI-assisted ETA/FTA generation**, regulator-facing
(evidence trails are a feature, not paperwork).

## Architecture — four layers

| Layer | Dir | What lives there |
|---|---|---|
| Engine | `psaengine/` | Generic FTA/ETA: exact ROBDD (**no complement edges — deliberate**) + ZBDD/MOCUS cut sets, exact Shannon probability, importance (Birnbaum/FV/RAW/RRW/DIM), MC uncertainty, beta-CCF, Open-PSA MEF XML I/O. Pure Python. |
| Domain | `bess/` | TR event trees (`tr_model_data.json`, 5 scenarios in `scenarios.json`), graded reference library (`reference_data.json` + `library.py`), C1–C5 consequences, report data. |
| Backend | `backend/` | FastAPI (`app.py`) + 证据链核心 `store.py`(内容寻址版本库 / 只增审计 / 分析案例 / 评审状态机 / 本地认证 `auth/`)+ canonical 规范层 + `/api/portfolio` + Word/PDF/CSV export + AI 管线(`ai_pipeline.py`, gated by `PSA_AI_ENABLED`). Legacy blobs `storage.py` → `saved/`. |
| Frontend | `frontend/src/` | React 18 + TS,探索者壳(菜单栏/项目树/状态栏)+ 多项目槽架构. Pages: 总览 / ETA / FTA / 参数库 / 参考库 / 后果 / FMEA / 报告证据链 / **组合总览**. Load-bearing: `stores/projectStore.ts`(多项目单一真源), `features/{shell,persistence}`, `components/eta/EtCanvas.tsx`, `eventtree.ts`, `model.ts`, `api.ts`, theme tokens in `theme.css`(`--psa-*` + `--exp-*`). |

Deep dives: `.claude/skills/psa-engine`, `psa-frontend`, `psa-evidence-chain`
(版本库/评审/认证/组合总览), `bess-tr-model`, `eta-reference-data`.

## Environment & commands — macOS is primary

- `make test` (py+fe) · `make benchmark` · `make check` (full pre-commit gate)
  · `make backend` (:8000) · `make frontend` (:5173) · `make run` · `make bundle`.
  Windows legacy runner archived at `docs/archive/run.ps1`.
- Python 3.12 via uv (`.venv`); Node 20 via nvm — in non-interactive shells
  `source ~/.nvm/nvm.sh` first. 前端类型门是 **`npx tsc -b`**(构建同款项目引用
  配置;`--noEmit` 解析更宽松的 config,有漏错前科)。
- Preview servers: `.claude/launch.json`. **`preview_screenshot` times out on
  this app — verify UI with `preview_eval` DOM checks** (established practice).

## Hard constraints

1. **Version pins**: Vite 5 / React 18 / echarts 5 / ag-grid 32 on Node 20.
   Do not upgrade any of them.
2. **Contracts**: node `id` / functional-event `feId` semantics, the ordered-
   skippable branching invariant, and the engine/MEF request shape are
   guarded by tests — change only with a spec (ADR) that says so.
3. **Engine changes ⇒ `make benchmark`** (17-benchmark SCRAM/OpenFTA corpus)
   plus the property/parity suites. A green unit run alone is not enough.
4. **Data provenance**: every reference-library entry needs `source.citation`;
   builtin entries only grade C/D (A/B come from user layer or Bayesian
   update). Units are load-bearing (`/cell·yr` vs `/unit·yr` vs per-demand
   PFD) — never convert silently.
5. **AI output** always carries provenance "AI 草案,待人工审核", defaults to
   grade D, and never invents numeric sources. Model tiering, fallbacks,
   caching, logging: `docs/design/ai-model-strategy.md`.
6. JSON responses declare `application/json; charset=utf-8`.
7. Frontend changes that affect the offline bundle ⇒ rebuild via `make bundle`.

## Conventions

- **TDD**: failing test first; one task per commit.
- **Language**: docs/specs/ROADMAP in Chinese; code, identifiers, commit
  messages in English.
- **Per-feature loop** (skills in `.claude/skills/`): `blindspot-pass` (new
  territory only) → `interview-me` → `plan-feature` (spec ordered by
  likelihood-of-change; `design-directions` mockups for UI work;
  `reference-hunt` when cloning tool behavior) → implement with running
  implementation notes → `verify-psa` → `change-quiz` → append a dated entry
  to `docs/superpowers/ROADMAP.md`.
- Specs/plans: `docs/superpowers/{specs,plans}/YYYY-MM-DD-<slug>*.md` —
  keep this existing naming.
- **Subagents** (`.claude/agents/`): `engine-reviewer` (fable) for any
  psaengine/bess numerical change · `frontend-dev` (sonnet) for UI
  implementation · `domain-reviewer` (fable) for PSA methodology, data
  grading, and report claims.

## 后 Fable 运行规则(无 Fable 级模型时的分级授权)

- **禁独改**(须已有 Fable 级规格+锚点测试在先,否则积压 backlog 等条件恢复):
  psaengine/bess 数值**语义**、隔离/状态机/并发路径(projectStore、persistence hook、
  store.py 事务)、密码学/会话/身份、监管口径声明(报告/组合总览聚合口径)。
- **可放行**(Opus/Sonnet + verify-psa 门):UI/换皮、报表布局、数据录入(库校验锁
  兜底)、文档、既有锁测覆盖之内的重构、按已评审规格的机械实现。
- 依据:verify-psa 的对抗审查升级规则(隔离/状态机/并发类改动,套件全绿仍须冷读
  审查——无 Fable 时该类改动直接积压)。绊线清单:
  `docs/reviews/2026-07-14-guardrail-tripwire-audit.md`;CI 四作业为物理门。

## Current state (2026-07-14)

**Phases 0–5 全部完成**(工具链/技能体系/三 ADR 落地/前端结构改造/引擎对标补全/
AI 管线/评审签发+本地认证),**探索者壳重设计 R1–R5 完成**(多项目槽架构/画布缩放/
组合总览,规格 §6 有偏离记录),技术文档 **TD-001 Rev C**(docs/,含 Word 版)即
canonical 手册。基线:py 366 collected(含 24 benchmark 逐位)· fe 281 · bundle 2.78MB。
文档地图:`docs/README.md`。

**悬置项**:GitHub 远程已建且 CI 四作业**全绿全阻断**(github.com/Aiden1981/PSA,
2026-07-15;CUDD Linux 首跑即过,Gap 6b 收口);AI 真实供应商首跑待 API key(runbook 就绪)。
**引擎 parity backlog 已清空**(2026-07-25 核对:LFT 序列集成、Gap 7/8、periodic-test
Complete `7ed0f1e`、regime-A rebind `f2fc916` 均已实现,`tests/banked/` 88/88 零跳过;
台账曾状态漂移,以 riskspectrum-parity 台账为准)。剩余候选见台账 backlog 表(集成 MC
分组抽样为禁独改类)。参考库 2026-07-24/25 全库来源审计:76/115 带核验落地页、分级
C21/D94、屏障库引用快照(grade/note/url/category)随节点走。Windows 历史:
`git-archive repo/`(ignored);被取代的旧手册与技能蓝图在 `docs/archive/`。
