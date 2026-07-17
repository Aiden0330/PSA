"""BANKED 锚点:CCF 组内认知联动抽样(规格 2026-07-17-ccf-group-sokc-linkage-banked)。

探针:Parameter 具 `epistemic_source` 字段(dataclass fields,零构造)⇒ 激活;
落地时 semver → 0.4.0(含 CCF 模型的 MC 带变宽,方向保守)。
判别闭式:全联动 p95/median = EF;独立抽(现行为)≈ e^{1.645·σ/√n}(n 个近等并联
贡献的对数正态和近似)——beta 组 OR-of-2 有 3 个铸参,≈1.9 vs 3.0,间距 1.6×。
"""
import pytest

from psaengine.model.json_io import load_model_from_dict
from psaengine.eta.uncertainty import event_tree_uncertainty

PROBE_REASON = ("CCF 组认知联动未实现——规格 docs/superpowers/specs/"
                "2026-07-17-ccf-group-sokc-linkage-banked.md")


def _implemented() -> bool:
    import dataclasses
    from psaengine.model.parameters import Parameter
    try:
        return "epistemic_source" in {f.name for f in dataclasses.fields(Parameter)}
    except TypeError:                       # 非 dataclass 实现形:按属性探测
        return hasattr(Parameter, "epistemic_source")


gated = pytest.mark.skipif(not _implemented(), reason=PROBE_REASON)


def _ccf_or_model(beta=0.1, q=0.01):
    return load_model_from_dict({
        "model_data": {"parameters": [
            {"id": "A", "kind": "probability", "value": q},
            {"id": "B", "kind": "probability", "value": q}]},
        "fault_trees": [{"name": "FE1", "top": "TOP", "nodes": [
            {"id": "A", "basic": True, "param_ref": "A"},
            {"id": "B", "basic": True, "param_ref": "B"},
            {"id": "TOP", "op": "or", "args": ["A", "B"]}]}],
        "event_trees": [{"name": "TR", "init_event": "IE", "init_frequency": 1.0,
                         "functional_events": [{"id": "FE1", "link_ft": "FE1"}],
                         "sequences": [{"path": {"FE1": "success"}, "end_state": "L0"},
                                       {"path": {"FE1": "failure"}, "end_state": "L1"}],
                         "consequence_bins": {"L0": "C1", "L1": "C2"}}],
        "ccf_groups": [{"id": "G", "members": ["A", "B"], "model": "beta",
                        "factors": {"beta": beta}}]})


@gated
def test_L1_group_linked_sampling_full_ef_spread():
    # OR(A,B) beta 展开 = A__I ∨ B__I ∨ CCF_G_A_B(三个铸参同源 Q_t)。
    # 全联动:整组共乘同一因子 → C2 ≈ median·f → p95/median ≈ EF=3;
    # 独立抽(旧病):3 个近等并联贡献 → p95/median ≈ e^{1.645σ/√3} ≈ 1.9。
    m = _ccf_or_model()
    u = event_tree_uncertainty(m, "TR", samples=4000, seed=7, error_factor=3.0)
    p50 = u["bands"]["C2"]["p50"]
    ratio = u["bands"]["C2"]["p95"] / p50
    assert 2.6 <= ratio <= 3.4, (
        f"p95/p50={ratio:.2f} 应 ≈3(组内认知联动)——≈1.9 即铸参独立抽(√n 收窄,非保守)")


@gated
def test_L2_ef1_degenerates_to_point_bitwise():
    from psaengine.eta.sequence import quantify_event_tree
    m = _ccf_or_model()
    u = event_tree_uncertainty(m, "TR", samples=50, seed=1, error_factor=1.0)
    point = quantify_event_tree(m, "TR")["consequences"]
    b = u["bands"]["C2"]
    assert b["p05"] == b["p50"] == b["p95"] == point["C2"]


def test_L3_ccf_free_stream_frozen():
    # 恒跑(不门控):无 CCF 模型的抽样流不得因联动机制改变——批次 F A7 同款冻结值。
    from backend.et_builder import build_model_from_request
    m = build_model_from_request(
        {"init_event": "IE", "init_frequency": 1e-3,
         "functional_events": [{"id": "FE1", "link_ft": "FE1"}],
         "fault_trees": {"FE1": {"name": "FT", "top": "TOP", "nodes": [
             {"id": "A", "basic": True, "param_ref": "A"},
             {"id": "B", "basic": True, "param_ref": "B"},
             {"id": "TOP", "op": "or", "args": ["A", "B"]}]}},
         "parameters": {"A": {"value": 0.2}, "B": {"value": 0.1}},
         "sequences": [{"path": {"FE1": "success"}, "end_state": "L0"},
                       {"path": {"FE1": "failure"}, "end_state": "L1"}],
         "consequence_bins": {"L0": "C1", "L1": "C2"}})
    u = event_tree_uncertainty(m, "TR", samples=200, seed=42, error_factor=3.0)
    assert u["bands"]["C2"]["p05"] == 1.37364901153765983e-04
    assert u["bands"]["C2"]["p50"] == 3.08110156636124267e-04
    assert u["bands"]["C2"]["p95"] == 6.47382403519241299e-04


@gated
def test_L5_scaled_draw_still_clipped():
    # median 0.6 的组:联动因子 >1/0.6 的样本必须封 1.0(缩放后截断铁律)
    m = _ccf_or_model(beta=1.0, q=0.6)     # 全共因:单铸参 CCF_G_A_B q=0.6
    u = event_tree_uncertainty(m, "TR", samples=2000, seed=3, error_factor=3.0)
    assert u["bands"]["C2"]["p95"] <= 1.0 + 1e-12
