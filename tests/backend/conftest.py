import pytest

from backend import store


@pytest.fixture(autouse=True)
def _isolated_store_db(tmp_path, monkeypatch):
    """ADR-2: every backend test gets its own store db — repo data/ stays clean.
    2026-07-21:双写的遗留 blob 目录(backend/storage._DIR)同样重定向——此前测试经
    /api/saved 会把「签发门-经存档」等 fixture 项目写进仓库共享 saved/,每跑一轮
    pytest 用户的项目树就多一批幽灵存档(报障实锤:10 份)。"""
    from backend import storage
    monkeypatch.setattr(store, "_DB_PATH", str(tmp_path / "projects.db"))
    monkeypatch.setattr(storage, "_DIR", str(tmp_path / "saved"))
