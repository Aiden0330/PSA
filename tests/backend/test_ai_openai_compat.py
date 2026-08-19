"""OpenAI 兼容供应商锁测(2026-08-18):GPT/DeepSeek/Gemini 经各自 API 直连。

架构律:管线消息恒为 Anthropic 规范形(system/user 块/tool_use/tool_result),
**翻译责任在客户端**——OpenAiCompatClient 每次调用把全史翻成 Chat Completions
形状(工具→function calling,图像→image_url dataURL,tool_result→role:tool),
响应再翻回 AiTurn。密钥:配置优先,回退 PSA_LLM_API_KEY(**绝不**回退
ANTHROPIC_API_KEY——把 anthropic 密钥发给别家是配置事故,不替用户揽)。
"""
import json

import pytest
from fastapi.testclient import TestClient

from backend import ai_config
from backend.app import app
from backend.ai_pipeline import OpenAiCompatClient, resolve_client

client = TestClient(app)


def _cfg(tmp_path, monkeypatch, **kw):
    p = str(tmp_path / "ai_config.json")
    monkeypatch.setattr(ai_config, "_PATH", p)
    if kw:
        ai_config.save(dict(kw))
    return p


class _Capture:
    def __init__(self, payload):
        self.payload = payload
        self.sent = None

    def post(self, url, headers=None, json=None, timeout=None):
        self.sent = {"url": url, "headers": headers, "body": json}
        class R:
            status_code = 200
            def __init__(s, d): s._d = d
            def raise_for_status(s): pass
            def json(s): return s._d
        return R(self.payload)


ANTHROPIC_STYLE_MSGS = [
    {"role": "system", "content": "系统提示"},
    {"role": "user", "content": [
        {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "AAAA"}},
        {"type": "text", "text": "{\"goal\":\"转录\"}"}]},
    {"role": "assistant", "content": [
        {"type": "tool_use", "id": "t1", "name": "search_reference_library", "input": {"query": "bms"}}]},
    {"role": "user", "content": [
        {"type": "tool_result", "tool_use_id": "t1", "content": "[{\"id\":\"B_BMS\"}]"}]},
]
TOOLS = [{"name": "search_reference_library", "description": "检索", "input_schema": {"type": "object", "properties": {}}}]


def test_message_and_tool_translation_roundtrip(tmp_path, monkeypatch):
    _cfg(tmp_path, monkeypatch, provider="openai", model="deepseek-chat",
         api_key="sk-ds-000000000000", base_url="https://api.deepseek.com/v1")
    cap = _Capture({"model": "deepseek-chat", "choices": [{"message": {
        "content": None, "tool_calls": [{"id": "c1", "type": "function", "function": {
            "name": "search_reference_library", "arguments": "{\"query\":\"bms\"}"}}]}}]})
    import backend.ai_pipeline as P
    monkeypatch.setattr(P, "httpx", cap, raising=False)
    cl = OpenAiCompatClient()
    turn = cl.complete(ANTHROPIC_STYLE_MSGS, TOOLS)
    b = cap.sent["body"]
    assert cap.sent["url"] == "https://api.deepseek.com/v1/chat/completions"
    assert cap.sent["headers"]["Authorization"] == "Bearer sk-ds-000000000000"
    assert b["model"] == "deepseek-chat"
    ms = b["messages"]
    assert ms[0] == {"role": "system", "content": "系统提示"}
    # 图像 → image_url dataURL;文本同块
    u = ms[1]["content"]
    assert u[0] == {"type": "image_url", "image_url": {"url": "data:image/png;base64,AAAA"}}
    assert u[1]["type"] == "text"
    # tool_use → assistant.tool_calls(arguments 为 JSON 串)
    assert ms[2]["tool_calls"][0]["function"]["name"] == "search_reference_library"
    assert json.loads(ms[2]["tool_calls"][0]["function"]["arguments"]) == {"query": "bms"}
    # tool_result → role:tool
    assert ms[3]["role"] == "tool" and ms[3]["tool_call_id"] == "t1"
    # 工具规格 → function calling
    assert b["tools"][0]["function"]["name"] == "search_reference_library"
    # 响应翻回 AiTurn
    assert turn.tool_calls == [{"id": "c1", "name": "search_reference_library", "arguments": {"query": "bms"}}]
    assert turn.served_by == "deepseek-chat"


def test_resolve_and_key_never_falls_back_to_anthropic_env(tmp_path, monkeypatch):
    _cfg(tmp_path, monkeypatch, provider="openai")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-SHOULD-NOT-LEAK-000")
    monkeypatch.delenv("PSA_LLM_API_KEY", raising=False)
    assert isinstance(resolve_client({}), OpenAiCompatClient)
    cl = OpenAiCompatClient()
    assert cl.api_key == ""                                     # 绝不把 anthropic 密钥发给别家
    monkeypatch.setenv("PSA_LLM_API_KEY", "sk-generic-000")
    assert OpenAiCompatClient().api_key == "sk-generic-000"


def test_config_accepts_openai_provider_and_default_base(tmp_path, monkeypatch):
    _cfg(tmp_path, monkeypatch)
    r = client.put("/api/ai/config", json={"provider": "openai", "model": "gpt-5.1"})
    assert r.status_code == 200, r.text
    g = client.get("/api/ai/config").json()
    assert g["provider"] == "openai"
    assert isinstance(g.get("models_openai"), list) and g["models_openai"]
    assert OpenAiCompatClient().base == "https://api.openai.com/v1"   # 无配置 → openai 官方默认
