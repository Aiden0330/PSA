"""截图转录(2026-08-17):图像随草案请求进管线,AI 把任意工具的 ETA/FTA 截图
转录为可编辑模型。铁律:①无图请求逐字节不变(回归);②图像以内容块进用户消息,
文本载荷剥离 base64(token 炸弹);③校验响亮(数量/类型/大小);④溯源表不落
base64 大团——以 sha256+尺寸元数据代之(哈希锚定确切图像)。
"""
import base64
import json

from fastapi.testclient import TestClient

from backend.ai_pipeline import AiTurn, generate_draft
from backend.app import app
from tests.backend.test_ai_pipeline import FakeClient, _good_fta_draft

client = TestClient(app)

PNG_1PX = base64.b64encode(
    bytes.fromhex("89504e470d0a1a0a0000000d494844520000000100000001080600000"
                  "01f15c4890000000d49444154789c626001000000ffff030000060005"
                  "57bfabd40000000049454e44ae426082")).decode()


def test_images_become_content_blocks_and_text_payload_is_stripped():
    draft = _good_fta_draft(library_ref=None)
    cl = FakeClient([AiTurn(content=json.dumps(draft, ensure_ascii=False))])
    payload = {"goal": "转录截图", "target": "fta",
               "images": [{"media_type": "image/png", "data": PNG_1PX}]}
    out, prov = generate_draft(payload, cl)
    assert out is not None
    user = client_msg = cl.seen[0][1]
    assert user["role"] == "user" and isinstance(user["content"], list)
    kinds = [b.get("type") for b in user["content"]]
    assert kinds[0] == "image" and kinds[-1] == "text"
    img = user["content"][0]
    assert img["source"] == {"type": "base64", "media_type": "image/png", "data": PNG_1PX}
    assert PNG_1PX not in user["content"][-1]["text"]          # 文本载荷剥离 base64
    assert "images" not in json.loads(user["content"][-1]["text"])
    # 转录规则入系统提示(只在带图时)
    assert "转录" in cl.seen[0][0]["content"]


def test_no_image_request_is_byte_identical_regression():
    draft = _good_fta_draft(library_ref=None)
    cl = FakeClient([AiTurn(content=json.dumps(draft, ensure_ascii=False))])
    generate_draft({"goal": "g", "target": "fta"}, cl)
    user = cl.seen[0][1]
    assert isinstance(user["content"], str)                     # 旧形状:纯字符串
    assert json.loads(user["content"]) == {"goal": "g", "target": "fta"}
    assert "转录" not in cl.seen[0][0]["content"]               # 无图不加转录附则


def test_route_validation_loud(monkeypatch):
    monkeypatch.setenv("PSA_AI_ENABLED", "1")
    monkeypatch.setenv("PSA_LLM_PROVIDER", "example")
    base = {"goal": "g", "target": "eta", "current_project": {}}
    # 类型越界
    r = client.post("/api/ai/draft-model", json={**base, "images": [
        {"media_type": "image/tiff", "data": PNG_1PX}]})
    assert r.status_code == 422
    # 数量越界(>3)
    imgs = [{"media_type": "image/png", "data": PNG_1PX}] * 4
    r = client.post("/api/ai/draft-model", json={**base, "images": imgs})
    assert r.status_code in (400, 422) and "3" in r.text
    # 非法 base64
    r = client.post("/api/ai/draft-model", json={**base, "images": [
        {"media_type": "image/png", "data": "!!not-base64!!"}]})
    assert r.status_code in (400, 422)


def test_provenance_stores_hash_not_blob(monkeypatch):
    monkeypatch.setenv("PSA_AI_ENABLED", "1")
    monkeypatch.setenv("PSA_LLM_PROVIDER", "example")
    from backend import store
    base = {"goal": "g", "target": "eta", "current_project": {},
            "images": [{"media_type": "image/png", "data": PNG_1PX}]}
    r = client.post("/api/ai/draft-model", json=base)
    assert r.status_code == 200, r.text
    rid = r.json().get("ai_draft_id")
    assert rid
    with store._conn() as cx:
        row = cx.execute("SELECT images_json, draft_json FROM ai_drafts WHERE id=?", (rid,)).fetchone()
    assert PNG_1PX not in (row["images_json"] or "")            # 不落 base64 大团
    assert PNG_1PX not in row["draft_json"]
    img_meta = json.loads(row["images_json"])[0]
    assert set(img_meta) >= {"media_type", "sha256", "bytes"}
    assert len(img_meta["sha256"]) == 64
