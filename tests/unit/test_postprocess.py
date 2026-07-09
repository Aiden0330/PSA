"""4a3 割集后处理:互斥/删除/恢复语义;精确概率通道不受影响;API 面。"""
import pytest
from fastapi.testclient import TestClient

from backend.app import app
from psaengine.quantify.cutsets import CutSet
from psaengine.quantify.postprocess import PostRule, apply_post_rules

client = TestClient(app)


def _cs(*evsets):
    return [CutSet(sorted(e), len(e), p) for e, p in evsets]


def test_mutually_exclusive_drops_only_cooccurring():
    cs = _cs((["M1", "A"], 1e-3), (["M2", "B"], 2e-3), (["M1", "M2"], 5e-4), (["M1", "M2", "C"], 1e-5))
    out, stats = apply_post_rules(cs, [PostRule("mutually_exclusive", ["M1", "M2"])])
    assert stats["removed"] == 2                     # 同含 M1+M2 的两条被删
    assert [set(c.events) for c in out] == [{"M2", "B"}, {"M1", "A"}]


def test_delete_contains_superset_semantics():
    cs = _cs((["A", "B"], 1e-3), (["A", "B", "C"], 1e-4), (["A"], 1e-2))
    out, stats = apply_post_rules(cs, [PostRule("delete_contains", ["A", "B"])])
    assert stats["removed"] == 2                     # ⊇{A,B} 的两条被删,{A} 保留
    assert [set(c.events) for c in out] == [{"A"}]


def test_recovery_appends_and_scales_idempotently():
    cs = _cs((["A", "B"], 1e-3), (["C"], 1e-2))
    rule = PostRule("recovery", ["A", "B"], add_event="REC_OP", prob=0.1)
    out, stats = apply_post_rules(cs, [rule])
    assert stats["recovered"] == 1
    rec = next(c for c in out if "REC_OP" in c.events)
    assert set(rec.events) == {"A", "B", "REC_OP"}
    assert rec.order == 3
    assert rec.probability == pytest.approx(1e-4, rel=1e-12)
    # 再次应用同一规则:不重复追加(幂等)
    out2, stats2 = apply_post_rules(out, [rule])
    assert stats2["recovered"] == 0
    assert next(c for c in out2 if "REC_OP" in c.events).probability == pytest.approx(1e-4, rel=1e-12)


def test_rule_validation():
    with pytest.raises(ValueError):
        PostRule.from_dict({"kind": "nope"})
    with pytest.raises(ValueError):
        PostRule.from_dict({"kind": "mutually_exclusive", "events": ["A"]})
    with pytest.raises(ValueError):
        PostRule.from_dict({"kind": "recovery", "events": ["A"], "add_event": "R", "prob": 1.5})


def _model_json():
    return {"model_data": {"parameters": [{"id": "A", "kind": "probability", "value": 0.1},
                                          {"id": "B", "kind": "probability", "value": 0.1},
                                          {"id": "M1", "kind": "probability", "value": 0.05},
                                          {"id": "M2", "kind": "probability", "value": 0.05}]},
            "fault_trees": [{"name": "T", "top": "TOP", "nodes": [
                {"id": "A", "basic": True, "param_ref": "A"},
                {"id": "B", "basic": True, "param_ref": "B"},
                {"id": "M1", "basic": True, "param_ref": "M1"},
                {"id": "M2", "basic": True, "param_ref": "M2"},
                {"id": "G1", "op": "and", "args": ["A", "B"]},
                {"id": "G2", "op": "and", "args": ["M1", "M2"]},
                {"id": "TOP", "op": "or", "args": ["G1", "G2"]}]}]}


def test_api_post_rules_exact_probability_untouched():
    base = client.post("/api/quantify", json={"model": _model_json(), "fault_tree": "T"}).json()
    r = client.post("/api/quantify", json={
        "model": _model_json(), "fault_tree": "T",
        "post_rules": [{"kind": "mutually_exclusive", "events": ["M1", "M2"]}],
    }).json()
    # 精确概率通道不受后处理影响(卖点守护)
    assert r["probability"] == pytest.approx(base["probability"], rel=1e-15)
    assert base["post"] is None
    sets = [set(c["events"]) for c in r["cutsets"]]
    assert {"M1", "M2"} not in sets and {"A", "B"} in sets
    assert r["post"]["removed"] == 1
    assert r["post"]["probability_rea"] == pytest.approx(0.01, rel=1e-12)   # 只剩 {A,B}
    bad = client.post("/api/quantify", json={"model": _model_json(), "fault_tree": "T",
                                             "post_rules": [{"kind": "nope"}]})
    assert bad.status_code == 400
