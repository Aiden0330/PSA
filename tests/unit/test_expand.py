import math, pytest
from psaengine.preprocess.expand import ccf_basic_probabilities

def test_beta_factor_split():
    # 总 Q=0.01, β=0.1 → 独立 0.009, 共因 0.001
    probs = ccf_basic_probabilities(model="beta", m=3, q_total=0.01, factors={"beta": 0.1})
    assert probs["independent"] == pytest.approx(0.009)
    assert probs["all"] == pytest.approx(0.001)

def test_mgl_three_components():
    # m=3, β=0.1, γ=0.5; Q_t=0.01
    # Q1=(1-β)Q_t; Q2=(1/C(2,1))·β·(1-γ)·Q_t; Q3=(1/C(2,2))·β·γ·Q_t
    p = ccf_basic_probabilities(model="mgl", m=3, q_total=0.01,
                                factors={"beta": 0.1, "gamma": 0.5})
    assert p["1"] == pytest.approx(0.9 * 0.01)
    assert p["2"] == pytest.approx((1/2) * 0.1 * 0.5 * 0.01)
    assert p["3"] == pytest.approx(0.1 * 0.5 * 0.01)

def test_alpha_factor_staggered():
    # alpha 因子(交错), m=2, α1, α2; Q_k ∝ (k/C(m-1,k-1))·α_k·Q_t/α_t
    p = ccf_basic_probabilities(model="alpha", m=2, q_total=0.01,
                                factors={"alpha1": 0.95, "alpha2": 0.05})
    assert p["1"] > 0 and p["2"] > 0
    assert p["2"] == pytest.approx((2/1) * 0.05 / (0.95 + 2*0.05) * 0.01, rel=1e-9)
