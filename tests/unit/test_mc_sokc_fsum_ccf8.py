"""批次 F 锚点(先红):SOKC 按 ref 抽样 + ET 求和 fsum 统一 + CCF 组上限 8。

规格:docs/superpowers/specs/2026-07-17-mc-sokc-fsum-ccf8.md(semver 0.2.0 → 0.3.0)。
"""
from math import comb, fsum

import pytest

from psaengine.model.json_io import load_model_from_dict
from psaengine.eta.sequence import quantify_event_tree
from psaengine.eta.uncertainty import (aggregate_event_tree_uncertainty,
                                       event_tree_uncertainty)

_CLS = ("C1", "C2", "C3", "C4", "C5")


def _model(fts, params, fes, seqs, bins, init=1.0, ccf=None):
    return load_model_from_dict({
        "model_data": {"parameters": params},
        "fault_trees": fts,
        "event_trees": [{"name": "TR", "init_event": "IE", "init_frequency": init,
                         "functional_events": fes, "sequences": seqs,
                         "consequence_bins": bins}],
        "ccf_groups": ccf or []})


# ── S-A:单树 MC 按 ref 联合抽样(SOKC)──────────────────────────────────────────

def _sokc_model():
    # 同 ref 双节点(qA×2)+ 独立 ref(B):正确语义 = qA 一次抽样共享,B 独立
    return _model(
        [{"name": "FE1", "top": "TOP", "nodes": [
            {"id": "A1", "basic": True, "param_ref": "qA"},
            {"id": "A2", "basic": True, "param_ref": "qA"},
            {"id": "B", "basic": True, "param_ref": "qB"},
            {"id": "G", "op": "and", "args": ["A1", "A2"]},
            {"id": "TOP", "op": "or", "args": ["G", "B"]}]}],
        [{"id": "qA", "kind": "probability", "value": 0.1},
         {"id": "qB", "kind": "probability", "value": 0.02}],
        [{"id": "FE1", "link_ft": "FE1"}],
        [{"path": {"FE1": "success"}, "end_state": "L0"},
         {"path": {"FE1": "failure"}, "end_state": "L1"}],
        {"L0": "C1", "L1": "C2"})


def test_A1_single_tree_bands_equal_aggregate_of_one_bitwise():
    # 两条代码路径一个语义:单树 == 聚合单树(同 seed 同流)——按 ref 排序联合抽样后成立
    m = _sokc_model()
    u1 = event_tree_uncertainty(m, "TR", samples=500, seed=11, error_factor=3.0)
    u2 = aggregate_event_tree_uncertainty([(m, "TR")], samples=500, seed=11, error_factor=3.0)
    for c in _CLS:
        assert u1["bands"][c] == u2["bands"][c], (
            f"{c}: 单树 {u1['bands'][c]} ≠ 聚合单树 {u2['bands'][c]} —— 抽样口径分叉(SOKC 病)")


def test_A2_same_ref_nodes_share_draw_p95():
    # AND(A1,A2) 同 ref(.1, EF3):同抽 p95 = (0.1·3)² = 0.09;独立抽 ≈ 0.047(修前实测)
    m = _model(
        [{"name": "FE1", "top": "G", "nodes": [
            {"id": "A1", "basic": True, "param_ref": "qA"},
            {"id": "A2", "basic": True, "param_ref": "qA"},
            {"id": "G", "op": "and", "args": ["A1", "A2"]}]}],
        [{"id": "qA", "kind": "probability", "value": 0.1}],
        [{"id": "FE1", "link_ft": "FE1"}],
        [{"path": {"FE1": "success"}, "end_state": "L0"},
         {"path": {"FE1": "failure"}, "end_state": "L1"}],
        {"L0": "C1", "L1": "C2"})
    u = event_tree_uncertainty(m, "TR", samples=4000, seed=7, error_factor=3.0)
    assert 0.07 <= u["bands"]["C2"]["p95"] <= 0.12, (
        f"p95={u['bands']['C2']['p95']:.4f} 应 ≈0.09(同 ref 同抽)——≈0.047 即按节点独立抽(非保守收窄)")


# ── S-B:ET 级求和 fsum(杀试点 P-1)─────────────────────────────────────────────

_MIX_PFD = {"F1": 5e-17, "F2": 5e-17, "F3": 5e-17, "F4": 0.5}
_MIX_INIT = 2.0


def _mixed_magnitude_model():
    # 4 屏障链,init=2.0:C2 = 四条单失败路径 = 大项 ≈1.0(F4 单失败,DFS 序最先到达)
    # + 三个尾项各 ≈5e-17。构造要点:单个尾项 0.225 ULP(< 半 ULP,顺序累加逐次被丢),
    # 三项之和 1.5e-16(> 半 ULP,fsum 正确进位)→ 顺序和与 fsum 确定性差 1 ULP(红)。
    from itertools import product as _prod
    keys = list(_MIX_PFD)
    seqs, bins = [], {}
    idx = 0
    for combo in _prod(("success", "failure"), repeat=4):
        es = f"L{idx}"; idx += 1
        seqs.append({"path": dict(zip(keys, combo)), "end_state": es})
        bins[es] = f"C{min(5, 1 + list(combo).count('failure'))}"
    return load_model_from_dict({
        "model_data": {"parameters": [
            {"id": k, "kind": "probability", "value": v} for k, v in _MIX_PFD.items()]},
        "fault_trees": [{"name": k, "top": k, "nodes": [
            {"id": k + "_E", "basic": True, "param_ref": k},
            {"id": k, "op": "null", "args": [k + "_E"]}]} for k in _MIX_PFD],
        "event_trees": [{"name": "TR", "init_event": "IE", "init_frequency": _MIX_INIT,
                         "functional_events": [{"id": k, "link_ft": k} for k in _MIX_PFD],
                         "sequences": seqs, "consequence_bins": bins}]})


def test_B1_quantify_consequence_sum_is_correctly_rounded():
    m = _mixed_magnitude_model()
    res = quantify_event_tree(m, "TR")
    ps = list(_MIX_PFD.values())
    contribs = []
    for i in range(4):                      # C2 = 恰一失败的四条路径(独立事实重推)
        prod = _MIX_INIT
        for j in range(4):
            prod *= ps[j] if j == i else (1 - ps[j])
        contribs.append(prod)
    assert res["consequences"]["C2"] == fsum(contribs), (
        f"C2={res['consequences']['C2']!r} 应为 fsum={fsum(contribs)!r}"
        "(顺序累加丢尾数进位 → 差 1 ULP;ET 级求和须 math.fsum)")


def test_B2_quantify_equals_report_channel_bitwise():
    # 序无关后两通道天然逐位(试点 P-1:此前报告按频率降序、quantify 按树序,末位分歧)
    from backend.execution import point_sequences
    m = _mixed_magnitude_model()
    q = quantify_event_tree(m, "TR")["consequences"]
    rep: dict = {}
    contribs: dict = {}
    for row in point_sequences(m, "TR", None, None, None):
        contribs.setdefault(row["consequence"], []).append(row["frequency"])
    rep = {c: fsum(v) for c, v in contribs.items()}
    for c in q:
        assert q[c] == rep.get(c, 0.0), f"{c}: quantify {q[c]!r} ≠ 报告通道 {rep.get(c)!r}"


# ── S-C:CCF 组上限 6 → 8 ───────────────────────────────────────────────────────

def _ccf_and_model(g, factors):
    nodes = [{"id": f"A{i}", "basic": True, "param_ref": f"A{i}"} for i in range(g)]
    nodes.append({"id": "TOP", "op": "and", "args": [f"A{i}" for i in range(g)]})
    return _model(
        [{"name": "FE1", "top": "TOP", "nodes": nodes}],
        [{"id": f"A{i}", "kind": "probability", "value": 0.01} for i in range(g)],
        [{"id": "FE1", "link_ft": "FE1"}],
        [{"path": {"FE1": "success"}, "end_state": "L0"},
         {"path": {"FE1": "failure"}, "end_state": "L1"}],
        {"L0": "C1", "L1": "C3"}, init=1e-2,
        ccf=[{"id": "G", "members": [f"A{i}" for i in range(g)],
              "model": "alpha", "factors": factors}])


def test_C1_group8_all_common_degenerate_exact():
    # α8=1:全共因 → AND-of-8 = 共因事件本身 → C3 = 1e-2 × 0.01 = 1e-4 逐位
    m = _ccf_and_model(8, {"alpha8": 1.0})
    res = quantify_event_tree(m, "TR")
    assert res["consequences"]["C3"] == pytest.approx(1e-4, rel=1e-14)


def test_C2_group8_all_independent_degenerate_exact():
    # α1=1:全独立 → P(AND) = 0.01⁸ = 1e-16 → C3 = 1e-18
    m = _ccf_and_model(8, {"alpha1": 1.0})
    res = quantify_event_tree(m, "TR")
    assert res["consequences"]["C3"] == pytest.approx(1e-18, rel=1e-12)


@pytest.mark.parametrize("g", [7, 8])
def test_C3_alpha_consistency_identity_g7_g8(g):
    from psaengine.preprocess.ccf_expand import q_levels
    factors = {f"alpha{k}": 1.0 / g for k in range(1, g + 1)}
    qk = q_levels("alpha", factors, g, 0.01)
    assert len(qk) == g
    total = fsum(comb(g - 1, k - 1) * qk[k - 1] for k in range(1, g + 1))
    assert total == pytest.approx(0.01, rel=1e-13), "Σ C(m-1,k-1)·Q_k = Q_t 恒等式"


def test_C4_group9_still_rejected():
    with pytest.raises(ValueError):
        m = _ccf_and_model(9, {"alpha1": 1.0})
        quantify_event_tree(m, "TR")


# ── 指纹:语义变更 ⇒ semver ≥ 0.3.0 ──────────────────────────────────────────────

def test_semver_bumped_for_mc_semantics_change():
    """批次 F 的保证 = **永不退回 0.2.x**(旧带只在 0.2.x 可复现,指纹不得撒谎)。
    改为下限断言:后续批次继续上抬 semver 时不制造跨批次 churn,各批次的精确钉扎
    放在自己的锚点文件里(如 CCF 联动 = 0.4.0,见 tests/banked/test_ccf_sokc_banked.py)。"""
    from backend import store
    got = tuple(int(x) for x in store.engine_fingerprint()["semver"].split("."))
    assert got >= (0, 3, 0), f"semver {got} 低于批次 F 基线 0.3.0"


# ── 收口(engine-review F-1):MGL 词汇止 ρ₇ → 8 组点名拒绝;alpha/phi 到 8 ─────────

def test_C5_mgl_group8_rejected_loudly_not_indexerror():
    from psaengine.preprocess.ccf_expand import q_levels
    with pytest.raises(ValueError, match="alpha"):        # 点名建议换 alpha,绝非 IndexError→500
        q_levels("mgl", {"beta": 0.3}, 8, 0.01)


def test_C6_mgl_group7_identity_locked():
    from psaengine.preprocess.ccf_expand import q_levels
    f = {"beta": 0.3, "gamma": 0.25, "delta": 0.2, "epsilon": 0.15, "mu": 0.1, "nu": 0.05}
    qk = q_levels("mgl", f, 7, 0.01)
    total = fsum(comb(6, k - 1) * qk[k - 1] for k in range(1, 8))
    assert total == pytest.approx(0.01, rel=1e-12)


def test_C7_phi_group8_numbered_keys_scale():
    from psaengine.preprocess.ccf_expand import q_levels
    phis = {f"phi{k}": 0.125 for k in range(1, 9)}          # Σ=1
    qk = q_levels("phi", phis, 8, 0.01)
    assert len(qk) == 8 and all(q >= 0 for q in qk)
