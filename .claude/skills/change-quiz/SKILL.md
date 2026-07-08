---
name: change-quiz
description: Comprehension insurance before merging substantial or safety-relevant changes — quiz the user on what changed so unreviewed AI-built behavior never silently enters a safety tool. Use after verify-psa passes on large features, engine/numerics changes, or when the user says 考考我/quiz me/合并前检查. Skip for trivial diffs.
---

# Change quiz

The field-guide insight: the human must *understand* the change, not just
watch tests pass. In a QRA tool, an unreviewed behavior change can surface in
a regulator's meeting months later.

## Build the quiz (5–8 questions, answers prepared but hidden)

Draw from four bins:

1. **Numerical spot-check (always ≥1 for engine/data changes).**
   "Barrier B_THERMAL's PFD doubles from 0.1 to 0.2 — what happens to the
   C2-sequence frequency and why isn't it exactly 2×?" ·
   "Which direction does RAW move for a barrier we just made more reliable?"
   The user must be able to sanity-check the tool's numbers by hand — that's
   what an expert reviewer will do to *them*.
2. **Behavior boundary.** "What happens now when a saved v2 project from
   June is loaded?" · "What does the UI show while the engine quantify is
   in flight?"
3. **Contract & invariant.** "Did `feId` semantics change?" (expected answer:
   no — and here's the guard test) · "Is the MEF export byte-identical?"
4. **Rationale recall.** "We chose X over Y in the spec — why?" (Tests
   whether the decision record actually landed.)

## Rules

- Ask **one at a time**, grade honestly, explain misses fully — a missed
  question is a documentation gap: fix the spec/ROADMAP entry or code comment
  that should have made it obvious, then re-ask.
- All questions answered (eventually) correctly → record "change-quiz passed"
  in the ROADMAP entry, then merge/commit.
- The user may waive the quiz explicitly; note the waiver. Never silently skip
  for psaengine/bess/reference-data changes.
