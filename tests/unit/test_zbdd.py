from psaengine.bdd.zbdd import ZbddManager

def test_single_set_and_count():
    z = ZbddManager(["A","B","C"])
    s = z.set_of([{"A","B"}])
    assert z.count(s) == 1
    assert z.to_sets(s) == [{"A","B"}]

def test_union_and_count():
    z = ZbddManager(["A","B","C"])
    s = z.union(z.set_of([{"A"}]), z.set_of([{"B","C"}]))
    assert z.count(s) == 2
    assert sorted(z.to_sets(s), key=len) == [{"A"}, {"B","C"}]

def test_subsume_removes_supersets():
    z = ZbddManager(["A","B","C"])
    s = z.set_of([{"A"}, {"A","B"}, {"B","C"}])   # {A,B} 被 {A} 吸收
    s = z.minimize(s)
    assert {"A"} in z.to_sets(s)
    assert {"A","B"} not in z.to_sets(s)
