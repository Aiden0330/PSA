"""Phase 5 认证叠加层(ADR-4)。

约束 #0:PSA_AUTH=off(默认)时全部行为逐位不变 —— 离线单文件、本地免登录、
OS-用户 actor 全部保留。认证是同一存储上的叠加层,不是代码分叉。
"""
from backend.auth.mode import auth_mode, is_server_mode

__all__ = ["auth_mode", "is_server_mode"]
