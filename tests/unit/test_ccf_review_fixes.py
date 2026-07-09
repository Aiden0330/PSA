"""engine-reviewer 2026-07-09 缺陷锁定测试(编号对应评审报告)。"""
import pytest

from psaengine import Analysis
from psaengine.model.ccf import CCFGroup
from psaengine.model.fault_tree import FaultTree
from psaengine.model.mef_xml import load_mef_xml, save_mef_xml
from psaengine.model.model import Model
from psaengine.model.parameters import Parameter, ParameterLibrary
from psaengine.model.pdag import PDAG, Op
from psaengine.preprocess.ccf_expand import apply_ccf, q_levels


def _model(qs: dict[str, float], gate=Op.AND, ccf=None, extra_ft=None):
    lib = ParameterLibrary()
    for x, q in qs.items():
        lib.add(Parameter(x, "probability", q))
    g = PDAG()
    for x in qs:
        g.basic(x)
    g.gate("TOP", gate, list(qs), k=None)
    g.top = "TOP"
    fts = {"T": FaultTree("TOP", g)}
    if extra_ft:
        fts.update(extra_ft)
    return Model(parameters=lib, fault_trees=fts, ccf_groups=ccf or [])


# 缺陷 #1:嵌套在 define-fault-tree 内的 define-CCF-group 必须被解析
NESTED_XML = """<?xml version="1.0"?>
<opsa-mef>
  <define-fault-tree name="SYS">
    <define-gate name="TOP"><and>
      <basic-event name="A"/><basic-event name="B"/>
    </and></define-gate>
    <define-CCF-group name="G" model="MGL">
      <members><basic-event name="A"/><basic-event name="B"/></members>
      <distribution><float value="0.01"/></distribution>
      <factors><factor level="2"><float value="0.10"/></factor></factors>
    </define-CCF-group>
  </define-fault-tree>
</opsa-mef>
"""


def test_nested_ccf_group_is_parsed(tmp_path):
    p = tmp_path / "n.xml"
    p.write_text(NESTED_XML, encoding="utf-8")
    m = load_mef_xml(str(p))
    assert len(m.ccf_groups) == 1
    # AND(A,B) + β=0.1:P ≈ βQ + (1-βQ)((1-β)Q)² > 纯独立 Q²
    assert Analysis(m).probability() > 2 * 0.01 ** 2


# 缺陷 #2:无 level 属性的 factor 按模型最小层级顺次分配(SCRAM 语义)
UNLABELED_XML = """<?xml version="1.0"?>
<opsa-mef>
  <define-fault-tree name="SYS">
    <define-gate name="TOP"><and>
      <basic-event name="A"/><basic-event name="B"/><basic-event name="C"/>
    </and></define-gate>
  </define-fault-tree>
  <define-CCF-group name="G" model="MGL">
    <members><basic-event name="A"/><basic-event name="B"/><basic-event name="C"/></members>
    <distribution><float value="0.01"/></distribution>
    <factors>
      <factor><float value="0.10"/></factor>
      <factor><float value="0.27"/></factor>
    </factors>
  </define-CCF-group>
</opsa-mef>
"""


def test_unlabeled_factors_assigned_sequentially(tmp_path):
    p = tmp_path / "u.xml"
    p.write_text(UNLABELED_XML, encoding="utf-8")
    [g] = load_mef_xml(str(p)).ccf_groups
    assert g.factors == {"beta": 0.10, "gamma": 0.27}


# 缺陷 #3:staggered 经 MEF attributes 无损往返
def test_staggered_mef_roundtrip(tmp_path):
    m = _model({"A": 2e-3, "B": 2e-3},
               ccf=[CCFGroup("G", ["A", "B"], "alpha", {"alpha1": 0.96, "alpha2": 0.04}, staggered=True)])
    p = tmp_path / "s.xml"
    save_mef_xml(m, str(p))
    m2 = load_mef_xml(str(p))
    assert m2.ccf_groups[0].staggered is True
    assert Analysis(m2).probability() == pytest.approx(Analysis(m).probability(), rel=1e-12)


# 缺陷 #4:错峰 alpha 必须 Σα=1(尺度敏感,静默缩放不可接受)
def test_staggered_alpha_requires_normalized_factors():
    with pytest.raises(ValueError, match="sum to 1"):
        q_levels("alpha", {"alpha1": 0.45, "alpha2": 0.035, "alpha3": 0.015}, 3, 1e-2, staggered=True)


# 缺陷 #5:部分在树 / 与先前组重叠 → 响亮失败;整组不在树 → 静默跳过(逐树语义)
def test_partial_presence_raises_absent_group_skipped():
    m = _model({"A": 1e-2, "B": 1e-2},
               ccf=[CCFGroup("G", ["A", "B", "X"], "mgl", {"beta": 0.1, "gamma": 0.2})])
    with pytest.raises(ValueError, match="partially present"):
        Analysis(m)
    # 整组成员都不在本树 → 跳过(组属于其他故障树)
    m2 = _model({"A": 1e-2, "B": 1e-2},
                ccf=[CCFGroup("G", ["X", "Y"], "mgl", {"beta": 0.1})])
    assert Analysis(m2).probability() == pytest.approx(1e-4, rel=1e-9)


def test_overlapping_groups_raise():
    m = _model({"A": 1e-2, "B": 1e-2, "C": 1e-2},
               ccf=[CCFGroup("G1", ["A", "B"], "mgl", {"beta": 0.1}),
                    CCFGroup("G2", ["B", "C"], "mgl", {"beta": 0.1})])
    with pytest.raises(ValueError, match="overlapping"):
        Analysis(m)


# 缺陷 #6:多层展开要求成员同质;异质 → 显式拒绝(beta 逐成员路径不受限)
def test_heterogeneous_members_rejected_for_multilevel():
    m = _model({"A": 0.1, "B": 0.2}, ccf=[CCFGroup("G", ["A", "B"], "mgl", {"beta": 0.1})])
    with pytest.raises(ValueError, match="homogeneous"):
        Analysis(m)
    m2 = _model({"A": 0.1, "B": 0.2}, ccf=[CCFGroup("G", ["A", "B"], "beta", {"beta": 0.1})])
    Analysis(m2)                                     # beta 保持逐成员 (1-β)q_i,不抛


# spec §二承诺:MGL 不支持错峰
def test_mgl_staggered_rejected():
    with pytest.raises(ValueError, match="staggered"):
        q_levels("mgl", {"beta": 0.1}, 3, 1e-2, staggered=True)


# ETA 路径:合并 PDAG 上展开 CCF(跨屏障共享共因精确否定)
def test_event_tree_applies_ccf():
    from psaengine.model.event_tree import EventTree, FunctionalEvent
    lib = ParameterLibrary()
    for x in ("A", "B"):
        lib.add(Parameter(x, "probability", 1e-2))
    fts = {}
    for fe_id, ev in (("FE1", "A"), ("FE2", "B")):
        g = PDAG()
        g.basic(ev)
        g.gate(fe_id, Op.NULL, [ev])
        g.top = fe_id
        fts[fe_id] = FaultTree(fe_id, g)
    et = EventTree("IE", 1.0,
                   [FunctionalEvent("FE1", "FE1", None), FunctionalEvent("FE2", "FE2", None)],
                   [{"end_state": "L2", "path": {"FE1": "failure", "FE2": "failure"}}],
                   {"L2": "C3"})
    grp = [CCFGroup("G", ["A", "B"], "mgl", {"beta": 0.1})]
    m_no = Model(parameters=lib, fault_trees=fts, event_trees={"TR": et}, ccf_groups=[])
    m_cc = Model(parameters=lib, fault_trees=fts, event_trees={"TR": et}, ccf_groups=grp)
    from psaengine.eta.sequence import quantify_event_tree
    p_no = quantify_event_tree(m_no, "TR")["sequences"]["L2"]
    p_cc = quantify_event_tree(m_cc, "TR")["sequences"]["L2"]
    assert p_no == pytest.approx(1e-4, rel=1e-9)
    # 精确:P(A∧B) = Q2 + (1-Q2)·Q1²,β=0.1 → 1e-3 + 0.999·(9e-3)² = 1.080919e-3
    assert p_cc == pytest.approx(1e-3 + (1 - 1e-3) * (9e-3) ** 2, rel=1e-12)
