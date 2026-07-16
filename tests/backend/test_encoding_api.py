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


def test_http_exception_response_declares_utf8_charset():
    # EB-12/O5:默认异常响应也须带 application/json; charset=utf-8。O1 已锁 422(validation)
    # 与 400(domain ValueError);此处补通用 HTTPException 路径(_http_exception_handler,404),
    # 使三处异常 handler 的 charset 声明全覆盖(中文 detail 客户端可读)。
    r = client.get("/api/model/__no_such_example__")
    assert r.status_code == 404
    assert "charset=utf-8" in r.headers["content-type"].lower()
