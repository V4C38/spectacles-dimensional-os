from __future__ import annotations

from unittest.mock import patch

import pytest
from dimos.robot.unitree.go2.cli.landiscovery import Go2Device

from dimos_ar.robot_select import RobotSelectionError, select_robot


def _device(serial: str, ip: str = "10.0.0.1") -> Go2Device:
    return Go2Device(serial=serial, ip=ip, iface="wlan0")


def test_single_robot_auto_select() -> None:
    device = _device("SERIAL_A")
    chosen = select_robot([device], prefer_serial=None, interactive=False)
    assert chosen.serial == "SERIAL_A"


def test_prefer_serial_match() -> None:
    devices = [_device("SERIAL_A"), _device("SERIAL_B", "10.0.0.2")]
    chosen = select_robot(devices, prefer_serial="SERIAL_B", interactive=False)
    assert chosen.serial == "SERIAL_B"


def test_prefer_serial_missing_raises() -> None:
    devices = [_device("SERIAL_A")]
    with pytest.raises(RobotSelectionError, match="not found"):
        select_robot(devices, prefer_serial="MISSING", interactive=False)


def test_multiple_non_interactive_raises() -> None:
    devices = [_device("SERIAL_A"), _device("SERIAL_B", "10.0.0.2")]
    with pytest.raises(RobotSelectionError, match="ROBOT_SERIAL"):
        select_robot(devices, prefer_serial=None, interactive=False)


@patch("dimos_ar.robot_select._prompt_questionary")
def test_multiple_interactive_uses_picker(mock_prompt) -> None:
    mock_prompt.return_value = _device("SERIAL_B", "10.0.0.2")
    devices = [_device("SERIAL_A"), _device("SERIAL_B", "10.0.0.2")]
    chosen = select_robot(devices, prefer_serial=None, interactive=True)
    assert chosen.serial == "SERIAL_B"
    mock_prompt.assert_called_once()
