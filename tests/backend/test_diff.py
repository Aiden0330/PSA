"""4a5 模型版本 diff:身份键对齐、易变字段剥离、API 面。"""
import copy

import backend.storage as storage
from fastapi.testclient import TestClient

from backend.app import app
from backend.diff import diff_json

client = TestClient(app)

PUUID = "9d3f0a90-0000-5000-8000-1234567890ef"


def _payload(fail=0.1, extra_fe=False):
    fes = [{"id": "FE1", "failProb": fail}]
    root = {"kind": "branch", "feId": "FE1",
            "success": {"kind": "leaf", "consequence": "C1"},
            "failure": {"kind": "leaf", "consequence": "C2"}}
    if extra_fe:
        fes.append({"id": "FE2", "failProb": 0.2})
        root = {"kind": "branch", "feId": "FE1",
                "success": {"kind": "leaf", "consequence": "C1"},
                "failure": {"kind": "branch", "feId": "FE2",
                            "success": {"kind": "leaf", "consequence": "C2"},
                            "failure": {"kind": "leaf", "consequence": "C3"}}}
    return {"v": 2,
            "etas": [{"key": "t", "name": "T",
                      "model": {"initEvent": "IE", "initFreq": 0.001,
                                "functionalEvents": fes, "root": root},
                      "fts": {"model_data": {"parameters": []}, "fault_trees": []},
                      "pfds": {}}],
            "activeKey": "t", "checkedKeys": {"t": True}}


def test_keyed_list_alignment_and_volatile_stripping():
    a = {"items": [{"ref": "A", "v": 1}, {"ref": "B", "v": 2}], "created_at": "x"}
    b = {"items": [{"ref": "B", "v": 3}, {"ref": "C", "v": 4}], "created_at": "y"}
    ch = diff_json(a, b)
    ops = {(c["op"], c["path"]) for c in ch}
    # A 删、C 增、B 改 —— 不因下标位移把 B 误报成 A→B 全改;created_at 不参与
    assert ("removed", "/items/A") in ops
    assert ("added", "/items/C") in ops
    assert ("changed", "/items/B/v") in ops
    assert not any("created_at" in c["path"] for c in ch)
    assert diff_json(a, copy.deepcopy(a)) == []


def test_api_diff_between_versions(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "_DIR", str(tmp_path / "saved"))
    r1 = client.post("/api/saved", json={"name": "P", "payload": _payload()}).json()
    sid, pu = r1["id"], r1["version"]["project_uuid"]
    client.post("/api/saved", json={"id": sid, "name": "P", "payload": _payload(fail=0.15, extra_fe=True)})
    vs = client.get(f"/api/projects/{pu}/versions").json()
    assert len(vs) == 2
    d = client.get(f"/api/projects/{pu}/diff", params={"from": vs[0]["id"], "to": vs[1]["id"]}).json()
    assert d["from"]["content_hash"] != d["to"]["content_hash"]
    assert d["summary"]["added"] >= 1                                  # FE2 及其参数新增
    paths = [c["path"] for c in d["changes"]]
    assert any("FE2" in p for p in paths)                              # 身份键路径可读
    changed_vals = [c for c in d["changes"] if c["op"] == "changed"
                    and c.get("from") == 0.1 and c.get("to") == 0.15]
    assert changed_vals                                                # failProb 0.1→0.15 被捕捉
    # 同版本自比 → 空
    same = client.get(f"/api/projects/{pu}/diff", params={"from": vs[0]["id"], "to": vs[0]["id"]}).json()
    assert same["summary"] == {"added": 0, "removed": 0, "changed": 0}
    # 版本不存在 → 404
    assert client.get(f"/api/projects/{pu}/diff", params={"from": 999, "to": vs[1]["id"]}).status_code == 404
