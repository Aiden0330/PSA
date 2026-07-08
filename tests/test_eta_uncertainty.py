from bess.scenarios import build_scenario_model
from psaengine.eta.uncertainty import event_tree_uncertainty


def test_bands_ordered_and_spread():
    m = build_scenario_model("SC_ISC")
    r = event_tree_uncertainty(m, "TR", samples=400, seed=1)
    for c, b in r["bands"].items():
        assert b["p05"] <= b["p50"] <= b["p95"]
    assert any(r["bands"][c]["p95"] > r["bands"][c]["p05"] for c in r["bands"])


def test_ef1_collapses_to_point():
    m = build_scenario_model("SC_EXT_FIRE")
    r = event_tree_uncertainty(m, "TR", samples=30, seed=1, error_factor=1.0)
    for c in r["bands"]:
        for k in ("p05", "p50", "p95"):
            assert abs(r["bands"][c][k] - r["point"][c]) <= 1e-9 * max(1.0, r["point"][c])
