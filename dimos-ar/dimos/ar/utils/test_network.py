"""Tests for dimos-ar LAN IP detection."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from dimos.ar.utils.network import detect_lan_ip


def test_detect_lan_ip_uses_env_override(monkeypatch) -> None:
    monkeypatch.setenv("DIMOS_AR_LAN_IP", "10.0.0.42")
    assert detect_lan_ip() == "10.0.0.42"


def test_detect_lan_ip_ignores_unknown_override(monkeypatch) -> None:
    monkeypatch.setenv("DIMOS_AR_LAN_IP", "unknown")
    with patch("dimos.ar.utils.network.socket.socket") as socket_cls:
        sock = MagicMock()
        sock.__enter__.return_value = sock
        sock.getsockname.return_value = ("192.168.1.5", 0)
        socket_cls.return_value = sock
        assert detect_lan_ip() == "192.168.1.5"


def test_detect_lan_ip_socket_fallback(monkeypatch) -> None:
    monkeypatch.delenv("DIMOS_AR_LAN_IP", raising=False)
    with patch("dimos.ar.utils.network.socket.socket") as socket_cls:
        sock = MagicMock()
        sock.__enter__.return_value = sock
        sock.getsockname.return_value = ("192.168.1.5", 0)
        socket_cls.return_value = sock
        assert detect_lan_ip() == "192.168.1.5"


def test_detect_lan_ip_returns_none_on_failure(monkeypatch) -> None:
    monkeypatch.delenv("DIMOS_AR_LAN_IP", raising=False)
    with patch("dimos.ar.utils.network.socket.socket", side_effect=OSError("no route")):
        assert detect_lan_ip() is None


def test_detect_lan_ip_rejects_loopback(monkeypatch) -> None:
    monkeypatch.delenv("DIMOS_AR_LAN_IP", raising=False)
    with patch("dimos.ar.utils.network.socket.socket") as socket_cls:
        sock = MagicMock()
        sock.__enter__.return_value = sock
        sock.getsockname.return_value = ("127.0.0.1", 0)
        socket_cls.return_value = sock
        assert detect_lan_ip() is None
