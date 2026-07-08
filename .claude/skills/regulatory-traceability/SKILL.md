---
name: regulatory-traceability
description: Evidence-trail checklist for regulator-facing outputs — every number in a report must trace to source, model version, settings, and (for AI content) generation provenance. Use when building/changing report export, storage/versioning, AI draft features, data provenance surfaces, or preparing a release/report for external review. Trigger words 监管/评审/溯源/证据链/审计/traceability.
---

# Regulatory traceability

User decision (2026-07-07): reports WILL face regulators requiring evidence
trails. Traceability is therefore product architecture, not report cosmetics.
It cannot be retrofitted — check new features against this list at spec time
(`plan-feature` §2).

## The chain every reported number must support

```
number in report → analysis case (model snapshot hash + engine version +
settings: truncation/samples/seed) → model element (id) → data entry
(value + unit + grade + source.citation [+ Bayes evidence chain]) →
source document (standard / dataset / test report / field record)
```

Any broken link = a question we cannot answer in review.

## Checklist by surface

**Data** (largely in place — protect it): `source.citation` mandatory ·
builtin ⇒ grade C/D only · grade snapshot on reference, cleared on manual
override (falls to D, marked) · Bayes updates append evidence chain
(N/k/prior/n₀, date) to `note` · units explicit, no silent conversion.

**Model & analysis** (Phase 2 storage ADR must deliver): immutable
content-hashed model snapshots · append-only audit log (who/when/what) ·
analysis-case record binding results to snapshot hash + engine version +
settings · model diff between snapshots (parity ledger #4/#5).

**Reports** (`backend/report_export.py`): keep the disclaimer (never remove) ·
uncertainty shown (p05/p50/p95), not just point estimates · assumptions
section states approximations + their conservatism direction · **data
pedigree appendix**: every parameter used, with value/unit/grade/citation ·
report states engine version + analysis settings.

**AI-generated content** (`backend/ai_draft.py` + strategy doc): provenance
stamp "AI 草案,待人工审核" on every node · default grade D until human
review · ungrounded numerics flagged, never silently invented · accepted
drafts log model ID + prompt version + tool-call trace + served-by model
(fallbacks can swap models — read `usage.iterations`).

## Framework mapping (cite when asked "per what standard?")

ASME/ANS RA-S supporting requirements (data & documentation) · IAEA SSG-3/SSG-4
PSA quality attributes · IEC 61508/61511 (SIL claims behind PFD entries) ·
NFPA 855 / UL 9540A (test-based barrier evidence) · 中电联 matrix + GB/T
36276/GB 44240 (domestic vocabulary — reports use these terms). This tool's
A/B/C/D grading maps cleanly onto these frameworks' data-quality expectations;
keep that mapping stated in the report appendix.
