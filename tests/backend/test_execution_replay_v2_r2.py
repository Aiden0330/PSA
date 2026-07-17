"""F3 收口二轮锚点:engine-reviewer F-1..F-4 + domain-reviewer D-1..D-7 修复锁。

裁定:docs/reviews/2026-07-16-3rd-party-review-adjudication.md(落地台账·收口二轮行)。
先红后绿(TDD):本文件在 620299a(阶段 2)上全红,证明四缺陷存在;修复后转绿。

口径(协调者裁决,规格 §2.3 附录):
- request_hash = **语义投影白名单**(与 et_builder 消费面同源),不再黑名单+去空。
  label/name 等呈现字段天然出局(F-2 P1);param_ref 自引用规范化;数字统一 float(P6)。
- boundary_condition_sets(命名集**定义**)是模型内容 → 入指纹 + 入 canonical(F-1/D-1);
  前端仅在选中时随请求携带 → 反构侧生成带/不带定义双变体(未选中时定义对本次计算惰性)。
- 集成 LFT:ie 块语义(树 + typed 参数)入指纹,init_frequency 标量(被引擎忽略)出局;
  反构侧按 withIeFaultTree 同法则(freq_source=ft + __init__ 树 + ie 独占参数分流)生成
  集成变体 → 单树集成钉扎转为哈希核验(F-3)。
- pin_binding 显式标记:request_hash_verified / recorded_only(checked_set)——绑定强度
  在案例与页脚可见(D-2)。
- typed 键提升按 kind 门控:gamma/alpha/beta/t0 仅当 kind∈{exponential,glm,weibull,
  periodic_test} 才离开 extra 残渣(F-4 铁律:v1 kind 参数带杂散同名键的存档逐位不变)。
"""
import json

import pytest
from fastapi.testclient import TestClient

from backend.app import app
from backend import store
from backend.canonical import build_engine_request, content_hash, to_canonical, to_v2
from backend.et_builder import build_model_from_request
from backend.execution import request_hash
from psaengine.eta.sequence import quantify_event_tree

client = TestClient(app)
PUUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301"


def _payload(fts, model_extra=None, init_freq=1.0):
    m = {"initEvent": "IE", "initFreq": init_freq,
         "functionalEvents": [{"id": "FE1", "failProb": 0.5, "linkFt": "FT1"}],
         "root": {"kind": "branch", "feId": "FE1",
                  "success": {"kind": "leaf", "consequence": "C1"},
                  "failure": {"kind": "leaf", "consequence": "C2"}}}
    m.update(model_extra or {})
    return {"v": 2, "etas": [{"key": "t", "name": "T", "model": m, "fts": fts, "pfds": {}}],
            "activeKey": "t", "checkedKeys": {"t": True}}


def _flat(fault_tree, parameters, extra=None, init_freq=1.0):
    """新前端 toEngineRequest 实际排放形:DFS 成功优先 L0/L1、挂树逐字(含 label)、
    probability 参数 {value}、typed kind 参数带 kind+字段。"""
    req = {"init_event": "IE", "init_frequency": init_freq,
           "functional_events": [{"id": "FE1", "link_ft": "FE1"}],
           "fault_trees": {"FE1": fault_tree},
           "parameters": parameters,
           "sequences": [{"path": {"FE1": "success"}, "end_state": "L0"},
                         {"path": {"FE1": "failure"}, "end_state": "L1"}],
           "consequence_bins": {"L0": "C1", "L1": "C2"}}
    req.update(extra or {})
    return req


# ══ F-2:反构镜像前端(label 门 / 自引用 param_ref / typed 参数 / int 值)══════════

_LABELED_TREE = {"name": "FT1", "top": "TOP", "nodes": [
    {"id": "R1", "basic": True},                                   # param_ref 自引用省略形
    {"id": "P1", "basic": True, "param_ref": "P1"},
    {"id": "TOP", "op": "or", "args": ["R1", "P1"], "label": "中间事件"},   # model.ts addGate 盖章
]}


def _labeled_typed_payload():
    return _payload({"model_data": {"parameters": [
        {"id": "R1", "kind": "rate", "value": 1e-5, "mttr": 24.0},
        {"id": "P1", "kind": "probability", "value": 0.02},
        {"id": "X", "kind": "probability", "value": 1},            # int 值(P6)
    ]}, "fault_trees": [_LABELED_TREE]})


def _labeled_typed_flat():
    return _flat(_LABELED_TREE, {
        "R1": {"kind": "rate", "value": 1e-5, "mttr": 24.0},       # typed 直传(F-2b)
        "P1": {"value": 0.02},
        "X": {"value": 1},
    })


def test_F2_labeled_typed_request_hash_matches_reconstruction():
    doc, _ = to_canonical(_labeled_typed_payload(), PUUID)
    assert request_hash(_labeled_typed_flat()) == request_hash(build_engine_request(doc, "t")), (
        "真实编辑流模型(label 门/自引用 param_ref/typed 参数/int 值)必须哈希一致——"
        "此前 label 即 409 误拒,证据链对标准编辑流失效")


def test_F2_labeled_typed_pin_accepted(tmp_path, monkeypatch):
    import backend.storage as storage
    monkeypatch.setattr(storage, "_DIR", str(tmp_path / "saved"))
    puuid = "aa000000-0000-5000-8000-00000000d001"
    r = client.post("/api/report?format=csv",
                    json={**_labeled_typed_flat(), "project_uuid": puuid,
                          "project_payload": _labeled_typed_payload(), "scenario_name": "R2"})
    assert r.status_code == 200, f"label 门模型钉扎应 200,得 {r.status_code}: {r.text[:300]}"
    settings = json.loads(client.get(f"/api/projects/{puuid}/cases").json()[0]["settings_json"])
    assert settings.get("pin_binding") == "request_hash_verified"


def test_F2b_rate_param_live_path_exact_unavailability():
    # typed 直传后活路径 rate λ=1e-5/MTTR=24 → q=λ·MTTR=2.4e-4(此前压平为 λ → 24× 低估)。
    res = quantify_event_tree(build_model_from_request(_labeled_typed_flat()), "TR")
    q_rate = 1e-5 * 24.0
    expect = 1.0 * (1 - (1 - q_rate) * (1 - 0.02))
    assert res["consequences"]["C2"] == pytest.approx(expect, rel=1e-12), (
        f"C2={res['consequences']['C2']} 应含精确 rate 不可用度(压平则 ≈{1 - (1 - 1e-5) * (1 - 0.02):.3e})")


# ══ F-1/D-1:bc 集定义 = 模型内容(入指纹 + 入 canonical + 逐字落卷)═══════════════

_BC_TREE = {"name": "FT1", "top": "TOP", "nodes": [
    {"id": "A", "basic": True, "param_ref": "A"},
    {"id": "A2", "basic": True, "param_ref": "A2"},
    {"id": "H", "house": True, "state": False},
    {"id": "G", "op": "and", "args": ["A2", "H"]},
    {"id": "TOP", "op": "or", "args": ["A", "G"]},
]}


def _bc_payload(h_state=True):
    return _payload({"model_data": {"parameters": [
        {"id": "A", "kind": "probability", "value": 0.2},
        {"id": "A2", "kind": "probability", "value": 0.5}]},
        "fault_trees": [_BC_TREE],
        "boundary_condition_sets": [{"name": "维护工况", "house_states": {"H": h_state}}]},
        init_freq=1e-3)


def _bc_flat(h_state=True, selected=True):
    extra = {}
    if selected:
        extra = {"boundary_condition_set": "维护工况",
                 "boundary_condition_sets": [{"name": "维护工况", "house_states": {"H": h_state}}]}
    return _flat(_BC_TREE, {"A": {"value": 0.2}, "A2": {"value": 0.5}}, extra, init_freq=1e-3)


def test_F1_bc_definitions_enter_request_hash():
    assert request_hash(_bc_flat(True)) != request_hash(_bc_flat(False)), (
        "同名 bc 集不同定义(H:True vs False)必须不同指纹——定义是模型内容(engine-reviewer F-1 探针)")


def test_F1_bc_definitions_enter_canonical_content_hash():
    a, _ = to_canonical(_bc_payload(True), PUUID)
    b, _ = to_canonical(_bc_payload(False), PUUID)
    assert content_hash(a) != content_hash(b), (
        "bc 集定义改动必须改 content_hash——否则同哈希去重钉到旧定义版本(D-1 静默替换窗口)")


def test_F1_bc_pin_consistent_200_and_resolved_verbatim(tmp_path, monkeypatch):
    import backend.storage as storage
    monkeypatch.setattr(storage, "_DIR", str(tmp_path / "saved"))
    puuid = "aa000000-0000-5000-8000-00000000d002"
    r = client.post("/api/report?format=csv",
                    json={**_bc_flat(True), "project_uuid": puuid,
                          "project_payload": _bc_payload(True), "scenario_name": "BC"})
    assert r.status_code == 200, r.text[:300]
    settings = json.loads(client.get(f"/api/projects/{puuid}/cases").json()[0]["settings_json"])
    rs = settings["resolved_settings"]
    assert rs["boundary_condition_set"] == "维护工况"
    assert rs["boundary_condition_sets"] == [{"name": "维护工况", "house_states": {"H": True}}], \
        "集合定义必须逐字落卷(D-1:名字不够,监管方要的是计算时刻的定义)"
    assert rs["boundary_condition_effective"] == {"H": True}
    assert settings.get("pin_binding") == "request_hash_verified"


def test_F1_bc_definition_drift_rejected_409(tmp_path, monkeypatch):
    import backend.storage as storage
    monkeypatch.setattr(storage, "_DIR", str(tmp_path / "saved"))
    puuid = "aa000000-0000-5000-8000-00000000d003"
    # 计算用旧定义(H:False),payload 已改新定义(H:True)→ 定义漂移,拒绝绑定
    r = client.post("/api/report?format=csv",
                    json={**_bc_flat(False), "project_uuid": puuid,
                          "project_payload": _bc_payload(True), "scenario_name": "BC"})
    assert r.status_code == 409, f"bc 定义漂移应 409,得 {r.status_code}: {r.text[:300]}"
    assert client.get(f"/api/projects/{puuid}/cases").json() == []


def test_F1_bc_unselected_pin_still_matches(tmp_path, monkeypatch):
    # 未选中命名集 → 请求不带定义(前端行为),定义对本次计算惰性 → 仍可核验绑定
    import backend.storage as storage
    monkeypatch.setattr(storage, "_DIR", str(tmp_path / "saved"))
    puuid = "aa000000-0000-5000-8000-00000000d004"
    r = client.post("/api/report?format=csv",
                    json={**_bc_flat(selected=False), "project_uuid": puuid,
                          "project_payload": _bc_payload(True), "scenario_name": "BC"})
    assert r.status_code == 200, r.text[:300]
    settings = json.loads(client.get(f"/api/projects/{puuid}/cases").json()[0]["settings_json"])
    assert settings.get("pin_binding") == "request_hash_verified"


def test_F1_bc_replay_from_reconstruction_no_valueerror():
    # 反构携带定义 → 重放按名解析不再 ValueError: unknown boundary condition set
    doc, _ = to_canonical(_bc_payload(True), PUUID)
    req = build_engine_request(doc, "t")
    assert req.get("boundary_condition_sets") == [{"name": "维护工况", "house_states": {"H": True}}]
    replay = quantify_event_tree(build_model_from_request(req), "TR",
                                 boundary_condition_set="维护工况")
    direct = quantify_event_tree(build_model_from_request(_bc_flat(True)), "TR",
                                 boundary_condition_set="维护工况")
    assert replay["consequences"] == direct["consequences"]
    assert replay["consequences"]["C2"] == pytest.approx(1e-3 * 0.6, rel=1e-12)   # A∨(A2∧H=T)


# ══ F-3:集成 LFT 钉扎转为哈希核验(屏障侧 + ie 块语义都绑定)═════════════════════

_IE_TREE = {"name": "__init__", "top": "IE_TOP", "nodes": [
    {"id": "I", "basic": True, "param_ref": "I"},
    {"id": "S", "basic": True, "param_ref": "S"},
    {"id": "IE_TOP", "op": "and", "args": ["I", "S"]}]}
_BARRIER_TREE = {"name": "FT1", "top": "B_TOP", "nodes": [
    {"id": "S", "basic": True, "param_ref": "S"},
    {"id": "X", "basic": True, "param_ref": "X"},
    {"id": "B_TOP", "op": "or", "args": ["S", "X"]}]}


def _lft_payload():
    return _payload({"model_data": {"parameters": [
        {"id": "I", "kind": "frequency", "value": 1e-3},
        {"id": "S", "kind": "probability", "value": 0.2},
        {"id": "X", "kind": "probability", "value": 0.1}]},
        "fault_trees": [_IE_TREE, _BARRIER_TREE]},
        model_extra={"initFreqSource": "ft"}, init_freq=0.001)


def _lft_flat(x=0.1, lam=1e-3):
    # withIeFaultTree 排放形:I 为 ie 独占 → 进块并从映射移除;S 共享 → 留映射。
    # init_frequency 故意 ≠ payload initFreq(集成模式引擎忽略标量初频 → 指纹弃之)。
    return _flat(_BARRIER_TREE, {"S": {"value": 0.2}, "X": {"value": x}},
                 {"ie_fault_tree": {"name": "__init__", "top": "IE_TOP",
                                    "nodes": _IE_TREE["nodes"],
                                    "parameters": [{"id": "I", "kind": "frequency", "value": lam}]}},
                 init_freq=0.0)


def test_F3_integrated_pin_hash_verified(tmp_path, monkeypatch):
    import backend.storage as storage
    monkeypatch.setattr(storage, "_DIR", str(tmp_path / "saved"))
    puuid = "aa000000-0000-5000-8000-00000000d005"
    r = client.post("/api/report?format=csv",
                    json={**_lft_flat(), "project_uuid": puuid,
                          "project_payload": _lft_payload(), "scenario_name": "LFT"})
    assert r.status_code == 200, r.text[:300]
    settings = json.loads(client.get(f"/api/projects/{puuid}/cases").json()[0]["settings_json"])
    assert settings.get("request_hash"), "集成钉扎必须记录请求哈希(此前 None:没记没绑)"
    assert settings.get("pin_binding") == "request_hash_verified"
    assert settings["resolved_settings"]["ie_fault_tree"]["top"] == "IE_TOP"   # D-3 逐字落卷


def test_F3_integrated_barrier_mutation_rejected_409(tmp_path, monkeypatch):
    import backend.storage as storage
    monkeypatch.setattr(storage, "_DIR", str(tmp_path / "saved"))
    puuid = "aa000000-0000-5000-8000-00000000d006"
    # engine-reviewer P4 探针:payload X=.1、计算请求 X=.9 + ie 块 → 此前 200,现在 409
    r = client.post("/api/report?format=csv",
                    json={**_lft_flat(x=0.9), "project_uuid": puuid,
                          "project_payload": _lft_payload(), "scenario_name": "LFT"})
    assert r.status_code == 409, f"集成屏障篡改应 409,得 {r.status_code}: {r.text[:300]}"
    assert client.get(f"/api/projects/{puuid}/cases").json() == []


def test_F3_integrated_ie_mutation_rejected_409(tmp_path, monkeypatch):
    import backend.storage as storage
    monkeypatch.setattr(storage, "_DIR", str(tmp_path / "saved"))
    puuid = "aa000000-0000-5000-8000-00000000d007"
    # ie 块 λ 改 5e-3(payload 1e-3)→ ie 块语义入指纹,同样拒绝
    r = client.post("/api/report?format=csv",
                    json={**_lft_flat(lam=5e-3), "project_uuid": puuid,
                          "project_payload": _lft_payload(), "scenario_name": "LFT"})
    assert r.status_code == 409, f"ie 块篡改应 409,得 {r.status_code}: {r.text[:300]}"


# ══ F-4:typed 键提升按 kind 门控(铁律对杂散键存档成立)═══════════════════════════

def test_F4_stray_numeric_beta_stays_in_extra():
    p = _payload({"model_data": {"parameters": [
        {"id": "P1", "kind": "probability", "value": 0.1, "beta": 0.2}]},   # 用户 CCF beta 注记
        "fault_trees": [{"name": "FT1", "top": "P1t", "nodes": [
            {"id": "P1", "basic": True, "param_ref": "P1"},
            {"id": "P1t", "op": "or", "args": ["P1"]}]}]})
    doc, sidecar = to_canonical(p, PUUID)
    assert doc.schema_version == "1.0", "杂散数值键不得误升 schema 2.0(F-4:假新版本)"
    param = next(x for x in doc.event_trees[0].parameters if x.ref == "P1")
    assert param.beta is None and param.extra.get("beta") == 0.2, \
        "v1 kind 的杂散 beta 必须留 extra 残渣(typed 提升按 kind 门控)——否则改哈希"
    assert to_v2(doc, sidecar) == p                       # 逐字往返


def test_F4_stray_nonnumeric_key_no_validation_error():
    p = _payload({"model_data": {"parameters": [
        {"id": "P1", "kind": "probability", "value": 0.1, "beta": "评审注记"}]},
        "fault_trees": [{"name": "FT1", "top": "P1t", "nodes": [
            {"id": "P1", "basic": True, "param_ref": "P1"},
            {"id": "P1t", "op": "or", "args": ["P1"]}]}]})
    doc, sidecar = to_canonical(p, PUUID)                 # 此前 ValidationError → 存档 400 回退
    assert to_v2(doc, sidecar) == p


def test_F4_v2_kind_typed_fields_still_lifted():
    # 门控不误伤:weibull 的 alpha/beta 仍提升为 typed 字段(G7 语义)
    p = _payload({"model_data": {"parameters": [
        {"id": "W1", "kind": "weibull", "value": 0.0, "alpha": 1000.0, "beta": 2.0,
         "mission_time": 500.0}]},
        "fault_trees": [{"name": "FT1", "top": "W1t", "nodes": [
            {"id": "W1", "basic": True, "param_ref": "W1"},
            {"id": "W1t", "op": "or", "args": ["W1"]}]}]})
    doc, _ = to_canonical(p, PUUID)
    param = next(x for x in doc.event_trees[0].parameters if x.ref == "W1")
    assert param.alpha == 1000.0 and param.beta == 2.0 and param.extra == {}
    assert doc.schema_version == "2.0"


# ══ staggered CCF:canonical 承载 + 指纹覆盖(收口顺修的老缺口)════════════════════

def _staggered_payload(stag=True):
    ccf = {"id": "G", "members": ["A", "B"], "model": "beta", "factors": {"beta": 0.1}}
    if stag:
        ccf["staggered"] = True
    return _payload({"model_data": {"parameters": [
        {"id": "A", "kind": "probability", "value": 0.1},
        {"id": "B", "kind": "probability", "value": 0.1}]},
        "fault_trees": [{"name": "FT1", "top": "T1", "nodes": [
            {"id": "A", "basic": True, "param_ref": "A"},
            {"id": "B", "basic": True, "param_ref": "B"},
            {"id": "T1", "op": "and", "args": ["A", "B"]}]}],
        "ccf_groups": [ccf]})


def test_staggered_ccf_roundtrips_and_hashes():
    doc, _ = to_canonical(_staggered_payload(True), PUUID)
    assert doc.event_trees[0].ccf_groups[0].staggered is True
    req = build_engine_request(doc, "t")
    assert req["ccf_groups"][0].get("staggered") is True, "staggered 语义此前在 canonical 丢失"
    flat_ccf = [{"id": "G", "members": ["A", "B"], "model": "beta",
                 "factors": {"beta": 0.1}, "staggered": True}]
    flat = _flat({"name": "FT1", "top": "T1", "nodes": [
        {"id": "A", "basic": True, "param_ref": "A"},
        {"id": "B", "basic": True, "param_ref": "B"},
        {"id": "T1", "op": "and", "args": ["A", "B"]}]},
        {"A": {"value": 0.1}, "B": {"value": 0.1}}, {"ccf_groups": flat_ccf})
    assert request_hash(flat) == request_hash(req)
    flat_ns = json.loads(json.dumps(flat))
    del flat_ns["ccf_groups"][0]["staggered"]
    assert request_hash(flat_ns) != request_hash(flat), "staggered 是语义,必须入指纹"
    # 未错开的载荷:canonical 序列化不新增键(铁律由既有基线锁双证)
    doc_ns, _ = to_canonical(_staggered_payload(False), PUUID)
    assert doc_ns.event_trees[0].ccf_groups[0].staggered is None
    assert "staggered" not in json.loads(
        __import__("backend.canonical.serialize", fromlist=["canonical_json"]).canonical_json(doc_ns))["event_trees"][0]["ccf_groups"][0]


# ══ D-4:checked_set 顶层边界条件响亮拒绝(O1 口径对称)═══════════════════════════

def _checked_set_body():
    tree = {"key": "t", "name": "T", "init_event": "IE", "init_frequency": 1e-3,
            "functional_events": [{"id": "FE1", "pfd": 0.1}], "fault_trees": {},
            "parameters": {},
            "sequences": [{"path": {"FE1": "success"}, "end_state": "L0"},
                          {"path": {"FE1": "failure"}, "end_state": "L1"}],
            "consequence_bins": {"L0": "C1", "L1": "C2"}}
    return {"init_event": "IE", "init_frequency": 1e-3, "functional_events": [],
            "fault_trees": {}, "parameters": {}, "sequences": [], "consequence_bins": {},
            "scope": "checked_set", "trees": [tree], "scenario_name": "AGG",
            "samples": 50, "seed": 1}


def test_D4_checked_set_top_level_house_states_rejected():
    r = client.post("/api/report?format=csv",
                    json={**_checked_set_body(), "house_states": {"H": True}})
    assert r.status_code == 400, f"checked_set 顶层 house_states 应 400,得 {r.status_code}"
    r2 = client.post("/api/event-tree/uncertainty",
                     json={**_checked_set_body(), "boundary_condition_set": "维护工况"})
    assert r2.status_code == 400, f"checked_set 顶层 bc 选择应 400,得 {r2.status_code}"


# ══ D-5:house 覆盖重放(版本反构 + resolved_settings 叠加 = 逐位)═════════════════

def test_D5_house_overlay_replay_bitwise(tmp_path, monkeypatch):
    import backend.storage as storage
    from backend.canonical.models import ProjectDocument
    monkeypatch.setattr(storage, "_DIR", str(tmp_path / "saved"))
    puuid = "aa000000-0000-5000-8000-00000000d008"
    payload = _bc_payload(True)
    flat = _bc_flat(selected=False)
    r = client.post("/api/event-tree/importance",
                    json={**flat, "house_states": {"H": True},
                          "project_uuid": puuid, "project_payload": payload,
                          "scenario_name": "HOUSE"})
    assert r.status_code == 200, r.text[:300]
    case = client.get(f"/api/projects/{puuid}/cases").json()[0]
    rs = json.loads(case["settings_json"])["resolved_settings"]
    assert rs["house_states"] == {"H": True}
    raw = store.get_version_raw(puuid, case["version_id"])
    doc = ProjectDocument.model_validate(raw[0])
    replay = quantify_event_tree(build_model_from_request(build_engine_request(doc, "t")),
                                 "TR", house_states=rs["house_states"])
    direct = quantify_event_tree(build_model_from_request(flat), "TR",
                                 house_states={"H": True})
    baseline = quantify_event_tree(build_model_from_request(flat), "TR")
    assert replay["consequences"] == direct["consequences"]          # 逐位
    assert replay["consequences"]["C2"] != baseline["consequences"]["C2"]   # 覆盖真的生效


# ══ D-2/D-6:绑定强度与 git 状态在页脚可见 ═══════════════════════════════════════

def _ev(pin_binding=None, dirty=False):
    ev = {"case_id": 7, "version_hash": "abcd1234ffff", "engine_version": "0.2.0",
          "created_at": "2026-07-16T00:00:00+00:00",
          "engine_fingerprint": {"semver": "0.2.0", "git_sha": "abc1234", "dirty": dirty,
                                 "request_schema_version": "2",
                                 "benchmark_corpus_version": "deadbeef"}}
    if pin_binding is not None:
        ev["pin_binding"] = pin_binding
    return ev


def test_D6_footer_dirty_none_marked_unknown():
    from backend.report_export import _evidence_line
    assert "git状态未知" in _evidence_line(_ev(dirty=None))
    assert "git状态未知" not in _evidence_line(_ev(dirty=False))
    assert "+dirty" in _evidence_line(_ev(dirty=True))


def test_D2_footer_binding_strength_visible():
    from backend.report_export import _evidence_line
    assert "已核验" in _evidence_line(_ev(pin_binding="request_hash_verified"))
    line = _evidence_line(_ev(pin_binding="recorded_only"))
    assert "仅记录" in line and "未经请求一致性核验" in line


def test_D2_checked_set_pin_marked_recorded_only(tmp_path, monkeypatch):
    import backend.storage as storage
    monkeypatch.setattr(storage, "_DIR", str(tmp_path / "saved"))
    puuid = "aa000000-0000-5000-8000-00000000d009"
    payload = _payload({"model_data": {"parameters": []}, "fault_trees": []})
    payload["etas"][0]["model"]["functionalEvents"] = [{"id": "FE1", "failProb": 0.1}]
    r = client.post("/api/report?format=csv",
                    json={**_checked_set_body(), "project_uuid": puuid,
                          "project_payload": payload})
    assert r.status_code == 200, r.text[:300]
    settings = json.loads(client.get(f"/api/projects/{puuid}/cases").json()[0]["settings_json"])
    assert settings.get("pin_binding") == "recorded_only"
    assert settings.get("pin_binding_reason") == "checked_set"
    assert "仅记录" in r.text                                     # CSV 页脚同现


# ══ D-7b:报告正文披露分析设置 ═══════════════════════════════════════════════════

def test_D7_report_body_discloses_analysis_settings(tmp_path, monkeypatch):
    import backend.storage as storage
    monkeypatch.setattr(storage, "_DIR", str(tmp_path / "saved"))
    r = client.post("/api/report?format=csv",
                    json={**_bc_flat(True), "samples": 64, "seed": 9, "scenario_name": "BC"})
    assert r.status_code == 200
    assert "# 分析设置" in r.text
    assert "维护工况" in r.text and "N=64" in r.text
