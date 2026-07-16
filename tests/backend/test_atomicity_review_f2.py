"""F2(三方评审 EB-03 + EB-07):评审状态机原子转换 + 保存 CAS 事务化 + 文件原子写。

EB-03:sign/return 曾为 SELECT-检查后无条件 UPDATE——退回先提交、持旧读的签发
仍能成功(review.return → review.sign 的非法审计序)。修后 UPDATE 带
state='in_review' 谓词 + rowcount 仲裁,并发下恰一方成功。
EB-07:base_version_hash 检查、legacy 文件写、canonical 写三段分离——两个同 base
的过期保存可同时 200;v2 载荷 canonical 失败被静默吞;文件写非原子。
"""
import json
import threading

import pytest
from fastapi.testclient import TestClient

from backend import storage, store
from backend.app import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def _tmp_stores(tmp_path, monkeypatch):
    store.configure(str(tmp_path / "evidence.db"))
    monkeypatch.setattr(storage, "_DIR", str(tmp_path / "saved"))
    yield


def _payload(pfd=0.1):
    return {"v": 2,
            "etas": [{"key": "t", "name": "T",
                      "model": {"initEvent": "IE", "initFreq": 0.001,
                                "functionalEvents": [{"id": "FE1", "failProb": pfd}],
                                "root": {"kind": "branch", "feId": "FE1",
                                         "success": {"kind": "leaf", "consequence": "C1"},
                                         "failure": {"kind": "leaf", "consequence": "C2"}}},
                      "fts": {"model_data": {"parameters": []}, "fault_trees": []},
                      "pfds": {}}],
            "activeKey": "t", "checkedKeys": {"t": True}}


def _project_with_version(sid="aa11", name="并发项目"):
    v = store.save_workspace_version(sid, name, _payload())
    return sid, v["project_uuid"], v


# ── EB-03:评审状态机 ─────────────────────────────────────────────────────────

def test_sequential_sign_after_return_blocked():
    _, puuid, v = _project_with_version("ab01")
    store.submit_review(puuid, v["id"])
    store.return_review(puuid, v["id"], note="先退回")
    with pytest.raises(store.ReviewStateError):
        store.sign_review(puuid, v["id"])


def test_concurrent_sign_vs_return_exactly_one_wins():
    # 时序探针(B5-P3 同法):Barrier 对齐后并发 sign/return ×20 轮——
    # 每轮恰一方成功,且终态与成功方一致、最后一条审计与终态一致。
    for i in range(20):
        _, puuid, v = _project_with_version(f"ac{i:02x}")
        store.submit_review(puuid, v["id"])
        barrier = threading.Barrier(2)
        outcome: dict[str, BaseException | None] = {}

        def _run(name, fn):
            barrier.wait()
            try:
                fn(puuid, v["id"], note=name) if name == "return" else fn(puuid, v["id"])
                outcome[name] = None
            except BaseException as e:          # noqa: BLE001 —— 探针要收全部异常
                outcome[name] = e

        ts = [threading.Thread(target=_run, args=("sign", store.sign_review)),
              threading.Thread(target=_run, args=("return", store.return_review))]
        for t in ts:
            t.start()
        for t in ts:
            t.join()
        winners = [k for k, e in outcome.items() if e is None]
        assert len(winners) == 1, f"round {i}: winners={winners} outcome={outcome}"
        st = store.review_for_version(puuid, v["id"])["state"]
        assert st == {"sign": "signed", "return": "returned"}[winners[0]]
        losers = [e for e in outcome.values() if e is not None]
        assert all(isinstance(e, store.ReviewStateError) for e in losers), losers


# ── EB-07:保存 CAS 事务化 ────────────────────────────────────────────────────

def test_save_cas_concurrent_same_base_exactly_one_succeeds():
    sid, puuid, v1 = _project_with_version("ad01")
    base = v1["content_hash"]
    barrier = threading.Barrier(2)
    results: dict[int, object] = {}

    def _save(k, pfd):
        barrier.wait()
        try:
            results[k] = store.save_workspace_version_cas(
                sid, "并发项目", _payload(pfd=pfd), base_version_hash=base)
        except BaseException as e:              # noqa: BLE001
            results[k] = e

    ts = [threading.Thread(target=_save, args=(1, 0.2)),
          threading.Thread(target=_save, args=(2, 0.3))]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    ok = [r for r in results.values() if isinstance(r, dict)]
    conflicts = [r for r in results.values() if isinstance(r, store.VersionConflictError)]
    assert len(ok) == 1 and len(conflicts) == 1, results
    assert conflicts[0].server_hash == ok[0]["content_hash"]


def test_save_cas_stale_base_rejected_sequentially():
    sid, puuid, v1 = _project_with_version("ad02")
    store.save_workspace_version_cas(sid, "并发项目", _payload(pfd=0.2),
                                     base_version_hash=v1["content_hash"])
    with pytest.raises(store.VersionConflictError):
        store.save_workspace_version_cas(sid, "并发项目", _payload(pfd=0.3),
                                         base_version_hash=v1["content_hash"])


# ── EB-07:端点分型——v2 失败响亮、非 v2 显式打标 ─────────────────────────────

def test_v2_payload_canonicalization_failure_is_422_not_silent_200():
    bad = {"v": 2, "etas": [{"key": "e1"}]}       # v2 形但缺必要字段 → 规范化失败
    r = client.post("/api/saved", json={"name": "坏载荷", "payload": bad})
    assert r.status_code == 422, r.text
    assert "无法规范化" in r.json()["detail"]


def test_non_v2_payload_saved_with_explicit_skip_flag():
    r = client.post("/api/saved", json={"name": "旧格式", "payload": {"foo": 1}})
    assert r.status_code == 200
    body = r.json()
    assert body.get("canonical_skipped") == "non_v2_payload"
    assert "version" not in body                   # 旧响应形状保持(此前吞异常后也无该键)


def test_v2_payload_endpoint_writes_version_and_file():
    r = client.post("/api/saved", json={"name": "正路", "payload": _payload()})
    assert r.status_code == 200
    body = r.json()
    assert body["version"]["content_hash"]
    assert json.load(open(storage._path(body["id"])))["payload"]["v"] == 2


# ── EB-07:legacy 文件原子写 ──────────────────────────────────────────────────

def test_file_write_failure_leaves_previous_content_intact(monkeypatch):
    rec = storage.save_workspace("原始", {"v": 1, "marker": "old"})
    sid = rec["id"]
    orig = json.load(open(storage._path(sid)))
    assert orig["payload"]["marker"] == "old"

    def _boom(*a, **k):
        raise OSError("disk full mid-write")

    with monkeypatch.context() as m:               # 不用 undo():会连同夹具的 _DIR 补丁一起撤
        m.setattr(storage.json, "dump", _boom)
        with pytest.raises(OSError):
            storage.save_workspace("原始", {"v": 1, "marker": "new"}, sid=sid)
    after = json.load(open(storage._path(sid)))    # 旧内容必须完好(此前直写会截断损毁)
    assert after["payload"]["marker"] == "old"
