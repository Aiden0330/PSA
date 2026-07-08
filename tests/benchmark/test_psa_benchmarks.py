import pytest
from tests.benchmark.harness import load_corpus, solve, rel_err

CORPUS = load_corpus()


@pytest.mark.benchmark
@pytest.mark.parametrize("entry", CORPUS, ids=[e["id"] for e in CORPUS])
def test_benchmark(entry):
    if not entry.get("engine_feasible", True):
        pytest.xfail(f"engine scale limit: {entry.get('infeasible_reason', 'BDD blowup')}")

    has_mcs = entry.get("ref_mcs_count") is not None
    res = solve(
        entry["model"],
        entry.get("fault_tree"),
        want_mcs=has_mcs,
        mcs_cutoff=entry.get("mcs_cutoff", 0.0),
    )

    re_ = rel_err(res["top_prob"], entry["ref_top_prob"])
    assert re_ <= entry["tol_rel"], (
        f'{entry["id"]}: top_prob {res["top_prob"]:.6g} vs ref '
        f'{entry["ref_top_prob"]:.6g} -> rel_err {re_:.2e} > tol {entry["tol_rel"]:.0e}'
    )

    if has_mcs:
        assert res["mcs_count"] == entry["ref_mcs_count"], (
            f'{entry["id"]} MCS: got {res["mcs_count"]} vs ref {entry["ref_mcs_count"]}'
        )
