"""初因事件故障树频率量化(规格 2026-07-13-ie-fault-tree-frequency §1-§2)。

行业规则(RiskSpectrum/SAPHIRE/CAFTA 同):每个最小割集**恰好一个**频率事件;
割集频率 = 初因率 × Π(使能概率);顶事件频率 = Σ 割集频率(频率的并即求和,
绝非概率通道的 1−Π(1−q));违规响亮报错,绝不静默近似。
配套量纲护栏:频率参数误入概率通道(unavailability)同样响亮。
"""
import pytest

from psaengine.model.fault_tree import FaultTree
from psaengine.model.model import Model
from psaengine.model.parameters import Parameter, ParameterLibrary
from psaengine.model.pdag import PDAG, Op
from psaengine.quantify.frequency import FrequencyRuleError, fault_tree_frequency


def _model(params: list[Parameter], build) -> Model:
    lib = ParameterLibrary()
    for p in params:
        lib.add(p)
    g = PDAG()
    build(g)
    return Model(parameters=lib, fault_trees={"IE": FaultTree(g.top, g)})


def test_or_of_two_frequencies_is_sum_not_probability_union():
    """OR(f₁,f₂) = f₁+f₂ = 3e-3 —— 概率通道会给 1−(1−f₁)(1−f₂) = 2.998e-3,必须区分。"""
    def build(g):
        g.basic("F1"); g.basic("F2")
        g.gate("TOP", Op.OR, ["F1", "F2"]); g.top = "TOP"
    m = _model([Parameter("F1", "frequency", 1e-3), Parameter("F2", "frequency", 2e-3)], build)
    r = fault_tree_frequency(m, "IE")
    assert r["frequency"] == pytest.approx(3e-3, rel=1e-12)          # 严格 Σ
    assert r["frequency"] != pytest.approx(1 - (1 - 1e-3) * (1 - 2e-3), rel=1e-9)
    assert len(r["cutsets"]) == 2
    assert {c["initiator"] for c in r["cutsets"]} == {"F1", "F2"}


def test_and_frequency_with_enabling_probability():
    """AND(f=1e-2, q=0.1) = 1e-3 /yr(初因率 × 使能概率)。"""
    def build(g):
        g.basic("F"); g.basic("Q")
        g.gate("TOP", Op.AND, ["F", "Q"]); g.top = "TOP"
    m = _model([Parameter("F", "frequency", 1e-2), Parameter("Q", "probability", 0.1)], build)
    r = fault_tree_frequency(m, "IE")
    assert r["frequency"] == pytest.approx(1e-3, rel=1e-12)
    assert r["cutsets"][0]["initiator"] == "F"
    assert r["cutsets"][0]["order"] == 2


def test_two_frequencies_in_one_cutset_is_loud_error():
    """AND(f,f) 量纲为 1/yr² —— 必须 raise,绝不给数。"""
    def build(g):
        g.basic("F1"); g.basic("F2")
        g.gate("TOP", Op.AND, ["F1", "F2"]); g.top = "TOP"
    m = _model([Parameter("F1", "frequency", 1e-3), Parameter("F2", "frequency", 2e-3)], build)
    with pytest.raises(FrequencyRuleError, match="F1"):
        fault_tree_frequency(m, "IE")


def test_pure_probability_tree_is_loud_error():
    """无频率事件的割集没有 /yr 量纲来源 —— 同样 raise(应走概率通道)。"""
    def build(g):
        g.basic("Q1"); g.basic("Q2")
        g.gate("TOP", Op.OR, ["Q1", "Q2"]); g.top = "TOP"
    m = _model([Parameter("Q1", "probability", 0.1), Parameter("Q2", "probability", 0.2)], build)
    with pytest.raises(FrequencyRuleError):
        fault_tree_frequency(m, "IE")


def test_mixed_structure_sum_of_initiator_times_enabler():
    """OR(AND(f₁,q), AND(f₂,q)) = (f₁+f₂)·q —— 共享使能事件在 Σ 语义下天然正确。"""
    def build(g):
        g.basic("F1"); g.basic("F2"); g.basic("Q")
        g.gate("G1", Op.AND, ["F1", "Q"])
        g.gate("G2", Op.AND, ["F2", "Q"])
        g.gate("TOP", Op.OR, ["G1", "G2"]); g.top = "TOP"
    m = _model([Parameter("F1", "frequency", 1e-3), Parameter("F2", "frequency", 2e-3),
                Parameter("Q", "probability", 0.25)], build)
    r = fault_tree_frequency(m, "IE")
    assert r["frequency"] == pytest.approx(3e-3 * 0.25, rel=1e-12)


def test_rate_parameter_as_enabler_lambda_mttr():
    """rate 参数(λ·MTTR)作为使能概率参与:AND(f=1e-2, rate λ=1e-3 MTTR=8h → q=8e-3)。"""
    def build(g):
        g.basic("F"); g.basic("R")
        g.gate("TOP", Op.AND, ["F", "R"]); g.top = "TOP"
    m = _model([Parameter("F", "frequency", 1e-2),
                Parameter("R", "rate", 1e-3, mttr=8.0)], build)
    r = fault_tree_frequency(m, "IE")
    assert r["frequency"] == pytest.approx(1e-2 * 8e-3, rel=1e-12)


def test_cutoff_truncates_by_cutset_frequency():
    def build(g):
        g.basic("F1"); g.basic("F2")
        g.gate("TOP", Op.OR, ["F1", "F2"]); g.top = "TOP"
    m = _model([Parameter("F1", "frequency", 1e-3), Parameter("F2", "frequency", 1e-9)], build)
    r = fault_tree_frequency(m, "IE", cutoff=1e-6)
    assert len(r["cutsets"]) == 1 and r["frequency"] == pytest.approx(1e-3)


def test_single_frequency_event_tree_equals_manual_value():
    """种子树(单频率事件)= 手动值 —— 迁移零意外(规格 §2.3)。"""
    def build(g):
        g.basic("F")
        g.gate("TOP", Op.NULL, ["F"]) if hasattr(Op, "NULL") else g.gate("TOP", Op.OR, ["F"])
        g.top = "TOP"
    m = _model([Parameter("F", "frequency", 4.2e-4)], build)
    assert fault_tree_frequency(m, "IE")["frequency"] == pytest.approx(4.2e-4, rel=1e-12)


def test_units_guard_frequency_param_rejected_in_probability_context():
    """量纲护栏(规格 §2.1):频率参数误入概率通道 → unavailability() 响亮 raise。"""
    p = Parameter("F", "frequency", 1e-3)
    with pytest.raises(ValueError, match="probability context"):
        p.unavailability()


# ── engine-review 2026-07-13 整改锁(F1/F2/F4)──

def test_review_f1_not_gate_rejected_loudly():
    """F1:NOT 门下 MCS 枚举静默丢负文字 → 错割集错频率(曾 +67% 无警告)——必须拒绝。"""
    def build(g):
        g.basic("F"); g.basic("Q")
        g.gate("N", Op.NOT, ["Q"])
        g.gate("TOP", Op.AND, ["F", "N"]); g.top = "TOP"
    m = _model([Parameter("F", "frequency", 1e-2), Parameter("Q", "probability", 0.4)], build)
    with pytest.raises(FrequencyRuleError, match="NOT"):
        fault_tree_frequency(m, "IE")


def test_review_f1_xor_gate_rejected_with_clear_message():
    def build(g):
        g.basic("F"); g.basic("Q")
        g.gate("TOP", Op.XOR, ["F", "Q"]); g.top = "TOP"
    m = _model([Parameter("F", "frequency", 1e-2), Parameter("Q", "probability", 0.4)], build)
    with pytest.raises(FrequencyRuleError, match="XOR"):
        fault_tree_frequency(m, "IE")


def test_review_f2_no_limit_order_rule_cannot_escape():
    """F2:曾经 limit_order=2 先截断 → AND(F1,F2,Q) 三阶违规割集消失、返回 F=0 无错。
    limit_order 已整体移除 —— 违规必然被看见。"""
    import inspect
    assert "limit_order" not in inspect.signature(fault_tree_frequency).parameters
    def build(g):
        g.basic("F1"); g.basic("F2"); g.basic("Q")
        g.gate("TOP", Op.AND, ["F1", "F2", "Q"]); g.top = "TOP"
    m = _model([Parameter("F1", "frequency", 1e-3), Parameter("F2", "frequency", 2e-3),
                Parameter("Q", "probability", 0.5)], build)
    with pytest.raises(FrequencyRuleError):
        fault_tree_frequency(m, "IE")


def test_review_f4_negative_rate_rejected_at_source():
    """F4:负 λ 曾经由 λ·MTTR 得负 q,再被 cutoff≥0 过滤静默吞掉 → F=0 貌似合理。"""
    p = Parameter("R", "rate", -1e-3, mttr=8.0)
    with pytest.raises(ValueError, match=">= 0"):
        p.unavailability()


def test_review_r1_negative_time_params_rejected_at_source():
    """R-1(round-2 残留):λ≥0 但时间参数为负 → q<0 走同一条静默吞没门,同样源头拒绝。"""
    for kwargs in ({"mttr": -8.0}, {"test_interval": -100.0}, {"mission_time": -24.0}):
        with pytest.raises(ValueError, match="< 0"):
            Parameter("R", "rate", 1e-3, **kwargs).unavailability()

# ── Gap 9 核心:逐初因精确模式(规格 2026-07-14-ie-frequency-exact-mode)──
# F_exact = Σ_i λ_i·P(∨ 使能合取),BDD 精确;恒 ≤ F_sum 且 ≤ Σλ(物理上界)。

def _brute_force_p(enabler_sets, q):
    """暴力真值表:P(∨_k ∧_{e∈k} e)。规格 §3 锚点 D 用它对拍(手算三重容斥易错)。"""
    from itertools import product as iproduct
    vars_ = sorted({e for s in enabler_sets for e in s})
    total = 0.0
    for bits in iproduct([0, 1], repeat=len(vars_)):
        st = dict(zip(vars_, bits))
        if any(all(st[e] for e in s) for s in enabler_sets):
            w = 1.0
            for v in vars_:
                w *= q[v] if st[v] else (1 - q[v])
            total += w
    return total


def test_exact_shared_initiator_respects_physical_bound():
    """锚点 A:OR(AND(I,A), AND(I,B)),λ=0.1,qA=0.6,qB=0.7。
    Σ 口径 0.13 > λ(越界示范);精确 = 0.1×(1−0.4×0.3) = 0.088。"""
    def build(g):
        g.basic("I"); g.basic("A"); g.basic("B")
        g.gate("G1", Op.AND, ["I", "A"]); g.gate("G2", Op.AND, ["I", "B"])
        g.gate("TOP", Op.OR, ["G1", "G2"]); g.top = "TOP"
    m = _model([Parameter("I", "frequency", 0.1),
                Parameter("A", "probability", 0.6), Parameter("B", "probability", 0.7)], build)
    r_sum = fault_tree_frequency(m, "IE")                      # 默认 sum,行为不变
    r_ex = fault_tree_frequency(m, "IE", method="exact")
    assert r_sum["frequency"] == pytest.approx(0.13, rel=1e-12)
    assert r_sum["frequency"] > 0.1                            # Σ 超物理上界的示范
    assert r_ex["frequency"] == pytest.approx(0.088, rel=1e-12)
    assert r_ex["frequency"] <= 0.1 + 1e-15                    # ≤ Σλ
    assert r_ex["method"] == "exact" and r_sum["method"] == "sum"
    bi = r_ex["by_initiator"]
    assert len(bi) == 1 and bi[0]["initiator"] == "I"
    assert bi[0]["enabling_probability"] == pytest.approx(0.88, rel=1e-12)
    assert bi[0]["rate"] == pytest.approx(0.1)
    # cutsets 列表两模式同形(溯源保留;exact 下 Σcutsets ≥ 头条)
    assert [c["frequency"] for c in r_ex["cutsets"]] == [c["frequency"] for c in r_sum["cutsets"]]


def test_exact_equals_sum_when_no_initiator_shares_cutsets():
    """锚点 B:跨初因共享使能 OR(AND(I1,A), AND(I2,A)) —— 两口径相等(各初因单割集)。"""
    def build(g):
        g.basic("I1"); g.basic("I2"); g.basic("A")
        g.gate("G1", Op.AND, ["I1", "A"]); g.gate("G2", Op.AND, ["I2", "A"])
        g.gate("TOP", Op.OR, ["G1", "G2"]); g.top = "TOP"
    m = _model([Parameter("I1", "frequency", 0.02), Parameter("I2", "frequency", 0.03),
                Parameter("A", "probability", 0.5)], build)
    r_sum = fault_tree_frequency(m, "IE")
    r_ex = fault_tree_frequency(m, "IE", method="exact")
    assert r_ex["frequency"] == pytest.approx(r_sum["frequency"], rel=1e-12)
    assert r_ex["frequency"] == pytest.approx(0.025, rel=1e-12)
    assert {b["initiator"] for b in r_ex["by_initiator"]} == {"I1", "I2"}


def test_exact_bare_initiator_cutset_has_enabling_one():
    """锚点 C:OR(I, AND(I2,B)) —— {I} 单独成最小割集 ⇒ P(E_I)=1(最小性保证)。"""
    def build(g):
        g.basic("I"); g.basic("I2"); g.basic("B")
        g.gate("G2", Op.AND, ["I2", "B"])
        g.gate("TOP", Op.OR, ["I", "G2"]); g.top = "TOP"
    m = _model([Parameter("I", "frequency", 1e-3), Parameter("I2", "frequency", 2e-3),
                Parameter("B", "probability", 0.4)], build)
    r_ex = fault_tree_frequency(m, "IE", method="exact")
    assert r_ex["frequency"] == pytest.approx(1e-3 + 2e-3 * 0.4, rel=1e-12)
    by = {b["initiator"]: b for b in r_ex["by_initiator"]}
    assert by["I"]["enabling_probability"] == pytest.approx(1.0)
    assert by["I2"]["enabling_probability"] == pytest.approx(0.4)


def test_exact_overlapping_enablers_matches_brute_force():
    """锚点 D:同初因三割集重叠使能 {A,B},{B,C},{C} —— BDD 与暴力真值表逐位一致,
    且严格小于 Σ 口径(重叠越多 Σ 高估越大)。"""
    q = {"A": 0.3, "B": 0.4, "C": 0.5}
    def build(g):
        g.basic("I"); g.basic("A"); g.basic("B"); g.basic("C")
        g.gate("G1", Op.AND, ["I", "A", "B"]); g.gate("G2", Op.AND, ["I", "B", "C"])
        g.gate("G3", Op.AND, ["I", "C"])
        g.gate("TOP", Op.OR, ["G1", "G2", "G3"]); g.top = "TOP"
    m = _model([Parameter("I", "frequency", 0.05)] +
               [Parameter(k, "probability", v) for k, v in q.items()], build)
    r_sum = fault_tree_frequency(m, "IE")
    r_ex = fault_tree_frequency(m, "IE", method="exact")
    # 最小化:{I,B,C} 被 {I,C} 吸收 → 有效割集 {I,A,B},{I,C}
    p_ref = _brute_force_p([{"A", "B"}, {"B", "C"}, {"C"}], q)   # 吸收前后布尔函数不变
    assert r_ex["by_initiator"][0]["enabling_probability"] == pytest.approx(p_ref, rel=1e-12)
    assert r_ex["frequency"] == pytest.approx(0.05 * p_ref, rel=1e-12)
    assert r_ex["frequency"] < r_sum["frequency"]


def test_exact_rule_violations_still_loud_and_cutoff_untouched():
    """精确模式沿用同一校验(一频率规则先于一切)与 cutoff 语义(只滤展示列表)。"""
    def build(g):
        g.basic("F1"); g.basic("F2")
        g.gate("TOP", Op.AND, ["F1", "F2"]); g.top = "TOP"
    m = _model([Parameter("F1", "frequency", 1e-3), Parameter("F2", "frequency", 2e-3)], build)
    with pytest.raises(FrequencyRuleError):
        fault_tree_frequency(m, "IE", method="exact")

    def build2(g):
        g.basic("I"); g.basic("A"); g.basic("B")
        g.gate("G1", Op.AND, ["I", "A"]); g.gate("G2", Op.AND, ["I", "B"])
        g.gate("TOP", Op.OR, ["G1", "G2"]); g.top = "TOP"
    m2 = _model([Parameter("I", "frequency", 0.1),
                 Parameter("A", "probability", 0.6), Parameter("B", "probability", 0.7)], build2)
    r = fault_tree_frequency(m2, "IE", cutoff=0.065, method="exact")
    assert len(r["cutsets"]) == 1                              # 0.06 被滤,0.07 保留
    assert r["frequency"] == pytest.approx(0.088, rel=1e-12)   # 头条不受 cutoff 影响


def test_exact_method_validation():
    def build(g):
        g.basic("F"); g.gate("TOP", Op.OR, ["F"]); g.top = "TOP"
    m = _model([Parameter("F", "frequency", 1e-3)], build)
    with pytest.raises(ValueError, match="method"):
        fault_tree_frequency(m, "IE", method="fuzzy")
