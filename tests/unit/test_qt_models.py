"""精确 Q(t) 模型(Gap 7 裁决一,规格 2026-07-15-gap7-qt-models-exchange)。

锚点纪律:期望值在测试内**独立编码公式**计算(math.exp),卷宗数字仅作注释——
防转录错误(规格 D 锚双计、§5 链式不等式两案的制度化教训)。
"""
import math

import pytest

from psaengine.model.parameters import Parameter


def test_exponential_exact():
    # 1−e^{−λt};λ=1e-3,t=100 → ≈0.0951626(λt 线性化 0.1 高估 +5.1%)
    p = Parameter("E", "exponential", 1e-3, mission_time=100.0)
    assert p.unavailability() == pytest.approx(1 - math.exp(-0.1), rel=1e-12)
    assert p.unavailability() < 1e-3 * 100.0            # 精确 < 线性化(保守方向核对)


def test_exponential_requires_mission_time():
    with pytest.raises(ValueError, match="mission_time"):
        Parameter("E", "exponential", 1e-3).unavailability()


def test_glm_steady_state_and_transient():
    lam, mttr = 1e-3, 10.0
    mu = 1.0 / mttr
    # 稳态(t 缺省):λ/(λ+μ) ≈ 0.00990099(λ·MTTR 线性化 0.01 高估 +1.0%)
    p = Parameter("G", "glm", lam, mttr=mttr)
    assert p.unavailability() == pytest.approx(lam / (lam + mu), rel=1e-12)
    # 瞬态 + 需求项:γe^{−rt} + (λ/r)(1−e^{−rt}),γ=0.005,t=24 → ≈0.009467
    g, t = 0.005, 24.0
    r = lam + mu
    expect = g * math.exp(-r * t) + (lam / r) * (1 - math.exp(-r * t))
    p2 = Parameter("G2", "glm", lam, mttr=mttr, gamma=g, mission_time=t)
    assert p2.unavailability() == pytest.approx(expect, rel=1e-12)


def test_glm_gamma_range_loud():
    with pytest.raises(ValueError, match="gamma"):
        Parameter("G", "glm", 1e-3, mttr=10.0, gamma=1.5).unavailability()


def test_weibull_aging():
    # 1−e^{−((t−t0)/α)^β};α=1000,β=2,t=100 → 1−e^{−0.01} ≈ 0.00995
    p = Parameter("W", "weibull", 0.0, alpha=1000.0, beta=2.0, mission_time=100.0)
    assert p.unavailability() == pytest.approx(1 - math.exp(-0.01), rel=1e-12)
    # t ≤ t0 → 0(时移前无失效)
    p2 = Parameter("W2", "weibull", 0.0, alpha=1000.0, beta=2.0, t0=200.0, mission_time=150.0)
    assert p2.unavailability() == 0.0


def test_weibull_validation_loud():
    with pytest.raises(ValueError, match="alpha"):
        Parameter("W", "weibull", 0.0, alpha=-1.0, beta=2.0, mission_time=10.0).unavailability()
    with pytest.raises(ValueError, match="beta"):
        Parameter("W", "weibull", 0.0, alpha=10.0, beta=0.0, mission_time=10.0).unavailability()


def test_periodic_test_cycle_average_exact():
    # q̄ = 1−(1−e^{−λτ})/(λτ);λ=1e-3,τ=100 → ≈0.0483742(λτ/2=0.05 高估 +3.4%)
    lam, tau = 1e-3, 100.0
    p = Parameter("PT", "periodic_test", lam, test_interval=tau)
    expect = 1 - (1 - math.exp(-lam * tau)) / (lam * tau)
    assert p.unavailability() == pytest.approx(expect, rel=1e-12)
    assert p.unavailability() < lam * tau / 2            # 精确 < λτ/2(保守方向核对)


def test_new_kinds_negative_params_loud():
    with pytest.raises(ValueError):
        Parameter("E", "exponential", -1e-3, mission_time=10.0).unavailability()
    with pytest.raises(ValueError):
        Parameter("PT", "periodic_test", 1e-3, test_interval=-5.0).unavailability()


def test_json_io_roundtrip_new_kinds():
    """json_io 透传新字段(gamma/alpha/beta/t0)——载入后 unavailability 一致。"""
    from psaengine.model.json_io import load_model_from_dict
    md = {"model_data": {"parameters": [
            {"id": "E", "kind": "exponential", "value": 1e-3, "mission_time": 100.0},
            {"id": "G", "kind": "glm", "value": 1e-3, "mttr": 10.0, "gamma": 0.005,
             "mission_time": 24.0},
            {"id": "W", "kind": "weibull", "value": 0.0, "alpha": 1000.0, "beta": 2.0,
             "mission_time": 100.0},
            {"id": "PT", "kind": "periodic_test", "value": 1e-3, "test_interval": 100.0}]},
          "fault_trees": [{"name": "T", "top": "TOP", "nodes": [
              {"id": "E", "basic": True, "param_ref": "E"},
              {"id": "TOP", "op": "null", "args": ["E"]}]}]}
    m = load_model_from_dict(md)
    assert m.parameters.get("E").unavailability() == pytest.approx(1 - math.exp(-0.1), rel=1e-12)
    assert m.parameters.get("W").unavailability() == pytest.approx(1 - math.exp(-0.01), rel=1e-12)
    assert m.parameters.get("G").gamma == 0.005
    assert m.parameters.get("PT").unavailability() == pytest.approx(
        1 - (1 - math.exp(-0.1)) / 0.1, rel=1e-12)


def test_periodic_test_tiny_x_no_cancellation():
    """review 365e7e5 G1:小 λτ 灾难性消去——x=1e-9 曾 56× 高估、大片负值。
    级数区与 expm1 区均与 60 位十进制参考一致;q̄∈[0,1] 全域性质锁。"""
    from decimal import Decimal, getcontext
    getcontext().prec = 60

    def ref(x: float) -> float:
        xd = Decimal(str(x))
        return float(1 - (1 - (-xd).exp()) / xd)

    for x in (1e-15, 1e-12, 1e-9, 1e-6, 5e-5, 1e-4, 1e-3, 0.1, 1.0, 5.0):
        p = Parameter("PT", "periodic_test", x, test_interval=1.0)   # λτ = x
        q = p.unavailability()
        assert q == pytest.approx(ref(x), rel=1e-9), f"x={x}"
        assert 0.0 <= q <= 1.0, f"x={x} q={q}"
        assert q == pytest.approx(x / 2, rel=1e-3) or x > 1e-3       # 小 x 渐近 λτ/2


def test_periodic_test_q_in_unit_interval_property():
    import random
    rng = random.Random(20260715)
    for _ in range(500):
        x = 10 ** rng.uniform(-15, 1.5)
        lam = 10 ** rng.uniform(-8, 0)
        q = Parameter("PT", "periodic_test", lam, test_interval=x / lam).unavailability()
        assert 0.0 <= q <= 1.0


def test_weibull_beta_one_degenerates_to_exponential_bitwise():
    """round-3 注记 2 恢复为不变量:β=1、α=1/λ 时 weibull ≡ exponential(同 −expm1 形,逐位)。"""
    lam, t = 1e-3, 100.0
    w = Parameter("W", "weibull", 0.0, alpha=1.0 / lam, beta=1.0, mission_time=t).unavailability()
    e = Parameter("E", "exponential", lam, mission_time=t).unavailability()
    assert w == e            # 逐位
