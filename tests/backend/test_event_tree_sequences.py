from bess.scenarios import build_scenario_model
from psaengine.eta.sequence import quantify_event_tree, event_tree_sequences


def test_sequences_sorted_and_conserved():
    model = build_scenario_model("SC_OVERCHARGE")
    seqs = event_tree_sequences(model, "TR")
    assert isinstance(seqs, list) and len(seqs) >= 2
    # 每项形态
    s0 = seqs[0]
    assert set(s0) >= {"end_state", "path", "consequence", "frequency"}
    assert isinstance(s0["path"], dict)
    # 降序
    freqs = [s["frequency"] for s in seqs]
    assert freqs == sorted(freqs, reverse=True)
    # 守恒: Σ序列频率 ≈ Σ后果频率
    total_seq = sum(freqs)
    total_cons = sum(quantify_event_tree(model, "TR")["consequences"].values())
    assert abs(total_seq - total_cons) <= 1e-12 + 1e-6 * total_cons
