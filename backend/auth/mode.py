"""PSA_AUTH 部署开关 —— 认证层的唯一模式判据入口(规格 §2)。

off(默认,现行为)| local(登录墙 + 会话身份)。所有 enforcement 点(CORS、
路由守卫、actor 身份)都调这里,不散读 env,以便单点审计与测试。

安全默认:未设或任何非 'local' 值一律 off(约束 #0)—— 宁可少拦(单用户放行)
也不误开(把本地开发当成服务器拦住)。开服务器模式是一个显式、有意的部署动作。
"""
from __future__ import annotations

import os


def auth_mode() -> str:
    """'local' 当且仅当 PSA_AUTH 环境变量(大小写不敏感)等于 'local';否则 'off'。"""
    return "local" if os.environ.get("PSA_AUTH", "").strip().lower() == "local" else "off"


def is_server_mode() -> bool:
    """语义别名:多用户/认证是否启用(CORS 白名单、路由守卫、会话 actor 的判据)。"""
    return auth_mode() == "local"
