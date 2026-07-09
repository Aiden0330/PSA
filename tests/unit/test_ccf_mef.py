"""MEF define-CCF-group 解析/生成 round-trip(alpha/MGL 因子层级映射)。"""
import pytest

from psaengine import Analysis
from psaengine.model.ccf import CCFGroup
from psaengine.model.fault_tree import FaultTree
from psaengine.model.mef_xml import load_mef_xml, save_mef_xml
from psaengine.model.model import Model
from psaengine.model.parameters import Parameter, ParameterLibrary
from psaengine.model.pdag import PDAG, Op

MGL_XML = """<?xml version="1.0"?>
<opsa-mef>
  <define-fault-tree name="SYS">
    <define-gate name="TOP"><atleast min="2">
      <basic-event name="A"/><basic-event name="B"/><basic-event name="C"/>
    </atleast></define-gate>
  </define-fault-tree>
  <define-CCF-group name="G" model="MGL">
    <members><basic-event name="A"/><basic-event name="B"/><basic-event name="C"/></members>
    <distribution><float value="0.01"/></distribution>
    <factors>
      <factor level="2"><float value="0.10"/></factor>
      <factor level="3"><float value="0.27"/></factor>
    </factors>
  </define-CCF-group>
</opsa-mef>
"""


def test_load_mgl_group(tmp_path):
    p = tmp_path / "m.xml"
    p.write_text(MGL_XML, encoding="utf-8")
    m = load_mef_xml(str(p))
    [g] = m.ccf_groups
    assert (g.model, g.members) == ("mgl", ["A", "B", "C"])
    assert g.factors == {"beta": 0.10, "gamma": 0.27}
    assert m.parameters.get("A").unavailability() == pytest.approx(0.01)
    # 载入即可量化(展开在 Analysis 内发生),与 spec 锚一致的方向性检查
    prob = Analysis(m).probability()
    assert prob > 3 * 0.01 ** 2                      # 共因 > 纯独立 2oo3


def test_alpha_roundtrip(tmp_path):
    lib = ParameterLibrary()
    for x in "AB":
        lib.add(Parameter(x, "probability", 2e-3))
    g = PDAG()
    for x in "AB":
        g.basic(x)
    g.gate("TOP", Op.AND, ["A", "B"])
    g.top = "TOP"
    m = Model(parameters=lib, fault_trees={"SYS": FaultTree("TOP", g)},
              ccf_groups=[CCFGroup("G2", ["A", "B"], "alpha", {"alpha1": 0.96, "alpha2": 0.04})])
    p = tmp_path / "rt.xml"
    save_mef_xml(m, str(p))
    m2 = load_mef_xml(str(p))
    [g2] = m2.ccf_groups
    assert (g2.id, g2.model, g2.members) == ("G2", "alpha", ["A", "B"])
    assert g2.factors == {"alpha1": 0.96, "alpha2": 0.04}
    assert m2.parameters.get("A").unavailability() == pytest.approx(2e-3)
    assert Analysis(m2).probability() == pytest.approx(Analysis(m).probability(), rel=1e-12)
