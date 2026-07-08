# Engine vs Standard-PSA Benchmark Validation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reproducible benchmark suite that validates this engine's exact top-event probability (and small-model MCS counts) against closed-form solutions and published/peer-tool values for standard Aralia/Open-PSA fault trees, plus a generated validation report.

**Architecture:** A self-contained `tests/benchmark/` corpus (machine-readable `corpus.json` manifest + `models/*.xml` MEF files + a thin `harness.py` over `load_mef_xml`/`Analysis` + a parametrized pytest that asserts per-model layered tolerances, xfailing models beyond the engine's scale). A `make_report.py` script renders the corpus + live engine runs into `docs/benchmark/engine-benchmark-validation.md`. Tier-1 anchors are hand-derived closed forms (offline, no network); Tier-2 are curated named benchmarks fetched from public repos/papers (network, in Task 4 only).

**Tech Stack:** Python 3.11+, pytest (`--import-mode=importlib`, `pythonpath=["."]`), the existing `psaengine` (`psaengine.model.mef_xml.load_mef_xml`, `psaengine.analysis.Analysis`). No new runtime deps. Run tests with `.venv/Scripts/python.exe -m pytest` (the global Python lacks FastAPI and mis-collects the suite).

**Spec:** `docs/superpowers/specs/2026-06-23-engine-benchmark-validation-design.md`

**Deviation from spec (flagged):** The spec's Tier-1 trio was `pressure_tank / voting_2of3 / bridge`. The WASH-1400 pressure-tank structure + probabilities are only well-defined *by citation* (its "closed form" is really a published worked example), so it is moved to **Tier-2 literature** (Task 4), and Tier-1's third closed-form anchor becomes **`shared_event`** (repeated-event tree, fully hand-derivable offline). Tier-1 still has 3 closed-form anchors; pressure_tank still appears, as a Tier-2 named benchmark with a cited reference value. If you want pressure_tank kept in Tier-1, transcribe it from NUREG-0492 with both a published-value check and an independent inclusion-exclusion over its documented MCS.

**As-built (2026-06-24):** Implemented as planned with three refinements: (1) Task 2's bridge bound assertion corrected — exact 0.0586125 sits between the two-path OR (0.0568125) and the rare-event sum (0.06025). (2) Task 3's corpus test uses `has_mcs = entry.get("ref_mcs_count") is not None` (robust to omitted/null MCS refs). (3) Task 4 Tier-2 (14 models) was sourced from the **SCRAM** peer tool's own test assertions + **OpenFTA** reports (pinned commit `b85b789`) instead of the now-gone `open-psa/models` repo — includes the real Aralia benchmarks `chinese`/`baobab1`/`cea9601` (all engine-feasible; none needed xfail) plus two **non-coherent** models (`xor_abc`/`a_or_not_ab`) kept as **probability-only** (no MCS-count assertion, honoring §2.7's coherent-only guard for cut sets); `pressure_tank` had no reproducible assignment+exact-value pair and was dropped. Final corpus: 17 entries (3 Tier-1 + 14 Tier-2); full suite `pytest -q` → 168 passed / 2 skipped.

---

## File Structure

| File | Responsibility |
|---|---|
| `tests/benchmark/harness.py` | Corpus loading + the engine adapter: `load_corpus()`, `rel_err()`, `solve()`, dir constants. The ONLY place that touches `load_mef_xml`/`Analysis`. |
| `tests/benchmark/corpus.json` | Machine-readable manifest: one entry per model (id, model path, tier, ref values, tolerance, assignment, provenance, feasibility). |
| `tests/benchmark/models/*.xml` | MEF fault-tree files (Tier-1 hand-written; Tier-2 curated). |
| `tests/benchmark/test_corpus_schema.py` | Validates manifest is well-formed and every model parses. |
| `tests/benchmark/test_tier1_closed_form.py` | Tier-1 anchors: engine exact vs hand-derived closed form (≤1e-9) + MCS count. Encodes the math independently of `corpus.json`. |
| `tests/benchmark/test_psa_benchmarks.py` | Generic parametrized check over the whole corpus; feasible → assert within `tol_rel` (+ MCS if given); infeasible → `xfail`. |
| `tests/benchmark/make_report.py` | Renders corpus + live runs → `docs/benchmark/engine-benchmark-validation.md`. |
| `docs/benchmark/engine-benchmark-validation.md` | The committed validation report (methodology + results table). |

**Import note (verified against `pyproject.toml`):** with `pythonpath=["."]` the repo root is on `sys.path`, so tests/scripts import the harness as `from tests.benchmark.harness import ...` (PEP-420 namespace package; **no `__init__.py` needed**, and `--import-mode=importlib` does not affect this normal import). If an environment ever fails to resolve it, prepend `import sys, pathlib; sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))`.

---

## Task 1: Benchmark scaffold — harness, Tier-1 models, manifest, schema test

**Files:**
- Create: `tests/benchmark/harness.py`
- Create: `tests/benchmark/corpus.json`
- Create: `tests/benchmark/models/voting_2of3.xml`
- Create: `tests/benchmark/models/bridge.xml`
- Create: `tests/benchmark/models/shared_event.xml`
- Test: `tests/benchmark/test_corpus_schema.py`

- [ ] **Step 1: Write the failing schema test**

Create `tests/benchmark/test_corpus_schema.py`:

```python
from tests.benchmark.harness import load_corpus, BENCH_DIR
from psaengine.model.mef_xml import load_mef_xml

REQUIRED = {"id", "model", "tier", "ref_top_prob", "tol_rel",
            "assignment", "source", "engine_feasible"}


def test_corpus_wellformed():
    corpus = load_corpus()
    assert len(corpus) >= 3
    ids = [e["id"] for e in corpus]
    assert len(ids) == len(set(ids)), "duplicate ids"
    for e in corpus:
        missing = REQUIRED - set(e)
        assert not missing, f'{e.get("id", "?")} missing {missing}'
        assert e["tier"] in (1, 2)
        assert e["tol_rel"] > 0
        assert isinstance(e["source"], dict) and e["source"].get("citation")
        assert (BENCH_DIR / e["model"]).exists(), f'missing model file {e["model"]}'


def test_tier1_present():
    assert sum(1 for e in load_corpus() if e["tier"] == 1) >= 3


def test_all_models_parse():
    for e in load_corpus():
        model = load_mef_xml(str(BENCH_DIR / e["model"]))
        assert model.fault_trees, f'{e["id"]}: no fault trees parsed'
```

- [ ] **Step 2: Run it to verify it fails**

Run: `.venv/Scripts/python.exe -m pytest tests/benchmark/test_corpus_schema.py -q`
Expected: collection/import error (`ModuleNotFoundError: tests.benchmark.harness`) or FAIL — harness/corpus do not exist yet.

- [ ] **Step 3: Create the harness**

Create `tests/benchmark/harness.py`:

```python
"""Thin adapter between the benchmark corpus and the PSA engine.

The only module that imports load_mef_xml/Analysis. Keeps the tests and the
report generator decoupled from engine internals.
"""
from __future__ import annotations
import json
import pathlib

from psaengine.model.mef_xml import load_mef_xml
from psaengine.analysis import Analysis

BENCH_DIR = pathlib.Path(__file__).resolve().parent
CORPUS = BENCH_DIR / "corpus.json"


def load_corpus() -> list[dict]:
    """Parse corpus.json into a list of entry dicts."""
    return json.loads(CORPUS.read_text(encoding="utf-8"))


def rel_err(got: float, ref: float) -> float:
    """Relative error |got-ref|/|ref|; falls back to |got| when ref == 0."""
    if ref == 0:
        return abs(got)
    return abs(got - ref) / abs(ref)


def solve(model_file: str, fault_tree: str | None = None,
          want_mcs: bool = False, mcs_cutoff: float = 0.0) -> dict:
    """Load a MEF model (path relative to BENCH_DIR) and quantify it.

    Returns {'top_prob': float, 'mcs_count': int | None}. MCS counting is
    skipped unless want_mcs (it can blow up on larger models).
    """
    model = load_mef_xml(str(BENCH_DIR / model_file))
    an = Analysis(model, fault_tree=fault_tree)
    out: dict = {"top_prob": an.probability("exact"), "mcs_count": None}
    if want_mcs:
        out["mcs_count"] = len(an.cutsets(cutoff=mcs_cutoff))
    return out
```

- [ ] **Step 4: Create the three Tier-1 model files**

Create `tests/benchmark/models/voting_2of3.xml`:

```xml
<?xml version="1.0"?>
<opsa-mef>
  <define-fault-tree name="voting_2of3">
    <define-gate name="TOP"><atleast min="2">
      <basic-event name="A"/><basic-event name="B"/><basic-event name="C"/>
    </atleast></define-gate>
  </define-fault-tree>
  <model-data>
    <define-basic-event name="A"><float value="0.1"/></define-basic-event>
    <define-basic-event name="B"><float value="0.2"/></define-basic-event>
    <define-basic-event name="C"><float value="0.3"/></define-basic-event>
  </model-data>
</opsa-mef>
```

Create `tests/benchmark/models/bridge.xml` (non-series-parallel; TOP = OR of the four minimal cut sets {E1·E2, E4·E5, E1·E3·E5, E2·E3·E4} via anonymous nested AND gates):

```xml
<?xml version="1.0"?>
<opsa-mef>
  <define-fault-tree name="bridge">
    <define-gate name="TOP"><or>
      <and><basic-event name="E1"/><basic-event name="E2"/></and>
      <and><basic-event name="E4"/><basic-event name="E5"/></and>
      <and><basic-event name="E1"/><basic-event name="E3"/><basic-event name="E5"/></and>
      <and><basic-event name="E2"/><basic-event name="E3"/><basic-event name="E4"/></and>
    </or></define-gate>
  </define-fault-tree>
  <model-data>
    <define-basic-event name="E1"><float value="0.1"/></define-basic-event>
    <define-basic-event name="E2"><float value="0.2"/></define-basic-event>
    <define-basic-event name="E3"><float value="0.05"/></define-basic-event>
    <define-basic-event name="E4"><float value="0.15"/></define-basic-event>
    <define-basic-event name="E5"><float value="0.25"/></define-basic-event>
  </model-data>
</opsa-mef>
```

Create `tests/benchmark/models/shared_event.xml` (repeated basic event B across two OR gates):

```xml
<?xml version="1.0"?>
<opsa-mef>
  <define-fault-tree name="shared_event">
    <define-gate name="TOP"><and>
      <gate name="G1"/><gate name="G2"/>
    </and></define-gate>
    <define-gate name="G1"><or>
      <basic-event name="A"/><basic-event name="B"/>
    </or></define-gate>
    <define-gate name="G2"><or>
      <basic-event name="B"/><basic-event name="C"/>
    </or></define-gate>
  </define-fault-tree>
  <model-data>
    <define-basic-event name="A"><float value="0.1"/></define-basic-event>
    <define-basic-event name="B"><float value="0.2"/></define-basic-event>
    <define-basic-event name="C"><float value="0.3"/></define-basic-event>
  </model-data>
</opsa-mef>
```

- [ ] **Step 5: Create the manifest with the three Tier-1 entries**

Create `tests/benchmark/corpus.json`:

```json
[
  {
    "id": "voting_2of3",
    "model": "models/voting_2of3.xml",
    "tier": 1,
    "ref_top_prob": 0.098,
    "ref_mcs_count": 3,
    "tol_rel": 1e-9,
    "assignment": "A=0.1, B=0.2, C=0.3 (in MEF file)",
    "source": {
      "citation": "Closed form: P(>=2 of 3) = (qa*qb+qa*qc+qb*qc) - 2*qa*qb*qc = 0.11 - 0.012 = 0.098",
      "url": ""
    },
    "engine_feasible": true
  },
  {
    "id": "bridge",
    "model": "models/bridge.xml",
    "tier": 1,
    "ref_top_prob": 0.0586125,
    "ref_mcs_count": 4,
    "tol_rel": 1e-9,
    "assignment": "E1=0.1,E2=0.2,E3=0.05,E4=0.15,E5=0.25; TOP=OR(E1E2,E4E5,E1E3E5,E2E3E4)",
    "source": {
      "citation": "Closed form via pivotal decomposition on bridge element E3, cross-checked by full inclusion-exclusion = 0.0586125",
      "url": ""
    },
    "engine_feasible": true
  },
  {
    "id": "shared_event",
    "model": "models/shared_event.xml",
    "tier": 1,
    "ref_top_prob": 0.224,
    "ref_mcs_count": 2,
    "tol_rel": 1e-9,
    "assignment": "A=0.1,B=0.2,C=0.3; TOP=(A|B)&(B|C), B repeated",
    "source": {
      "citation": "Closed form: qB + (1-qB)*qA*qC = 0.2 + 0.8*0.03 = 0.224 (repeated-event handling; rare-event approx would give 0.23)",
      "url": ""
    },
    "engine_feasible": true
  }
]
```

- [ ] **Step 6: Run the schema test to verify it passes**

Run: `.venv/Scripts/python.exe -m pytest tests/benchmark/test_corpus_schema.py -q`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add tests/benchmark/harness.py tests/benchmark/corpus.json tests/benchmark/models tests/benchmark/test_corpus_schema.py
git commit -m "test(benchmark): 基准脚手架 + Tier-1 模型 + corpus 校验"
```

---

## Task 2: Tier-1 closed-form correctness

**Files:**
- Test: `tests/benchmark/test_tier1_closed_form.py`

- [ ] **Step 1: Write the test (independently encodes the math)**

Create `tests/benchmark/test_tier1_closed_form.py`. Expected values are hard-coded here (not read from `corpus.json`) so the test is an independent check of the engine against hand-derived truth. A failure here is a real engine-correctness finding — investigate with superpowers:systematic-debugging, do **not** loosen the tolerance.

```python
import pytest
from tests.benchmark.harness import solve

# id -> (expected exact top probability, expected minimal-cut-set count)
EXPECTED = {
    "voting_2of3": (0.098, 3),
    "bridge": (0.0586125, 4),
    "shared_event": (0.224, 2),
}


@pytest.mark.parametrize("model_id", list(EXPECTED))
def test_tier1_closed_form(model_id):
    exp_prob, exp_mcs = EXPECTED[model_id]
    res = solve(f"models/{model_id}.xml", want_mcs=True)
    assert res["top_prob"] == pytest.approx(exp_prob, rel=1e-9), \
        f"{model_id}: got {res['top_prob']!r} vs closed form {exp_prob!r}"
    assert res["mcs_count"] == exp_mcs, \
        f"{model_id} MCS: got {res['mcs_count']} vs {exp_mcs}"


def test_bridge_exact_within_bounds():
    # The two order-2 cut sets {E1,E2} and {E4,E5} alone OR to 0.0568125.
    # The bridge element E3 adds cut sets {E1,E3,E5},{E2,E3,E4}, so the exact
    # top probability must be strictly greater than that two-path OR, and
    # strictly below the rare-event (sum-of-cut-set) upper bound 0.06025.
    two_paths_or = 0.02 + 0.0375 - 0.02 * 0.0375        # 0.0568125
    rare_event_sum = 0.02 + 0.0375 + 0.00125 + 0.0015   # 0.06025
    p = solve("models/bridge.xml")["top_prob"]
    assert two_paths_or < p < rare_event_sum
```

- [ ] **Step 2: Run it (expect PASS; a FAIL is a real engine bug)**

Run: `.venv/Scripts/python.exe -m pytest tests/benchmark/test_tier1_closed_form.py -v`
Expected: PASS (4 tests). If any FAIL, stop and debug the engine — the closed forms are verified by hand + inclusion-exclusion.

- [ ] **Step 3: Commit**

```bash
git add tests/benchmark/test_tier1_closed_form.py
git commit -m "test(benchmark): Tier-1 闭式锚点(2of3/bridge/shared_event)精确性 ≤1e-9"
```

---

## Task 3: Generic corpus-wide parametrized check + feasibility handling

**Files:**
- Test: `tests/benchmark/test_psa_benchmarks.py`

- [ ] **Step 1: Write the generic parametrized test**

Create `tests/benchmark/test_psa_benchmarks.py`. This drives every corpus entry; infeasible models `xfail` **without** being solved (so a known BDD-blowup model never hangs the suite).

```python
import pytest
from tests.benchmark.harness import load_corpus, solve, rel_err

CORPUS = load_corpus()


@pytest.mark.benchmark
@pytest.mark.parametrize("entry", CORPUS, ids=[e["id"] for e in CORPUS])
def test_benchmark(entry):
    if not entry.get("engine_feasible", True):
        pytest.xfail(f"engine scale limit: {entry.get('infeasible_reason', 'BDD blowup')}")

    res = solve(
        entry["model"],
        entry.get("fault_tree"),
        want_mcs="ref_mcs_count" in entry,
        mcs_cutoff=entry.get("mcs_cutoff", 0.0),
    )

    re_ = rel_err(res["top_prob"], entry["ref_top_prob"])
    assert re_ <= entry["tol_rel"], (
        f'{entry["id"]}: top_prob {res["top_prob"]:.6g} vs ref '
        f'{entry["ref_top_prob"]:.6g} -> rel_err {re_:.2e} > tol {entry["tol_rel"]:.0e}'
    )

    if "ref_mcs_count" in entry:
        assert res["mcs_count"] == entry["ref_mcs_count"], (
            f'{entry["id"]} MCS: got {res["mcs_count"]} vs ref {entry["ref_mcs_count"]}'
        )
```

- [ ] **Step 2: Register the `benchmark` marker (avoid unknown-marker warnings)**

Modify `pyproject.toml` — under `[tool.pytest.ini_options]` add a `markers` key:

```toml
[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["."]
addopts = "--import-mode=importlib"
markers = [
    "benchmark: standard-PSA benchmark corpus checks (engine vs reference values)",
]
```

- [ ] **Step 3: Run the benchmark dir**

Run: `.venv/Scripts/python.exe -m pytest tests/benchmark -v`
Expected: PASS — Tier-1 entries pass within 1e-9; no xfails yet (Tier-2 not added). No `PytestUnknownMarkWarning`.

- [ ] **Step 4: Commit**

```bash
git add tests/benchmark/test_psa_benchmarks.py pyproject.toml
git commit -m "test(benchmark): 全 corpus 参数化校验 + engine_feasible xfail + benchmark marker"
```

---

## Task 4: Tier-2 curation — named standard benchmarks (NETWORK)

**Requires network.** Uses WebFetch/WebSearch (load via ToolSearch: `select:WebFetch,WebSearch`). The deliverable is curated data (model files + manifest entries with provenance), produced by following the procedure below — not pre-written here.

**Files:**
- Create: `tests/benchmark/models/<id>.xml` (≥7 Tier-2 models + `pressure_tank`)
- Modify: `tests/benchmark/corpus.json` (append Tier-2 entries)
- (Conditional) Modify: `psaengine/model/mef_xml.py` — only if a needed benchmark uses an unsupported-but-trivial MEF construct; minimal, with its own test + commit.

**Candidate models** (Aralia/Open-PSA suite; final set chosen by feasibility): `chinese`, `theatre`, `ftr10`, `das9601`, `isp9601`, `nus9601`, `edf9206`, `baobab1` (large — likely `engine_feasible:false`), plus `pressure_tank` (WASH-1400).

**Reference-value sources** (record exact citation + url + the basic-event assignment per model):
- Peer BDD tools: **SCRAM** (`github.com/rakhimov/scram`) published/computed exact top probabilities for these inputs; **XFTA** documentation.
- Papers: **Contini & Matuzas 2009**; **Jung et al. 2008** (RESS, fast BDD benchmark tables); **Wei et al. 2016**.
- `pressure_tank`: **NUREG-0492 Fault Tree Handbook** / Contini & Matuzas worked example.

- [ ] **Step 1: Fetch candidate models**

Load web tools: ToolSearch `select:WebFetch,WebSearch`. For each candidate, WebFetch the MEF/Aralia source from `github.com/open-psa/models` (raw file URL). Save as `tests/benchmark/models/<id>.xml`. Record the source URL.

- [ ] **Step 2: Filter to the MEF subset the loader supports**

For each fetched file, confirm it uses ONLY: `define-fault-tree` / `define-gate` with `and|or|not|atleast(min=k)|xor`, `define-basic-event` with a literal `<float value>`, optional `define-house-event` with `<constant>`. **Reject or transform** files that use `define-parameter`, expressions (`exponential`/`mul`/...), MEF CCF groups, or `define-component`:
- If only basic-event probabilities are missing (they reference parameters): inject `<float>` values matching the reference's stated assignment (e.g. the paper's uniform q, or per-event values). Record the assignment string.
- If structurally unsupported: drop the model and note the reason (do not silently discard — it is recorded in the report as out-of-scope).

Quick parse check per file:

```bash
.venv/Scripts/python.exe -c "from psaengine.model.mef_xml import load_mef_xml; m=load_mef_xml('tests/benchmark/models/chinese.xml'); print(list(m.fault_trees))"
```

- [ ] **Step 3: Probe engine feasibility per model**

For each candidate, time an exact solve; classify as feasible (completes in a few seconds) or a scale-limit:

```bash
.venv/Scripts/python.exe -c "import time;from tests.benchmark.harness import solve;t=time.time();r=solve('models/chinese.xml');print(r['top_prob'], round(time.time()-t,2),'s')"
```

Large models that blow up / exceed a sensible wall-clock → mark `engine_feasible:false` with an `infeasible_reason` (these become documented scale-limit findings, not failures). Keep at least one large model (e.g. `baobab1`) as an intentional scale-limit probe.

- [ ] **Step 4: Append Tier-2 entries to `corpus.json`**

For each kept model add an entry (feasible example):

```json
{
  "id": "chinese",
  "model": "models/chinese.xml",
  "tier": 2,
  "ref_top_prob": 0.0,
  "ref_mcs_count": null,
  "tol_rel": 1e-3,
  "assignment": "all basic events q=0.5 (per <source>)",
  "source": { "citation": "<author, year, table>", "url": "<url>" },
  "engine_feasible": true
}
```

and an infeasible example:

```json
{
  "id": "baobab1",
  "model": "models/baobab1.xml",
  "tier": 2,
  "ref_top_prob": 0.0,
  "tol_rel": 1e-3,
  "assignment": "<per source>",
  "source": { "citation": "<...>", "url": "<...>" },
  "engine_feasible": false,
  "infeasible_reason": "naive ROBDD growth on ~N gates exceeds wall-clock"
}
```

Rules: set `ref_top_prob` to the published value; set `tol_rel` = `1e-3` for rounded paper values, tighten to `1e-6` when taken from a high-precision peer tool; include `ref_mcs_count` only for small models with an unambiguous published count and same cutoff (omit otherwise — large-model MCS counts are cutoff-dependent). Ensure ≥7 Tier-2 entries total. Schema test (Task 1) must still pass — run it.

- [ ] **Step 5: Run the full benchmark suite**

Run: `.venv/Scripts/python.exe -m pytest tests/benchmark -v`
Expected: feasible models pass within their `tol_rel`; infeasible models report `xfail` (not fail). Investigate any real `assert` failure (wrong assignment vs reference, or an engine issue) before proceeding — a genuine mismatch must be either fixed (assignment/source) or recorded as an unreproducible entry with reason, never silenced.

- [ ] **Step 6: Commit**

```bash
git add tests/benchmark/models tests/benchmark/corpus.json
git commit -m "test(benchmark): Tier-2 命名基准语料(Aralia/Open-PSA)+ 逐项出处/赋值/可行性"
```

---

## Task 5: Report generator + committed validation report

**Files:**
- Create: `tests/benchmark/make_report.py`
- Create: `docs/benchmark/engine-benchmark-validation.md` (generated, then committed)

- [ ] **Step 1: Write the report generator**

Create `tests/benchmark/make_report.py`:

```python
"""Render the benchmark corpus + live engine runs into the validation report.

Run from the repo root:
    .venv/Scripts/python.exe -m tests.benchmark.make_report
"""
from __future__ import annotations
import datetime
import pathlib

from tests.benchmark.harness import load_corpus, solve, rel_err

REPO = pathlib.Path(__file__).resolve().parents[2]
OUT = REPO / "docs" / "benchmark" / "engine-benchmark-validation.md"

HEADER = """# 引擎 vs 标准 PSA 基准模型 — 对标验证报告

> 自动生成自 `tests/benchmark/corpus.json` + 引擎实跑。重生成:
> `.venv/Scripts/python.exe -m tests.benchmark.make_report`

## 方法学
- 指标:精确顶事件概率(BDD,`Analysis.probability("exact")`);小模型并比最小割集数(`Analysis.cutsets()`)。
- 参考值:闭式解(Tier 1)/ 同行工具(SCRAM/XFTA)/ 学术基准表(Tier 2),逐模型记赋值与出处。
- 容差:Tier 1 ≤1e-9;Tier 2 按公布精度(≤1e-3 或匹配有效位;高精度同行值收紧到 1e-6)。
- 尺度上限:`engine_feasible=false` 的大模型记为「尺度上限」(xfail),非失败。

## 结果
"""


def main() -> None:
    rows = []
    for e in load_corpus():
        if not e.get("engine_feasible", True):
            rows.append((e, None, None, None, "尺度上限"))
            continue
        try:
            res = solve(e["model"], e.get("fault_tree"),
                        want_mcs="ref_mcs_count" in e and e["ref_mcs_count"] is not None,
                        mcs_cutoff=e.get("mcs_cutoff", 0.0))
        except Exception as ex:  # pragma: no cover - reported, not raised
            rows.append((e, None, None, None, f"运行失败: {ex!r}"))
            continue
        re_ = rel_err(res["top_prob"], e["ref_top_prob"])
        verdict = "✅" if re_ <= e["tol_rel"] else "❌"
        rows.append((e, res["top_prob"], res["mcs_count"], re_, verdict))

    lines = [HEADER,
             "| 模型 | Tier | 来源 | 参考顶概率 | 引擎顶概率 | 相对误差 | 参考MCS | 引擎MCS | 判定 |",
             "|---|---|---|---|---|---|---|---|---|"]
    for e, p, mcs, re_, verdict in rows:
        ref = f'{e["ref_top_prob"]:.6g}'
        got = "—" if p is None else f"{p:.6g}"
        rerr = "—" if re_ is None else f"{re_:.2e}"
        rmcs = e.get("ref_mcs_count") if e.get("ref_mcs_count") is not None else "—"
        gmcs = "—" if mcs is None else mcs
        lines.append(
            f'| `{e["id"]}` | {e["tier"]} | {e["source"].get("citation", "")} '
            f'| {ref} | {got} | {rerr} | {rmcs} | {gmcs} | {verdict} |'
        )
    lines.append("")
    lines.append(f"_生成时间(UTC):{datetime.datetime.utcnow():%Y-%m-%d %H:%M}_")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Generate the report**

Run: `.venv/Scripts/python.exe -m tests.benchmark.make_report`
Expected: prints `wrote .../docs/benchmark/engine-benchmark-validation.md`; the file contains a row per corpus entry with engine values and ✅ / 尺度上限.

- [ ] **Step 3: Verify the report content**

Open `docs/benchmark/engine-benchmark-validation.md`; confirm Tier-1 rows show rel_err ~1e-16 (✅), Tier-2 feasible rows ✅, infeasible rows show 尺度上限.

- [ ] **Step 4: Commit**

```bash
git add tests/benchmark/make_report.py docs/benchmark/engine-benchmark-validation.md
git commit -m "docs(benchmark): 报告生成器 + 定稿对标验证报告"
```

---

## Task 6: Full-suite regression + wiring

**Files:**
- Modify: `docs/superpowers/ROADMAP.md` (link the report)
- (Memory) update the project memory note.

- [ ] **Step 1: Run the entire test suite (no regression)**

Run: `.venv/Scripts/python.exe -m pytest -q`
Expected: all previously-passing tests still pass (~144 + 2 skipped baseline), plus the new benchmark tests; benchmark infeasible entries show as `xfail` (counted, not failures). Zero unexpected failures.

- [ ] **Step 2: Confirm the benchmark suite can be deselected**

Run: `.venv/Scripts/python.exe -m pytest -q -m "not benchmark"`
Expected: benchmark corpus test is deselected; everything else runs green.

- [ ] **Step 3: Link from the roadmap**

Modify `docs/superpowers/ROADMAP.md`: add a line under the current-status/validation section pointing to `docs/benchmark/engine-benchmark-validation.md` and noting `pytest tests/benchmark` as the reproducibility command. (Insert near the existing engine/validation notes; match surrounding bullet style.)

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/ROADMAP.md
git commit -m "docs(benchmark): ROADMAP 链接对标验证报告 + 复现命令"
```

- [ ] **Step 5: Update project memory**

Update `C:\Users\Liv\.claude\projects\D--PSA-Opus\memory\bess-psa-tool.md` ⑫ section: mark benchmark validation implemented (corpus size, Tier-1 closed-form ≤1e-9 pass, Tier-2 results, any scale-limit xfails), and note `tests/benchmark/` + the report path. Update `MEMORY.md` index line accordingly.

---

## Self-Review (completed against the spec)

**Spec coverage:**
- §2.1 corpus two tiers ≈10+ → Tasks 1 (Tier-1 ×3) + 4 (Tier-2 ≥7 + pressure_tank). ✅
- §2.2 reproducibility / per-model assignment + provenance → `assignment` + `source` fields enforced by schema test (Task 1); curation rules (Task 4). ✅
- §2.3 metrics + layered tolerance → Task 2 (≤1e-9), Task 3 (`tol_rel` per entry), `ref_mcs_count` for small models. ✅
- §2.4 corpus.json schema → Task 1 manifest + schema test. ✅
- §2.5 harness + parametrized test + scale guard → Tasks 1/3 (`engine_feasible` xfail without solving = the scale guard). ✅
- §2.6 report → Task 5. ✅
- §2.7 scope guard (coherent, MEF-subset, prob-only large) → Task 4 filter + feasibility rules. ✅
- §3 file changes (new `tests/benchmark/`, `docs/benchmark/`; conditional minimal `mef_xml.py`) → matched; conditional strengthening called out in Task 4. ✅
- §4 build order + acceptance → Tasks 1–6 map to rows 1–5 (curation split into offline scaffold + networked Tier-2). ✅

**Placeholder scan:** Tier-2 `ref_top_prob`/`source`/files are produced by Task 4's specified procedure (research deliverable), not vague code placeholders; all code (harness, tests, report) is complete and runnable. ✅

**Type/name consistency:** `solve()` returns `{"top_prob","mcs_count"}` and is called consistently in Tasks 2/3/5; `BENCH_DIR`, `load_corpus`, `rel_err` names match across files; corpus keys (`id/model/tier/ref_top_prob/ref_mcs_count/tol_rel/assignment/source/engine_feasible/infeasible_reason/fault_tree/mcs_cutoff`) are used consistently. ✅

**Scale-guard caveat:** the guard is curation-driven (`engine_feasible:false` → xfail without solving), chosen over a multiprocessing/`pytest-timeout` kill because Windows `spawn` would not reliably re-import the namespace `tests.benchmark.harness` in the child, and `pytest-timeout`'s thread method cannot kill a CPU-bound BDD build. Keep candidate sizes tractable; if a "feasible" model surprises, mark it infeasible.
