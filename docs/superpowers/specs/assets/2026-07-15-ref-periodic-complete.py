"""Triangulated reference for banked spec: periodic-test Complete (SCRAM 11-arg).

Three independent routes:
  (i)  scram_complete   — verbatim float transcription of SCRAM
       PeriodicTest::Complete::Compute (normative semantics source).
  (ii) decimal_complete — same state-flow ordering, Decimal-60 arithmetic with
       cancellation-free forms (controls float error; also the anchor mint).
  (iii) mc_complete     — discrete-event Monte Carlo from the narrative
       semantics (controls transcription-misreading error; independent route).

Run: prints anchor table + consistency checks. Every number that enters the
spec/tests comes from THIS script's output (transcription-error discipline).
"""
from decimal import Decimal, getcontext
from math import exp, expm1, log
from random import Random

getcontext().prec = 60
D = Decimal


# ── (i) verbatim SCRAM float transcription ────────────────────────────────────

def p_exp_f(lam, t):
    return 1 - exp(-lam * t)


def p_exp2_f(p_mu, p_lambda, mu, lam, t):
    # SCRAM 5-arg p_exp: two consecutive Poisson processes (first mu, then lam)
    return (p_lambda - (1 - p_lambda) * lam * t) if lam == mu \
        else (lam * p_mu - mu * p_lambda) / (lam - mu)


def scram_complete(lam, lam_test, mu, tau, theta, gamma, pi_, avail_at_test,
                   sigma, omega, t):
    if t <= theta:
        return p_exp_f(lam, t)
    p_fail = p_exp_f(lam, theta)
    p_repair = 0.0
    p_avail = 1 - p_fail

    def p_mu_lambda(p_mu, p_lam, tt):
        return p_mu * omega + (1 - omega) * p_exp2_f(p_mu, p_lam, mu, lam, tt)

    def p_test(p_lt, p_mu, p_lam, tt, available=True):
        nonlocal p_fail, p_repair, p_avail
        p_fail_tr = p_fail + p_avail * (gamma + (1 - gamma) * p_lt)
        new_fail = p_repair * p_mu_lambda(p_mu, p_lam, tt) + (1 - sigma) * p_fail_tr
        new_repair = (1 - p_mu) * p_repair + sigma * p_fail_tr
        new_avail = 1 - new_fail - new_repair - \
            (0.0 if available else p_avail * (1 - gamma) * (1 - p_lt))
        p_fail, p_repair, p_avail = new_fail, new_repair, new_avail

    def p_period(p_lam, p_mu, tt):
        nonlocal p_fail, p_repair, p_avail
        p_fail = p_avail * p_lam + p_fail + p_repair * p_mu_lambda(p_mu, p_lam, tt)
        p_repair = p_repair * (1 - p_mu)
        p_avail = 1 - p_fail - p_repair

    delta = t - theta
    n = int(delta / tau)
    d_period = tau - pi_
    p_lt = p_exp_f(lam_test, pi_)
    p_lam_at = p_exp_f(lam, pi_)
    p_mu_at = p_exp_f(mu, pi_)
    p_lam_d = p_exp_f(lam, d_period)
    p_mu_d = p_exp_f(mu, d_period)
    for _ in range(n):
        p_test(p_lt, p_mu_at, p_lam_at, pi_)
        p_period(p_lam_d, p_mu_d, d_period)
    rem = delta - n * tau
    if rem <= pi_:
        p_test(p_exp_f(lam_test, rem), p_exp_f(mu, rem), p_exp_f(lam, rem),
               rem, avail_at_test)
    else:
        p_test(p_lt, p_mu_at, p_lam_at, pi_)
        lo = rem - pi_
        p_period(p_exp_f(lam, lo), p_exp_f(mu, lo), lo)
    return 1 - p_avail


def scram_instant_test(lam, mu, tau, theta, t):
    """Verbatim SCRAM InstantTest (5-arg) — for the pi->0 consistency check."""
    if t <= theta:
        return p_exp_f(lam, t)

    def carry(p_lam, p_mu, tt):
        p_ml = p_exp2_f(p_lam, p_mu, lam, mu, tt)   # swapped call, as in SCRAM
        return 1 - p_mu + p_ml - p_lam

    prob = p_exp_f(lam, theta)
    delta = t - theta
    n = int(delta / tau)
    fraction = carry(p_exp_f(lam, tau), p_exp_f(mu, tau), tau)
    compound = fraction ** n
    prob = prob * compound + p_exp_f(lam, tau) * (compound - 1) / (fraction - 1)
    rem = delta - n * tau
    return prob * carry(p_exp_f(lam, rem), p_exp_f(mu, rem), rem) + p_exp_f(lam, rem)


# ── (ii) Decimal-60, cancellation-free forms, same state-flow ordering ────────

def p_exp_D(rate, t):
    return 1 - (-rate * t).exp()


def p_exp2_D(mu, lam, t):
    """P(first process mu completes, then second process lam occurs, by t).
    Stable closed form: 1 - e^{-lam t} (1 + lam * (e^{dt}-1)/d), d = lam - mu.
    Derived independently by convolution integral (spec appendix)."""
    d = lam - mu
    e = (-lam * t).exp()
    if d == 0:
        g = t
    else:
        g = ((d * t).exp() - 1) / d
    return 1 - e * (1 + lam * g)


def decimal_complete(lam, lam_test, mu, tau, theta, gamma, pi_, avail_at_test,
                     sigma, omega, t):
    lam, lam_test, mu, tau, theta = D(lam), D(lam_test), D(mu), D(tau), D(theta)
    gamma, pi_, sigma, omega, t = D(gamma), D(pi_), D(sigma), D(omega), D(t)
    if t <= theta:
        return p_exp_D(lam, t)
    p_fail = p_exp_D(lam, theta)
    p_repair = D(0)
    p_avail = 1 - p_fail

    def p_mu_lambda(p_mu, tt):
        return p_mu * omega + (1 - omega) * p_exp2_D(mu, lam, tt)

    def p_test(p_lt, p_mu, tt, available):
        nonlocal p_fail, p_repair, p_avail
        tr = p_fail + p_avail * (gamma + (1 - gamma) * p_lt)
        nf = p_repair * p_mu_lambda(p_mu, tt) + (1 - sigma) * tr
        nr = (1 - p_mu) * p_repair + sigma * tr
        na = 1 - nf - nr - (D(0) if available else p_avail * (1 - gamma) * (1 - p_lt))
        p_fail, p_repair, p_avail = nf, nr, na

    def p_period(p_lam, p_mu, tt):
        nonlocal p_fail, p_repair, p_avail
        p_fail = p_avail * p_lam + p_fail + p_repair * p_mu_lambda(p_mu, tt)
        p_repair = p_repair * (1 - p_mu)
        p_avail = 1 - p_fail - p_repair

    delta = t - theta
    n = int(delta / tau)          # matches C++ double-division truncation
    d_period = tau - pi_
    for _ in range(n):
        p_test(p_exp_D(lam_test, pi_), p_exp_D(mu, pi_), pi_, True)
        p_period(p_exp_D(lam, d_period), p_exp_D(mu, d_period), d_period)
    rem = delta - n * tau
    if rem <= pi_:
        p_test(p_exp_D(lam_test, rem), p_exp_D(mu, rem), rem, bool(avail_at_test))
    else:
        p_test(p_exp_D(lam_test, pi_), p_exp_D(mu, pi_), pi_, True)
        lo = rem - pi_
        p_period(p_exp_D(lam, lo), p_exp_D(mu, lo), lo)
    return 1 - p_avail


# ── (iii) discrete-event Monte Carlo from the narrative semantics ─────────────

def mc_complete(lam, lam_test, mu, tau, theta, gamma, pi_, avail_at_test,
                sigma, omega, t, trials, seed):
    """Narrative: component available fails latently at rate lam; tests at
    theta+k*tau lasting pi_; at test start gamma-shock, during test rate
    lam_test; detection with coverage sigma applied to the latent pool
    (pre-window latents + this window's gamma/lam_test failures) at window end
    (or at t if t lands mid-window — SCRAM applies the partial-window detection
    step); detected -> repair Exp(mu); repair completion: omega -> latent
    (bad restart), else available and may re-fail at rate lam for the window
    remainder (these repair-derived latents skip THIS window's detection);
    if not avail_at_test, components that entered the window available and
    survived gamma+lam_test count unavailable while under test at t."""
    rng = Random(seed)
    A, L, R = 0, 1, 2
    unavail = 0

    def p(rate, tt):
        return -expm1(-rate * tt)

    def trunc_exp(rate, w):
        # completion time of Exp(rate) conditioned on < w
        u = rng.random()
        return -log(1 - u * p(rate, w)) / rate if rate > 0 else w

    for _ in range(trials):
        state = A
        if t <= theta:
            if rng.random() < p(lam, t):
                state = L
            unavail += (state != A)
            continue
        if rng.random() < p(lam, theta):
            state = L
        tk = theta
        under_test_ok = False
        while True:
            w = min(pi_, t - tk)
            partial = (t - tk) <= pi_
            # -- test window [tk, tk+w] --
            transient = (state == L)
            under_test_ok = False
            if state == A:
                if rng.random() < gamma:
                    state, transient = L, True
                elif rng.random() < p(lam_test, w):
                    state, transient = L, True
                else:
                    under_test_ok = True
            elif state == R:
                if rng.random() < p(mu, w):
                    if rng.random() < omega:
                        state = L            # repair-derived: skips detection
                    else:
                        state = A
                        s = trunc_exp(mu, w)
                        if rng.random() < p(lam, w - s):
                            state = L        # repair-derived: skips detection
            # detection at window end / at t if partial
            if transient and state == L and rng.random() < sigma:
                state = R
            if partial:
                un = state in (L, R) or (state == A and under_test_ok
                                         and not avail_at_test)
                unavail += un
                break
            # -- between tests (tk+pi_, tk+tau) or partial to t --
            d = min(tau - pi_, t - tk - pi_)
            if state == A:
                if rng.random() < p(lam, d):
                    state = L
            elif state == R:
                if rng.random() < p(mu, d):
                    if rng.random() < omega:
                        state = L
                    else:
                        state = A
                        s = trunc_exp(mu, d)
                        if rng.random() < p(lam, d - s):
                            state = L
            if t - tk - pi_ <= tau - pi_ and t < tk + tau:
                unavail += (state in (L, R))
                break
            tk += tau
    return unavail / trials


# ── anchor points ─────────────────────────────────────────────────────────────

P1 = dict(lam=1e-4, lam_test=3e-4, mu=0.125, tau=730.0, theta=200.0,
          gamma=0.005, pi_=2.0, sigma=0.95, omega=0.01)      # BESS-ish, hours
P5 = dict(lam=5e-3, lam_test=1e-2, mu=0.05, tau=100.0, theta=50.0,
          gamma=0.05, pi_=10.0, sigma=0.8, omega=0.1)        # MC-power point

CASES = [
    ("A1 t<theta (pure aging)",      P1, False, 100.0),
    ("A2 mid-cycle t=8760 (1yr)",    P1, False, 8760.0),
    ("A3 inside test window, x=F",   P1, False, 200.0 + 3 * 730.0 + 1.0),
    ("A4 inside test window, x=T",   P1, True,  200.0 + 3 * 730.0 + 1.0),
    ("A5 exact test boundary",       P1, False, 200.0 + 5 * 730.0),
    ("A6 just after test end",       P1, False, 200.0 + 5 * 730.0 + 2.0),
    ("A7 MC-power point t=365",      P5, False, 365.0),
]

print("=== anchors: float transcription vs Decimal-60 ===")
for name, P, x, t in CASES:
    f = scram_complete(P["lam"], P["lam_test"], P["mu"], P["tau"], P["theta"],
                       P["gamma"], P["pi_"], x, P["sigma"], P["omega"], t)
    d = decimal_complete(P["lam"], P["lam_test"], P["mu"], P["tau"], P["theta"],
                         P["gamma"], P["pi_"], x, P["sigma"], P["omega"], t)
    rel = abs(D(repr(f)) - d) / d if d != 0 else D(0)
    print(f"{name:32s} float={f!r}\n{'':32s} dec  ={str(+d)[:34]}  rel={float(rel):.3e}")

print("\n=== pi->0 consistency: Complete(sigma=1,gamma=0,omega=0) -> InstantTest ===")
it = scram_instant_test(1e-4, 0.125, 730.0, 200.0, 8760.0)
print(f"InstantTest              = {it!r}")
for k in (2, 4, 6, 8):
    pi0 = 730.0 * 10 ** (-k)
    c = scram_complete(1e-4, 3e-4, 0.125, 730.0, 200.0, 0.0, pi0, True, 1.0, 0.0, 8760.0)
    print(f"Complete pi=730e-{k:<2d}      = {c!r}   |diff|={abs(c - it):.3e}")

print("\n=== MC triangulation (independent semantics route) ===")
t = 365.0
ex = scram_complete(P5["lam"], P5["lam_test"], P5["mu"], P5["tau"], P5["theta"],
                    P5["gamma"], P5["pi_"], False, P5["sigma"], P5["omega"], t)
for seed in (7, 42):
    trials = 2_000_000
    m = mc_complete(P5["lam"], P5["lam_test"], P5["mu"], P5["tau"], P5["theta"],
                    P5["gamma"], P5["pi_"], False, P5["sigma"], P5["omega"], t,
                    trials, seed)
    se = (ex * (1 - ex) / trials) ** 0.5
    print(f"seed={seed}: MC={m:.6f} exact={ex:.6f} |z|={abs(m - ex) / se:.2f} (se={se:.2e})")
# and one x=True point inside a window
t_in = 50.0 + 2 * 100.0 + 5.0
for x in (False, True):
    ex_in = scram_complete(P5["lam"], P5["lam_test"], P5["mu"], P5["tau"], P5["theta"],
                           P5["gamma"], P5["pi_"], x, P5["sigma"], P5["omega"], t_in)
    m_in = mc_complete(P5["lam"], P5["lam_test"], P5["mu"], P5["tau"], P5["theta"],
                       P5["gamma"], P5["pi_"], x, P5["sigma"], P5["omega"], t_in,
                       2_000_000, 11)
    se = (ex_in * (1 - ex_in) / 2_000_000) ** 0.5
    print(f"x={x}: t={t_in} MC={m_in:.6f} exact={ex_in:.6f} |z|={abs(m_in - ex_in) / se:.2f}")

print("\n=== lam~mu cancellation demo (naive float p_exp2 vs Decimal stable) ===")
for eps in (1e-9, 1e-12, 1e-13):
    lam, mu, tt = 1e-3, 1e-3 * (1 + eps), 8.0
    naive = p_exp2_f(p_exp_f(mu, tt), p_exp_f(lam, tt), mu, lam, tt)
    ref = p_exp2_D(D(repr(mu)), D(repr(lam)), D(repr(tt)))
    rel = abs(D(repr(naive)) - ref) / ref
    print(f"mu=lam*(1+{eps:.0e}): naive={naive!r} ref={str(+ref)[:24]} rel_err={float(rel):.3e}")

print("\n=== [0,1] sweep: float transcription over random grid ===")
rng = Random(123)
bad = 0
excursions = []
for i in range(4000):
    lam = 10 ** rng.uniform(-9, -2)
    lam_t = lam * 10 ** rng.uniform(0, 1.5)
    mu = 10 ** rng.uniform(-3, 0)
    tau = 10 ** rng.uniform(1, 4)
    pi_ = tau * rng.uniform(1e-4, 0.5)
    theta = rng.uniform(0, tau)
    g = rng.uniform(0, 0.2)
    s = rng.uniform(0.5, 1.0)
    o = rng.uniform(0, 0.2)
    t = rng.uniform(0, 30 * tau)
    q = scram_complete(lam, lam_t, mu, tau, theta, g, pi_, rng.random() < 0.5, s, o, t)
    if not 0.0 <= q <= 1.0:
        bad += 1
        excursions.append((i, q, q - 1.0 if q > 1.0 else q))
print(f"violations: {bad}/4000, excursions={excursions!r}")


# ── audit D5: every spec-quoted number must be printed by THIS script ─────────

P1T = (1e-4, 3e-4, 0.125, 730.0, 200.0, 0.005, 2.0)
SO1 = (0.95, 0.01)

print("\n=== A6b / A8 / boundary anchors (spec-quoted) ===")
a6b_f = scram_complete(*P1T, False, *SO1, 200.0 + 5 * 730.0 + 3.0)
a6b_d = decimal_complete(*P1T, False, *SO1, 200.0 + 5 * 730.0 + 3.0)
print(f"A6b rem=3 else-branch: float={a6b_f!r} dec={str(+a6b_d)[:34]} "
      f"rel={float(abs(D(repr(a6b_f)) - a6b_d) / a6b_d):.3e}")
a8a_f = scram_complete(*P1T, False, *SO1, 8760.0)
a8b_f = scram_complete(*P1T, False, *SO1, 175200.0)
a8a_d = decimal_complete(*P1T, False, *SO1, 8760.0)
a8b_d = decimal_complete(*P1T, False, *SO1, 175200.0)
print(f"A8 steady cycle: float q(8760)={a8a_f!r} q(175200)={a8b_f!r} "
      f"bitwise-equal={a8a_f == a8b_f}")
print(f"A8 Decimal rel = {float(abs(a8a_d - a8b_d) / a8a_d):.3e}")
# D1: t == theta boundary — transcription uses SCRAM's 1-exp form; the banked
# implementation is MANDATED (spec §3) to use -expm1, so the bitwise test
# anchor is against -expm1. Both printed; they differ only in the last ulps.
b_f = scram_complete(*P1T, False, *SO1, 200.0)
b_e = -expm1(-1e-4 * 200.0)
print(f"D1 t==theta: transcription(1-exp)={b_f!r} mandated(-expm1)={b_e!r} "
      f"rel={abs(b_f - b_e) / b_e:.3e}")

print("\n=== A9 point (spec-quoted): naive whole-chain vs stable vs Decimal ===")
mttr9 = 999.999999999
mu9 = 1.0 / mttr9
P9 = (1e-3, 2e-3, mu9, 100.0, 50.0, 0.01, 1.0)
q9_naive = scram_complete(*P9, True, 0.9, 0.05, 1050.0)
q9_dec = decimal_complete(*P9, True, 0.9, 0.05, 1050.0)


def p_exp2_stable_f(p_mu, p_lambda, mu, lam, t):
    dlt = lam - mu
    g = t if dlt == 0 else expm1(dlt * t) / dlt
    return 1.0 - exp(-lam * t) * (1.0 + lam * g)


_orig_p_exp2 = p_exp2_f
globals()["p_exp2_f"] = p_exp2_stable_f
q9_stable = scram_complete(*P9, True, 0.9, 0.05, 1050.0)
globals()["p_exp2_f"] = _orig_p_exp2
print(f"delta=mu-lam={mu9 - 1e-3!r}")
print(f"naive : {q9_naive!r} rel={float(abs(D(repr(q9_naive)) - q9_dec) / q9_dec):.3e}")
print(f"stable: {q9_stable!r} rel={float(abs(D(repr(q9_stable)) - q9_dec) / q9_dec):.3e}")
print(f"dec   : {str(+q9_dec)[:34]} (float(dec)={float(q9_dec)!r})")

print("\n=== §6 reconciliation (spec-quoted): piecewise Simpson, discontinuity-safe ===")


def simpson(f, a, b, n):
    h = (b - a) / n
    s = f(a) + f(b)
    for i in range(1, n):
        s += f(a + i * h) * (4 if i % 2 else 2)
    return s * h / 3


def cycle_avg_piecewise(P, x, so, k, n=20000, eps=1e-6):
    # split at the in-cycle jump t = start + pi; for x=False q is discontinuous
    # AT both endpoints of the between-test segment (rem=pi still takes the
    # partial-window branch, rem=0 jumps to 1), so those two endpoint samples
    # are replaced by one-sided interior limits (bias ~eps*jump/tau ≈ 1e-9).
    start = P[4] + k * P[3]
    end = start + P[3]
    mid = start + P[6]
    f = lambda t: scram_complete(*P, x, *so, t)
    g = lambda t: f(min(max(t, mid + eps), end - eps))
    return (simpson(f, start, mid, n) + simpson(g, mid, end, n)) / (end - start)


for n in (2000, 20000):
    print(f"P1 x=F steady-cycle piecewise avg (n={n}/segment) = "
          f"{cycle_avg_piecewise(P1T, False, SO1, 10, n)!r}")
avg1 = cycle_avg_piecewise(P1T, False, SO1, 10)
lam, mttr, tau, gg, pp = 1e-4, 8.0, 730.0, 0.005, 2.0
four = lam * tau / 2 + lam * mttr + pp / tau + gg
print(f"  four-term sum={four:.6f} rel gap={(four - avg1) / avg1:+.2%}")
P2T = (1e-4, 1e-4, 0.125, 730.0, 200.0, 0.0, 2.0)   # classical regime: lam*=lam
avg2 = cycle_avg_piecewise(P2T, True, (1.0, 0.0), 10)
s2 = lam * (tau / 2 + mttr)
print(f"P2 (sigma=1,gamma=0,omega=0,x=T,lam*=lam) piecewise avg = {avg2!r}")
print(f"  lam*(tau/2+MRT)={s2:.6f} rel gap={(s2 - avg2) / avg2:+.2%}")
