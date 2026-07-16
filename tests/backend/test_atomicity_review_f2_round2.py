"""F2 冷读对抗审查(2026-07-16)四缺陷回归锁:R1 共享 tmp 并发损毁、
R2 submit returned→in_review 无条件 UPDATE、R3 非法 sid 先写库后撞文件校验、
R4 见 frontend/src/api.saveWorkspace.test.ts(422 不走离线回退)。
"""
import json
import threading

import pytest

from backend import storage, store


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


# ── R1:并发同 sid 保存不得损毁(唯一 tmp)────────────────────────────────────

def test_concurrent_same_sid_saves_never_corrupt():
    sid = "cafe1234"
    storage.save_workspace("初始", {"v": 1, "marker": 0}, sid=sid)
    errors: list = []

    def _save(k):
        for _ in range(30):
            try:
                storage.save_workspace("并发", {"v": 1, "marker": k, "pad": "x" * 5000}, sid=sid)
            except BaseException as e:      # noqa: BLE001
                errors.append(e)

    ts = [threading.Thread(target=_save, args=(k,)) for k in range(4)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    assert not errors, f"concurrent same-sid save raised: {errors[:3]}"
    # 文件必可解析且 marker 完整(非混编):任一写者的完整值
    doc = json.load(open(storage._path(sid)))
    assert doc["payload"]["marker"] in range(4)
    assert doc["payload"]["pad"] == "x" * 5000


# ── R2:submit returned→in_review 条件仲裁 ────────────────────────────────────

def test_submit_from_returned_is_conditional():
    v = store.save_workspace_version("bb01", "R2", _payload())
    puuid, vid = v["project_uuid"], v["id"]
    store.submit_review(puuid, vid)
    store.return_review(puuid, vid, note="退回")
    store.submit_review(puuid, vid)                 # returned → in_review 合法
    assert store.review_for_version(puuid, vid)["state"] == "in_review"
    # 已 in_review 再 submit → 响亮(此前 returned 分支无谓词,竞态下可覆写他人 in_review)
    with pytest.raises(store.ReviewStateError):
        store.submit_review(puuid, vid)


def test_concurrent_submit_vs_return_no_illegal_audit_order():
    for i in range(15):
        v = store.save_workspace_version(f"bc{i:02x}", "R2c", _payload())
        puuid, vid = v["project_uuid"], v["id"]
        store.submit_review(puuid, vid)
        store.return_review(puuid, vid, note="退回")   # 现处 returned
        barrier = threading.Barrier(2)
        out: dict = {}

        def _run(name, fn):
            barrier.wait()
            try:
                fn(puuid, vid, note=name) if name == "return" else fn(puuid, vid)
                out[name] = None
            except BaseException as e:      # noqa: BLE001
                out[name] = e

        # submit(returned→in_review)对 return(要求 in_review):从 returned 态,
        # return 必败(非 in_review),submit 必成——恰一成功
        ts = [threading.Thread(target=_run, args=("submit", store.submit_review)),
              threading.Thread(target=_run, args=("return", store.return_review))]
        for t in ts:
            t.start()
        for t in ts:
            t.join()
        winners = [k for k, e in out.items() if e is None]
        assert winners == ["submit"], f"round {i}: {out}"
        assert store.review_for_version(puuid, vid)["state"] == "in_review"


# ── R3:非法 sid 在任何库写之前拒绝 ───────────────────────────────────────────

def test_illegal_sid_rejected_before_any_store_write():
    from fastapi.testclient import TestClient
    from backend.app import app
    client = TestClient(app)
    r = client.post("/api/saved", json={"name": "坏 sid", "id": "NOTHEX99",
                                        "payload": _payload()})
    assert r.status_code in (400, 422), r.text
    # 关键:证据库不得留下孤儿项目(此前 CAS 先行 → project+version 已提交才撞文件校验)
    puuid = store.legacy_project_uuid("NOTHEX99")
    assert store.list_versions(puuid) == []
    assert all(p["uuid"] != puuid for p in store.list_projects())
