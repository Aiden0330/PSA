"""Phase 5 auth B2 — accounts(argon2id)+ sessions 存储层安全不变量(规格 §4.1)。

钉定的安全常量(Fable 批次决策):
- argon2id 用库默认参数(RFC 9106 低内存档:t=3, m=64MiB, p=4,16B 盐)
- 会话表存 sha256(token) 而非原始 token —— 备份=库文件拷贝(ADR-4),库泄露不得等于会话劫持
- token = secrets.token_urlsafe(32)(256 bit 熵),只存在于 Set-Cookie 与客户端
- TTL 12h,过半衰期滑动续期;过期即删(懒清理)
- verify_credentials 对 未知用户/错口令/停用账户 一律返回 None(枚举防御);真实原因进审计
"""
import hashlib
import sqlite3

import pytest

from backend import store


def test_create_account_hashes_with_argon2id():
    acc = store.create_account("zhang", "s3cret-pw", "analyst", display_name="张力群")
    assert acc["username"] == "zhang" and acc["role"] == "analyst"
    assert "pw_hash" not in acc                                # 哈希绝不出存储层
    with store._conn() as cx:
        row = cx.execute("SELECT pw_hash FROM accounts WHERE username='zhang'").fetchone()
    assert row["pw_hash"].startswith("$argon2id$")             # 明确 argon2id 变体
    assert "s3cret-pw" not in row["pw_hash"]


def test_verify_credentials_roundtrip_and_uniform_failure():
    store.create_account("zhang", "correct-horse", "analyst")
    ok = store.verify_credentials("zhang", "correct-horse")
    assert ok is not None and ok["username"] == "zhang" and ok["role"] == "analyst"
    assert store.verify_credentials("zhang", "wrong") is None
    assert store.verify_credentials("ghost", "whatever") is None   # 未知用户同样 None(防枚举)


def test_disabled_account_rejected_uniformly():
    store.create_account("leaver", "pw123456", "reviewer")
    assert store.verify_credentials("leaver", "pw123456") is not None
    store.set_account_disabled("leaver", True)
    assert store.verify_credentials("leaver", "pw123456") is None  # 与错口令不可区分
    store.set_account_disabled("leaver", False)
    assert store.verify_credentials("leaver", "pw123456") is not None


def test_duplicate_username_raises():
    store.create_account("zhang", "pw-one-111", "analyst")
    with pytest.raises(sqlite3.IntegrityError):
        store.create_account("zhang", "pw-two-222", "admin")


def test_invalid_role_rejected():
    with pytest.raises(ValueError):
        store.create_account("x", "pw123456", "superuser")


def test_weak_password_rejected():
    with pytest.raises(ValueError):
        store.create_account("x", "short", "analyst")          # 最短长度门(8)


def test_set_password_rotates():
    store.create_account("zhang", "old-pw-123", "analyst")
    store.set_password("zhang", "new-pw-456")
    assert store.verify_credentials("zhang", "old-pw-123") is None
    assert store.verify_credentials("zhang", "new-pw-456") is not None


def test_session_token_stored_hashed_not_raw():
    store.create_account("zhang", "pw123456", "analyst")
    token = store.create_session("zhang")
    assert isinstance(token, str) and len(token) >= 40         # token_urlsafe(32) ≈ 43 字符
    with store._conn() as cx:
        rows = cx.execute("SELECT token FROM sessions").fetchall()
    stored = {r["token"] for r in rows}
    assert token not in stored                                 # 原始 token 绝不落库
    assert hashlib.sha256(token.encode()).hexdigest() in stored


def test_get_session_resolves_identity_and_expiry(monkeypatch):
    store.create_account("zhang", "pw123456", "reviewer", display_name="张力群")
    token = store.create_session("zhang")
    ident = store.get_session(token)
    assert ident and ident["username"] == "zhang" and ident["role"] == "reviewer"
    assert store.get_session("forged-token") is None
    # 时间推进到 TTL 之后 → 过期即删(懒清理)
    real_now = store._now
    monkeypatch.setattr(store, "_now", lambda: "2099-01-01T00:00:00+00:00")
    assert store.get_session(token) is None
    monkeypatch.setattr(store, "_now", real_now)
    with store._conn() as cx:
        assert cx.execute("SELECT COUNT(*) c FROM sessions").fetchone()["c"] == 0


def test_session_sliding_renewal_past_half_life(monkeypatch):
    from datetime import datetime, timedelta, timezone
    store.create_account("zhang", "pw123456", "analyst")
    t0 = datetime(2026, 7, 12, 8, 0, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(store, "_now", lambda: t0.isoformat(timespec="seconds"))
    token = store.create_session("zhang")
    with store._conn() as cx:
        exp0 = cx.execute("SELECT expires_at FROM sessions").fetchone()["expires_at"]
    # 7 小时后(> TTL/2=6h 已消耗)访问 → 续期
    t7 = t0 + timedelta(hours=7)
    monkeypatch.setattr(store, "_now", lambda: t7.isoformat(timespec="seconds"))
    assert store.get_session(token) is not None
    with store._conn() as cx:
        exp1 = cx.execute("SELECT expires_at FROM sessions").fetchone()["expires_at"]
    assert exp1 > exp0                                         # 滑动续期生效
    # 刚创建即访问(< 半衰期)→ 不写库(续期有界)
    t1 = t7 + timedelta(minutes=1)
    monkeypatch.setattr(store, "_now", lambda: t1.isoformat(timespec="seconds"))
    store.get_session(token)
    with store._conn() as cx:
        exp2 = cx.execute("SELECT expires_at FROM sessions").fetchone()["expires_at"]
    assert exp2 == exp1


def test_delete_session_logout():
    store.create_account("zhang", "pw123456", "analyst")
    token = store.create_session("zhang")
    store.delete_session(token)
    assert store.get_session(token) is None


def test_list_accounts_never_exposes_hash_and_audit_written():
    store.create_account("zhang", "pw123456", "analyst")
    accounts = store.list_accounts()
    assert accounts and all("pw_hash" not in a for a in accounts)
    with store._conn() as cx:
        acts = [r["action"] for r in cx.execute("SELECT action FROM audit_log").fetchall()]
    assert "account.create" in acts
