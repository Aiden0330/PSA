import json, pytest
from psaengine.model.model import Model
from psaengine.model.json_io import load_model
from psaengine.model.rebind import RebindRule
from psaengine.model.parameters import Parameter, ParameterLibrary
from psaengine.model.fault_tree import FaultTree
from psaengine.model.pdag import PDAG, Op
from psaengine.quantify.postprocess import PostRule

def test_load_tiny_and():
    m = Model.from_json("examples/tiny_and.json")
    assert m.parameters.get("A").unavailability() == 0.1
    ft = m.fault_trees["TOP"]
    assert ft.pdag.basic_events() == {"A", "B"}

def test_round_trip(tmp_path):
    m = Model.from_json("examples/tiny_and.json")
    out = tmp_path / "rt.json"
    m.to_json(str(out))
    m2 = Model.from_json(str(out))
    assert m2.fault_trees["TOP"].pdag.node("TOP").op.value == "and"

def test_undefined_param_ref_rejected(tmp_path):
    bad = {"model_data": {"parameters": []},
           "fault_trees": [{"name": "T", "top": "T", "nodes": [
               {"id": "X", "basic": True, "param_ref": "MISSING"},
               {"id": "T", "op": "null", "args": ["X"]}]}],
           "event_trees": [], "ccf_groups": []}
    p = tmp_path / "bad.json"; p.write_text(json.dumps(bad))
    with pytest.raises(ValueError, match="MISSING"):
        load_model(str(p))


def _sig_rebind(r):
    return (r.id, tuple(sorted(r.when.items())), r.param, r.value, r.to_param)

def _sig_post(r):
    return (r.kind, tuple(r.events), r.add_event, r.prob, r.source, r.source_prob)

def test_rebind_and_post_rules_json_round_trip(tmp_path):
    # 规格 2026-07-15-regime-a §6 门禁:新字段 json_io 往返锁
    lib = ParameterLibrary()
    for pid, v in (("A", 0.02), ("B", 0.1), ("C", 0.25), ("B_ALT", 0.4)):
        lib.add(Parameter(pid, "probability", v))
    g = PDAG()
    for b in ("A", "B", "C"):
        g.basic(b)
    g.house("H", state=False)
    g.gate("G", Op.AND, ["B", "C"]); g.gate("TOP", Op.OR, ["A", "G"]); g.top = "TOP"
    rebind = [RebindRule(id="r-val", when={"H": True}, param="B", value=0.4),
              RebindRule(id="r-to", when={"H": True}, param="C", to_param="B_ALT")]
    post = [PostRule.from_dict({"kind": "recovery", "events": ["A"],
                               "add_event": "B_ALT", "prob": 0.5}),
            PostRule.from_dict({"kind": "exchange", "events": ["A"], "source": "B",
                                "source_prob": 0.1, "add_event": "C", "prob": 0.25})]
    m = Model(parameters=lib, fault_trees={"T": FaultTree("TOP", g)},
              rebind_rules=rebind, post_rules=post)
    out = tmp_path / "rules.json"
    m.to_json(str(out))
    m2 = Model.from_json(str(out))
    assert [_sig_rebind(r) for r in m2.rebind_rules] == [_sig_rebind(r) for r in rebind]
    assert [_sig_post(r) for r in m2.post_rules] == [_sig_post(r) for r in post]
