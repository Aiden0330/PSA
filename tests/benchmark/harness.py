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


def parse_model(model_file: str):
    """Load and return a parsed MEF model (path relative to BENCH_DIR).

    The single place benchmark code loads a model file, so engine coupling
    stays inside this module.
    """
    return load_mef_xml(str(BENCH_DIR / model_file))


def solve(model_file: str, fault_tree: str | None = None,
          want_mcs: bool = False, mcs_cutoff: float = 0.0) -> dict:
    """Load a MEF model (path relative to BENCH_DIR) and quantify it.

    Returns {'top_prob': float, 'mcs_count': int | None}. MCS counting is
    skipped unless want_mcs (it can blow up on larger models). mcs_cutoff is
    the probability cutoff passed to cutsets(); 0.0 = no truncation.
    """
    model = parse_model(model_file)
    an = Analysis(model, fault_tree=fault_tree)
    out: dict = {"top_prob": an.probability("exact"), "mcs_count": None}
    if want_mcs:
        out["mcs_count"] = len(an.cutsets(cutoff=mcs_cutoff))
    return out
