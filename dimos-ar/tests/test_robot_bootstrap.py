from __future__ import annotations

from unittest.mock import patch

from dimos.core.global_config import global_config
from dimos.robot.unitree.go2.cli.landiscovery import Go2Device

from dimos_ar.robot_bootstrap import LiveRobot, ReplayMode, apply_robot_bootstrap


def _device(serial: str, ip: str = "192.168.1.10") -> Go2Device:
    return Go2Device(serial=serial, ip=ip, iface="wlan0")


@patch.dict("os.environ", {"FORCE_REPLAY": "1"}, clear=False)
def test_force_replay() -> None:
    result = apply_robot_bootstrap()
    assert isinstance(result, ReplayMode)
    assert global_config.replay is True


@patch("dimos_ar.robot_bootstrap.discover_devices", return_value=[])
@patch.dict("os.environ", {"FORCE_REPLAY": "", "ROBOT_SERIAL": ""}, clear=False)
def test_no_robots_replay(mock_discover) -> None:
    result = apply_robot_bootstrap()
    assert isinstance(result, ReplayMode)
    assert global_config.replay is True
    mock_discover.assert_called_once()


@patch("dimos_ar.robot_bootstrap.discover_devices", return_value=[_device("ONLY_ONE")])
@patch.dict("os.environ", {"FORCE_REPLAY": "", "ROBOT_SERIAL": "", "CI": "1"}, clear=False)
def test_single_robot_live(mock_discover, capsys) -> None:
    result = apply_robot_bootstrap()
    assert isinstance(result, LiveRobot)
    assert result.serial == "ONLY_ONE"
    assert global_config.replay is False
    assert global_config.robot_ip == "192.168.1.10"
    out = capsys.readouterr().out
    assert "Found 1 robot" in out
    assert "Go2" in out
    assert "ONLY_ONE" in out


@patch("dimos_ar.robot_bootstrap.discover_devices")
@patch.dict(
    "os.environ",
    {"FORCE_REPLAY": "", "ROBOT_SERIAL": "PICK_ME", "CI": "1"},
    clear=False,
)
def test_robot_serial_selects(mock_discover) -> None:
    mock_discover.return_value = [
        _device("OTHER", "10.0.0.1"),
        _device("PICK_ME", "10.0.0.2"),
    ]
    result = apply_robot_bootstrap()
    assert isinstance(result, LiveRobot)
    assert result.serial == "PICK_ME"
    assert global_config.robot_ip == "10.0.0.2"
