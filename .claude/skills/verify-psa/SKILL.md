---
name: verify-psa
description: The standing verification gate before declaring any change done/committing — runs the right suites for what was touched and exercises the real UI. Use after implementing any feature/fix, before commit, or when the user says 验证/收口/verify. Non-negotiable for psaengine/bess numerical changes.
---

# Verify PSA

Green means verified, not "probably fine". Report numbers honestly — failures
verbatim, skips named.

## The gate, scaled to what changed

| Touched | Must run |
|---|---|
| Anything | `git diff --check` + the affected test suite |
| `frontend/src` | `make test-fe` + `make build-fe` (tsc is part of build) |
| `psaengine/` or `bess/` numerics | `make test-py` + **`make benchmark`** (no exceptions — the 17-benchmark corpus is the regression gate) |
| `backend/` | `make test-py` (API tests live in tests/backend) |
| Reference data / anything embedded in the offline bundle | `make test-py` + `make bundle` (regenerates embeddedData.ts + standalone html) |
| Full pre-commit sweep | `make check` |

Baselines (2026-07-07): py 156 pass/2 skip · benchmark 24 pass · vitest 165
pass. A *dropped* test count is a finding even when everything passes.

## Beyond suites — exercise the territory

1. **UI changes: drive the real app.** Start preview
   (`.claude/launch.json`), verify with **`preview_eval` DOM checks —
   `preview_screenshot` times out on this app** (established practice).
   Test the interaction, not the render: click the row → tree highlights;
   drag the splitter → panel resizes; save → `POST /api/saved` fires.
2. **Numerical changes: one independent recomputation.** Recompute one
   sequence frequency by hand (product form when independent), or cross-check
   MOCUS vs BDD, or verify one importance direction (RAW ≥ 1 for a
   contributing barrier). Engine agreeing with itself is not verification.
3. **Persistence changes: round-trip an OLD artifact.** Load a pre-change
   saved workspace/project file (payload v2 compat), save, reload — nothing
   lost.
4. **Approximation changes: check the conservatism direction** — for a safety
   tool, silently *underestimating* risk is the failure mode that matters.

## Report format

What ran, exact counts vs baseline, what was exercised in preview (which
interactions), what was NOT verified and why. Then — and only then — commit
(one task per commit, English message).
