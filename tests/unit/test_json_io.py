import json, pytest
from psaengine.model.model import Model
from psaengine.model.json_io import load_model

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
