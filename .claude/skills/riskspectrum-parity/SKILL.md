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
| Open-PSA MEF XML I/O | ✅ | round-trip tests |
| Graded reference library w/ citations + A/B/C/D | ✅ exceeds | reference_data.json |

## Gaps (priority order — the Phase 4a backlog)

| # | Gap | Why it matters | Notes |
|---|---|---|---|
| 1 | **Alpha-factor / MGL CCF expansion** (`ccf_expand.py` is beta-only; MGL/alpha approximated by first factor) | NUREG/CR-5485 alpha is what reviewers expect for redundant channels (2oo3 sensors, dual contactors) | Schema already declares `beta|mgl|alpha|phi`; staggered vs non-staggered testing distinction needed |
| 2 | **House events / boundary condition sets** as first-class API | Sequence-specific logic, maintenance/config states | Constant propagation exists in preprocess — needs surfacing + per-analysis sets |
| 3 | **Post-processing rules** (delete terms, mutually exclusive events, recovery) | Realistic large-model cleanup | Interacts with exact-negation design — spec carefully |
| 4 | **Analysis cases** (model version + boundary set + settings + results as one stored, auditable record) | Parity feature AND the regulator evidence trail | Depends on Phase 2 storage/versioning ADR |
| 5 | **Model compare / diff** | RS Model Compare; also self-review + future multi-user merge primitive | Old ROADMAP item B; depends on canonical schema |
| 6 | CUDD-scale validation + hybrid MCS-BDD fallback | 10k+ event models | CI cudd-parity job is the first step; hybrid path per references |
| 7 | Exchange events; time-dependent Q(t) beyond core four; risk monitor | Long tail | Defer — not needed for BESS QRA near-term |

## Rules

- Before implementing any gap: `reference-hunt` its exact semantics (SCRAM
  source / RS theory manual / NUREG) + secure a numeric anchor for
  `tests/benchmark/`.
- When a gap closes: move the row up with evidence, note the date. When
  claiming "exceeds", there must be a test demonstrating the difference.
