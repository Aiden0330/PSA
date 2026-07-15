"""POST /api/ft/frequency(初因故障树频率)+ 'ft' 源载荷 canonical 往返锁。"""
from fastapi.testclient import TestClient

from backend.app import app
from backend.canonical import content_hash, to_canonical, to_v2
from backend.canonical.models import ProjectDocument

client = TestClient(app)


def _ie_model(and_two_freq=False, pure_prob=False):
    """__init__ 树:OR(AND(F_BMS, Q_ALARM), F_EXT) —— 双初因、一使能,手算 F=1e-3·0.2+5e-4。"""
    if and_two_freq:
        nodes = [{"id": "F1", "basic": True, "param_ref": "F1"},
                 {"id": "F2", "basic": True, "param_ref": "F2"},
                 {"id": "TOP", "op": "and", "args": ["F1", "F2"]}]
        params = [{"id": "F1", "kind": "frequency", "value": 1e-3},
                  {"id": "F2", "kind": "frequency", "value": 2e-3}]
    elif pure_prob:
        nodes = [{"id": "Q1", "basic": True, "param_ref": "Q1"},
                 {"id": "TOP", "op": "null", "args": ["Q1"]}]
        params = [{"id": "Q1", "kind": "probability", "value": 0.1}]
    else:
        nodes = [{"id": "F_BMS", "basic": True, "param_ref": "F_BMS"},
                 {"id": "Q_ALARM", "basic": True, "param_ref": "Q_ALARM"},
                 {"id": "F_EXT", "basic": True, "param_ref": "F_EXT"},
                 {"id": "G1", "op": "and", "args": ["F_BMS", "Q_ALARM"]},
                 {"id": "TOP", "op": "or", "args": ["G1", "F_EXT"]}]
        params = [{"id": "F_BMS", "kind": "frequency", "value": 1e-3},
                  {"id": "Q_ALARM", "kind": "probability", "value": 0.2},
                  {"id": "F_EXT", "kind": "frequency", "value": 5e-4}]
    return {"model_data": {"parameters": params},
            "fault_trees": [{"name": "__init__", "top": "TOP", "nodes": nodes}]}


def test_frequency_endpoint_happy_path():
    r = client.post("/api/ft/frequency", json={"model": _ie_model(), "fault_tree": "__init__"})
    assert r.status_code == 200
    assert "charset=utf-8" in r.headers["content-type"]
    body = r.json()
    assert abs(body["frequency"] - (1e-3 * 0.2 + 5e-4)) < 1e-15    # Σ 语义,手算锚点
    assert len(body["cutsets"]) == 2
    assert {c["initiator"] for c in body["cutsets"]} == {"F_BMS", "F_EXT"}
    assert body["cutsets"][0]["frequency"] >= body["cutsets"][1]["frequency"]


def test_two_frequencies_in_cutset_is_400():
    r = client.post("/api/ft/frequency", json={"model": _ie_model(and_two_freq=True),
                                               "fault_tree": "__init__"})
    assert r.status_code == 400 and "频率" in r.json()["detail"]


def test_pure_probability_tree_is_400():
    r = client.post("/api/ft/frequency", json={"model": _ie_model(pure_prob=True),
                                               "fault_tree": "__init__"})
    assert r.status_code == 400


def test_unknown_tree_is_400():
    r = client.post("/api/ft/frequency", json={"model": _ie_model(), "fault_tree": "ghost"})
    assert r.status_code == 400


def test_ft_source_payload_roundtrips_lossless_with_frequency_params():
    """'ft' 源 + __init__ 树 + frequency 参数:v2 → canonical → v2 逐字段无损,哈希稳定。"""
    payload = {"v": 2,
               "etas": [{"key": "t", "name": "T",
                         "model": {"initEvent": "BMS 多重失效致过充", "initFreq": 7e-4,
                                   "initFreqSource": "ft",
                                   "functionalEvents": [{"id": "FE1", "failProb": 0.1}],
                                   "root": {"kind": "branch", "feId": "FE1",
                                            "success": {"kind": "leaf", "consequence": "C1"},
                                            "failure": {"kind": "leaf", "consequence": "C2"}}},
                         "fts": _ie_model(), "pfds": {}}],
               "activeKey": "t", "checkedKeys": {"t": True}}
    puuid = "3f2504e0-4f89-41d3-9a0c-0305e82c3301"
    doc, sidecar = to_canonical(payload, puuid)
    assert to_v2(doc, sidecar) == payload                          # 逐字段无损
    h1 = content_hash(doc)
    doc2, _ = to_canonical(to_v2(doc, sidecar), puuid)
    assert content_hash(doc2) == h1                                # 哈希稳定
    # frequency kind 真的保下来了(不是被压成 probability)
    dumped = doc.model_dump(mode="json")
    kinds = {p["ref"]: p["kind"] for t in dumped["event_trees"] for p in t["parameters"]}
    assert kinds.get("F_BMS") == "frequency" and kinds.get("Q_ALARM") == "probability"


def _shared_initiator_model():
    """OR(AND(I,A), AND(I,B)),λ=0.1,qA=0.6,qB=0.7 —— 规格 2026-07-14 锚点 A。"""
    nodes = [{"id": "I", "basic": True, "param_ref": "I"},
             {"id": "A", "basic": True, "param_ref": "A"},
             {"id": "B", "basic": True, "param_ref": "B"},
             {"id": "G1", "op": "and", "args": ["I", "A"]},
             {"id": "G2", "op": "and", "args": ["I", "B"]},
             {"id": "TOP", "op": "or", "args": ["G1", "G2"]}]
    params = [{"id": "I", "kind": "frequency", "value": 0.1},
              {"id": "A", "kind": "probability", "value": 0.6},
              {"id": "B", "kind": "probability", "value": 0.7}]
    return {"model_data": {"parameters": params},
            "fault_trees": [{"name": "__init__", "top": "TOP", "nodes": nodes}]}


def test_frequency_endpoint_exact_method():
    """method=exact:头条 0.088(≤ λ=0.1 物理上界),by_initiator 携带 P(E);默认仍 sum。"""
    m = _shared_initiator_model()
    r_sum = client.post("/api/ft/frequency", json={"model": m, "fault_tree": "__init__"})
    r_ex = client.post("/api/ft/frequency",
                       json={"model": m, "fault_tree": "__init__", "method": "exact"})
    assert r_sum.status_code == 200 and r_ex.status_code == 200
    s, e = r_sum.json(), r_ex.json()
    assert s["method"] == "sum" and abs(s["frequency"] - 0.13) < 1e-12
    assert s.get("by_initiator") is None                      # sum 不带逐初因块
    assert e["method"] == "exact" and abs(e["frequency"] - 0.088) < 1e-12
    assert e["frequency"] <= 0.1 + 1e-15
    bi = e["by_initiator"]
    assert len(bi) == 1 and bi[0]["initiator"] == "I"
    assert abs(bi[0]["enabling_probability"] - 0.88) < 1e-12
    assert len(e["cutsets"]) == 2                             # 溯源列表两模式同形


def test_frequency_endpoint_rejects_unknown_method():
    r = client.post("/api/ft/frequency",
                    json={"model": _shared_initiator_model(), "fault_tree": "__init__",
                          "method": "fuzzy"})
    assert r.status_code == 422                               # pydantic Literal 校验
