---
name: blindspot-pass
description: Surface unknown-unknowns BEFORE starting work in unfamiliar territory (new subsystem, new algorithm family, new standard, new library like Yjs/CUDD, or a feature type this repo has never built). Produces a ranked unknowns report, not code. Use when the user says 盲区检查/blindspot, or before any feature whose shape the repo has no precedent for. Do NOT use for routine changes in well-trodden areas.
---

# Blindspot pass

Cheap probe before expensive work: map what we don't know we don't know.
Output is a **report the user reacts to** — never start implementing in the
same turn.

## Procedure

1. **Read the territory, not the map.** Actual code/data the task touches
   (not just docs), the relevant `.claude/skills/` domain skill, recent
   `docs/superpowers/specs` for adjacent features, and — for external tech —
   current upstream docs (versions drift; this repo pins Vite 5/React 18/Node 20).
2. **Write down the assumptions the request silently makes.** For each:
   where would it break?
3. **Classify what surfaces, by quadrant:**
   - Known unknowns → questions for `interview-me`, ranked by
     (likelihood the answer changes the design) × (cost of guessing wrong).
   - Unknown knowns → things the user would recognize on sight but hasn't
     specified → propose mockups (`design-directions`) or reference
     examples (`reference-hunt`) instead of asking abstract questions.
   - Unknown unknowns → risks with a concrete probe each (spike, test,
     measurement) that would retire the risk cheaply.

## PSA-specific blindspot checklist (scan every time)

- **Units & 口径**: per-year vs per-demand vs per-cell·yr vs per-unit·yr;
  frequency vs probability; event-level recall vs sample-level accuracy.
- **Scaling boundary**: cell → module → rack → cabin → site. Which level does
  this feature live at, and what converts between levels?
- **Independence assumptions**: shared basic events, CCF, product-form vs
  exact engine quantification — does this feature silently assume independence?
- **Conservatism direction**: if we must approximate, which direction is safe
  for a *safety* tool? (Overestimating risk ≠ underestimating.)
- **Contract stability**: does it touch node `id`/`feId`, the MEF shape,
  saved-payload compatibility, or the reference-data schema?
- **Evidence trail**: will a regulator ask where this number/behavior came
  from? What must be logged/cited?
- **Numerical hygiene**: non-rare probabilities (0.01–0.5) break rare-event
  approximations; check truncation and 1e-12-level comparisons.

## Output format

Short report: ① assumptions made by the request · ② top known-unknowns as
prioritized questions · ③ unknown-known candidates + the artifact that would
surface them · ④ risk probes worth running first · ⑤ recommendation (proceed /
interview first / spike first). Then stop and wait.
