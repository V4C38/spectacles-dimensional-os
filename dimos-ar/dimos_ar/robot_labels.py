"""Human-readable labels for discovered Unitree robots."""

from __future__ import annotations

from dimos.robot.unitree.go2.cli.landiscovery import Go2Device

DISCOVERED_ROBOT_TYPE = "Go2"

_SERIAL_PREFIXES: list[tuple[str, str]] = [
    ("B42D2", "Go2"),
    ("B42D1", "Go2"),
    ("B42D", "Go2"),
]


def robot_type_from_serial(serial: str) -> str:
    for prefix, label in _SERIAL_PREFIXES:
        if serial.startswith(prefix):
            return label
    return DISCOVERED_ROBOT_TYPE


def format_discovered_robot(device: Go2Device) -> str:
    rtype = robot_type_from_serial(device.serial)
    return f"{rtype} {device.serial}"
