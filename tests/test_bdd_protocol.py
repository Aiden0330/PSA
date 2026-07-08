from psaengine.bdd.kernel import BddManager, build_from_pdag
from psaengine.model.pdag import PDAG, Op
from psaengine.quantify.probability import exact_probability


def _model():
    g = PDAG(); g.basic("a"); g.basic("b"); g.gate("T", Op.OR, ["a", "b"]); g.top = "T"
    m = BddManager(["a", "b"]); root = build_from_pdag(m, g, "T")
    return m, root, {"a": 0.1, "b": 0.2}


def test_protocol_methods_consistent():
    m, root, q = _model()
    assert not m.is_terminal(root)
    assert m.is_terminal(m.one) and m.terminal_value(m.one) == 1
    assert m.is_terminal(m.zero) and m.terminal_value(m.zero) == 0
    ti = m.top_var_index(root)
    assert m.var_name(ti) in ("a", "b")
    # cofactor 沿顶变量分解后, 概率仍守恒
    hi = m.cofactor(root, ti, 1)
    lo = m.cofactor(root, ti, 0)
    p = q[m.var_name(ti)]
    assert abs(exact_probability(m, root, q)
               - (p * exact_probability(m, hi, q) + (1 - p) * exact_probability(m, lo, q))) < 1e-12


def test_exact_probability_or():
    m, root, q = _model()
    assert abs(exact_probability(m, root, q) - (1 - 0.9 * 0.8)) < 1e-12
