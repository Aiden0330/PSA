from psaengine.bdd.kernel import BddManager

def test_var_and_constants():
    m = BddManager(["A", "B"])
    assert m.ite(m.one, m.one, m.zero) == m.one
    a = m.var("A")
    assert m.is_var(a, "A")

def test_and_or_not_truth_table():
    m = BddManager(["A", "B"])
    a, b = m.var("A"), m.var("B")
    g_and = m.apply_and(a, b)
    g_or = m.apply_or(a, b)
    # AND 仅 A=1,B=1 为真
    assert m.eval(g_and, {"A": 1, "B": 1}) == 1
    assert m.eval(g_and, {"A": 1, "B": 0}) == 0
    assert m.eval(g_or, {"A": 0, "B": 1}) == 1
    assert m.eval(g_or, {"A": 0, "B": 0}) == 0
    assert m.eval(m.apply_not(a), {"A": 0, "B": 0}) == 1

def test_canonicity_same_function_same_root():
    m = BddManager(["A", "B"])
    a, b = m.var("A"), m.var("B")
    f1 = m.apply_or(a, b)
    f2 = m.apply_or(b, a)          # 交换律 → 同根(规范型)
    assert f1 == f2

def test_redundant_node_eliminated():
    m = BddManager(["A"])
    a = m.var("A")
    # ite(A, X, X) == X
    assert m.ite(a, m.one, m.one) == m.one
