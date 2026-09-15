"""Status line parsing from start.sh / setup.sh output."""

from __future__ import annotations

from pathlib import Path

from armodule import (
    _RE_CHECK_OK,
    _RE_DIMOS_PYTHON,
    _RE_DIMOS_REF,
    _RE_DIMOS_VERSION,
    WEBXR_PORT,
    Phase,
    ProcessManager,
    detect_lan_ip,
)


def test_parse_armodule_ready_and_ips(tmp_path: Path) -> None:
    mgr = ProcessManager(root=tmp_path)
    mgr._parse_armodule_line("ARModule ready — ws://0.0.0.0:8787")
    assert mgr.status.websocket_url == "ws://0.0.0.0:8787"
    assert mgr.status.phase == Phase.RUNNING

    mgr._parse_armodule_line("Host IP:      192.168.1.42")
    assert mgr.status.host_ip == "192.168.1.42"

    mgr._parse_armodule_line("Robot IP:     192.168.12.1")
    assert mgr.status.robot_ip == "192.168.12.1"


def test_parse_websocket_banner_before_ready(tmp_path: Path) -> None:
    mgr = ProcessManager(root=tmp_path)
    mgr.status.phase = Phase.STARTING
    mgr._parse_armodule_line(
        "WebSocket:    ws://0.0.0.0:8787 (not listening yet — booting DimOS stack…)"
    )
    assert mgr.status.websocket_url == "ws://0.0.0.0:8787"
    assert mgr.status.phase == Phase.STARTING

    mgr._parse_armodule_line(
        "16:33:23.496[inf][s-ar/dimos/ar/module.py] ARModule started websocket=ws://0.0.0.0:8787"
    )
    assert mgr.status.websocket_url == "ws://0.0.0.0:8787"
    assert mgr.status.phase == Phase.RUNNING


def test_parse_armodule_ready_ascii_dash(tmp_path: Path) -> None:
    mgr = ProcessManager(root=tmp_path)
    mgr._parse_armodule_line("ARModule ready - ws://127.0.0.1:8787")
    assert mgr.status.websocket_url == "ws://127.0.0.1:8787"


def test_start_sh_openai_log_does_not_set_status_warning(tmp_path: Path) -> None:
    mgr = ProcessManager(root=tmp_path)
    mgr._parse_armodule_line(
        "Warning: OPENAI_API_KEY is unset — agent mode will not work until it is set."
    )
    assert mgr.status.warning is None


def test_parse_strips_ansi_and_simulated_robot_ip(tmp_path: Path) -> None:
    mgr = ProcessManager(root=tmp_path)
    mgr._parse_armodule_line("\033[32mHost IP:      10.23.159.29\033[0m")
    assert mgr.status.host_ip == "10.23.159.29"

    mgr._parse_armodule_line("Robot IP:     simulated")
    assert mgr.status.robot_ip == "simulated"


def test_snapshot_includes_host_ip_not_spectacles(tmp_path: Path) -> None:
    mgr = ProcessManager(root=tmp_path)
    mgr.status.check_ok = True
    mgr.status.host_ip = "192.168.1.9"
    mgr.status.blueprint = "unitree_go2_ar"
    mgr.status.client = "webxr"
    mgr.status.webxr_local_url = f"https://localhost:{WEBXR_PORT}"
    mgr.status.webxr_url = f"https://192.168.1.9:{WEBXR_PORT}"
    snap = mgr.snapshot()
    assert snap["check_ok"] is True
    assert snap["host_ip"] == "192.168.1.9"
    assert "spectacles_ip" not in snap
    assert snap["webxr_local_url"] == "https://localhost:5173"
    assert snap["webxr_url"] == "https://192.168.1.9:5173"
    assert "default_clone_dir" in snap


def test_check_ok_regexes_match_setup_output() -> None:
    assert _RE_CHECK_OK.match("CHECK_OK=1")
    assert _RE_CHECK_OK.match("CHECK_OK=0")
    assert _RE_DIMOS_PYTHON.match("DIMOS_PYTHON=/tmp/dimos/.venv/bin/python3")
    assert _RE_DIMOS_VERSION.match("DIMOS_VERSION=0.4.0")
    assert _RE_DIMOS_REF.match("DIMOS_REF=main abc123")
    assert _RE_CHECK_OK.match("CHECK_OK_GO2=1") is None


def test_detect_lan_ip_returns_string() -> None:
    ip = detect_lan_ip()
    assert isinstance(ip, str)
    assert ip
