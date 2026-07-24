"""Status line parsing from start.sh / setup.sh output."""

from __future__ import annotations

from pathlib import Path

from bridge import Phase, ProcessManager


def test_parse_bridge_ready_and_ips(tmp_path: Path) -> None:
    mgr = ProcessManager(root=tmp_path)
    mgr._parse_bridge_line("Bridge ready — ws://0.0.0.0:8787")
    assert mgr.status.websocket_url == "ws://0.0.0.0:8787"
    assert mgr.status.phase == Phase.RUNNING

    mgr._parse_bridge_line("Spectacles:   enter 192.168.1.42 in the lens")
    assert mgr.status.spectacles_ip == "192.168.1.42"

    mgr._parse_bridge_line("Robot IP:     192.168.12.1")
    assert mgr.status.robot_ip == "192.168.12.1"


def test_parse_websocket_banner_before_ready(tmp_path: Path) -> None:
    mgr = ProcessManager(root=tmp_path)
    mgr.status.phase = Phase.STARTING
    mgr._parse_bridge_line(
        "WebSocket:    ws://0.0.0.0:8787 (not listening yet — booting DimOS stack…)"
    )
    assert mgr.status.websocket_url == "ws://0.0.0.0:8787"
    assert mgr.status.phase == Phase.STARTING

    mgr._parse_bridge_line(
        "16:33:23.496[inf][s-ar/dimos/ar/bridge/module.py] ARBridge started websocket=ws://0.0.0.0:8787"
    )
    assert mgr.status.websocket_url == "ws://0.0.0.0:8787"
    assert mgr.status.phase == Phase.RUNNING


def test_parse_bridge_ready_ascii_dash(tmp_path: Path) -> None:
    mgr = ProcessManager(root=tmp_path)
    mgr._parse_bridge_line("Bridge ready - ws://127.0.0.1:8787")
    assert mgr.status.websocket_url == "ws://127.0.0.1:8787"


def test_openai_warning(tmp_path: Path) -> None:
    mgr = ProcessManager(root=tmp_path)
    mgr._parse_bridge_line("Warning: OPENAI_API_KEY is unset — agent mode will not work until it is set.")
    assert mgr.status.warning is not None
    assert "OPENAI_API_KEY" in mgr.status.warning


def test_parse_strips_ansi_and_simulated_robot_ip(tmp_path: Path) -> None:
    mgr = ProcessManager(root=tmp_path)
    mgr._parse_bridge_line("\033[32mSpectacles:   enter 10.23.159.29 in the lens\033[0m")
    assert mgr.status.spectacles_ip == "10.23.159.29"

    mgr._parse_bridge_line("Robot IP:     simulated")
    assert mgr.status.robot_ip == "simulated"


def test_snapshot_includes_per_stack_readiness(tmp_path: Path) -> None:
    mgr = ProcessManager(root=tmp_path)
    mgr.status.ready_go2 = True
    mgr.status.ready_g1 = False
    mgr.status.check_ok = True
    snap = mgr.snapshot()
    assert snap["ready_go2"] is True
    assert snap["ready_g1"] is False
    assert snap["check_ok"] is True
    assert "default_clone_dir" in snap


def test_check_ok_regexes_match_setup_output() -> None:
    from bridge import _RE_CHECK_OK, _RE_CHECK_OK_G1, _RE_CHECK_OK_GO2, _RE_DIMOS_PYTHON

    assert _RE_CHECK_OK_GO2.match("CHECK_OK_GO2=1")
    assert _RE_CHECK_OK_GO2.match("CHECK_OK_GO2=0")
    assert _RE_CHECK_OK_G1.match("CHECK_OK_G1=1")
    assert _RE_CHECK_OK_G1.match("CHECK_OK_G1=0")
    assert _RE_CHECK_OK.match("CHECK_OK=1")
    assert _RE_DIMOS_PYTHON.match("DIMOS_PYTHON=/tmp/dimos/.venv/bin/python3")
    assert _RE_CHECK_OK_GO2.match("CHECK_OK_GO2=1 ") is not None
    assert _RE_CHECK_OK_G1.match("CHECK_OK=1") is None
