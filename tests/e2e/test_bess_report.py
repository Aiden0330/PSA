import pytest
from bess.report import run_scenario, build_report

def test_report_has_consequences_and_importance(tmp_path):
    rpt = build_report(scenario="grid_container", samples=500, seed=7)
    assert set(rpt["consequences"]).issubset({"C1","C2","C3","C4","C5"})
    assert "barrier_importance" in rpt
    assert "uncertainty" in rpt
    # 重要度排序: 离气探测/应急响应应在前列(对后果影响大)
    top_barriers = [b for b, _ in rpt["barrier_importance"][:3]]
    assert "B_OFFGAS" in top_barriers or "B_RESPONSE" in top_barriers

def test_uncertainty_band_brackets_point_estimate():
    rpt = build_report(scenario="grid_container", samples=800, seed=3)
    # C1 只取决于首道屏障(median PFD), 点估计落在其 5–95% 带内
    band = rpt["uncertainty"]["C1"]
    assert band["p05"] <= rpt["consequences"]["C1"] <= band["p95"]

def test_run_scenario_writes_markdown(tmp_path):
    out = tmp_path / "rpt.md"
    path = run_scenario("grid_container", samples=200, output=str(out))
    assert out.exists()
    text = out.read_text(encoding="utf-8")
    assert "BESS 热失控 QRA" in text and "C5" in text
