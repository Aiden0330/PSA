"""ADR-1 acceptance #1: lossless v2 -> canonical -> v2 round-trip + hash determinism."""
import copy
import json
import os

from backend.canonical import to_canonical, to_v2, content_hash

PUUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301"

_SAVED = os.path.join(os.path.dirname(__file__), "..", "..", "saved", "5d6520ef.json")


def _rich_payload():
    """Synthetic payload exercising every optional field the converter models."""
    ft = {"name": "B_BMS", "top": "B_BMS", "nodes": [
        {"id": "S1", "basic": True, "param_ref": "S1"},
        {"id": "S2", "basic": True, "param_ref": "S2"},
        {"id": "S3", "basic": True, "param_ref": "S3"},
        {"id": "VOTE", "op": "atleast", "args": ["S1", "S2", "S3"], "k": 2},
        {"id": "LOGIC", "basic": True, "param_ref": "LOGIC"},
        {"id": "B_BMS", "op": "or", "args": ["VOTE", "LOGIC"], "label": "中间事件"},
    ]}
    return {
        "v": 2,
        "etas": [{
            "key": "sc:SC_ISC", "name": "电芯内短路", "renamed": True,
            "model": {
                "initEvent": "电芯内短路", "initFreq": 1.2e-2,
                "functionalEvents": [
                    {"id": "B_OFFGAS", "label": "早期离气探测+联动", "failProb": 0.05,
                     "source": "Sandia 2024", "grade": "D", "evidence": "N=22 k=0"},
                    {"id": "B_BMS", "label": "BMS 切断", "failProb": 0.1, "linkFt": "B_BMS"},
                    {"id": "B_GONE", "failProb": 0.2, "linkFt": "MISSING_TREE"},
                ],
                "root": {"kind": "branch", "feId": "B_OFFGAS",
                         "success": {"kind": "leaf", "consequence": "C1"},
                         "failure": {"kind": "branch", "feId": "B_BMS",
                                     "success": {"kind": "leaf", "consequence": "K1"},
                                     "failure": {"kind": "leaf", "consequence": "C9X"}}},
                "consequences": [
                    {"id": "C1", "desc": "单体安全排气", "level": "C1"},
                    {"id": "K1", "desc": "自定义局部事件", "level": "C2"},
                ],
                "consequenceDefs": {"C1": "旧字段"},
                "initFreqSource": "product",
                "product": {"cellsPerPack": 104, "packsPerSystem": 20, "cellFailureRate": 1e-7},
            },
            "fts": {"model_data": {"parameters": [
                        {"id": "S1", "kind": "probability", "value": 0.02, "source": "exida 2020(/demand)"},
                        {"id": "S2", "kind": "probability", "value": 0.02},
                        {"id": "S3", "kind": "probability", "value": 0.02, "custom_tag": 7},
                        {"id": "LOGIC", "kind": "probability", "value": 0.01},
                    ]},
                    "fault_trees": [ft],
                    "ccf_groups": [{"id": "G_SENS", "members": ["S1", "S2", "S3"],
                                    "model": "beta", "factors": {"beta": 0.1}}]},
            "pfds": {"B_BMS": 0.0112},
        }],
        "activeKey": "sc:SC_ISC",
        "checkedKeys": {"sc:SC_ISC": True, "ghost": False},
        "userFts": {"model_data": {"parameters": [{"id": "U1", "kind": "probability", "value": 0.3}]},
                    "fault_trees": [{"name": "我的树", "top": "G1", "nodes": [
                        {"id": "U1", "basic": True, "param_ref": "U1"},
                        {"id": "G1", "op": "or", "args": ["U1"]}]}]},
        "fmeaRows": [{"id": "r1", "S": 8, "O": 3, "D": 4}],
        "fmeaMapping": {"componentDefaultS": 6},
    }


def test_real_archive_roundtrip_lossless():
    with open(_SAVED, encoding="utf-8") as f:
        payload = json.load(f)["payload"]
    doc, sidecar = to_canonical(copy.deepcopy(payload), PUUID)
    assert to_v2(doc, sidecar) == payload


def test_rich_payload_roundtrip_lossless():
    payload = _rich_payload()
    doc, sidecar = to_canonical(copy.deepcopy(payload), PUUID)
    assert to_v2(doc, sidecar) == payload


def test_canonical_carries_fts_semantics():
    doc, _ = to_canonical(_rich_payload(), PUUID)
    t = doc.event_trees[0]
    ft = next(x for x in t.fault_trees if x.ref == "B_BMS")
    assert len(ft.nodes) == 6
    vote = next(n for n in ft.nodes if n.ref == "VOTE")
    assert vote.op == "atleast" and vote.k == 2 and len(vote.args) == 3
    assert t.ccf_groups[0].members == ["S1", "S2", "S3"]
    # linkFt to a missing tree stays raw (not silently resolved)
    gone = next(fe for fe in t.functional_events if fe.ref == "B_GONE")
    assert gone.linked_fault_tree is None


def test_hash_deterministic_and_content_addressed():
    p = _rich_payload()
    d1, _ = to_canonical(copy.deepcopy(p), PUUID)
    d2, _ = to_canonical(copy.deepcopy(p), PUUID)
    assert d1.model_dump() == d2.model_dump()
    assert content_hash(d1) == content_hash(d2)
    # timestamps are volatile: stamping must not change the hash
    d2.project.modified_at = "2026-07-08T00:00:00Z"
    assert content_hash(d1) == content_hash(d2)
    # content change must change the hash
    p2 = _rich_payload()
    p2["etas"][0]["model"]["functionalEvents"][0]["failProb"] = 0.06
    d3, _ = to_canonical(p2, PUUID)
    assert content_hash(d3) != content_hash(d1)


def test_sidecarless_reconstruction_is_semantic():
    payload = _rich_payload()
    doc, _ = to_canonical(copy.deepcopy(payload), PUUID)
    v2 = to_v2(doc, None)
    m = v2["etas"][0]["model"]
    assert m["initEvent"] == "电芯内短路"
    assert m["initFreq"] == 1.2e-2
    assert m["functionalEvents"][1]["linkFt"] == "B_BMS"
    # sidecarless is canonical-normal: materialized consequences included
    assert {c["id"] for c in m["consequences"]} == {"C1", "K1", "C9X"}
    names = {f["name"] for f in v2["etas"][0]["fts"]["fault_trees"]}
    assert names == {"B_BMS"}
    # regenerated fts params exclude minted bookkeeping params
    ids = {p["id"] for p in v2["etas"][0]["fts"]["model_data"]["parameters"]}
    assert ids == {"S1", "S2", "S3", "LOGIC"}


def test_init_provenance_survives_roundtrip():
    """4c2:模板初因溯源(source/grade/evidence)进频率参数 provenance 块,无损往返。"""
    payload = {"v": 2, "etas": [{"key": "t", "name": "T", "model": {
        "initEvent": "IE", "initFreq": 5e-3, "initFreqSource": "manual",
        "initSource": "DNV GL McMicken 2020", "initGrade": "D", "initEvidence": "折算系统级频率",
        "functionalEvents": [{"id": "FE1", "label": "b", "failProb": 0.1}],
        "root": {"kind": "branch", "feId": "FE1",
                 "success": {"kind": "leaf", "consequence": "C1"},
                 "failure": {"kind": "leaf", "consequence": "C2"}}},
        "fts": {"model_data": {"parameters": []}, "fault_trees": []}, "pfds": {}}],
        "activeKey": "t", "checkedKeys": {"t": True}}
    doc, sc = to_canonical(copy.deepcopy(payload), PUUID)
    m = to_v2(doc, sc)["etas"][0]["model"]
    assert m["initSource"] == "DNV GL McMicken 2020"
    assert m["initGrade"] == "D"
    assert m["initEvidence"] == "折算系统级频率"
    # sidecarless(canonical-normal 语义再生)同样保留
    assert to_v2(doc, None)["etas"][0]["model"]["initSource"] == "DNV GL McMicken 2020"
    # 不同溯源 → 不同内容哈希(provenance 是内容,参与哈希)
    p2 = copy.deepcopy(payload)
    p2["etas"][0]["model"]["initGrade"] = "C"
    assert content_hash(to_canonical(p2, PUUID)[0]) != content_hash(doc)
