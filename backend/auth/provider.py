"""认证 provider 接口(规格 §4.2)—— ADR-4 D-P5-2 的 OIDC/SSO 叠加点。

LocalProvider 是第一个实现(本地账户表);将来 OidcProvider 实现同一协议,
auth_mode 之外的第二维扩展点。路由层只认协议,不认实现。
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Protocol


@dataclass(frozen=True)
class Identity:
    account_id: int
    username: str
    role: str                      # admin | analyst | reviewer
    display_name: str | None = None


class AuthProvider(Protocol):
    def authenticate(self, username: str, password: str) -> Optional[Identity]:
        """校验凭据;成功返回身份,失败(含停用/未知用户)返回 None。"""
        ...


class LocalProvider:
    """本地账户实现:包 store.verify_credentials(argon2id + 枚举防御在存储层)。"""

    def authenticate(self, username: str, password: str) -> Optional[Identity]:
        from backend import store
        row = store.verify_credentials(username, password)
        if row is None:
            return None
        return Identity(account_id=row["account_id"], username=row["username"],
                        role=row["role"], display_name=row["display_name"])


def get_provider() -> AuthProvider:
    """当前部署的 provider。local 是唯一实现;OIDC 落地时按配置分派。"""
    return LocalProvider()
