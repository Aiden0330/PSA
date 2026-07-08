---
name: interview-me
description: Resolve known-unknowns by interviewing the user ONE question at a time before spec/implementation, when a feature has ambiguities whose answers change the design. Use after blindspot-pass, at the start of plan-feature when the request is underspecified, or when the user says 采访我/interview me/问我. Not for questions the codebase can answer — read the code instead.
---

# Interview me

The user is the domain expert (PSA engineer). Their head holds decisions the
repo doesn't. Extract them **one question at a time** — batched question lists
get shallow answers.

## Rules

1. **Never ask what the code/docs/git history can answer.** Verify first.
2. **Priority order** = (how much the answer changes the design) ×
   (cost of guessing wrong). Data-model and user-facing-behavior questions
   almost always outrank internals.
3. **One question per turn**, with 2–4 concrete options + your recommendation
   and its reasoning (use AskUserQuestion when available). Concrete options
   beat open questions — the expert corrects faster than they specify.
4. **For taste/UX questions, don't interview — show.** Switch to
   `design-directions` (mockups) or `reference-hunt` (existing-tool behavior):
   unknown-knowns are recognized, not recalled.
5. **Stop when marginal questions stop changing the design** — typically
   3–6 questions. Interviewing past that is stalling.
6. **Record every answer as a decision** in the spec's 决策记录 section
   (docs/superpowers/specs/…): question → chosen answer → why → what it rules
   out. Decisions without a written trail get re-litigated.

## PSA question bank (adapt, don't recite)

- Which risk metric does this serve (sequence frequency, C1–C5 bin, site
  aggregate, importance ranking)? Who reads it — analyst, reviewer, regulator?
- Point estimate or with uncertainty band? Which percentiles matter?
- Is the RiskSpectrum behavior the target, or a chance to do better?
  (Check `riskspectrum-parity` first.)
- Conservative default or best-estimate default when data is missing?
- Does this need to survive into the report/evidence trail, and at what grade?
- 中文/English labeling for this surface? Which vocabulary — 中电联/GB or
  IEC/NFPA?
