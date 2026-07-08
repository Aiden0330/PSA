from fastapi.testclient import TestClient
from backend.app import app

client = TestClient(app)


def test_library_endpoint_returns_sourced_data():
    r = client.get("/api/bess/library")
    assert r.status_code == 200
    data = r.json()
    assert data["barrier_effectiveness"][0]["source"]["citation"]
    assert "disclaimer" in data["meta"]
    assert len(data["component_failure_rates"]) >= 5
