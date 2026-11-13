"""Status line parsing from start.sh / setup.sh output."""

from __future__ import annotations

from pathlib import Path

import pytest

from armodule import (
    _RE_CHECK_OK,
    _RE_DIMOS_PYTHON,
    _RE_DIMOS_REF,
    _RE_DIMOS_VERSION,
    WEBXR_PORT,
    Phase,
    ProcessManager,
    abs_dimos_python,
    detect_lan_ip,
)


def test_parse_armodule_ready_and_ips(tmp_path: Path) -> None:
    mgr = ProcessManager(root=tmp_path)
    mgr.runtime._parse_armodule_line("ARModule ready — ws://0.0.0.0:8787")
    assert mgr.status.websocket_url == "ws://0.0.0.0:8787"
    assert mgr.status.phase == Phase.RUNNING

    mgr.runtime._parse_armodule_line("Host IP:      192.168.1.42")
    assert mgr.status.host_ip == "192.168.1.42"

    mgr.runtime._parse_armodule_line("Robot IP:     192.168.12.1")
    assert mgr.status.robot_ip == "192.168.12.1"


def test_parse_websocket_banner_before_ready(tmp_path: Path) -> None:
    mgr = ProcessManager(root=tmp_path)
    mgr.runtime.update_status(phase=Phase.STARTING)
    mgr.runtime._parse_armodule_line(
        "WebSocket:    ws://0.0.0.0:8787 (not listening yet — booting DimOS stack…)"
    )
    assert mgr.status.websocket_url == "ws://0.0.0.0:8787"
    assert mgr.status.phase == Phase.STARTING

    mgr.runtime._parse_armodule_line(
        "16:33:23.496[inf][s-ar/dimos/ar/module.py] ARModule started websocket=ws://0.0.0.0:8787"
    )
    assert mgr.status.websocket_url == "ws://0.0.0.0:8787"
    assert mgr.status.phase == Phase.RUNNING


def test_parse_armodule_ready_ascii_dash(tmp_path: Path) -> None:
    mgr = ProcessManager(root=tmp_path)
    mgr.runtime._parse_armodule_line("ARModule ready - ws://127.0.0.1:8787")
    assert mgr.status.websocket_url == "ws://127.0.0.1:8787"


def test_start_sh_openai_log_does_not_set_status_warning(tmp_path: Path) -> None:
    mgr = ProcessManager(root=tmp_path)
    mgr.runtime._parse_armodule_line(
        "Warning: OPENAI_API_KEY is unset — agent mode will not work until it is set."
    )
    assert mgr.status.warning is None


def test_parse_strips_ansi_and_simulated_robot_ip(tmp_path: Path) -> None:
    mgr = ProcessManager(root=tmp_path)
    mgr.runtime._parse_armodule_line("\033[32mHost IP:      10.23.159.29\033[0m")
    assert mgr.status.host_ip == "10.23.159.29"

    mgr.runtime._parse_armodule_line("Robot IP:     simulated")
    assert mgr.status.robot_ip == "simulated"


def test_parse_pin_after_ready(tmp_path: Path) -> None:
    mgr = ProcessManager(root=tmp_path)
    mgr.runtime._parse_armodule_line("ARModule ready — ws://0.0.0.0:8787")
    mgr.runtime._parse_armodule_line("Host IP:      192.168.1.42")
    mgr.runtime._parse_armodule_line("Robot IP:     192.168.12.1")
    mgr.runtime._parse_armodule_line("\033[32mPIN: 123456\033[0m")
    assert mgr.status.phase == Phase.RUNNING
    assert mgr.status.pin == "123456"
    assert mgr.snapshot()["pin"] == "123456"


def test_snapshot_includes_host_ip_not_spectacles(tmp_path: Path) -> None:
    mgr = ProcessManager(root=tmp_path)
    mgr.dependencies.update_status(check_ok=True)
    mgr.observe_host_ip("192.168.1.9")
    mgr.runtime.update_status(blueprint="unitree_go2_ar")
    mgr.runtime.update_status(client="webxr")
    mgr.runtime.update_status(webxr_local_url=f"https://localhost:{WEBXR_PORT}")
    mgr.runtime.update_status(webxr_url=f"https://192.168.1.9:{WEBXR_PORT}")
    snap = mgr.snapshot()
    assert snap["check_ok"] is True
    assert snap["host_ip"] == "192.168.1.9"
    assert "spectacles_ip" not in snap
    assert snap["webxr_local_url"] == "https://localhost:5173"
    assert snap["webxr_url"] == "https://192.168.1.9:5173"
    assert "default_clone_dir" in snap


def test_abs_dimos_python_keeps_venv_symlink(tmp_path: Path) -> None:
    venv_bin = tmp_path / "dimos" / ".venv" / "bin"
    venv_bin.mkdir(parents=True)
    base = tmp_path / "uv-python"
    base.write_text("#!/bin/sh\n", encoding="utf-8")
    base.chmod(0o755)
    (venv_bin / "python").symlink_to(base)
    venv_python = venv_bin / "python3"
    venv_python.symlink_to("python")
    assert Path(venv_python).resolve() == base.resolve()
    kept = abs_dimos_python(str(venv_python))
    assert Path(kept) == venv_bin.resolve() / "python3"
    assert kept != str(base.resolve())


def test_check_ok_regexes_match_setup_output() -> None:
    assert _RE_CHECK_OK.match("CHECK_OK=1")
    assert _RE_CHECK_OK.match("CHECK_OK=0")
    assert _RE_DIMOS_PYTHON.match("DIMOS_PYTHON=/tmp/dimos/.venv/bin/python3")
    assert _RE_DIMOS_VERSION.match("DIMOS_VERSION=0.4.0")
    assert _RE_DIMOS_REF.match("DIMOS_REF=main abc123")
    assert _RE_CHECK_OK.match("CHECK_OK_GO2=1") is None


@pytest.mark.parametrize("address", ["10.0.0.8", "127.0.0.1", None])
def test_detect_lan_ip(address, monkeypatch) -> None:
    from unittest.mock import Mock
    sock = Mock()
    if address is None:
        sock.connect.side_effect = OSError("no route")
    else:
        sock.getsockname.return_value = (address, 1234)
    monkeypatch.setattr("armodule.socket.socket", lambda *args: sock)
    assert detect_lan_ip() == (address if address and not address.startswith("127.") else "unknown")
    sock.close.assert_called_once()


def test_webxr_snapshot_shows_shared_pin(tmp_path: Path) -> None:
    mgr = ProcessManager(root=tmp_path)
    mgr.runtime.update_status(client="webxr")
    mgr.runtime.update_status(webxr_url="https://192.168.1.9:5173")
    mgr.runtime._parse_armodule_line("PIN: 123456")
    assert mgr.snapshot()["pin"] == "123456"
    assert mgr.snapshot()["webxr_url"] == "https://192.168.1.9:5173"


def test_unknown_shell_ip_does_not_erase_detected_address(tmp_path: Path) -> None:
    mgr = ProcessManager(root=tmp_path)
    mgr.observe_host_ip("192.168.1.42")
    mgr.runtime._parse_armodule_line("Host IP:      unknown")
    assert mgr.status.host_ip == "192.168.1.42"


@pytest.mark.parametrize("ansi", [False, True])
def test_vite_urls_recover_unknown_address(tmp_path: Path, ansi: bool) -> None:
    mgr = ProcessManager(root=tmp_path)
    mgr.observe_host_ip("unknown")
    mgr.runtime._parse_webxr_line("  ➜  Local:   https://localhost:5173/")
    line = "  ➜  Network: https://192.168.1.181:5173/"
    if ansi:
        line = "\x1b[32m" + line + "\x1b[0m"
    mgr.runtime._parse_webxr_line(line)
    assert mgr.status.webxr_url == "https://192.168.1.181:5173/"
    assert mgr.status.webxr_local_url == "https://localhost:5173/"
    assert mgr.status.host_ip == "192.168.1.181"
    mgr.runtime._parse_webxr_line("  ➜  Network: https://172.17.0.1:5173/")
    assert mgr.status.webxr_url == "https://192.168.1.181:5173/"


def test_vite_urls_prefer_default_route_interface(tmp_path: Path) -> None:
    mgr = ProcessManager(root=tmp_path)
    mgr.observe_host_ip("192.168.1.42")
    mgr.runtime.update_status(webxr_url="https://192.168.1.42:5173")
    mgr.runtime._parse_webxr_line("  ➜  Network: https://172.17.0.1:5173/")
    assert mgr.status.webxr_url == "https://192.168.1.42:5173"
    mgr.runtime._parse_webxr_line("  ➜  Network: https://192.168.1.42:5173/")
    assert mgr.status.webxr_url == "https://192.168.1.42:5173/"
