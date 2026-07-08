"""替代 BDD 后端(dd 库)与纯 Python 内核的顶事件概率对拍。

dd.autoref(纯 Python)在本机可用 → 实跑, 验证适配器与遍历协议正确;
dd.cudd(需 Cython+CUDD 编译)通常仅 Linux/WSL 可用 → 不可用即 skip。
两者经同一 DdBddManager 代码路径, 故 autoref 通过即证明 cudd 路径逻辑正确。

注: 用完显式释放 dd 管理器并 gc.collect(), 避免 dd.autoref 在解释器关闭时
对未释放节点的断言噪声。"""
import gc
import pytest
from psaengine.bdd.kernel import make_manager, build_from_pdag
from psaengine.model.pdag import PDAG, Op
from psaengine.quantify.probability import exact_probability

ORDER = ["a", "b", "c"]
Q = {"a": 0.1, "b": 0.2, "c": 0.05}


def _pdag_or_and() -> PDAG:
    g = PDAG(); g.basic("a"); g.basic("b"); g.basic("c")
    g.gate("g1", Op.AND, ["a", "b"]); g.gate("T", Op.OR, ["g1", "c"]); g.top = "T"
    return g


def _prob(backend: str, g: PDAG, q: dict) -> float:
    """在指定后端建 BDD 求顶概率, 用完彻底释放(防 autoref 关闭期断言噪声)。"""
    m = make_manager(ORDER, backend)
    root = build_from_pdag(m, g, "T")
    val = exact_probability(m, root, q)
    del root, m
    gc.collect()
    return val


def test_python_reference_value():
    # P((a∧b)∨c) = 0.05 + 0.02 - 0.001 = 0.069
    assert abs(_prob("python", _pdag_or_and(), Q) - 0.069) < 1e-12


@pytest.mark.parametrize("backend", ["autoref", "cudd"])
def test_dd_backend_matches_python(backend):
    pytest.importorskip("dd." + backend)
    ref = _prob("python", _pdag_or_and(), Q)
    assert abs(_prob(backend, _pdag_or_and(), Q) - ref) < 1e-12


@pytest.mark.parametrize("backend", ["autoref", "cudd"])
def test_dd_backend_kofn(backend):
    pytest.importorskip("dd." + backend)
    # 2-of-3 表决, 验证 ATLEAST 路径在替代后端下也正确
    def g():
        x = PDAG(); x.basic("a"); x.basic("b"); x.basic("c")
        x.gate("T", Op.ATLEAST, ["a", "b", "c"], k=2); x.top = "T"
        return x
    q = {"a": 0.1, "b": 0.2, "c": 0.3}
    assert abs(_prob(backend, g(), q) - _prob("python", g(), q)) < 1e-12
