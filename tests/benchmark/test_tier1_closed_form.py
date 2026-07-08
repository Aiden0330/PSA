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
