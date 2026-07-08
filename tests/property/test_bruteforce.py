import itertools, pytest
from hypothesis import given, strategies as st, settings
from psaengine.model.pdag import PDAG, Op
from psaengine.ordering.heuristics import dflm
from psaengine.bdd.kernel import BddManager, build_from_pdag
from psaengine.quantify.probability import exact_probability

def brute(structure, n, q):
    names = [f"x{i}" for i in range(n)]
    total = 0.0
    for bits in itertools.product([0,1], repeat=n):
        assign = dict(zip(names, bits))
        if structure(assign):
            p = 1.0
            for i, b in enumerate(bits):
                p *= q[names[i]] if b else (1 - q[names[i]])
            total += p
    return total

@settings(max_examples=50, deadline=None)
@given(k=st.integers(min_value=1, max_value=4),
       probs=st.lists(st.floats(0.05, 0.6), min_size=4, max_size=4))
def test_kofn_exact_equals_bruteforce(k, probs):
    n = 4; names = [f"x{i}" for i in range(n)]
    g = PDAG()
    for nm in names: g.basic(nm)
    g.gate("TOP", Op.ATLEAST, names, k=k); g.top="TOP"
    q = dict(zip(names, probs))
    m = BddManager(dflm(g)); root = build_from_pdag(m, g, "TOP")
    exact = exact_probability(m, root, q)
    bf = brute(lambda a: sum(a.values()) >= k, n, q)
    assert exact == pytest.approx(bf, rel=1e-9)
