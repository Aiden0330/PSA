"""CCF alpha/MGL/phi 展开:数值锚 + 结构(spec 2026-07-09-ccf-alpha-mgl-semantics)。"""
import pytest

from psaengine import Analysis
from psaengine.model.ccf import CCFGroup
from psaengine.model.fault_tree import FaultTree
from psaengine.model.model import Model
from psaengine.model.parameters import Parameter, ParameterLibrary
from psaengine.model.pdag import PDAG, Op
from psaengine.preprocess.ccf_expand import apply_ccf, q_levels

QT = 1e-2


def _abc_model(op=Op.AND, k=None, ccf=None):
    lib = ParameterLibrary()
    for x in "ABC":
        lib.add(Parameter(x, "probability", QT))
    g = PDAG()
    for x in "ABC":
        g.basic(x)
    g.gate("TOP", op, ["A", "B", "C"], k=k)
    g.top = "TOP"
    return Model(parameters=lib, fault_trees={"T": FaultTree("TOP", g)},
                 ccf_groups=ccf or [])


# ── 数值锚(NUREG/CR-5485 Tables 5-11/5-12;SCRAM 对照)──

def test_alpha_nonstaggered_anchor():
    q = q_levels("alpha", {"alpha1": 0.95, "alpha2": 0.03, "alpha3": 0.02}, 3, QT)
    assert q[0] == pytest.approx(8.878505e-3, rel=1e-6)
    assert q[1] == pytest.approx(2.803738e-4, rel=1e-6)
    assert q[2] == pytest.approx(5.607477e-4, rel=1e-6)


def test_alpha_staggered_anchor():
    q = q_levels("alpha", {"alpha1": 0.95, "alpha2": 0.03, "alpha3": 0.02}, 3, QT, staggered=True)
    assert q == pytest.approx([9.5e-3, 1.5e-4, 2.0e-4], rel=1e-12)


def test_mgl_anchor():
    q = q_levels("mgl", {"beta": 0.10, "gamma": 0.27}, 3, QT)
    assert q == pytest.approx([9.0e-3, 3.65e-4, 2.7e-4], rel=1e-12)


def test_phi_direct_and_sum_guard():
    q = q_levels("phi", {"phi1": 0.9, "phi2": 0.06, "phi3": 0.04}, 3, QT)
    assert q == pytest.approx([9.0e-3, 6.0e-4, 4.0e-4], rel=1e-12)
    with pytest.raises(ValueError):
        q_levels("phi", {"phi1": 0.5, "phi2": 0.1, "phi3": 0.1}, 3, QT)   # Σφ≠1


def test_mgl_m2_equals_beta_model():
    # m=2 时 MGL 退化为 beta:Q_1=(1-β)Q_t、Q_2=βQ_t
    q = q_levels("mgl", {"beta": 0.1}, 2, QT)
    assert q == pytest.approx([(1 - 0.1) * QT, 0.1 * QT], rel=1e-12)


def test_group_size_cap():
    # 批次 F(2026-07-17,P-8):上限 6 → 8——alpha/phi 到 8,MGL 词汇止 ρ₇ 上限 7
    # 点名拒绝(锚点 tests/unit/test_mc_sokc_fsum_ccf8.py C1-C7),9 起仍响亮拒绝。
    q_levels("mgl", {"beta": 0.1}, 7, QT)          # 不再触发护栏
    with pytest.raises(ValueError):
        q_levels("mgl", {"beta": 0.1}, 9, QT)


# ── 展开结构 ──

def test_mgl_expansion_structure():
    m = _abc_model(ccf=[CCFGroup("G", ["A", "B", "C"], "mgl", {"beta": 0.10, "gamma": 0.27})])
    pdag, lib = apply_ccf(m.fault_trees["T"].pdag, m.ccf_groups, m.parameters)
    # 3 独立 + 3 对 + 1 三重
    for eid, val in [("A__I", 9.0e-3), ("CCF_G_A_B", 3.65e-4), ("CCF_G_A_C", 3.65e-4),
                     ("CCF_G_B_C", 3.65e-4), ("CCF_G_A_B_C", 2.7e-4)]:
        assert lib.get(eid).unavailability() == pytest.approx(val, rel=1e-12)
    a = pdag.node("A")
    assert a.op is Op.OR
    assert set(a.args) == {"A__I", "CCF_G_A_B", "CCF_G_A_C", "CCF_G_A_B_C"}
    b = pdag.node("B")
    assert set(b.args) == {"B__I", "CCF_G_A_B", "CCF_G_B_C", "CCF_G_A_B_C"}


def test_alpha_cutsets_contain_pair_and_triple_events():
    m = _abc_model(op=Op.ATLEAST, k=2,
                   ccf=[CCFGroup("G", ["A", "B", "C"], "alpha",
                                 {"alpha1": 0.95, "alpha2": 0.03, "alpha3": 0.02})])
    cs = Analysis(m).cutsets()
    sets = [set(c.events) for c in cs]
    assert {"CCF_G_A_B"} in sets          # 一个对事件即令 2oo3 失效 → 一阶割集
    assert {"CCF_G_A_B_C"} in sets
    assert any(s == {"A__I", "B__I"} for s in sets)


def test_beta_legacy_path_unchanged():
    # 原 beta 集总展开保持(守护既有行为)
    m = _abc_model(ccf=[CCFGroup("G", ["A", "B"], "beta", {"beta": 0.1})])
    pdag, lib = apply_ccf(m.fault_trees["T"].pdag, m.ccf_groups, m.parameters)
    assert set(pdag.node("A").args) == {"A__I", "CCF_G"}
    assert lib.get("CCF_G").unavailability() == pytest.approx(0.1 * QT, rel=1e-12)
