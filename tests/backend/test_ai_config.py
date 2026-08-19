"""用户级 AI 配置锁测(2026-08-17):UI 配 API key/模型/供应商。

密钥纪律:落 data/ai_config.json(0600;data/ 已 gitignore)——GET 永不回显
原文(只有掩码提示);审计不含密钥材料;api_key 语义:缺省=不动,""=清除,
串=设置。优先级:用户配置 > 环境变量 > 默认。enabled 开关与 PSA_AI_ENABLED
环境变量任一即启用。
"""
import json
import os
import stat

from fastapi.testclient import TestClient

from backend.app import app
from backend import ai_config

client = TestClient(app)


def _cfg_path(tmp_path, monkeypatch):
    p = str(tmp_path / "ai_config.json")
    monkeypatch.setattr(ai_config, "_PATH", p)
    return p


def test_put_get_roundtrip_masked_and_0600(tmp_path, monkeypatch):
    p = _cfg_path(tmp_path, monkeypatch)
    r = client.put("/api/ai/config", json={
        "enabled": True, "provider": "anthropic",
        "model": "claude-fable-5", "api_key": "sk-ant-abcdefghijklmnop1234"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["api_key_set"] is True
    assert "sk-ant-abcdefghijklmnop1234" not in json.dumps(d)   # 永不回显原文
    assert d["api_key_hint"].startswith("sk-an") and d["api_key_hint"].endswith("1234")
    assert "…" in d["api_key_hint"]
    # 文件 0600
    mode = stat.S_IMODE(os.stat(p).st_mode)
    assert mode == 0o600, oct(mode)
    # GET 同样掩码
    g = client.get("/api/ai/config").json()
    assert g["enabled"] is True and g["provider"] == "anthropic"
    assert g["model"] == "claude-fable-5"
    assert "sk-ant-abcdefghijklmnop1234" not in json.dumps(g)
    assert isinstance(g.get("models"), list) and "claude-fable-5" in g["models"]


def test_api_key_semantics_keep_and_clear(tmp_path, monkeypatch):
    _cfg_path(tmp_path, monkeypatch)
    client.put("/api/ai/config", json={"api_key": "sk-ant-abcdefghijklmnop1234"})
    # 缺省 = 不动
    r = client.put("/api/ai/config", json={"model": "claude-sonnet-5"})
    assert r.json()["api_key_set"] is True
    # "" = 清除
    r = client.put("/api/ai/config", json={"api_key": ""})
    assert r.json()["api_key_set"] is False and r.json()["api_key_hint"] == ""


def test_priority_config_over_env_and_enabled_or(tmp_path, monkeypatch):
    _cfg_path(tmp_path, monkeypatch)
    monkeypatch.setenv("PSA_LLM_MODEL", "env-model")
    monkeypatch.setenv("PSA_LLM_PROVIDER", "example")
    monkeypatch.delenv("PSA_AI_ENABLED", raising=False)
    from backend import ai_draft
    from backend.ai_pipeline import AnthropicClient, resolve_client
    assert ai_draft.is_enabled() is False
    client.put("/api/ai/config", json={"enabled": True, "provider": "anthropic",
                                       "model": "cfg-model", "api_key": "sk-cfg-000000000000"})
    assert ai_draft.is_enabled() is True                        # 配置 OR 环境变量
    assert isinstance(resolve_client({}), AnthropicClient)      # 配置供应商压过环境
    cl = AnthropicClient()
    assert cl.model_id == "cfg-model"                           # 配置模型压过环境
    assert cl.api_key == "sk-cfg-000000000000"


def test_validation_and_audit_without_secret(tmp_path, monkeypatch):
    _cfg_path(tmp_path, monkeypatch)
    assert client.put("/api/ai/config", json={"provider": "foo"}).status_code == 422
    client.put("/api/ai/config", json={"api_key": "sk-ant-abcdefghijklmnop1234"})
    from backend import store
    with store._conn() as cx:
        rows = cx.execute("SELECT details_json FROM audit_log WHERE action='ai.config'").fetchall()
    assert rows, "配置变更必须留审计"
    assert all("sk-ant" not in r["details_json"] for r in rows)  # 审计不含密钥


def test_base_url_roundtrip_clear_and_client_priority(tmp_path, monkeypatch):
    _cfg_path(tmp_path, monkeypatch)
    monkeypatch.setenv("PSA_ANTHROPIC_BASE_URL", "https://env.example.com")
    # 设置(尾斜杠归一)
    r = client.put("/api/ai/config", json={"base_url": "https://relay.example.cn/v1x/"})
    assert r.status_code == 200, r.text
    assert r.json()["base_url"] == "https://relay.example.cn/v1x"
    from backend.ai_pipeline import AnthropicClient
    assert AnthropicClient().base == "https://relay.example.cn/v1x"   # 配置压过环境
    # 校验:非 http(s) 响亮 400
    assert client.put("/api/ai/config", json={"base_url": "ftp://x"}).status_code == 400
    assert client.put("/api/ai/config", json={"base_url": "not-a-url"}).status_code == 400
    # "" = 清除 → 回退环境变量;GET 显示配置值为空
    r = client.put("/api/ai/config", json={"base_url": ""})
    assert r.json()["base_url"] == ""
    assert AnthropicClient().base == "https://env.example.com"
    # 环境也清掉 → 官方默认
    monkeypatch.delenv("PSA_ANTHROPIC_BASE_URL")
    assert AnthropicClient().base == "https://api.anthropic.com"
