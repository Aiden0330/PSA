"""用户级 AI 配置(2026-08-17):UI 配 API key / 模型 / 供应商。

密钥纪律:
- 落本地 `data/ai_config.json`(**0600**;`data/` 已 gitignore)——绝不进
  projects.db(库会被备份/同步,密钥不得随行),绝不进审计详情,GET 永不回显原文。
- 优先级:**用户配置 > 环境变量 > 默认**(显式配置是分析行为,压过部署环境)。
- `enabled` 与环境变量 `PSA_AI_ENABLED=1` 任一即启用(UI 配置本身就是知情开启)。
"""
from __future__ import annotations

import json
import os
from typing import Any

_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "ai_config.json")

ALLOWED_PROVIDERS = ("example", "anthropic", "openai")
# 模型清单与 docs/design/ai-model-strategy.md 同步(fable 主档,opus 服务端回退档)
DEFAULT_MODELS = ["claude-fable-5", "claude-opus-4-8", "claude-sonnet-5",
                  "claude-haiku-4-5-20251001"]
# OpenAI 兼容侧参考清单(以供应商文档为准;自定义输入永远可用)
OPENAI_SUGGESTED_MODELS = ["gpt-5.1", "gpt-4o", "deepseek-chat", "deepseek-reasoner",
                           "gemini-3-pro-preview", "gemini-2.5-pro"]


def load() -> dict[str, Any]:
    try:
        with open(_PATH, encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def save(cfg: dict[str, Any]) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(_PATH)), exist_ok=True)
    with open(_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
    os.chmod(_PATH, 0o600)


def enabled() -> bool:
    return bool(load().get("enabled"))


def provider() -> str | None:
    return load().get("provider") or None


def model() -> str | None:
    return load().get("model") or None


def base_url() -> str | None:
    """中转网关/代理端点(配置 > PSA_ANTHROPIC_BASE_URL 环境变量;None=官方默认)。
    注意:API key 会发送到该地址——UI 侧有"只填你信任的网关"提示。"""
    return load().get("base_url") or None


def api_key() -> str:
    """配置密钥优先;回退环境变量(部署级)。"""
    return (load().get("api_key")
            or os.getenv("ANTHROPIC_API_KEY")
            or os.getenv("PSA_LLM_API_KEY", ""))


def key_hint(key: str) -> str:
    """掩码提示:sk-an…1234。短于 12 字符只报「已设置」,绝不回原文。"""
    if not key:
        return ""
    return f"{key[:5]}…{key[-4:]}" if len(key) >= 12 else "已设置"
