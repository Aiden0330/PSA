from bess.scenarios import build_scenario_model
from psaengine.eta.uncertainty import barrier_importance_exact


def test_severe_consequence_all_barriers_necessary():
    m = build_scenario_model("SC_OVERCHARGE")  # C5=全部失效
    imp = barrier_importance_exact(m, "TR")
    for r in imp["C5"]:
        assert abs(r["fv"] - 1.0) < 1e-9     # 每屏障对 C5 都必需 → FV=1


def test_fv_bound_and_uninvolved_zero():
    m = build_scenario_model("SC_OVERCHARGE")
    imp = barrier_importance_exact(m, "TR")
    for c, rows in imp.items():
        for r in rows:
            assert r["fv"] <= 1.0 + 1e-9
            assert r["raw"] >= 0.0
    first = m.event_trees["TR"].functional_events[0].id
    for r in imp["C1"]:                       # C1=仅首屏障成功
        if r["barrier"] != first:
            assert abs(r["fv"]) < 1e-9        # 非首屏障对 C1 无贡献


def test_rows_sorted_by_fv_desc():
    imp = barrier_importance_exact(build_scenario_model("SC_ISC"), "TR")
    for c, rows in imp.items():
        fvs = [r["fv"] for r in rows]
        assert fvs == sorted(fvs, reverse=True)
