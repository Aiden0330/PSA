---
name: reference-hunt
description: Extract the exact semantics of an existing tool/standard/paper before reimplementing behavior we can point to but not fully describe — RiskSpectrum/SAPHIRE/SCRAM/XFTA behavior, Open-PSA MEF constructs, NUREG/IEC/NFPA formulas, predecessor-tool code. Use when parity work starts, when the user says 参照/对标/像RiskSpectrum那样, or hands over an example file. Not for freely designable features.
---

# Reference hunt

"Make it like X" fails when we guess X's semantics. Extract them first,
verbatim, with sources — then map to our concepts.

## Procedure

1. **Get the primary source.** Preference order: tool documentation/theory
   manual → open-source implementation (SCRAM/XFTA/SAPHIRE code, pinned
   commit) → standard text (NUREG/CR-5485, IEC 61508/61511, NFPA, Open-PSA
   MEF spec) → predecessor code (`git-archive repo/`,
   `docs/reference-assets/templates-eta-claude.ts`) → screenshots/papers.
   Record source + version/commit/edition for every extracted fact.
2. **Write the semantics table before any code**: inputs → outputs →
   edge cases → formulas (exact notation) → defaults → failure behavior.
   Unverifiable cells are marked `[unverified]`, never guessed silently.
3. **Map to our territory**: each semantic row → psaengine/frontend concept;
   classify **adopt** (same behavior) / **adapt** (translated) /
   **deliberately exceed** (we do better — e.g. exact success-branch negation
   vs delete-term; state it in docs and tests) / **reject** (with reason).
4. **Anchor numerically.** For quantitative behavior, secure at least one
   worked example with expected numbers (tool output, standard's example,
   paper table) and turn it into a test BEFORE implementing — this is how
   the 17-benchmark corpus was built; extend `tests/benchmark/` the same way
   (pinned reference values, cited).
5. Deliverable feeds `plan-feature`: semantics table + mapping + numeric
   anchors, into the spec's 对标依据 section. Update
   `riskspectrum-parity`'s ledger when a gap's semantics are now known.

## Trust rules

Vendor marketing claims are not semantics (厂商"零事故/无蔓延"宣称不可作输入 —
established project rule). Tool GUI behavior observed second-hand needs
`[unverified]` until reproduced. When two references disagree, record both and
escalate to `interview-me` — that's a real decision, not noise.
