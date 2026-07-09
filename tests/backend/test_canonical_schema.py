"""ADR-1 acceptance #3/#4-adjacent: strict schema endpoint + all builtin
scenarios convert and validate (structure only — data values evolve)."""
from fastapi.testclient import TestClient

from backend.app import app
from backend.canonical import to_canonical
from bess.library import load_library
from bess.scenarios import build_scenario_model, load_scenarios
from psaengine.model.json_io import fault_tree_to_dict, parameters_to_json

client = TestClient(app)
PUUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301"
_DEPTH = ["C1", "C2", "C3", "C4", "C5", "C5", "C5"]


def test_schema_endpoint_is_strict():
    r = client.get("/api/schema/project-document/1.0")
    assert r.status_code == 200
    schema = r.json()
    assert schema.get("additionalProperties") is False
    defs = schema.get("$defs", {})
    assert all(d.get("additionalProperties") is False
               for d in defs.values() if d.get("type") == "object")
    assert "EventTree" in defs and "Provenance" in defs


def _scenario_payload(sid: str) -> dict:
    """Mirror frontend buildScenarioTab: engine scenario -> v2 tab payload."""
    model = build_scenario_model(sid)
    lib = load_library()
    labels = {b["id"]: b["name"] for b in lib["barrier_effectiveness"]}
    pfd = {b["id"]: b.get("pfd", 0.1) for b in lib["barrier_effectiveness"]}
    et = model.event_trees["TR"]
    ftj = [fault_tree_to_dict(name, ft) for name, ft in model.fault_trees.items()]
    big = {f["name"] for f in ftj if len(f["nodes"]) > 2}
    fes = []
    for fe in et.functional_events:
        d = {"id": fe.id, "label": labels.get(fe.id, fe.id),
             "failProb": pfd.get(fe.id, 0.1)}
        if fe.id in big:
            d["linkFt"] = fe.id
        fes.append(d)
    node = {"kind": "leaf", "consequence": _DEPTH[min(len(fes), 6)]}
    for i in range(len(fes) - 1, -1, -1):
        node = {"kind": "branch", "feId": fes[i]["id"],
                "success": {"kind": "leaf", "consequence": _DEPTH[min(i, 6)]},
                "failure": node}
    key = "sc:" + sid
    return {"v": 2,
            "etas": [{"key": key, "name": sid,
                      "model": {"initEvent": et.init_event,
                                "initFreq": et.init_frequency,
                                "functionalEvents": fes, "root": node},
                      "fts": {"model_data": {"parameters": parameters_to_json(model.parameters)},
                              "fault_trees": ftj},
                      "pfds": {}}],
            "activeKey": key, "checkedKeys": {key: True}}


def test_all_builtin_scenarios_convert_and_roundtrip():
    from backend.canonical import to_v2
    import copy
    for s in load_scenarios():
        payload = _scenario_payload(s["id"])
        doc, sidecar = to_canonical(copy.deepcopy(payload), PUUID)  # construction = validation
        assert doc.event_trees[0].functional_events, s["id"]
        assert to_v2(doc, sidecar) == payload, s["id"]
