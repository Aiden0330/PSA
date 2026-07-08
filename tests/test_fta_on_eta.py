"""FTA 挂载在 ETA 上: 当功能事件链接的故障树跨屏障共享基本事件时,
引擎精确否定的序列频率应不同于"各屏障独立 PFD 积式"的近似。"""
from bess.scenarios import build_scenario_model
from psaengine.eta.sequence import quantify_event_tree
from psaengine.bdd.kernel import BddManager, build_from_pdag
from psaengine.quantify.probability import exact_probability


def _standalone_fe_probs(model) -> dict:
    """各功能事件独立看待时的顶事件概率(不考虑跨 FE 共享)。"""
    et = model.event_trees["TR"]
    out = {}
    for fe in et.functional_events:
        ft = model.fault_trees[fe.link_ft]
        basics = sorted(ft.pdag.basic_events())
        m = BddManager(basics)
        root = build_from_pdag(m, ft.pdag, ft.top)
        q = {b: model.parameters.get(ft.pdag.node(b).param_ref).unavailability() for b in basics}
        out[fe.id] = exact_probability(m, root, q)
    return out


def _independent_cascade(model) -> dict:
    """用独立积式按级联算各 end_state 频率(忽略共享相关性)。"""
    et = model.event_trees["TR"]
    p = _standalone_fe_probs(model)
    bids = [fe.id for fe in et.functional_events]
    seqf = {}
    for seq in et.sequences:
        prob = 1.0
        for bid in bids:
            br = seq["path"].get(bid)
            if br == "failure":
                prob *= p[bid]
            elif br == "success":
                prob *= (1 - p[bid])
        seqf[seq["end_state"]] = et.init_frequency * prob
    return seqf


def test_shared_event_makes_exact_differ_from_independent():
    model = build_scenario_model("SC_ISC")   # B_OFFGAS 与 B_BMS 共享 BMS_CONTACTOR_FAIL
    exact = quantify_event_tree(model, "TR")["sequences"]
    indep = _independent_cascade(model)
    assert any(abs(exact[k] - indep[k]) > 1e-12 for k in exact), \
        "共享事件下引擎精确值应不同于独立积式"


def test_no_shared_event_matches_independent():
    model = build_scenario_model("SC_EXT_FIRE")  # 全平凡 FT, 无共享
    exact = quantify_event_tree(model, "TR")["sequences"]
    indep = _independent_cascade(model)
    for k in exact:
        assert abs(exact[k] - indep[k]) <= 1e-12 * max(1.0, abs(exact[k])), k
