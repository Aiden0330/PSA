import pytest
import backend.storage as storage


def test_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "_DIR", str(tmp_path / "saved"))
    meta = storage.save_workspace("场景A", {"etModel": {"x": 1}, "fts": {"y": 2}})
    assert meta["name"] == "场景A" and meta["id"]
    assert any(w["id"] == meta["id"] for w in storage.list_workspaces())
    rec = storage.load_workspace(meta["id"])
    assert rec["payload"]["etModel"] == {"x": 1}
    storage.delete_workspace(meta["id"])
    assert storage.list_workspaces() == []
    with pytest.raises(KeyError):
        storage.load_workspace(meta["id"])


def test_bad_id_rejected(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "_DIR", str(tmp_path / "saved"))
    with pytest.raises(KeyError):
        storage.load_workspace("../etc/passwd")
