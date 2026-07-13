"""Phase 5 认证模式脚手架 + CORS 收紧 — 规格 §2/§3。约束 #0:off 是安全默认。"""
import importlib

import pytest

from backend.auth import mode


def test_default_is_off(monkeypatch):
    monkeypatch.delenv("PSA_AUTH", raising=False)
    assert mode.auth_mode() == "off"
    assert mode.is_server_mode() is False


def test_local_enables_server_mode(monkeypatch):
    monkeypatch.setenv("PSA_AUTH", "local")
    assert mode.auth_mode() == "local"
    assert mode.is_server_mode() is True


@pytest.mark.parametrize("val", ["LOCAL", " local ", "Local"])
def test_local_case_and_space_insensitive(monkeypatch, val):
    monkeypatch.setenv("PSA_AUTH", val)
    assert mode.is_server_mode() is True


@pytest.mark.parametrize("val", ["", "on", "1", "true", "server", "off", "garbage"])
def test_unknown_values_are_off(monkeypatch, val):
    """安全默认:任何非 'local' 值 → off(宁可少拦不可误开)。"""
    monkeypatch.setenv("PSA_AUTH", val)
    assert mode.auth_mode() == "off"


def test_cors_wildcard_in_off_mode(monkeypatch):
    """off 模式 CORS 保持 "*"(约束 #0):导入时求值,需重载 app 模块。"""
    monkeypatch.delenv("PSA_AUTH", raising=False)
    import backend.app as app_mod
    importlib.reload(app_mod)
    assert app_mod._cors_origins == ["*"]


def test_cors_whitelist_in_server_mode(monkeypatch):
    monkeypatch.setenv("PSA_AUTH", "local")
    monkeypatch.setenv("PSA_CORS_ORIGINS", "https://a.example, https://b.example")
    import backend.app as app_mod
    importlib.reload(app_mod)
    assert app_mod._cors_origins == ["https://a.example", "https://b.example"]
    # 复原:重载回 off,避免污染同进程后续测试(app 是模块级单例)
    monkeypatch.delenv("PSA_AUTH", raising=False)
    monkeypatch.delenv("PSA_CORS_ORIGINS", raising=False)
    importlib.reload(app_mod)
