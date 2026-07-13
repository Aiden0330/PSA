"""Phase 5 blindspot probe P1(2026-07-10 报告 §④)固化为永久回归。

原始问题:两人并行保存同一项目会不会丢数据?探针给出的事实底座是 D-P5-4
(乐观保存 + 冲突提示,而非 check-out 锁)得以拍板的依据——这里把该事实钉成测试:

- 工作区头(/api/saved 的 payload blob)是 LWW:两个都不带 base_version_hash 的客户端
  依次保存,后者的内容成为"当前"(前者的编辑从工作区头视角消失)。
- 但版本库(ADR-2 内容寻址)不是 LWW:两次保存各自的内容都以独立版本存在,
  前者版本仍可通过 /api/projects/{puuid}/versions/{vid}?include_doc=true 完整取回。
- 结论:不丢数据,但会互相看不见——这正是 D-P5-4 加 409 冲突检测(带 base_version_hash
  时)的动机;不带 base 时(如本探针模拟的"互不知情的两个客户端")仍是这里验证的 LWW 语义。
"""
from fastapi.testclient import TestClient

from backend import store
from backend.app import app
from backend.canonical import to_v2
from backend.canonical.models import ProjectDocument

client = TestClient(app)


def _payload(fail: float) -> dict:
    return {"v": 2,
            "etas": [{"key": "t", "name": "T",
                      "model": {"initEvent": "IE", "initFreq": 0.001,
                                "functionalEvents": [{"id": "FE1", "failProb": fail}],
                                "root": {"kind": "branch", "feId": "FE1",
                                         "success": {"kind": "leaf", "consequence": "C1"},
                                         "failure": {"kind": "leaf", "consequence": "C2"}}},
                      "fts": {"model_data": {"parameters": []}, "fault_trees": []},
                      "pfds": {}}],
            "activeKey": "t", "checkedKeys": {"t": True}}


def test_concurrent_saves_without_base_hash_overwrite_head_but_keep_both_versions(tmp_path, monkeypatch):
    import backend.storage as storage
    monkeypatch.setattr(storage, "_DIR", str(tmp_path / "saved"))

    # 客户端 A 首存(建立项目);客户端 B 稍后读到同一 sid(互不知情的并行编辑起点)
    r_a1 = client.post("/api/saved", json={"name": "P", "payload": _payload(0.10)}).json()
    sid = r_a1["id"]
    puuid = r_a1["version"]["project_uuid"]

    # A 编辑并保存(不带 base_version_hash —— 模拟未升级到 B4 前端的客户端,或有意强制覆盖)
    r_a2 = client.post("/api/saved", json={"id": sid, "name": "P", "payload": _payload(0.15)}).json()
    hash_a = r_a2["version"]["content_hash"]

    # B 基于更早内容独立编辑,同样不带 base,后保存 —— 工作区头 LWW 覆盖 A 的结果
    r_b1 = client.post("/api/saved", json={"id": sid, "name": "P", "payload": _payload(0.20)}).json()
    hash_b = r_b1["version"]["content_hash"]
    assert hash_b != hash_a

    # 事实①:工作区头 = 最后写入者(A 的编辑从"当前"视角消失)
    head = client.get(f"/api/saved/{sid}").json()
    assert head["payload"]["etas"][0]["model"]["functionalEvents"][0]["failProb"] == 0.20
    assert head["version_hash"] == hash_b

    # 事实②:版本库两个版本都在,A 的内容仍可精确取回(不是"丢了",是"看不见")
    versions = store.list_versions(puuid)
    hashes = {v["content_hash"] for v in versions}
    assert {hash_a, hash_b} <= hashes
    a_version_id = next(v["id"] for v in versions if v["content_hash"] == hash_a)
    assert client.get(f"/api/projects/{puuid}/versions/{a_version_id}?include_doc=true").status_code == 200
    # 逐位回收(ADR-1 无损往返,同 test_store.py::test_stored_pair_roundtrips_to_original_payload)
    raw_doc, raw_sidecar = store.get_version_raw(puuid, a_version_id)
    recovered = to_v2(ProjectDocument.model_validate(raw_doc), raw_sidecar)
    assert recovered["etas"][0]["model"]["functionalEvents"][0]["failProb"] == 0.15

    # 事实③:409 检测正是为堵住①而生 —— B 若带上(过期的)base 会被拦下,而非静默覆盖 A
    r_late = client.post("/api/saved", json={"id": sid, "name": "P", "payload": _payload(0.99),
                                              "base_version_hash": hash_a})
    assert r_late.status_code == 409
