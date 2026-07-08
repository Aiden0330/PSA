# AI Model Strategy — BESS PSA

*2026-07-07 · Phase 0 baseline decision record. Prices and API surfaces are a
dated snapshot; re-verify before major changes. The Phase 2 AI-pipeline ADR
refines the product plane in detail — this document sets the tiering and the
non-negotiables.*

## Principle

Claude Fable 5 (`claude-fable-5`, $10/$50 per MTok) is reserved for work where
**unknowns are dense and a wrong answer is expensive to discover later**:
one-off design decisions, subtle numerical/algorithmic work, and safety-critical
generation. Work that is already specified runs on cheaper tiers:
Opus 4.8 (`claude-opus-4-8`, $5/$25) as the implementation workhorse,
Sonnet 5 (`claude-sonnet-5`, $3/$15; intro $2/$10 through 2026-08-31) for
spec'd implementation and high-volume product surfaces, Haiku 4.5
(`claude-haiku-4-5`, $1/$5) for mechanical fan-out.

## Plane A — building the tool (Claude Code development)

| Phase | Main session | Subagents | Rationale |
|---|---|---|---|
| 0 Foundation (git/uv/CI) | Sonnet 5 / Opus 4.8 | — | Mechanical; zero design unknowns |
| 1 `.claude/` infra | **Fable 5** designs skill content; Opus writes files | Haiku for file moves | Encoding conventions = unknown-knowns elicitation |
| 2 Keystone ADRs (schema / storage-audit / AI pipeline) | **Fable 5, effort high/xhigh** | Fable/Opus adversarial reviewers | Highest-stakes decisions; errors propagate everywhere |
| 3 Structural refactors | Opus 4.8 (+fast mode for iteration) | Sonnet 5 `frontend-dev` | Spec exists; volume work. Fable only reviews the storage migration |
| 4a Engine parity (alpha/MGL CCF, house events, post-processing) | **Fable 5** for math + verification | Sonnet for test scaffolding | Subtle new math; benchmarks catch regressions, not wrong new formulas |
| 4b AI program | **Fable 5** designs prompts/rubrics/evals | Haiku preps eval data | Meta-work deserves the strongest model |
| 5 Multi-user | Opus 4.8 | **Fable 5** reviews CRDT merge semantics + permission model | Well-trodden CRUD except the concurrency/security seams |

Agent model pins (Phase 1, `.claude/agents/*.md` frontmatter):
`engine-reviewer` → fable · `frontend-dev` → sonnet · `domain-reviewer` → fable
· mechanical sweeps (citation checks, translations) → haiku.
Keep CLAUDE.md and skills byte-stable so prompt caching holds across sessions.
Never spawn a Fable subagent for grep-level work.

## Plane B — inside the product (AI ETA/FTA generation)

Tier by call frequency × stakes:

| Surface | Model | Notes |
|---|---|---|
| **ETA/FTA draft generation** (flagship) | `claude-fable-5`, effort `high` | Low frequency, maximum stakes. Agentic tool-use loop (`search_reference_library`, `get_template`, `search_incident_corpus`, tools `strict: true`); final draft via structured outputs (`messages.parse()` against the canonical ProjectDocument schema). ~$0.5–2 per grounded draft |
| Explain-this-number, report narrative, model Q&A | `claude-sonnet-5` | Frequent, latency-sensitive, lower stakes |
| Library-entry matching/rerank, zh/en label suggestions, citation formatting | `claude-haiku-4-5` | High volume, trivially checkable |
| **Validation (domain lint, Σp=1, units, engine dry-run)** | **No model.** | Deterministic code in `psaengine`; the model only *repairs* against lint output |
| Golden-case eval harness | Batch API (50% off) | Nightly/CI; also the **model-upgrade gate** — no model/prompt version ships without passing evals |

### API implementation requirements (Anthropic-native path)

- **Fable 5 request shape**: omit `thinking` entirely (always on; explicit
  `disabled` → 400), no `temperature`/`top_p`/`top_k` (→ 400 — note the current
  OpenAI-compatible path in `backend/ai_draft.py` sends `temperature: 0.2`;
  do not copy that shape), control depth via `output_config.effort`.
- **Refusal fallbacks on by default**: `betas=["server-side-fallback-2026-06-01"]`,
  `fallbacks=[{"model": "claude-opus-4-8"}]`. Safety classifiers can
  false-positive on benign-adjacent safety-engineering text (thermal runaway,
  explosion consequences); the analyst must never see a hard failure. Check
  `stop_reason == "refusal"` before reading content; record the served-by model
  from `usage.iterations`.
- **Prompt caching**: frozen system prompt + deterministically serialized
  reference library (sort keys) as the cached prefix; `ttl: "1h"` for working
  sessions. Volatile per-request content goes after the last breakpoint.
- **Streaming** for all draft generation (turns can run minutes at high effort).

### Governance (regulator-facing)

1. **Pin and log**: every accepted draft's analysis-case record stores exact
   model ID, prompt version, tool-call trace, and served-by model. This is the
   AI evidence trail.
2. **Retention tiers**: Fable 5 requires 30-day retention and is unavailable
   under zero-data-retention. Deployment tiers: Fable 5 (default) → Opus 4.8
   (ZDR orgs) → local/OpenAI-compatible provider (on-prem; existing
   `PSA_LLM_PROVIDER` path — keep it; the eval harness quantifies the quality
   gap honestly).
3. **Upgrade gate**: model or prompt changes go through the Batch-API eval run;
   diffs in structure-match / grounding-rate / quantification-sanity scores are
   reviewed before rollout.
4. **Provenance stamping** (already enforced in `ai_draft.py`): every
   AI-generated node carries "AI 草案,待人工审核"; grade defaults to D until
   human review; ungrounded numerics are flagged, never silently invented.
