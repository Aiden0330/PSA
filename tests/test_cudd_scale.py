"""4a6 CUDD 规模冒烟:千级事件模型经 dd.cudd 后端量化,对闭式解。
无 dd.cudd 的环境自动跳过(CI Linux 任务与本机 mac 均可作证)。"""
import pytest

dd_cudd = pytest.importorskip("dd.cudd")

from psaengine.bdd.kernel import make_manager, build_from_pdag
from psaengine.model.pdag import PDAG, Op
from psaengine.quantify.probability import exact_probability


@pytest.mark.parametrize("n", [1000])
def test_cudd_thousand_event_or_closed_form(n):
    q = 1e-4
    g = PDAG()
    names = [f"E{i:04d}" for i in range(n)]
    for x in names:
        g.basic(x)
    g.gate("TOP", Op.OR, names)
    g.top = "TOP"
    m = make_manager(names, backend="cudd")
    root = build_from_pdag(m, g, "TOP")
    p = exact_probability(m, root, {x: q for x in names})
    assert p == pytest.approx(1.0 - (1.0 - q) ** n, rel=1e-12)


def test_cudd_matches_python_kernel_on_kofn():
    from psaengine.bdd.kernel import BddManager
    names = [f"K{i}" for i in range(12)]
    g = PDAG()
    for x in names:
        g.basic(x)
    g.gate("TOP", Op.ATLEAST, names, k=5)
    g.top = "TOP"
    q = {x: 0.01 * (i + 1) for i, x in enumerate(names)}
    mp = BddManager(names)
    pc = exact_probability(mp, build_from_pdag(mp, g, "TOP"), q)
    mc = make_manager(names, backend="cudd")
    pcudd = exact_probability(mc, build_from_pdag(mc, g, "TOP"), q)
    assert pcudd == pytest.approx(pc, rel=1e-12)
