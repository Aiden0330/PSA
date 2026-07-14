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
