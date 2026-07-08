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
| Backend | `backend/` | FastAPI (`app.py`), ET builder, workspace blobs (`storage.py` → `saved/`), Word/PDF/CSV export, AI draft (`ai_draft.py`, gated by `PSA_AI_ENABLED`). |
| Frontend | `frontend/src/` | React 18 + TS workbench. Tabs: ETA / FTA / FMEA / 参考库 / 报告. Load-bearing: `App.tsx`, `eventtree.ts`, `model.ts`, `api.ts`, `components/EventTreeEditor.tsx`, theme tokens in `theme.css`. |

Deep dives: `.claude/skills/psa-engine`, `psa-frontend`, `bess-tr-model`,
`eta-reference-data`.

## Environment & commands — macOS is primary

- `make test` (py+fe) · `make benchmark` · `make check` (full pre-commit gate)
  · `make backend` (:8000) · `make frontend` (:5173) · `make run` · `make bundle`.
  `run.ps1` is Windows legacy.
- Python 3.12 via uv (`.venv`); Node 20 via nvm — in non-interactive shells
  `source ~/.nvm/nvm.sh` first.
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

## Current state (2026-07)

Phase 0+1 done (macOS toolchain, CI, git, this structure). Next: **Phase 2
keystone ADRs** — canonical ProjectDocument schema, storage/versioning/audit,
AI pipeline. Parity backlog: `.claude/skills/riskspectrum-parity`. Windows
history: `git-archive repo/` (ignored, standalone). Predecessor templates
awaiting migration: `docs/reference-assets/templates-eta-claude.ts`.
