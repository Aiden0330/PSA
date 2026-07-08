import pytest
from psaengine import Model, Analysis

def test_analysis_probability_and_importance():
    m = Model.from_json("examples/tiny_and.json")
    an = Analysis(m, fault_tree="TOP")
    assert an.probability(method="exact") == pytest.approx(0.1*0.2)
    imp = an.importance(measures=["fv"])
    assert "A" in imp and "fv" in imp["A"]

def test_analysis_cutsets():
    m = Model.from_json("examples/tiny_and.json")
    an = Analysis(m, fault_tree="TOP")
    cs = an.cutsets()
    assert sorted(cs[0].events) == ["A","B"]
