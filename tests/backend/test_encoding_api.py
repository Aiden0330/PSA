from fastapi.testclient import TestClient

from backend.app import app


client = TestClient(app)


def test_json_api_declares_utf8_charset_for_chinese_clients():
    r = client.get("/api/bess/scenarios")

    assert r.status_code == 200
    assert "charset=utf-8" in r.headers["content-type"].lower()
    assert "电芯内短" in r.text


def test_openapi_descriptions_keep_readable_chinese():
    r = client.get("/openapi.json")

    assert r.status_code == 200
    description = r.json()["paths"]["/api/bess/scenarios"]["get"]["description"]
    assert "内置场景事件树列表" in description
    assert "鍐" not in description
