"""CCF 性质:一致性恒等式 Σ C(m-1,k-1)·Q_k = Q_t;系统级穷举 = BDD 精确值。"""
from itertools import combinations, product
from math import comb
import random

import pytest

from psaengine import Analysis
from psaengine.model.ccf import CCFGroup
from psaengine.model.fault_tree import FaultTree
from psaengine.model.model import Model
from psaengine.model.parameters import Parameter, ParameterLibrary
from psaengine.model.pdag import PDAG, Op
from psaengine.preprocess.ccf_expand import q_levels

rng = random.Random(20260709)


def _rand_alphas(m):
    xs = [rng.uniform(0.01, 1.0) for _ in range(m)]
    xs[0] += 5.0                                     # α1 占主
    s = sum(xs)
    return {f"alpha{k+1}": xs[k] / s for k in range(m)}


def _rand_mgl(m):
    names = ["beta", "gamma", "delta"]
    return {names[i]: rng.uniform(0.01, 0.5) for i in range(m - 1)}


@pytest.mark.parametrize("m", [2, 3, 4])
def test_alpha_consistency_identity(m):
    qt = 3.7e-3
    for staggered in (False, True):
        q = q_levels("alpha", _rand_alphas(m), m, qt, staggered=staggered)
        total = sum(comb(m - 1, k - 1) * q[k - 1] for k in range(1, m + 1))
        assert total == pytest.approx(qt, rel=1e-12), (m, staggered)


@pytest.mark.parametrize("m", [2, 3, 4])
def test_mgl_consistency_identity(m):
    qt = 3.7e-3
    q = q_levels("mgl", _rand_mgl(m), m, qt)
    total = sum(comb(m - 1, k - 1) * q[k - 1] for k in range(1, m + 1))
    assert total == pytest.approx(qt, rel=1e-12)


def _bruteforce_2oo3_mgl(qt, beta, gamma):
    """展开后的 2oo3 系统精确参考:穷举 7 个独立基本事件的 2^7 个状态。"""
    q = q_levels("mgl", {"beta": beta, "gamma": gamma}, 3, qt)
    singles = ["A", "B", "C"]
    pairs = list(combinations(singles, 2))
    events = [(f"{s}__I", q[0]) for s in singles] \
        + [("CCF_" + "_".join(p), q[1]) for p in pairs] \
        + [("CCF_ABC", q[2])]

    def comp_failed(x, state):
        if state[f"{x}__I"]:
            return True
        if state["CCF_ABC"]:
            return True
        return any(state["CCF_" + "_".join(p)] for p in pairs if x in p)

    total = 0.0
    names = [e[0] for e in events]
    probs = {n: p for n, p in events}
    for bits in product([0, 1], repeat=len(events)):
        state = dict(zip(names, bits))
        w = 1.0
        for n in names:
            w *= probs[n] if state[n] else (1.0 - probs[n])
        if sum(comp_failed(x, state) for x in singles) >= 2:
            total += w
    return total


def test_2oo3_mgl_bdd_equals_bruteforce():
    qt, beta, gamma = 1e-2, 0.10, 0.27
    lib = ParameterLibrary()
    for x in "ABC":
        lib.add(Parameter(x, "probability", qt))
    g = PDAG()
    for x in "ABC":
        g.basic(x)
    g.gate("TOP", Op.ATLEAST, ["A", "B", "C"], k=2)
    g.top = "TOP"
    m = Model(parameters=lib, fault_trees={"T": FaultTree("TOP", g)},
              ccf_groups=[CCFGroup("G", ["A", "B", "C"], "mgl", {"beta": beta, "gamma": gamma})])
    p_bdd = Analysis(m).probability()
    p_ref = _bruteforce_2oo3_mgl(qt, beta, gamma)
    assert p_bdd == pytest.approx(p_ref, rel=1e-12)
    # 共因显著抬升联合失效(独立情形 P≈3q²)
    assert p_bdd > 5 * (3 * qt ** 2)
