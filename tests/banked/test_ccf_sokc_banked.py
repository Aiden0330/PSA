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
    # OR(A,B) beta 展开 = A__I ∨ B__I ∨ CCF_G(三个铸参同源 Q_t)。
    # 全联动:整组共乘同一因子 → C2 ≈ median·f → p95/median ≈ EF=3;
    # 独立抽(旧病):3 个并联贡献权重 (9/19,9/19,1/19) ⇒ σ_eff≈0.672σ ⇒ 比值 ≈2.18
    # (engine-review 2026-07-22 以 2×10⁶ 样本复核;此前注释的 1.9 是等权近似,偏乐观)。
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


@gated
def test_L4_integrated_channel_same_law():
    """L4:集成通道(IE∧屏障 + CCF 组)同法则。

    闭式判别(σ=ln3/1.645):C3 = λ·P(屏障),λ 按规格 S3 入带(频率参数亦有认知谱)。
      · 组内联动(本实现):屏障谱 = 单因子 σ ⇒ 总 σ√2 ⇒ p95/p50 = 3^√2 ≈ 4.73
      · 铸参独立抽(旧病):屏障谱 σ_eff≈0.672σ(权重非等)⇒ 总 √(1+0.672²)σ ⇒ ≈3.82
        (engine-review 2026-07-22 实测复核;等权近似 3.56 偏乐观)
    1.23× 间距,窗口 [4.2, 5.3] 仍两侧判别(4000 样本 MC 噪声 ~7%)。
    """
    from psaengine.eta.uncertainty import event_tree_uncertainty_integrated
    from backend.et_builder import build_model_from_request
    m = build_model_from_request({
        "init_event": "IE", "init_frequency": 0.0,
        "functional_events": [{"id": "FE_B", "link_ft": "FE_B"}],
        "fault_trees": {"FE_B": {"name": "B", "top": "B_TOP", "nodes": [
            {"id": "A", "basic": True, "param_ref": "A"},
            {"id": "B", "basic": True, "param_ref": "B"},
            {"id": "B_TOP", "op": "or", "args": ["A", "B"]}]}},
        "parameters": {"A": {"value": 0.01}, "B": {"value": 0.01}},
        "sequences": [{"path": {"FE_B": "success"}, "end_state": "L0"},
                      {"path": {"FE_B": "failure"}, "end_state": "L1"}],
        "consequence_bins": {"L0": "C1", "L1": "C3"},
        "ccf_groups": [{"id": "G", "members": ["A", "B"], "model": "beta",
                        "factors": {"beta": 0.1}}],
        "ie_fault_tree": {"name": "__init__", "top": "IE_TOP", "nodes": [
            {"id": "I", "basic": True, "param_ref": "I"},
            {"id": "IE_TOP", "op": "or", "args": ["I"]}],
            "parameters": [{"id": "I", "kind": "frequency", "value": 1e-3}]}})
    u = event_tree_uncertainty_integrated(m, "TR", samples=4000, seed=11, error_factor=3.0)
    p50 = u["bands"]["C3"]["p50"]
    ratio = u["bands"]["C3"]["p95"] / p50
    assert 4.2 <= ratio <= 5.3, (
        f"集成通道 p95/p50={ratio:.2f} 应 ≈4.73(组内联动 × λ 谱);≈3.56 即铸参独立抽")


@gated
def test_L6_semver_rebased_for_ccf_linkage():
    """规格 §3(2026-07-22 修订后):含 CCF 模型的 MC 带与 0.3.x **不可互换**
    (相关结构改变:同向并联变宽、混合符号可变窄,见 L7)⇒ semver 0.4.0。
    指纹随报告页脚落卷,旧带不可在新版复现 —— 版本号不得撒谎。"""
    from backend import store
    assert store.engine_fingerprint()["semver"] == "0.4.0"


# ══ engine-review 2026-07-22 收口:F1 方向诚实 / F6 覆盖缺口 ═══════════════════

@gated
def test_L7_mixed_sign_exposure_may_narrow_not_a_regression():
    """F1(口径诚实):联动**不是**"只宽不窄"。混合符号暴露(成功分支/非相干)下
    同源缩放暴露真实抵消,带比独立抽窄——彼时独立抽本就错误偏宽。此锚点固化该事实,
    使任何"方向保守"的笼统声明不能悄悄回到代码/文档里。

    序列 A__I ∧ ¬B__I ∧ ¬CCF(同组成员跨两功能事件,一失效一成功):
    联动因子敏感度 1−2·(0.3/0.7)=1/7 ⇒ 带显著收窄(审查 probe2:1.16 vs 独立 3.73)。
    """
    m = load_model_from_dict({
        "model_data": {"parameters": [
            {"id": "A", "kind": "probability", "value": 0.6},
            {"id": "B", "kind": "probability", "value": 0.6}]},
        "fault_trees": [
            {"name": "FE1", "top": "A", "nodes": [{"id": "A", "basic": True, "param_ref": "A"}]},
            {"name": "FE2", "top": "B", "nodes": [{"id": "B", "basic": True, "param_ref": "B"}]}],
        "event_trees": [{"name": "TR", "init_event": "IE", "init_frequency": 1.0,
                         "functional_events": [{"id": "FE1", "link_ft": "FE1"},
                                               {"id": "FE2", "link_ft": "FE2"}],
                         "sequences": [{"path": {"FE1": "failure", "FE2": "success"},
                                        "end_state": "L1"},
                                       {"path": {"FE1": "failure", "FE2": "failure"},
                                        "end_state": "L2"},
                                       {"path": {"FE1": "success"}, "end_state": "L0"}],
                         "consequence_bins": {"L0": "C1", "L1": "C2", "L2": "C3"}}],
        "ccf_groups": [{"id": "G", "members": ["A", "B"], "model": "beta",
                        "factors": {"beta": 0.5}}]})
    u = event_tree_uncertainty(m, "TR", samples=4000, seed=5, error_factor=3.0)
    b = u["bands"]["C2"]
    assert b["p95"] / b["p50"] < 2.0, "混合符号暴露应显著窄于独立抽的 ~3.7(方向非单调)"


@gated
def test_L8_multilevel_alpha_group_linked():
    """F6:多层模型(alpha)联动锚点 —— 此前只测了 beta。
    3 成员 alpha 组全子集展开 = 7 个铸参,全部同源 Q_t ⇒ 比值 ≈EF=3;独立抽会更窄。"""
    m = load_model_from_dict({
        "model_data": {"parameters": [
            {"id": p, "kind": "probability", "value": 0.01} for p in ("A", "B", "C")]},
        "fault_trees": [{"name": "FE1", "top": "TOP", "nodes": [
            {"id": "A", "basic": True, "param_ref": "A"},
            {"id": "B", "basic": True, "param_ref": "B"},
            {"id": "C", "basic": True, "param_ref": "C"},
            {"id": "TOP", "op": "or", "args": ["A", "B", "C"]}]}],
        "event_trees": [{"name": "TR", "init_event": "IE", "init_frequency": 1.0,
                         "functional_events": [{"id": "FE1", "link_ft": "FE1"}],
                         "sequences": [{"path": {"FE1": "success"}, "end_state": "L0"},
                                       {"path": {"FE1": "failure"}, "end_state": "L1"}],
                         "consequence_bins": {"L0": "C1", "L1": "C2"}}],
        "ccf_groups": [{"id": "G", "members": ["A", "B", "C"], "model": "alpha",
                        "factors": {"alpha1": 0.9, "alpha2": 0.07, "alpha3": 0.03}}]})
    u = event_tree_uncertainty(m, "TR", samples=4000, seed=9, error_factor=3.0)
    b = u["bands"]["C2"]
    assert 2.6 <= b["p95"] / b["p50"] <= 3.4


@gated
def test_L9_heterogeneous_beta_group_not_force_linked():
    """F2(b):异质 beta 组不满足规格 §2 的同质前提 —— 各成员独立部分随自己的参数走
    (派生忠实),不得被强行绑到代表成员(那是把不同数据源夸大成相关)。"""
    from psaengine.preprocess.ccf_expand import apply_ccf
    from psaengine.model.ccf import CCFGroup
    m = load_model_from_dict({
        "model_data": {"parameters": [
            {"id": "A", "kind": "probability", "value": 0.05},
            {"id": "B", "kind": "probability", "value": 0.001}]},
        "fault_trees": [{"name": "T", "top": "TOP", "nodes": [
            {"id": "A", "basic": True, "param_ref": "A"},
            {"id": "B", "basic": True, "param_ref": "B"},
            {"id": "TOP", "op": "or", "args": ["A", "B"]}]}]})
    grp = CCFGroup("G", ["A", "B"], "beta", {"beta": 0.1})
    _, lib = apply_ccf(m.fault_trees["T"].pdag, [grp], m.parameters)
    assert lib.get("A__I").epistemic_source == "A"
    assert lib.get("B__I").epistemic_source == "B"      # 不是 "A"
    assert lib.get("CCF_G").epistemic_source == "A"     # 共因项随代表参数(q_rep 出处)


@gated
def test_L10_user_injected_source_validated():
    """F3:epistemic_source 经 json_io 成为用户输入面 —— 链式/悬空/频率源必须响亮拒绝
    (静默出数会依赖字典序,破坏逐位重放的证据链保证)。"""
    def _m(params):
        return load_model_from_dict({
            "model_data": {"parameters": params},
            "fault_trees": [{"name": "T", "top": "TOP", "nodes": [
                {"id": "X", "basic": True, "param_ref": "X"},
                {"id": "TOP", "op": "or", "args": ["X"]}]}],
            "event_trees": [{"name": "TR", "init_event": "IE", "init_frequency": 1.0,
                             "functional_events": [{"id": "FE1", "link_ft": "T"}],
                             "sequences": [{"path": {"FE1": "failure"}, "end_state": "L1"}],
                             "consequence_bins": {"L1": "C2"}}]})
    dangling = _m([{"id": "X", "kind": "probability", "value": 0.1,
                    "epistemic_source": "GHOST"}])
    with pytest.raises(ValueError, match="不存在于参数库"):
        event_tree_uncertainty(dangling, "TR", samples=8, error_factor=3.0)

    chained = _m([{"id": "X", "kind": "probability", "value": 0.1, "epistemic_source": "Y"},
                  {"id": "Y", "kind": "probability", "value": 0.2, "epistemic_source": "Z"},
                  {"id": "Z", "kind": "probability", "value": 0.3}])
    with pytest.raises(ValueError, match="不得链式"):
        event_tree_uncertainty(chained, "TR", samples=8, error_factor=3.0)

    freq_src = _m([{"id": "X", "kind": "probability", "value": 0.1, "epistemic_source": "F"},
                   {"id": "F", "kind": "frequency", "value": 1e-3}])
    with pytest.raises(ValueError, match="量纲混用"):
        event_tree_uncertainty(freq_src, "TR", samples=8, error_factor=3.0)

    # 复审 R1:**声明方**为频率同样拒绝。单树通道有更早的量纲守卫(频率参数不得进概率
    # 语境);真正的暴露面是**集成通道**——那里 λ 合法入带,审查 probe8 实测 λ=2.4/yr
    # 被 _apply_links 截到 1.0,C3 p50 0.0098 vs 正确 0.024(~8× 静默低估,非保守)。
    from psaengine.eta.uncertainty import event_tree_uncertainty_integrated
    from backend.et_builder import build_model_from_request
    from psaengine.model.parameters import Parameter
    mi = build_model_from_request({
        "init_event": "IE", "init_frequency": 0.0,
        "functional_events": [{"id": "FE_B", "link_ft": "FE_B"}],
        "fault_trees": {"FE_B": {"name": "B", "top": "B_TOP", "nodes": [
            {"id": "Q", "basic": True, "param_ref": "Q"},
            {"id": "B_TOP", "op": "or", "args": ["Q"]}]}},
        "parameters": {"Q": {"value": 0.1}},
        "sequences": [{"path": {"FE_B": "success"}, "end_state": "L0"},
                      {"path": {"FE_B": "failure"}, "end_state": "L1"}],
        "consequence_bins": {"L0": "C1", "L1": "C3"},
        "ie_fault_tree": {"name": "__init__", "top": "IE_TOP", "nodes": [
            {"id": "LAM", "basic": True, "param_ref": "LAM"},
            {"id": "IE_TOP", "op": "or", "args": ["LAM"]}],
            "parameters": [{"id": "LAM", "kind": "frequency", "value": 2.4}]}})
    old = mi.parameters.get("LAM")
    mi.parameters.add(Parameter("LAM", "frequency", old.value, epistemic_source="Q"))
    with pytest.raises(ValueError, match="不可声明 epistemic_source"):
        event_tree_uncertainty_integrated(mi, "TR", samples=8, error_factor=3.0)


@gated
def test_L11_aggregate_matches_single_tree_and_rejects_ambiguous_reuse():
    """F6:aggregate 通道锚点(此前零覆盖)。单树 == 聚合单树逐位;
    F5:跨树同名铸参异源(复用组 id、成员不同)→ 法则指纹点名拒绝,不再静默拆散相关。"""
    from psaengine.eta.uncertainty import aggregate_event_tree_uncertainty
    m = _ccf_or_model()
    single = event_tree_uncertainty(m, "TR", samples=500, seed=17, error_factor=3.0)
    agg = aggregate_event_tree_uncertainty([(m, "TR")], samples=500, seed=17, error_factor=3.0)
    for k in ("p05", "p50", "p95"):
        assert agg["bands"]["C2"][k] == single["bands"]["C2"][k]

    def _tree(a, b_):
        return load_model_from_dict({
            "model_data": {"parameters": [
                {"id": a, "kind": "probability", "value": 0.01},
                {"id": b_, "kind": "probability", "value": 0.01}]},
            "fault_trees": [{"name": "FE1", "top": "TOP", "nodes": [
                {"id": a, "basic": True, "param_ref": a},
                {"id": b_, "basic": True, "param_ref": b_},
                {"id": "TOP", "op": "or", "args": [a, b_]}]}],
            "event_trees": [{"name": "TR", "init_event": "IE", "init_frequency": 1.0,
                             "functional_events": [{"id": "FE1", "link_ft": "FE1"}],
                             "sequences": [{"path": {"FE1": "success"}, "end_state": "L0"},
                                           {"path": {"FE1": "failure"}, "end_state": "L1"}],
                             "consequence_bins": {"L0": "C1", "L1": "C2"}}],
            "ccf_groups": [{"id": "G", "members": [a, b_], "model": "beta",
                            "factors": {"beta": 0.1}}]})
    with pytest.raises(ValueError):        # CCF_G 同名、源不同(A vs C)→ 拒绝
        aggregate_event_tree_uncertainty([(_tree("A", "B"), "TR"), (_tree("C", "D"), "TR")],
                                         samples=50, seed=1, error_factor=3.0)


@gated
def test_L12_epistemic_source_roundtrip_symmetric():
    """F6:json_io 往返对称(声明须验)—— 铸参的认知源经 save/load 不丢。"""
    from psaengine.model.json_io import parameters_to_json
    from psaengine.model.parameters import Parameter, ParameterLibrary
    from psaengine.model.json_io import _param
    lib = ParameterLibrary()
    lib.add(Parameter("CCF_G", "probability", 0.001, epistemic_source="A"))
    d = parameters_to_json(lib)[0]
    assert d["epistemic_source"] == "A"
    assert _param(d).epistemic_source == "A"
