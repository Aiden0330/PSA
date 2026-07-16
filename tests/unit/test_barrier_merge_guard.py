"""EB-04(三方评审 2026-07-16):屏障↔屏障合并碰撞护栏 + CCF 生成名命名空间检查。

LFT round-1(ed90116 F1)只护了 IE↔屏障轴;本文件锁屏障↔屏障轴的同款判据:
同 id 仅限同参数基本事件,门/异构撞名响亮拒绝(此前静默首见胜——评审复现
FF=.1/FS=0,正确 .02/.08)。CCF 生成 id(CCF_*/​*__I)撞用户命名空间同样响亮
(此前 lib.add 静默覆盖用户参数:.901 → .018019 无异常)。
"""
import pytest

from psaengine.eta.sequence import quantify_event_tree
from psaengine.model.ccf import CCFGroup
from psaengine.model.event_tree import EventTree, FunctionalEvent
from psaengine.model.fault_tree import FaultTree
from psaengine.model.model import Model
from psaengine.model.parameters import Parameter, ParameterLibrary
from psaengine.model.pdag import PDAG, Op


def _ft(build) -> FaultTree:
    g = PDAG()
    build(g)
    return FaultTree(g.top, g)


def _model(params, barriers: dict, ccf_groups=None) -> Model:
    lib = ParameterLibrary()
    for p in params:
        lib.add(p)
    fts = {name: _ft(b) for name, b in barriers.items()}
    fe_ids = list(barriers)
    seqs = []
    for i in range(2 ** len(fe_ids)):
        path = {fid: ("failure" if (i >> k) & 1 else "success")
                for k, fid in enumerate(fe_ids)}
        tag = "".join("F" if path[f] == "failure" else "S" for f in fe_ids)
        seqs.append({"path": path, "end_state": f"S_{tag}"})
    et = EventTree(init_event="IE", init_frequency=1.0,
                   functional_events=[FunctionalEvent(id=f, link_ft=f) for f in fe_ids],
                   sequences=seqs,
                   consequence_bins={s["end_state"]: "C1" for s in seqs})
    return Model(parameters=lib, fault_trees=fts, event_trees={"TR": et},
                 ccf_groups=ccf_groups or [])


# ── 撞名拒绝 ──────────────────────────────────────────────────────────────────

def test_gate_id_collision_across_barriers_raises():
    # 两棵屏障树各有名为 TOP 的门(模板默认名场景)——此前第二棵被静默丢弃
    m = _model(
        [Parameter("A", "probability", 0.1), Parameter("B", "probability", 0.2)],
        {"FE_1": lambda g: (g.basic("A"), g.gate("TOP", Op.OR, ["A"])),
         "FE_2": lambda g: (g.basic("B"), g.gate("TOP", Op.OR, ["B"]))})
    with pytest.raises(ValueError, match="TOP"):
        quantify_event_tree(m, "TR")


def test_renamed_gates_give_reviewer_expected_numbers():
    # 评审给出的正确值:qA=.1, qB=.2 → FF=.02, FS(F1 败 F2 成)=.08
    m = _model(
        [Parameter("A", "probability", 0.1), Parameter("B", "probability", 0.2)],
        {"FE_1": lambda g: (g.basic("A"), g.gate("T1", Op.OR, ["A"])),
         "FE_2": lambda g: (g.basic("B"), g.gate("T2", Op.OR, ["B"]))})
    r = quantify_event_tree(m, "TR")["sequences"]
    assert r["S_FF"] == pytest.approx(0.1 * 0.2, rel=1e-12)
    assert r["S_FS"] == pytest.approx(0.1 * 0.8, rel=1e-12)


def test_basic_id_with_conflicting_param_ref_raises():
    m = _model(
        [Parameter("S", "probability", 0.1), Parameter("S2", "probability", 0.3)],
        {"FE_1": lambda g: (g.basic("S"), g.gate("T1", Op.OR, ["S"])),
         "FE_2": lambda g: (g.basic("S", param_ref="S2"), g.gate("T2", Op.OR, ["S"]))})
    with pytest.raises(ValueError, match="'S'"):
        quantify_event_tree(m, "TR")


def test_gate_vs_basic_id_raises():
    m = _model(
        [Parameter("G", "probability", 0.1), Parameter("X", "probability", 0.2)],
        {"FE_1": lambda g: (g.basic("G"), g.gate("T1", Op.OR, ["G"])),
         "FE_2": lambda g: (g.basic("X"), g.gate("G", Op.OR, ["X"]),
                            g.gate("T2", Op.OR, ["G"]))})
    with pytest.raises(ValueError, match="'G'"):
        quantify_event_tree(m, "TR")


# ── 合法共享不扰动 ────────────────────────────────────────────────────────────

def test_shared_basic_same_param_ref_allowed_flagship_anchor():
    # 旗舰锚:F1=OR(S,X1)、F2=OR(S,X2),q 均 .1 → LL 精确 = .1+.9×.01 = 0.109
    m = _model(
        [Parameter("S", "probability", 0.1), Parameter("X1", "probability", 0.1),
         Parameter("X2", "probability", 0.1)],
        {"FE_1": lambda g: (g.basic("S"), g.basic("X1"), g.gate("T1", Op.OR, ["S", "X1"])),
         "FE_2": lambda g: (g.basic("S"), g.basic("X2"), g.gate("T2", Op.OR, ["S", "X2"]))})
    r = quantify_event_tree(m, "TR")["sequences"]
    assert r["S_FF"] == pytest.approx(0.109, rel=1e-12)


def test_same_tree_linked_by_two_fes_allowed():
    # 同一棵树被两个功能事件链接(同对象):合法;完全相关 ⇒ 一败俱败
    lib = [Parameter("A", "probability", 0.1)]
    ft = {"B": lambda g: (g.basic("A"), g.gate("T", Op.OR, ["A"]))}
    m = _model(lib, ft)
    et = m.event_trees["TR"]
    et.functional_events = [FunctionalEvent(id="FE_1", link_ft="B"),
                            FunctionalEvent(id="FE_2", link_ft="B")]
    et.sequences = [
        {"path": {"FE_1": "failure", "FE_2": "failure"}, "end_state": "S_FF"},
        {"path": {"FE_1": "failure", "FE_2": "success"}, "end_state": "S_FS"},
        {"path": {"FE_1": "success", "FE_2": "failure"}, "end_state": "S_SF"},
        {"path": {"FE_1": "success", "FE_2": "success"}, "end_state": "S_SS"},
    ]
    et.consequence_bins = {s["end_state"]: "C1" for s in et.sequences}
    r = quantify_event_tree(m, "TR")["sequences"]
    assert r["S_FF"] == pytest.approx(0.1, rel=1e-12)
    assert r["S_FS"] == pytest.approx(0.0, abs=1e-18)


# ── CCF 生成名命名空间 ────────────────────────────────────────────────────────

def test_ccf_generated_id_colliding_user_parameter_raises():
    # 评审例:用户已有 CCF_g(q=.9)节点+参数;beta 组 g 生成同名共因事件——
    # 此前 lib.add 静默覆盖(顶值 .901 → .018019 无异常)
    m = _model(
        [Parameter("M1", "probability", 0.1), Parameter("M2", "probability", 0.1),
         Parameter("CCF_g", "probability", 0.9)],
        {"FE_1": lambda g: (g.basic("M1"), g.basic("M2"), g.basic("CCF_g"),
                            g.gate("T1", Op.OR, ["M1", "M2", "CCF_g"]))},
        ccf_groups=[CCFGroup("g", ["M1", "M2"], "beta", {"beta": 0.1})])
    with pytest.raises(ValueError, match="CCF_g"):
        quantify_event_tree(m, "TR")


def test_ccf_indep_id_colliding_user_node_raises():
    m = _model(
        [Parameter("M1", "probability", 0.1), Parameter("M2", "probability", 0.1),
         Parameter("M1__I", "probability", 0.5)],
        {"FE_1": lambda g: (g.basic("M1"), g.basic("M2"), g.basic("M1__I"),
                            g.gate("T1", Op.OR, ["M1", "M2", "M1__I"]))},
        ccf_groups=[CCFGroup("g", ["M1", "M2"], "beta", {"beta": 0.1})])
    with pytest.raises(ValueError, match="M1__I"):
        quantify_event_tree(m, "TR")


def test_ccf_clean_namespace_expansion_unchanged():
    # 无撞名时 beta 展开数值不受护栏影响:P(M1∧M2) = βQ + (1−βQ)((1−β)Q)²
    m = _model(
        [Parameter("M1", "probability", 0.1), Parameter("M2", "probability", 0.1)],
        {"FE_1": lambda g: (g.basic("M1"), g.basic("M2"),
                            g.gate("T1", Op.AND, ["M1", "M2"]))},
        ccf_groups=[CCFGroup("g", ["M1", "M2"], "beta", {"beta": 0.1})])
    r = quantify_event_tree(m, "TR")["sequences"]
    qc, qi = 0.1 * 0.1, 0.9 * 0.1
    assert r["S_F"] == pytest.approx(qc + (1 - qc) * qi * qi, rel=1e-12)
