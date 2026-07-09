"""4a2 house 事件 / 边界条件集:引擎覆盖语义 + 模型不可变 + API 面。"""
import pytest
from fastapi.testclient import TestClient

from backend.app import app
from psaengine import Analysis
from psaengine.model.fault_tree import FaultTree
from psaengine.model.model import Model
from psaengine.model.parameters import Parameter, ParameterLibrary
from psaengine.model.pdag import PDAG, Op

client = TestClient(app)


def _model(bc_sets=None):
    """TOP = OR(AND(A, H_MAINT), B):H_MAINT 表示「检修工况」house 事件,默认 False。"""
    lib = ParameterLibrary()
    lib.add(Parameter("A", "probability", 0.2))
    lib.add(Parameter("B", "probability", 0.01))
    g = PDAG()
    g.basic("A"); g.basic("B")
    g.house("H_MAINT", state=False)
    g.gate("G1", Op.AND, ["A", "H_MAINT"])
    g.gate("TOP", Op.OR, ["G1", "B"])
    g.top = "TOP"
    return Model(parameters=lib, fault_trees={"T": FaultTree("TOP", g)}, bc_sets=bc_sets or {})


def test_house_override_flips_probability():
    m = _model()
    assert Analysis(m).probability() == pytest.approx(0.01, rel=1e-12)          # H=False → 只剩 B
    p_on = Analysis(m, house_states={"H_MAINT": True}).probability()
    assert p_on == pytest.approx(0.2 + 0.01 - 0.2 * 0.01, rel=1e-12)            # OR(A,B) 精确


def test_named_boundary_condition_set_and_precedence():
    m = _model(bc_sets={"检修": {"H_MAINT": True}})
    assert Analysis(m, boundary_condition_set="检修").probability() == pytest.approx(0.208, rel=1e-9)
    # 显式 house_states 覆盖命名集
    p = Analysis(m, boundary_condition_set="检修", house_states={"H_MAINT": False}).probability()
    assert p == pytest.approx(0.01, rel=1e-12)


def test_model_not_mutated_and_loud_errors():
    m = _model()
    Analysis(m, house_states={"H_MAINT": True})
    assert m.fault_trees["T"].pdag.nodes["H_MAINT"].state is False              # 模型本体未被改写
    with pytest.raises(ValueError, match="unknown house event"):
        Analysis(m, house_states={"NOPE": True})
    with pytest.raises(ValueError, match="not a house event"):
        Analysis(m, house_states={"A": True})
    with pytest.raises(ValueError, match="unknown boundary condition set"):
        Analysis(m, boundary_condition_set="不存在")


def test_house_conditioning_changes_cutsets():
    m = _model()
    on = {frozenset(c.events) for c in Analysis(m, house_states={"H_MAINT": True}).cutsets()}
    off = {frozenset(c.events) for c in Analysis(m).cutsets()}
    assert frozenset({"A"}) in on and frozenset({"A"}) not in off
    assert frozenset({"B"}) in on and frozenset({"B"}) in off


# ── API 面 ──

def _ft_json():
    return {"model_data": {"parameters": [{"id": "A", "kind": "probability", "value": 0.2},
                                          {"id": "B", "kind": "probability", "value": 0.01}]},
            "fault_trees": [{"name": "T", "top": "TOP", "nodes": [
                {"id": "A", "basic": True, "param_ref": "A"},
                {"id": "B", "basic": True, "param_ref": "B"},
                {"id": "H_MAINT", "house": True, "state": False},
                {"id": "G1", "op": "and", "args": ["A", "H_MAINT"]},
                {"id": "TOP", "op": "or", "args": ["G1", "B"]}]}],
            "boundary_condition_sets": [{"name": "检修", "house_states": {"H_MAINT": True}}]}


def test_api_quantify_house_states_and_bc_set():
    base = client.post("/api/quantify", json={"model": _ft_json(), "fault_tree": "T"}).json()
    assert base["probability"] == pytest.approx(0.01, rel=1e-9)
    on = client.post("/api/quantify", json={"model": _ft_json(), "fault_tree": "T",
                                            "house_states": {"H_MAINT": True}}).json()
    assert on["probability"] == pytest.approx(0.208, rel=1e-9)
    named = client.post("/api/quantify", json={"model": _ft_json(), "fault_tree": "T",
                                               "boundary_condition_set": "检修"}).json()
    assert named["probability"] == pytest.approx(0.208, rel=1e-9)
    bad = client.post("/api/quantify", json={"model": _ft_json(), "fault_tree": "T",
                                             "house_states": {"NOPE": True}})
    assert bad.status_code == 400


def test_api_event_tree_house_states():
    req = {
        "init_event": "IE", "init_frequency": 1.0,
        "functional_events": [{"id": "FE1", "link_ft": "FE1"}],
        "fault_trees": {"FE1": {"top": "TOP", "nodes": [
            {"id": "A", "basic": True, "param_ref": "A"},
            {"id": "H_MAINT", "house": True, "state": False},
            {"id": "TOP", "op": "and", "args": ["A", "H_MAINT"]}]}},
        "parameters": {"A": {"value": 0.2}},
        "sequences": [{"end_state": "L1", "path": {"FE1": "failure"}}],
        "consequence_bins": {"L1": "C2"},
    }
    off = client.post("/api/event-tree/quantify", json=req).json()
    assert off["sequences"]["L1"] == pytest.approx(0.0, abs=1e-15)              # H=False → FE1 不可能失效
    on = client.post("/api/event-tree/quantify", json={**req, "house_states": {"H_MAINT": True}}).json()
    assert on["sequences"]["L1"] == pytest.approx(0.2, rel=1e-12)
