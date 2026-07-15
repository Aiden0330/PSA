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


def test_exchange_rule_swaps_event_and_probability():
    """exchange(Gap 7 裁决二,MEF §6 手算例):C={H,A} 满足假设 {H} 且含 source A
    → 换成 {H,A'},概率 ×(q_A'/q_A):0.2×0.01=0.002 → 0.2×0.10=0.02(10×)。"""
    from psaengine.quantify.cutsets import CutSet
    rule = PostRule.from_dict({"kind": "exchange", "events": ["H"], "source": "A",
                               "add_event": "A_prime", "prob": 0.10, "source_prob": 0.01})
    cs = [CutSet(events=["A", "H"], order=2, probability=0.002)]
    out, stats = apply_post_rules(cs, [rule])
    assert len(out) == 1
    assert out[0].events == ["A_prime", "H"]
    assert out[0].probability == pytest.approx(0.02, rel=1e-12)
    assert out[0].order == 2
    assert stats.get("exchanged") == 1


def test_exchange_rule_target_already_present_divides_only():
    """target 已在割集 → 集合语义:仅移除 source、÷q_source,阶 −1。"""
    from psaengine.quantify.cutsets import CutSet
    rule = PostRule.from_dict({"kind": "exchange", "events": ["H"], "source": "A",
                               "add_event": "B", "prob": 0.3, "source_prob": 0.01})
    cs = [CutSet(events=["A", "B", "H"], order=3, probability=0.2 * 0.01 * 0.3)]
    out, _ = apply_post_rules(cs, [rule])
    assert out[0].events == ["B", "H"]
    assert out[0].probability == pytest.approx(0.2 * 0.3, rel=1e-12)
    assert out[0].order == 2


def test_exchange_rule_not_applied_without_hypothesis_or_source():
    from psaengine.quantify.cutsets import CutSet
    rule = PostRule.from_dict({"kind": "exchange", "events": ["H"], "source": "A",
                               "add_event": "A_prime", "prob": 0.10, "source_prob": 0.01})
    keep = [CutSet(events=["A"], order=1, probability=0.01),          # 无 H
            CutSet(events=["H", "X"], order=2, probability=0.002)]    # 无 source
    out, stats = apply_post_rules(keep, [rule])
    assert sorted(tuple(c.events) for c in out) == [("A",), ("H", "X")]
    assert stats.get("exchanged", 0) == 0


def test_exchange_rule_validation_loud():
    with pytest.raises(ValueError, match="source"):
        PostRule.from_dict({"kind": "exchange", "events": ["H"],
                            "add_event": "A2", "prob": 0.1, "source_prob": 0.01})
    with pytest.raises(ValueError, match="source_prob"):
        PostRule.from_dict({"kind": "exchange", "events": ["H"], "source": "A",
                            "add_event": "A2", "prob": 0.1})
