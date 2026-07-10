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
| CUDD backend correctness (coherent + non-coherent) | ✅ 2026-07-09 | dd.cudd built on macOS arm64, parity tests live (0 skipped); complement-mark cofactor fix + NOT/XOR/success-branch locks; 1000-event closed-form; iterative Shannon traversal (no recursion cap) |

## Gaps (remaining)

| # | Gap | Why it matters | Notes |
|---|---|---|---|
| 6b | CUDD CI job (Linux) + hybrid MCS-BDD fallback + 10k-event stress corpus | Reproducible scale proof in CI | Local macOS validation done 2026-07-09; CI inert until GitHub remote exists |
| 7 | Exchange events; time-dependent Q(t) beyond core four; risk monitor | Long tail | Defer — not needed for BESS QRA near-term |
| 8 | Boundary-condition / post-processing / CCF-per-barrier UI(engine+API done) | Analyst ergonomics | API-first shipped 2026-07-09; UI slot: analysis settings panel |

## Rules

- Before implementing any gap: `reference-hunt` its exact semantics (SCRAM
  source / RS theory manual / NUREG) + secure a numeric anchor for
  `tests/benchmark/`.
- When a gap closes: move the row up with evidence, note the date. When
  claiming "exceeds", there must be a test demonstrating the difference.
