"""BANKED 锚点:周期检验 Complete(10 参 Markov,瞬时 q(t))。

规格:docs/superpowers/specs/2026-07-15-periodic-test-complete-banked.md
证据脚本:docs/superpowers/specs/assets/2026-07-15-ref-periodic-complete.py

实现落地前整文件 skip(探针见 _implemented);落地即自动激活——无需改测试。
参考实现(Decimal-60)独立编码于本文件,锚点常量与之双锁;float 常量出自
证据脚本运行记录(float ↔ Decimal 全点位 rel ≤ 5.5e-15,MC 2M×2 三角 |z| < 1)。
"""
from decimal import Decimal, localcontext
from math import expm1
from random import Random

import pytest

from psaengine.model.parameters import Parameter

D = Decimal


def _param(lam=1e-4, lam_test=3e-4, mttr=8.0, tau=730.0, theta=200.0,
           gamma=0.005, pi_=2.0, x=False, sigma=0.95, omega=0.01, t=8760.0,
           **over):
    kw = dict(id="PTC", kind="periodic_test_complete", value=lam,
              lambda_test=lam_test, mttr=mttr, test_interval=tau, theta=theta,
              gamma=gamma, test_duration=pi_, available_at_test=x,
              sigma=sigma, omega=omega, mission_time=t)
    kw.update(over)
    return Parameter(**kw)


def _implemented() -> bool:
    # 评审 D3:构造期与计算期分开判——字段落地后,计算期任何异常(含 TypeError)
    # 都视为已实现,让锚点去红;返回类型也交由锚点断言把关,不进 skip。
    try:
        p = _param()
    except TypeError:
        return False         # Parameter 尚无新字段(构造期)
    try:
        p.unavailability()
    except ValueError as e:
        if "unknown kind" in str(e):
            return False
        return True
    except Exception:
        return True
    return True

pytestmark = pytest.mark.skipif(
    not _implemented(),
    reason="BANKED:等待 periodic_test_complete 实现"
           "(规格 2026-07-15-periodic-test-complete-banked)")


# ── Decimal-60 参考实现(独立编码;稳定形 p_exp2,§3)──────────────────────────

def _p_exp_D(rate, t):
    return 1 - (-rate * t).exp()


def _p_exp2_D(mu, lam, t):
    """P(先 μ 完成、再 λ 发生,t 内)= 1 − e^{−λt}(1 + λ·g),g=(e^{δt}−1)/δ,δ=λ−μ。"""
    dlt = lam - mu
    g = t if dlt == 0 else ((dlt * t).exp() - 1) / dlt
    return 1 - (-lam * t).exp() * (1 + lam * g)


def _ref(lam, lam_test, mu, tau, theta, gamma, pi_, x, sigma, omega, t):
    with localcontext() as ctx:      # 评审 S3:精度局部化,不落进程级副作用
        ctx.prec = 60
        return _ref_body(lam, lam_test, mu, tau, theta, gamma, pi_, x,
                         sigma, omega, t)


def _ref_body(lam, lam_test, mu, tau, theta, gamma, pi_, x, sigma, omega, t):
    lam, lam_test, mu = D(repr(lam)), D(repr(lam_test)), D(repr(mu))
    tau, theta, gamma = D(repr(tau)), D(repr(theta)), D(repr(gamma))
    pi_, sigma, omega, t = D(repr(pi_)), D(repr(sigma)), D(repr(omega)), D(repr(t))
    if t <= theta:
        return _p_exp_D(lam, t)
    p_fail, p_repair = _p_exp_D(lam, theta), D(0)
    p_avail = 1 - p_fail

    def p_ml(p_mu, tt):
        return p_mu * omega + (1 - omega) * _p_exp2_D(mu, lam, tt)

    def p_test(w, available):
        nonlocal p_fail, p_repair, p_avail
        p_lt, p_mu = _p_exp_D(lam_test, w), _p_exp_D(mu, w)
        tr = p_fail + p_avail * (gamma + (1 - gamma) * p_lt)
        nf = p_repair * p_ml(p_mu, w) + (1 - sigma) * tr
        nr = (1 - p_mu) * p_repair + sigma * tr
        na = 1 - nf - nr - (D(0) if available else p_avail * (1 - gamma) * (1 - p_lt))
        p_fail, p_repair, p_avail = nf, nr, na

    def p_period(dd):
        nonlocal p_fail, p_repair, p_avail
        p_lam, p_mu = _p_exp_D(lam, dd), _p_exp_D(mu, dd)
        p_fail = p_avail * p_lam + p_fail + p_repair * p_ml(p_mu, dd)
        p_repair = p_repair * (1 - p_mu)
        p_avail = 1 - p_fail - p_repair

    delta = t - theta
    n = int(delta / tau)                       # C 截断语义
    for _ in range(n):
        p_test(pi_, True)
        p_period(tau - pi_)
    rem = delta - n * tau
    if rem <= pi_:
        p_test(rem, bool(x))
    else:
        p_test(pi_, True)
        p_period(rem - pi_)
    return 1 - p_avail


def _q(**kw) -> float:
    return _param(**kw).unavailability()


def _ref_of(**kw):
    base = dict(lam=1e-4, lam_test=3e-4, mttr=8.0, tau=730.0, theta=200.0,
                gamma=0.005, pi_=2.0, x=False, sigma=0.95, omega=0.01, t=8760.0)
    base.update(kw)
    return float(_ref(base["lam"], base["lam_test"], 1.0 / base["mttr"],
                      base["tau"], base["theta"], base["gamma"], base["pi_"],
                      base["x"], base["sigma"], base["omega"], base["t"]))


# ── 锚点 A1–A8:P1 参数族(值注释 = 证据脚本记录;断言 = 参考实现现算)──────────

def test_A1_before_first_test_is_pure_aging():
    q = _q(t=100.0)
    assert q == -expm1(-1e-4 * 100.0)                       # 逐位:纯老化段
    assert q == pytest.approx(0.009950166250831893, rel=1e-12)


def test_A1b_exactly_at_first_test_instant():
    # 评审 D1:t == θ 必须走 t≤θ 分支(≤ 非 <);误写 < 则 x=F 得 1.0(50× 偏差)
    assert _q(t=200.0) == -expm1(-1e-4 * 200.0)
    assert _q(x=True, t=200.0) == -expm1(-1e-4 * 200.0)


def test_A2_mid_cycle_one_year():
    q = _q()                                                # t=8760
    assert q == pytest.approx(_ref_of(), rel=1e-12)
    assert q == pytest.approx(0.05587434138146241, rel=1e-12)


def test_A3_inside_window_unavailable_at_test():
    q = _q(x=False, t=200.0 + 3 * 730.0 + 1.0)
    assert q > 1 - 1e-15                                    # 整舱受试 ≈ 全不可用(dec 1−2.7e-42)


def test_A4_inside_window_available_at_test():
    q = _q(x=True, t=200.0 + 3 * 730.0 + 1.0)
    assert q == pytest.approx(_ref_of(x=True, t=200.0 + 3 * 730.0 + 1.0), rel=1e-12)
    assert q == pytest.approx(0.07946390522062774, rel=1e-12)


def test_A5_exact_test_start_is_one_bitwise():
    # 规格 §2 要点 4 精确恒等式:x=False 且 rem=0 → 代数消项,q ≡ 1
    assert _q(x=False, t=200.0 + 5 * 730.0) == 1.0


def test_A6_window_end_boundary_still_partial_branch():
    assert _q(x=False, t=200.0 + 5 * 730.0 + 2.0) >= 1 - 1e-15     # rem=π 走部分窗分支


def test_A6b_just_after_window_else_branch():
    q = _q(x=False, t=200.0 + 5 * 730.0 + 3.0)
    assert q == pytest.approx(_ref_of(t=200.0 + 5 * 730.0 + 3.0), rel=1e-12)
    assert q == pytest.approx(0.07102803223338383, rel=1e-12)


def test_A7_mc_triangulated_point():
    # P5 族:MC 2M×2 seeds |z|≤0.94 三角点(证据脚本记录)
    q = _q(lam=5e-3, lam_test=1e-2, mttr=20.0, tau=100.0, theta=50.0,
           gamma=0.05, pi_=10.0, x=False, sigma=0.8, omega=0.1, t=365.0)
    assert q == pytest.approx(_ref_of(lam=5e-3, lam_test=1e-2, mttr=20.0,
                                      tau=100.0, theta=50.0, gamma=0.05,
                                      pi_=10.0, x=False, sigma=0.8, omega=0.1,
                                      t=365.0), rel=1e-12)
    assert q == pytest.approx(0.44158666402877444, rel=1e-12)


def test_A8_steady_cycle_periodicity():
    # 同相位不同周期数(n=11 vs n=239)→ 稳态周期收敛
    assert _q(t=8760.0) == pytest.approx(_q(t=175200.0), rel=1e-12)


# ── A9:λ≈μ 稳定形强制(朴素 p_exp2 在此整链 q 级 rel 7.5e-5 → 必红)────────────

def test_A9_near_equal_rates_requires_stable_form():
    q = _q(lam=1e-3, lam_test=2e-3, mttr=999.999999999, tau=100.0, theta=50.0,
           gamma=0.01, pi_=1.0, x=True, sigma=0.9, omega=0.05, t=1050.0)
    ref = _ref_of(lam=1e-3, lam_test=2e-3, mttr=999.999999999, tau=100.0,
                  theta=50.0, gamma=0.01, pi_=1.0, x=True, sigma=0.9,
                  omega=0.05, t=1050.0)
    assert q == pytest.approx(ref, rel=1e-9)
    assert q == pytest.approx(0.4954499499856775, rel=1e-9)


# ── A10:π→0 一致性(InstantTest 参考在本测试内转录)───────────────────────────

def test_A10_pi_to_zero_converges_to_instant_test():
    lam, mu, tau, theta, t = 1e-4, 0.125, 730.0, 200.0, 8760.0

    def p_exp(r, tt):
        return -expm1(-r * tt)

    def p_exp2(p_mu, p_lambda, mu_, lam_, tt):     # SCRAM InstantTest 用的两级形
        return (p_lambda - (1 - p_lambda) * lam_ * tt) if lam_ == mu_ \
            else (lam_ * p_mu - mu_ * p_lambda) / (lam_ - mu_)

    def instant_test():
        def carry(p_lam, p_mu, tt):
            return 1 - p_mu + p_exp2(p_lam, p_mu, lam, mu, tt) - p_lam
        prob = p_exp(lam, theta)
        delta = t - theta
        n = int(delta / tau)
        frac = carry(p_exp(lam, tau), p_exp(mu, tau), tau)
        comp = frac ** n
        prob = prob * comp + p_exp(lam, tau) * (comp - 1) / (frac - 1)
        rem = delta - n * tau
        return prob * carry(p_exp(lam, rem), p_exp(mu, rem), rem) + p_exp(lam, rem)

    q = _q(lam=lam, lam_test=3e-4, mttr=8.0, tau=tau, theta=theta, gamma=0.0,
           pi_=tau * 1e-6, x=True, sigma=1.0, omega=0.0, t=t)
    assert abs(q - instant_test()) < 1e-7          # 实测 6.9e-8,线性 O(π) 收敛


# ── A11:[0,1] 性质 500 例 ─────────────────────────────────────────────────────

def test_A11_q_in_unit_interval_500_random():
    rng = Random(20260715)
    for _ in range(500):
        lam = 10 ** rng.uniform(-9, -2)
        tau = 10 ** rng.uniform(1, 4)
        pi_ = tau * rng.uniform(1e-4, 0.5)
        q = _q(lam=lam, lam_test=lam * 10 ** rng.uniform(0, 1.5),
               mttr=10 ** rng.uniform(0, 3), tau=tau, pi_=pi_,
               theta=rng.uniform(0, tau), gamma=rng.uniform(0, 0.2),
               x=rng.random() < 0.5, sigma=rng.uniform(0.5, 1.0),
               omega=rng.uniform(0, 0.2), t=rng.uniform(0, 30 * tau))
        assert 0.0 <= q <= 1.0


# ── A12:校验响亮 ─────────────────────────────────────────────────────────────

@pytest.mark.parametrize("bad", [
    dict(test_duration=730.0),          # π ≥ τ
    dict(test_duration=0.0),            # π ≤ 0
    dict(available_at_test=None),       # 缺 x(不设默认)
    dict(sigma=1.2),                    # σ ∉ [0,1]
    dict(omega=-0.1),                   # ω ∉ [0,1]
    dict(mttr=0.0),                     # mttr ≤ 0
    dict(mttr=None),                    # 缺 mttr
    dict(theta=None),                   # 缺 θ
    dict(theta=-1.0),                   # θ < 0
    dict(lambda_test=None),             # 缺 λ*
    dict(lambda_test=-1e-4),            # λ* < 0
    dict(mission_time=None),            # 缺 t
    dict(value=-1e-4),                  # λ < 0
    dict(gamma=1.2),                    # γ ∉ [0,1](评审 S4)
    dict(test_interval=0.0),            # τ ≤ 0(评审 S4)
])
def test_A12_loud_validation(bad):
    with pytest.raises(ValueError, match="PTC"):
        _q(**bad)


# ── 曲线助手(规格 §1)────────────────────────────────────────────────────────

def test_curve_helper_matches_pointwise():
    from psaengine.model.parameters import periodic_test_complete_curve
    p = _param()
    ts = [100.0, 8760.0, 200.0 + 3 * 730.0 + 1.0]
    ys = periodic_test_complete_curve(p, ts)
    for tt, y in zip(ts, ys):
        assert y == _q(t=tt)                       # 逐位:同一实现取样


# ── 收口补锁(实现批评审 F1/F2)────────────────────────────────────────────────

def test_F1_available_at_test_strict_bool():
    # 字符串 "false" 经 bool() 强转按 True 记账 → 窗内 q 由 1.0 滑到 0.079(12.6× 低估)
    with pytest.raises(ValueError, match="strict bool"):
        _q(x="false", t=200.0 + 3 * 730.0 + 1.0)
    with pytest.raises(ValueError, match="strict bool"):
        _q(x=1, t=8760.0)                       # int 1 同拒(bool 是 int 子类,isinstance 放行 True/False)


def test_F2_json_roundtrip_ten_params_bitwise():
    from psaengine.model.json_io import parameters_to_json, load_model_from_dict
    p = _param()
    lib_json = [{"id": "PTC", **{k: v for k, v in vars(p).items()
                                 if k not in ("id", "distribution") and v is not None}}]
    m = load_model_from_dict({"model_data": {"parameters": lib_json},
                              "fault_trees": [], "event_trees": [], "ccf_groups": []})
    p2 = m.parameters.get("PTC")
    assert p2.unavailability() == p.unavailability()          # 逐位
    assert parameters_to_json(m.parameters)[0] == lib_json[0]  # save 侧对称(False 存活于 v is not None)
