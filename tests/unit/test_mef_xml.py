import pytest
from psaengine.model.mef_xml import load_mef_xml, save_mef_xml
from psaengine.analysis import Analysis

MEF = """<?xml version="1.0"?>
<opsa-mef>
  <define-fault-tree name="FT">
    <define-gate name="TOP"><or>
      <basic-event name="A"/><basic-event name="B"/>
    </or></define-gate>
  </define-fault-tree>
  <model-data>
    <define-basic-event name="A"><float value="0.1"/></define-basic-event>
    <define-basic-event name="B"><float value="0.2"/></define-basic-event>
  </model-data>
</opsa-mef>"""

def test_parse_and_quantify(tmp_path):
    p = tmp_path / "m.xml"; p.write_text(MEF)
    model = load_mef_xml(str(p))
    an = Analysis(model, fault_tree="FT")
    assert an.probability(method="exact") == pytest.approx(1 - 0.9*0.8)

def test_round_trip(tmp_path):
    p = tmp_path / "m.xml"; p.write_text(MEF)
    model = load_mef_xml(str(p))
    out = tmp_path / "out.xml"; save_mef_xml(model, str(out))
    model2 = load_mef_xml(str(out))
    an = Analysis(model2, fault_tree="FT")
    assert an.probability() == pytest.approx(0.28)

def test_atleast_parsed(tmp_path):
    mef = '''<opsa-mef><define-fault-tree name="F">
      <define-gate name="T"><atleast min="2">
        <basic-event name="A"/><basic-event name="B"/><basic-event name="C"/>
      </atleast></define-gate></define-fault-tree>
      <model-data>
        <define-basic-event name="A"><float value="0.3"/></define-basic-event>
        <define-basic-event name="B"><float value="0.3"/></define-basic-event>
        <define-basic-event name="C"><float value="0.3"/></define-basic-event>
      </model-data></opsa-mef>'''
    p = tmp_path / "v.xml"; p.write_text(mef)
    an = Analysis(load_mef_xml(str(p)), fault_tree="F")
    assert an.probability() == pytest.approx(0.216)
