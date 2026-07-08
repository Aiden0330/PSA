import backend.storage as storage
from fastapi.testclient import TestClient
from backend.app import app

client = TestClient(app)


def test_saved_api_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "_DIR", str(tmp_path / "saved"))
    r = client.post("/api/saved", json={"name": "T1", "payload": {"etModel": {"a": 1}, "fts": {}}})
    assert r.status_code == 200
    sid = r.json()["id"]
    assert any(w["id"] == sid for w in client.get("/api/saved").json())
    got = client.get(f"/api/saved/{sid}").json()
    assert got["payload"]["etModel"] == {"a": 1}
    assert client.delete(f"/api/saved/{sid}").status_code == 200
    assert client.get(f"/api/saved/{sid}").status_code == 404


def test_saved_api_update_in_place(tmp_path, monkeypatch):
    """带 id 再次保存 → 原地更新同一条, 不产生新副本。"""
    monkeypatch.setattr(storage, "_DIR", str(tmp_path / "saved"))
    sid = client.post("/api/saved", json={"name": "P1", "payload": {"v": 1}}).json()["id"]
    r2 = client.post("/api/saved", json={"id": sid, "name": "P1-edited", "payload": {"v": 2}})
    assert r2.status_code == 200 and r2.json()["id"] == sid     # 返回同一 id
    lst = client.get("/api/saved").json()
    assert len(lst) == 1                                        # 仍只有一条, 未新增副本
    got = client.get(f"/api/saved/{sid}").json()
    assert got["payload"] == {"v": 2} and got["name"] == "P1-edited"
