---
name: plan-feature
description: Write the spec + implementation plan for a feature, ordered by likelihood-of-change, into docs/superpowers/{specs,plans}/. Use at the start of any non-trivial feature (after blindspot-pass/interview-me if those ran), or when the user says 写规格/设计/plan this/立项. The gate between "we agreed what to build" and "start building".
---

# Plan feature

Continues this repo's proven convention — 23+ specs/plans in
`docs/superpowers/` — upgraded with unknowns-first ordering.

## Files (keep the naming exactly)

- `docs/superpowers/specs/YYYY-MM-DD-<slug>-design.md` — what & why (Chinese)
- `docs/superpowers/plans/YYYY-MM-DD-<slug>.md` — how, stepwise (Chinese)

## Spec: order sections by likelihood-of-change, not by narrative

Put what the user is most likely to tweak FIRST, so review effort lands where
it matters:

1. **用户可见行为与界面** — what changes on screen/in reports; mockup links
   (`design-directions`) for UI work.
2. **数据模型与契约** — payload/schema/API deltas. State explicitly:
   impact on `id`/`feId` (should be none), saved-payload v2 compatibility
   (old archives must load — via normalizeEta/defaults), MEF shape, reference
   data schema, offline bundle.
3. **决策记录** — every `interview-me` answer: question → decision → why →
   rejected alternatives. 对标依据 from `reference-hunt` goes here too.
4. **算法/引擎语义** — formulas, invariants, approximation direction,
   numeric anchors that will become tests.
5. **非目标** — explicitly out of scope (scope creep insurance).

## Plan: TDD steps + verification plan

- Steps small enough that each ends green and committable; **each step names
  its failing-test-first**. Numeric steps cite their anchor (analytical,
  MOCUS cross-check, or benchmark reference).
- Call out which steps parallelize across subagents (`frontend-dev` for UI
  modules; worktree isolation if files overlap) — multi-wave pattern is
  established practice in this repo.
- **验证段 is mandatory**: which suites (`make test-py` / `test-fe` /
  `benchmark` when psaengine touched), which preview_eval interactions,
  whether `make bundle` is needed, expected test-count delta.
- End with the ROADMAP entry stub (one dated bullet, Chinese) to append on
  merge.

## Exit check

Spec reviewed by the user (or explicitly waived) before implementation starts.
If any section-2 contract is touched, say so in the first line of the spec —
that's what `engine-reviewer`/`domain-reviewer` will scrutinize.
