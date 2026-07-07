"""Tests for dimos-ar console divider and checkpoint styling."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from dimos.ar.utils.console import (
    _AR_STYLE_KEY,
    console_divider,
    install_ar_console_styles,
    log_checkpoint,
    use_console_colors,
)


def test_use_console_colors_respects_force_env(monkeypatch) -> None:
    monkeypatch.delenv("DIMOS_AR_FORCE_COLOR", raising=False)
    with patch("sys.stdout.isatty", return_value=False):
        assert use_console_colors() is False
    monkeypatch.setenv("DIMOS_AR_FORCE_COLOR", "1")
    with patch("sys.stdout.isatty", return_value=False):
        assert use_console_colors() is True


def test_console_divider_plain_when_not_tty(capsys) -> None:
    with patch("dimos.ar.utils.console.use_console_colors", return_value=False):
        console_divider(
            "Bridge ready — ws://0.0.0.0:8787",
            subtitle="Spectacles: enter 192.168.1.5 in the lens",
        )
    out = capsys.readouterr().out
    assert "Bridge ready — ws://0.0.0.0:8787" in out
    assert "Spectacles: enter 192.168.1.5 in the lens" in out
    assert "\033[" not in out


def test_console_divider_subtitle_ansi_when_tty(capsys) -> None:
    with patch("dimos.ar.utils.console.use_console_colors", return_value=True):
        console_divider("Bridge ready", subtitle="Spectacles: enter 10.0.0.1 in the lens")
    out = capsys.readouterr().out
    assert "Bridge ready" in out
    assert "Spectacles: enter 10.0.0.1 in the lens" in out
    assert "\033[" in out
    assert out.count("-" * 50) == 2


def test_console_divider_ansi_when_tty(capsys) -> None:
    with patch("dimos.ar.utils.console.use_console_colors", return_value=True):
        console_divider("AR client connected")
    out = capsys.readouterr().out
    assert "AR client connected" in out
    assert "\033[" in out
    assert out.count("-" * 50) == 2


def test_log_checkpoint_passes_ar_style_for_success() -> None:
    logger = MagicMock()
    log_checkpoint(logger, kind="success", event="Registration succeeded", mode="manual_pose")
    logger.info.assert_called_once_with(
        "Registration succeeded",
        **{_AR_STYLE_KEY: "success", "mode": "manual_pose"},
    )


def test_log_checkpoint_default_omits_style() -> None:
    logger = MagicMock()
    log_checkpoint(logger, event="routine event", robot_connected=True)
    logger.info.assert_called_once_with("routine event", robot_connected=True)


def test_install_ar_console_styles_rebinds_existing_formatter() -> None:
    import logging

    import structlog

    import dimos.ar.utils.console as console_mod
    import dimos.utils.logging_config as logging_config

    stdlib_logger = logging.getLogger("dimos.ar.utils.test_rebind")
    stdlib_logger.handlers.clear()
    handler = logging.StreamHandler()
    handler.setFormatter(
        structlog.stdlib.ProcessorFormatter(processor=logging_config._compact_console_processor)
    )
    stdlib_logger.addHandler(handler)

    console_mod._INSTALLED = False
    with patch("dimos.ar.utils.console.use_console_colors", return_value=True):
        install_ar_console_styles()
        line = logging_config._compact_console_processor(
            None,
            "info",
            {
                "timestamp": "2026-06-24T12:00:00",
                "level": "info",
                "logger": "dimos/ar/bridge/module.py",
                "event": "Registration succeeded",
                _AR_STYLE_KEY: "success",
            },
        )
    assert "▸ Registration succeeded" in line
    assert _AR_STYLE_KEY not in line
