from fastapi.testclient import TestClient
from backend.app import app

client = TestClient(app)


def test_mef_import_roundtrip(tmp_path):
    from psaengine.model.pdag import PDAG, Op
    from psaengine.model.parameters import Parameter, ParameterLibrary
    from psaengine.model.fault_tree import FaultTree
    from psaengine.model.model import Model
    from psaengine.model.mef_xml import save_mef_xml
    g = PDAG(); g.basic("a"); g.basic("b"); g.gate("T", Op.OR, ["a", "b"]); g.top = "T"
    lib = ParameterLibrary(); lib.add(Parameter("a", "probability", 0.1)); lib.add(Parameter("b", "probability", 0.2))
    m = Model(parameters=lib, fault_trees={"FT": FaultTree("T", g)}, event_trees={}, ccf_groups=[])
    p = tmp_path / "m.xml"; save_mef_xml(m, str(p))
    r = client.post("/api/import/mef", json={"xml": p.read_text(encoding="utf-8")})
    assert r.status_code == 200
    d = r.json()
    assert d["fault_tree"] and d["model"]["fault_trees"]
    ids = [n["id"] for n in d["model"]["fault_trees"][0]["nodes"]]
    assert "a" in ids and "T" in ids


def test_mef_import_bad_xml():
    assert client.post("/api/import/mef", json={"xml": "<not-mef/>"}).status_code in (400, 422, 500)
