import pytest
from psaengine import Model, Analysis

def test_analysis_mocus_matches_bdd():
    m = Model.from_json("examples/tiny_and.json")
    an = Analysis(m, fault_tree="TOP")
    bdd_cs = sorted(sorted(c.events) for c in an.cutsets())
    mocus_cs = sorted(sorted(c) for c in an.mocus_cutsets())
    assert bdd_cs == mocus_cs == [["A","B"]]

def test_analysis_modular_probability():
    m = Model.from_json("examples/tiny_and.json")
    an = Analysis(m, fault_tree="TOP")
    assert an.modular_probability() == pytest.approx(an.probability())

def test_analysis_truncation_study():
    m = Model.from_json("examples/tiny_and.json")
    an = Analysis(m, fault_tree="TOP")
    rows = an.truncation_study(cutoffs=[1e-1, 1e-3])
    assert all("probability" in r and "delta" in r for r in rows)
