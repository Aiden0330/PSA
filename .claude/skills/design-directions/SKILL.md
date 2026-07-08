---
name: design-directions
description: Generate 3–4 divergent single-file HTML mockups with realistic PSA data for the user to react to, BEFORE implementing UI work whose look/feel is not fully specified. Use for new panels/tabs/layouts/report designs, or when the user says 设计方向/mockup/出几个方案. Skip for spec'd tweaks to existing UI (follow docs/design/restyle-spec.md instead).
---

# Design directions

The user's sense of "world-class PSA tool" is an unknown-known: they'll
recognize it instantly but can't fully specify it. Show, don't ask.

## Procedure

1. **Divergence is the point.** 3–4 genuinely different directions (e.g.
   RiskSpectrum-familiar density · modern analytical dashboard ·
   canvas-first minimal chrome · report/document-centric) — not one idea with
   four color schemes. Name each direction and state its bet in one line.
2. **Realistic data or the feedback is worthless.** Real barrier names from
   `bess/reference_data.json` (离气探测联动, BMS 切断…), plausible magnitudes
   (frequencies 1e-7…1e-2/yr, PFDs 0.001–0.5), real C1–C5 labels, real
   sequence counts (5–40), long Chinese labels included — truncation behavior
   is part of the design. Numbers in tabular-mono.
3. **Anchor in the existing system**: start from `frontend/src/theme.css`
   `--psa-*` tokens and the card language of `docs/design/restyle-spec.md`;
   a direction may deliberately break it, but say so.
4. Single-file HTML each (inline CSS/JS, no CDN), saved to
   `docs/design/mockups/YYYY-MM-DD-<feature>-<direction>.html`. Static is
   fine; fake the one key interaction with a few lines of JS if it carries
   the concept.
5. Present with a one-paragraph comparison + your recommendation; user picks
   a winner (and steals parts of losers). Then write the implementation spec
   restyle-spec style: exact classes/tokens/composition, "preserve every
   control and handler", so `frontend-dev` can execute without re-deciding
   the design.

## PSA-specific mockup checklist

Scientific notation formatting (1.2×10⁻⁵ vs 1.2e-5 — pick and be consistent) ·
risk-matrix color semantics (A/B/C zones must match riskmatrix.ts) ·
grade badges A/B/C/D with their established colors · uncertainty bands
(p05/p50/p95) shown without clutter · sequence paths readable at 20+ rows ·
bilingual labels without layout breakage.
