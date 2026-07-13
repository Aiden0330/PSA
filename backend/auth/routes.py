"""认证路由:login / logout / me(规格 §4.3)。

Cookie 钉定(B2):名 psa_session;HttpOnly(JS 不可读);SameSite=Lax(跨站 POST
不带 cookie → CSRF 缓解,顶级导航不受影响);Secure 跟随请求 scheme(内网默认 http,
ADR-4;反代终结 TLS 时 uvicorn --proxy-headers 使 scheme 为 https → Secure 自动置位);
Max-Age = 会话 TTL。

失败语义:登录失败一律 401「用户名或口令错误」—— 未知用户/错口令/停用不可区分
(枚举防御);真实原因只进审计(auth.login_failed 带 username)。
PSA_AUTH=off:login/logout → 501(认证未启用);me → 200 {mode:"off"}(前端判据,
约束 #0:off 模式一切照旧,单用户即全权)。
"""
from __future__ import annotations

import getpass

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

from backend.auth.mode import is_server_mode
from backend.auth.provider import get_provider

SESSION_COOKIE = "psa_session"
_COOKIE_MAX_AGE = 12 * 3600          # 与 store._SESSION_TTL_HOURS 一致

router = APIRouter(prefix="/api/auth")


class LoginBody(BaseModel):
    username: str
    password: str


def _set_session_cookie(response: Response, request: Request, token: str) -> None:
    response.set_cookie(
        SESSION_COOKIE, token,
        max_age=_COOKIE_MAX_AGE, httponly=True, samesite="lax",
        secure=(request.url.scheme == "https"), path="/")


@router.post("/login")
def login(body: LoginBody, request: Request, response: Response):
    from backend import store
    if not is_server_mode():
        raise HTTPException(501, "认证未启用(PSA_AUTH=off)")
    ident = get_provider().authenticate(body.username, body.password)
    if ident is None:
        with store._conn() as cx:                      # 真实原因只进审计,响应统一
            store.record_audit(cx, "auth.login_failed", details={"username": body.username})
        raise HTTPException(401, "用户名或口令错误")
    token = store.create_session(ident.username)
    _set_session_cookie(response, request, token)
    actor_token = store.set_current_actor(ident.username)   # 本请求随后的审计以该身份记
    try:
        with store._conn() as cx:
            store.record_audit(cx, "auth.login", details={"username": ident.username})
    finally:
        store.reset_current_actor(actor_token)
    return {"mode": "local", "username": ident.username, "role": ident.role,
            "display_name": ident.display_name}


@router.post("/logout")
def logout(request: Request, response: Response):
    from backend import store
    if not is_server_mode():
        raise HTTPException(501, "认证未启用(PSA_AUTH=off)")
    raw = request.cookies.get(SESSION_COOKIE)
    if raw:
        ident = store.get_session(raw)
        store.delete_session(raw)
        if ident:
            actor_token = store.set_current_actor(ident["username"])
            try:
                with store._conn() as cx:
                    store.record_audit(cx, "auth.logout", details={"username": ident["username"]})
            finally:
                store.reset_current_actor(actor_token)
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"ok": True}


@router.get("/me")
def me(request: Request):
    from backend import store
    if not is_server_mode():
        # off 模式:单用户即全权(role=admin 使前端呈现全部入口),身份 = OS 用户
        try:
            user = getpass.getuser()
        except Exception:
            user = "unknown"
        return {"mode": "off", "username": user, "role": "admin", "display_name": None}
    raw = request.cookies.get(SESSION_COOKIE)
    ident = store.get_session(raw) if raw else None
    if ident is None:
        raise HTTPException(401, "未登录")
    return {"mode": "local", **{k: ident[k] for k in ("username", "role", "display_name")}}
