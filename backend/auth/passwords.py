"""口令哈希(argon2id)—— 认证层唯一的口令处理点(规格 §4,B2 钉定)。

参数策略:用 argon2-cffi 的库默认(RFC 9106 低内存档:time_cost=3、memory_cost=64 MiB、
parallelism=4、16B 盐、32B 摘要)而非手写数字 —— 库默认随安全共识演进,
`needs_rehash` 让旧哈希在下次成功登录时透明升级。

枚举防御:未知用户名走 `dummy_verify()`(对固定哈希做一次真实 argon2 校验),
使"用户不存在"与"口令错误"的响应时间同为 argon2 主导 —— 调用方(store.verify_credentials)
必须在未知用户分支调用它。
"""
from __future__ import annotations

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

MIN_PASSWORD_LEN = 8   # 最短长度门;内网小团队不强推复杂度规则,长度是底线

_ph = PasswordHasher()
# 模块加载时生成一次:未知用户名分支的等时垫片(内容无意义,只为耗时一致)
_DUMMY_HASH = _ph.hash("bess-psa-dummy-timing-pad")


def hash_password(password: str) -> str:
    if not isinstance(password, str) or len(password) < MIN_PASSWORD_LEN:
        raise ValueError(f"password must be at least {MIN_PASSWORD_LEN} characters")
    return _ph.hash(password)


def verify_password(pw_hash: str, password: str) -> bool:
    try:
        _ph.verify(pw_hash, password)
        return True
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def needs_rehash(pw_hash: str) -> bool:
    try:
        return _ph.check_needs_rehash(pw_hash)
    except InvalidHashError:
        return True


def dummy_verify() -> None:
    """未知用户名时调用:烧掉与真实校验相同量级的时间(结果丢弃)。"""
    try:
        _ph.verify(_DUMMY_HASH, "definitely-not-the-password")
    except VerifyMismatchError:
        pass
