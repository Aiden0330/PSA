"""三角色路由守卫(规格 §5.1)。

off 模式:全部放行(单用户即全权,约束 #0 —— 现有测试全在 off 模式,守卫为 no-op)。
local 模式:未登录 → 401;角色不在允许集 → 403。守卫返回身份 dict 供处理器用
(签发口令复核、审计快照 role)。

身份来源:会话中间件(app.py)已解析 cookie 并写入 request.state.identity;
守卫读它,不重复查库。
"""
from __future__ import annotations

from typing import Optional

from fastapi import HTTPException, Request

from backend.auth.mode import is_server_mode

# 角色集(admin 含于每个非 admin-only 集 —— admin 是超级用户)
ANALYST = ("analyst", "admin")
REVIEWER = ("reviewer", "admin")
ANY_ROLE = ("analyst", "reviewer", "admin")
ADMIN = ("admin",)


def _identity(request: Request) -> Optional[dict]:
    return getattr(request.state, "identity", None)


def require_authenticated(request: Request) -> Optional[dict]:
    """local 模式要求已登录(任意角色);off 模式放行返回 None。"""
    if not is_server_mode():
        return None
    ident = _identity(request)
    if ident is None:
        raise HTTPException(401, "未登录")
    return ident


def require_role(*roles: str):
    """生成守卫依赖:local 模式校验角色 ∈ roles,否则 403;off 模式放行。"""
    def dep(request: Request) -> Optional[dict]:
        if not is_server_mode():
            return None
        ident = _identity(request)
        if ident is None:
            raise HTTPException(401, "未登录")
        if ident["role"] not in roles:
            raise HTTPException(403, f"需要角色 {'/'.join(roles)};当前账户为「{ident['role']}」")
        return ident
    return dep
