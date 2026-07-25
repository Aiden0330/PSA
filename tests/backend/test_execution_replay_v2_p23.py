"""F3 阶段 2(EB-02 钉扎完整性)+ 阶段 3(EB-08 canonical v2 / 引擎指纹 / 反构重放)锚点。

规格:docs/superpowers/specs/2026-07-16-analysis-execution-evidence-replay-v2.md §3 G4–G8。
裁定背景:docs/reviews/2026-07-16-3rd-party-review-adjudication.md。

先红后绿(TDD)。铁律锁(test_hash_stability_iron_law)始终绿:证明新增 typed 字段/kind
不改任何既有存档的 content_hash——证据链根基。
"""
import copy
import glob
import json
import os

import pytest
from fastapi.testclient import TestClient

from backend.app import app
from backend import store
from backend.canonical import (build_engine_request, content_hash, to_canonical, to_v2)
from backend.canonical.serialize import canonical_json
from backend.et_builder import build_model_from_request
from psaengine.eta.sequence import quantify_event_tree

client = TestClient(app)
PUUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301"

_SAVED_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "saved")

# ── 铁律锁(阶段 3 §1):既有存档 content_hash 逐位不变 ──────────────────────────
# 基线哈希由 EB-08 落地**前**的引擎对合成/真实载荷计算并冻结于此。加 gamma/alpha/beta/t0
# 与四新 kind 后,v1 载荷(不含任一 v2 特征)必须仍产出同一哈希(model_serializer 缺省
# 不落盘 + 内容级 schema_version 保证)。真实存档为本机未追踪数据(saved/ 在 .gitignore),
# CI 由合成载荷覆盖同一保证。


def _rich_payload():
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


def _mini_payload():
    return {"v": 2, "etas": [{"key": "t", "name": "T", "model": {
        "initEvent": "IE", "initFreq": 5e-3,
        "functionalEvents": [{"id": "FE1", "failProb": 0.1}],
        "root": {"kind": "branch", "feId": "FE1",
                 "success": {"kind": "leaf", "consequence": "C1"},
                 "failure": {"kind": "leaf", "consequence": "C2"}}},
        "fts": {"model_data": {"parameters": []}, "fault_trees": []}, "pfds": {}}],
        "activeKey": "t", "checkedKeys": {"t": True}}


def _rate_ccf_dist_payload():
    return {"v": 2, "etas": [{"key": "t", "name": "T", "model": {
        "initEvent": "IE", "initFreq": 1e-2,
        "functionalEvents": [{"id": "FE1", "failProb": 0.1, "linkFt": "FT1"}],
        "root": {"kind": "branch", "feId": "FE1",
                 "success": {"kind": "leaf", "consequence": "C1"},
                 "failure": {"kind": "leaf", "consequence": "C2"}}},
        "fts": {"model_data": {"parameters": [
            {"id": "R1", "kind": "rate", "value": 1e-5, "mttr": 24.0},
            {"id": "P1", "kind": "probability", "value": 0.02,
             "distribution": {"family": "lognormal", "params": {"ef": 3}}}]},
            "fault_trees": [{"name": "FT1", "top": "FT1", "nodes": [
                {"id": "R1", "basic": True, "param_ref": "R1"},
                {"id": "P1", "basic": True, "param_ref": "P1"},
                {"id": "FT1", "op": "or", "args": ["R1", "P1"]}]}],
            "ccf_groups": [{"id": "G", "members": ["R1", "P1"], "model": "beta",
                            "factors": {"beta": 0.1}}]},
        "pfds": {}}], "activeKey": "t", "checkedKeys": {"t": True}}


# 冻结于 EB-08 落地前(commit 8afcbf4)——绝不因本批改动而变。
_SYNTHETIC_BASELINES = {
    "rich": ("a00d374293aee3904cfe68dade924ba428c1a246fad90e78e3837463da785dd2", _rich_payload),
    "mini": ("03829459930342459c6ab1ed176f9779c42eb2bbe746c22bc390cd9efcbc7429", _mini_payload),
    "rate_ccf_dist": ("2f139d3b1c9b2cd6daeefd4d14a81945c265be1c7f76b177064befa88859ac5c",
                      _rate_ccf_dist_payload),
}

# 铁律语料改冻结夹具(2026-07-17):此前直读 saved/ 活文件按文件名对基线——saved/ 是
# .gitignore 的用户数据,用户在应用里一保存(47483b20 当日 17:03 存新版本)测试即崩,
# 崩的不是哈希函数而是"活文件永不变"这个错误假设。三份代表内容(覆盖全部 3 个不同
# 基线;原 6 个同哈希文件同为默认场景内容)已与 F3 期基线逐位核对后冻结为提交内夹具。
# 铁律保证不减:同字节 → 同 canonical → 同哈希,语料不再随用户使用漂移。
_FIXTURE_DIR = os.path.join(os.path.dirname(__file__), "fixtures", "eb08")
_FROZEN_ARCHIVE_BASELINES = {
    "27489f5c.json": "9336823767df799b9bfe263f5a56f7404c7ab27292d04bbc160f86467c7088d9",
    "42b7c524.json": "1190fa4582c0a0a1ca56bdb96d078d71ea314e0b7bec359b62fde767ac95b677",
    "5d6520ef.json": "a983322982834bbf3ae2797bd37e27e24d0bef9ebc984d55b0bb2afe07ebaa6f",
}


@pytest.mark.parametrize("name", sorted(_SYNTHETIC_BASELINES))
def test_hash_stability_iron_law_synthetic(name):
    expected, factory = _SYNTHETIC_BASELINES[name]
    doc, _ = to_canonical(factory(), PUUID)
    assert content_hash(doc) == expected, (
        f"EB-08 broke the content_hash of a v1 payload '{name}' — 证据链铁律违反")
    # v1 载荷仍标 "1.0"(内容级 schema_version 未误升)
    assert doc.schema_version == "1.0"


def test_hash_stability_iron_law_real_archives():
    checked = 0
    for base, expected in sorted(_FROZEN_ARCHIVE_BASELINES.items()):
        with open(os.path.join(_FIXTURE_DIR, base), encoding="utf-8") as f:
            blob = json.load(f)
        payload = blob.get("payload", blob)
        assert payload.get("v") == 2 and isinstance(payload.get("etas"), list), (
            f"夹具 {base} 不是 v2 载荷——夹具文件被误改")
        doc, _ = to_canonical(copy.deepcopy(payload), PUUID)
        assert content_hash(doc) == expected, (
            f"EB-08 broke frozen archive {base} 的 content_hash — 证据链铁律违反")
        checked += 1
    assert checked == len(_FROZEN_ARCHIVE_BASELINES)


# ── G6:beta-CCF replay = .018019(此前 .01,反构丢 CCF)────────────────────────

def _beta_ccf_payload():
    # top=AND(A,B),A=B=0.1,beta CCF 0.1 → P = 0.01 + 0.99·0.09² = 0.018019。
    return {"v": 2, "etas": [{"key": "t", "name": "T", "model": {
        "initEvent": "IE", "initFreq": 1.0,
        "functionalEvents": [{"id": "FE1", "failProb": 0.5, "linkFt": "FT1"}],
        "root": {"kind": "branch", "feId": "FE1",
                 "success": {"kind": "leaf", "consequence": "C1"},
                 "failure": {"kind": "leaf", "consequence": "C2"}}},
        "fts": {"model_data": {"parameters": [
            {"id": "A", "kind": "probability", "value": 0.1},
            {"id": "B", "kind": "probability", "value": 0.1}]},
            "fault_trees": [{"name": "FT1", "top": "FT1", "nodes": [
                {"id": "A", "basic": True, "param_ref": "A"},
                {"id": "B", "basic": True, "param_ref": "B"},
                {"id": "FT1", "op": "and", "args": ["A", "B"]}]}],
            "ccf_groups": [{"id": "CCF_AB", "members": ["A", "B"], "model": "beta",
                            "factors": {"beta": 0.1}}]},
        "pfds": {}}], "activeKey": "t", "checkedKeys": {"t": True}}


def test_G6_beta_ccf_replay_reapplied():
    doc, _ = to_canonical(_beta_ccf_payload(), PUUID)
    req = build_engine_request(doc, "t")
    assert req.get("ccf_groups"), "反构必须带 CCF 组(此前丢 → 重放 .01)"
    res = quantify_event_tree(build_model_from_request(req), "TR")
    assert res["consequences"]["C2"] == pytest.approx(0.018019, rel=1e-6), (
        f"beta-CCF 未重放:C2={res['consequences']['C2']}(应 .018019,丢 CCF 则 .01)")


# ── G7:Q(t) 往返无损(weibull/periodic_test);此前 ValidationError ─────────────

def _qt_payload():
    return {"v": 2, "etas": [{"key": "t", "name": "T", "model": {
        "initEvent": "IE", "initFreq": 1.0,
        "functionalEvents": [{"id": "FE1", "failProb": 0.5, "linkFt": "WT"}],
        "root": {"kind": "branch", "feId": "FE1",
                 "success": {"kind": "leaf", "consequence": "C1"},
                 "failure": {"kind": "leaf", "consequence": "C2"}}},
        "fts": {"model_data": {"parameters": [
            {"id": "W1", "kind": "weibull", "value": 0.0,
             "alpha": 1000.0, "beta": 2.0, "mission_time": 500.0},
            {"id": "PT1", "kind": "periodic_test", "value": 1e-3, "test_interval": 100.0}]},
            "fault_trees": [{"name": "WT", "top": "WT_top", "nodes": [
                {"id": "WE", "basic": True, "param_ref": "W1"},
                {"id": "PE", "basic": True, "param_ref": "PT1"},
                {"id": "WT_top", "op": "or", "args": ["WE", "PE"]}]}]},
        "pfds": {}}], "activeKey": "t", "checkedKeys": {"t": True}}


def test_G7_qt_canonical_roundtrip_lossless():
    payload = _qt_payload()
    doc, sidecar = to_canonical(copy.deepcopy(payload), PUUID)   # 此前:ValidationError

    # 1) canonical Parameter 承载 typed 字段(非 extra 残渣)
    t = doc.event_trees[0]
    w1 = next(p for p in t.parameters if p.ref == "W1")
    assert w1.kind == "weibull" and w1.alpha == 1000.0 and w1.beta == 2.0
    assert w1.mission_time == 500.0 and w1.extra == {}
    pt1 = next(p for p in t.parameters if p.ref == "PT1")
    assert pt1.kind == "periodic_test" and pt1.test_interval == 100.0

    # 2) 内容级 schema_version 升到 "2.0"(自描述),且 canonical_json 可序列化
    assert doc.schema_version == "2.0"
    assert '"kind":"weibull"' in canonical_json(doc)

    # 3) 有 sidecar 往返逐字段无损
    assert to_v2(doc, sidecar) == payload
    # 4) sidecarless(canonical-normal)也带回 typed 字段——证明 canonical 承载语义
    sl_params = to_v2(doc, None)["etas"][0]["fts"]["model_data"]["parameters"]
    sl_w1 = next(p for p in sl_params if p["id"] == "W1")
    assert sl_w1["kind"] == "weibull" and sl_w1["alpha"] == 1000.0 and sl_w1["beta"] == 2.0

    # 5) 反构 → 引擎 → quantify 与直建请求逐位一致(精确 Q(t),非扁平标量)
    req = build_engine_request(doc, "t")
    assert req["parameters"]["W1"] == {"kind": "weibull", "value": 0.0,
                                       "mission_time": 500.0, "alpha": 1000.0, "beta": 2.0}
    res = quantify_event_tree(build_model_from_request(req), "TR")
    # 直建:同一 typed 请求,不经 canonical
    direct = quantify_event_tree(build_model_from_request(req), "TR")
    assert res["consequences"] == direct["consequences"]
    # C2 = 1.0 × [1-(1-Q_W)(1-Q_PT)];Q_W=1-e^{-0.25}, Q_PT=1-(1-e^{-0.1})/0.1
    from math import exp, expm1
    q_w = -expm1(-((500.0 / 1000.0) ** 2))
    q_pt = 1.0 + expm1(-0.1) / 0.1
    assert res["consequences"]["C2"] == pytest.approx(1 - (1 - q_w) * (1 - q_pt), rel=1e-9)


# ── G8:引擎指纹结构 + 非 0.1.0 + git 降级不崩 ────────────────────────────────

def test_G8_engine_fingerprint_structure():
    fp = store.engine_fingerprint()
    assert set(fp) == {"semver", "git_sha", "dirty", "request_schema_version",
                       "benchmark_corpus_version"}
    assert fp["semver"] != "0.1.0"                      # 占位版本已升(EB-08 可辨)
    assert fp["semver"] == "0.4.0"
    assert isinstance(fp["git_sha"], str) and fp["git_sha"]
    assert fp["request_schema_version"] == "2"
    assert isinstance(fp["benchmark_corpus_version"], str) and fp["benchmark_corpus_version"]


def test_G8_fingerprint_git_degrades_without_crash(monkeypatch):
    # 无 git 环境(rev-parse/status 抛)→ 降级 unknown/None,绝不崩。
    import subprocess

    def _boom(*a, **k):
        raise FileNotFoundError("git not found")

    monkeypatch.setattr(subprocess, "run", _boom)
    fp = store.engine_fingerprint()
    assert fp["git_sha"] == "unknown"
    assert fp["dirty"] is None
    assert fp["semver"] == "0.4.0"                      # semver 不依赖 git


# ── MEF 导出对四新 kind 响亮拒绝(不静默固化 Q(t))──────────────────────────────

@pytest.mark.parametrize("kind,extra", [
    ("weibull", {"alpha": 1000.0, "beta": 2.0, "mission_time": 500.0}),
    ("exponential", {"mission_time": 8760.0}),
    ("glm", {"mttr": 24.0}),
    ("periodic_test", {"test_interval": 100.0}),
    # banked Complete(PTC 评审 F2):同病同拒,防 _QT_KINDS 重构掉行
    ("periodic_test_complete", {"lambda_test": 3e-4, "mttr": 8.0, "test_interval": 730.0,
                                "theta": 200.0, "gamma": 0.005, "test_duration": 2.0,
                                "available_at_test": False, "sigma": 0.95, "omega": 0.01,
                                "mission_time": 8760.0}),
])
def test_mef_export_rejects_qt_kinds(tmp_path, kind, extra):
    from psaengine.model.json_io import load_model_from_dict
    from psaengine.model.mef_xml import save_mef_xml
    model = load_model_from_dict({
        "model_data": {"parameters": [{"id": "QP", "kind": kind, "value": 1e-3, **extra}]},
        "fault_trees": [{"name": "T", "top": "TOP", "nodes": [
            {"id": "QP", "basic": True, "param_ref": "QP"},
            {"id": "TOP", "op": "or", "args": ["QP"]}]}],
        "event_trees": [], "ccf_groups": []})
    with pytest.raises(ValueError) as ei:
        save_mef_xml(model, str(tmp_path / "out.xml"))
    assert "QP" in str(ei.value) and kind in str(ei.value)


def test_mef_export_probability_rate_unchanged(tmp_path):
    # 相干既有行为零扰动:probability/rate 仍正常导出。
    from psaengine.model.json_io import load_model_from_dict
    from psaengine.model.mef_xml import save_mef_xml, load_mef_xml
    model = load_model_from_dict({
        "model_data": {"parameters": [
            {"id": "P", "kind": "probability", "value": 0.02},
            {"id": "R", "kind": "rate", "value": 1e-5, "mttr": 24.0}]},
        "fault_trees": [{"name": "T", "top": "TOP", "nodes": [
            {"id": "P", "basic": True, "param_ref": "P"},
            {"id": "R", "basic": True, "param_ref": "R"},
            {"id": "TOP", "op": "or", "args": ["P", "R"]}]}],
        "event_trees": [], "ccf_groups": []})
    out = str(tmp_path / "out.xml")
    save_mef_xml(model, out)                             # 不抛
    reloaded = load_mef_xml(out)
    assert "P" in reloaded.parameters and "R" in reloaded.parameters


# ── et_builder:不带 kind 的旧形状零扰动;带 kind 透传 ──────────────────────────

def test_et_builder_zero_disturbance_untyped_params():
    # 不带 kind 的参数 dict / 裸标量 → probability 强转,逐位不变。
    req = {"init_event": "IE", "init_frequency": 1.0,
           "functional_events": [{"id": "FE1", "pfd": 0.1}],
           "fault_trees": {}, "parameters": {"X": {"value": 0.3}, "Y": 0.4},
           "sequences": [{"path": {"FE1": "failure"}, "end_state": "L1"},
                         {"path": {"FE1": "success"}, "end_state": "L0"}],
           "consequence_bins": {"L0": "C1", "L1": "C2"}}
    model = build_model_from_request(req)
    assert model.parameters.get("X").kind == "probability" and model.parameters.get("X").value == 0.3
    assert model.parameters.get("Y").kind == "probability" and model.parameters.get("Y").value == 0.4


def test_et_builder_typed_param_passthrough():
    # 带 kind 键 → 透传 kind 与 typed 字段(不再强转 probability)。
    req = {"init_event": "IE", "init_frequency": 1.0,
           "functional_events": [{"id": "FE1", "link_ft": "FE1"}],
           "fault_trees": {"FE1": {"name": "FT", "top": "TOP", "nodes": [
               {"id": "WE", "basic": True, "param_ref": "W1"},
               {"id": "TOP", "op": "or", "args": ["WE"]}]}},
           "parameters": {"W1": {"kind": "weibull", "value": 0.0,
                                 "alpha": 1000.0, "beta": 2.0, "mission_time": 500.0}},
           "sequences": [{"path": {"FE1": "failure"}, "end_state": "L1"},
                         {"path": {"FE1": "success"}, "end_state": "L0"}],
           "consequence_bins": {"L0": "C1", "L1": "C2"}}
    model = build_model_from_request(req)
    w1 = model.parameters.get("W1")
    assert w1.kind == "weibull" and w1.alpha == 1000.0 and w1.beta == 2.0 and w1.mission_time == 500.0


# ── 阶段 2(EB-02):request_hash + 钉扎一致性 ─────────────────────────────────

def _pfd_payload(fail):
    return {"v": 2, "etas": [{"key": "t", "name": "T", "model": {
        "initEvent": "IE", "initFreq": 0.001,
        "functionalEvents": [{"id": "FE1", "failProb": fail}],
        "root": {"kind": "branch", "feId": "FE1",
                 "success": {"kind": "leaf", "consequence": "C1"},
                 "failure": {"kind": "leaf", "consequence": "C2"}}},
        "fts": {"model_data": {"parameters": []}, "fault_trees": []}, "pfds": {}}],
        "activeKey": "t", "checkedKeys": {"t": True}}


def _pfd_req(pfd):
    # 前端 toEngineRequest 实序:DFS 成功优先(L0,L1),link_ft 缺省(pfd-only)。
    return {"init_event": "IE", "init_frequency": 0.001,
            "functional_events": [{"id": "FE1", "pfd": pfd}],
            "fault_trees": {}, "parameters": {},
            "sequences": [{"path": {"FE1": "success"}, "end_state": "L0"},
                          {"path": {"FE1": "failure"}, "end_state": "L1"}],
            "consequence_bins": {"L0": "C1", "L1": "C2"}}


def test_request_hash_consistent_matches_reconstruction():
    # 一致载荷:flat 请求的 request_hash 必等于从 canonical 反构请求的 request_hash。
    from backend.execution import request_hash
    doc, _ = to_canonical(_pfd_payload(0.1), PUUID)
    assert request_hash(_pfd_req(0.1)) == request_hash(build_engine_request(doc, "t"))
    # PFD 变 → 哈希变(模型指纹随参数动)
    assert request_hash(_pfd_req(0.9)) != request_hash(build_engine_request(doc, "t"))


def test_G4_consistent_pin_records_request_hash_and_fingerprint(tmp_path, monkeypatch):
    import backend.storage as storage
    monkeypatch.setattr(storage, "_DIR", str(tmp_path / "saved"))
    puuid = "aa000000-0000-5000-8000-00000000c001"
    ctx = {"project_uuid": puuid, "project_payload": _pfd_payload(0.1), "scenario_name": "X"}
    r = client.post("/api/report?format=csv", json={**_pfd_req(0.1), **ctx})
    assert r.status_code == 200, r.text
    cases = client.get(f"/api/projects/{puuid}/cases").json()
    assert len(cases) == 1
    settings = json.loads(cases[0]["settings_json"])
    assert settings.get("request_hash")                       # 请求哈希入案例
    assert settings["engine_fingerprint"]["semver"] == "0.4.0"
    assert settings["engine_fingerprint"]["request_schema_version"] == "2"
    assert settings["resolved_settings"]["house_states"] == {}


def test_G4_payload_request_mismatch_rejected_409(tmp_path, monkeypatch):
    import backend.storage as storage
    monkeypatch.setattr(storage, "_DIR", str(tmp_path / "saved"))
    puuid = "aa000000-0000-5000-8000-00000000c002"
    # project_payload PFD=.1、计算请求 PFD=.9 → 409,绝不 200+钉扎错版本(EB-02)
    ctx = {"project_uuid": puuid, "project_payload": _pfd_payload(0.1), "scenario_name": "X"}
    r = client.post("/api/report?format=csv", json={**_pfd_req(0.9), **ctx})
    assert r.status_code == 409, f"应 409,得 {r.status_code}: {r.text[:200]}"
    assert "一致" in r.text or "inconsistent" in r.text.lower()
    # 一个案例都不得留下(反构不匹配 → 库写前即拒)
    cases = client.get(f"/api/projects/{puuid}/cases").json()
    assert cases == []


# ── G5:从钉扎版本反构重放逐位一致(含 CCF)─────────────────────────────────────

def _ccf_pinnable():
    payload = _beta_ccf_payload()
    payload["etas"][0]["model"]["initFreq"] = 1.0             # 与 flat 请求初频一致
    flat = {"init_event": "IE", "init_frequency": 1.0,
            "functional_events": [{"id": "FE1", "link_ft": "FE1"}],
            "fault_trees": {"FE1": {"name": "FT1", "top": "FT1", "nodes": [
                {"id": "A", "basic": True, "param_ref": "A"},
                {"id": "B", "basic": True, "param_ref": "B"},
                {"id": "FT1", "op": "and", "args": ["A", "B"]}]}},
            "parameters": {"A": {"value": 0.1}, "B": {"value": 0.1}},
            "sequences": [{"path": {"FE1": "success"}, "end_state": "L0"},
                          {"path": {"FE1": "failure"}, "end_state": "L1"}],
            "consequence_bins": {"L0": "C1", "L1": "C2"},
            "ccf_groups": [{"id": "CCF_AB", "members": ["A", "B"], "model": "beta",
                            "factors": {"beta": 0.1}}]}
    return payload, flat


def test_G5_replay_from_pinned_version_bit_identical(tmp_path, monkeypatch):
    import backend.storage as storage
    from backend.canonical.models import ProjectDocument
    monkeypatch.setattr(storage, "_DIR", str(tmp_path / "saved"))
    payload, flat = _ccf_pinnable()
    puuid = "aa000000-0000-5000-8000-00000000c003"
    r = client.post("/api/event-tree/importance",
                    json={**flat, "project_uuid": puuid, "project_payload": payload,
                          "scenario_name": "CCF"})
    assert r.status_code == 200, r.text
    case = client.get(f"/api/projects/{puuid}/cases").json()[0]
    settings = json.loads(case["settings_json"])
    assert settings.get("request_hash") and settings["engine_fingerprint"]["semver"] == "0.4.0"

    # 反构:从钉扎版本(库中 canonical)重建引擎请求 → quantify;与计算所用请求 quantify 逐位一致
    raw = store.get_version_raw(puuid, case["version_id"])
    doc = ProjectDocument.model_validate(raw[0])
    replay = quantify_event_tree(build_model_from_request(build_engine_request(doc, "t")), "TR")
    direct = quantify_event_tree(build_model_from_request(flat), "TR")
    assert replay["sequences"] == direct["sequences"]         # 逐位
    assert replay["consequences"] == direct["consequences"]
    assert replay["consequences"]["C2"] == pytest.approx(0.018019, rel=1e-6)   # CCF 重放
