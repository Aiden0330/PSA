import pytest

from backend import store


@pytest.fixture(autouse=True)
def _isolated_store_db(tmp_path, monkeypatch):
    """ADR-2: every backend test gets its own store db — repo data/ stays clean."""
    monkeypatch.setattr(store, "_DB_PATH", str(tmp_path / "projects.db"))
