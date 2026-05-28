from __future__ import annotations

import sys

from dimos.robot.unitree.go2.cli.landiscovery import Go2Device

from dimos_ar.robot_labels import DISCOVERED_ROBOT_TYPE, format_discovered_robot


class RobotSelectionError(RuntimeError):
    """Raised when a robot cannot be selected (missing serial, ambiguous LAN, etc.)."""


def _sorted_devices(devices: list[Go2Device]) -> list[Go2Device]:
    return sorted(devices, key=lambda d: d.serial)


def _match_serial(devices: list[Go2Device], prefer_serial: str) -> Go2Device:
    for device in devices:
        if device.serial == prefer_serial:
            return device
    available = ", ".join(format_discovered_robot(d) for d in devices)
    raise RobotSelectionError(
        f"{DISCOVERED_ROBOT_TYPE} serial {prefer_serial!r} not found on LAN. "
        f"Available: {available}",
    )


def _prompt_questionary(devices: list[Go2Device]) -> Go2Device:
    import questionary

    serial = questionary.select(
        "Select robot to connect to:",
        choices=[format_discovered_robot(d) for d in devices],
    ).ask()
    if serial is not None:
        # choice is full label "Go2 SERIAL"; extract serial after type prefix.
        prefix = f"{DISCOVERED_ROBOT_TYPE} "
        if serial.startswith(prefix):
            serial = serial[len(prefix) :]
    if serial is None:
        raise RobotSelectionError("Robot selection cancelled.")
    return _match_serial(devices, serial)


def _prompt_numbered(devices: list[Go2Device]) -> Go2Device:
    print("\nSelect robot to connect to:")
    for index, device in enumerate(devices, start=1):
        print(f"  {index}. {format_discovered_robot(device)}")
    while True:
        raw = input(f"Choice [1-{len(devices)}]: ").strip()
        if not raw:
            choice = 1
        else:
            try:
                choice = int(raw)
            except ValueError:
                print("Enter a number.")
                continue
        if 1 <= choice <= len(devices):
            return devices[choice - 1]
        print(f"Enter a value between 1 and {len(devices)}.")


def select_robot(
    devices: list[Go2Device],
    *,
    prefer_serial: str | None,
    interactive: bool,
) -> Go2Device:
    """Pick one Go2 from a discovery result."""
    if not devices:
        raise RobotSelectionError("No robots to select from.")

    ordered = _sorted_devices(devices)

    if prefer_serial is not None:
        return _match_serial(ordered, prefer_serial)

    if len(ordered) == 1:
        return ordered[0]

    if not interactive:
        labels = ", ".join(format_discovered_robot(d) for d in ordered)
        raise RobotSelectionError(
            f"Found {len(ordered)} robots on LAN ({labels}). "
            "Set ROBOT_SERIAL to choose one, or run from an interactive terminal.",
        )

    print(f"\nFound {len(ordered)} robots.\n")
    try:
        return _prompt_questionary(ordered)
    except ImportError:
        return _prompt_numbered(ordered)


def is_interactive_terminal() -> bool:
    """True when stdin is a TTY and CI is not forcing non-interactive mode."""
    import os

    if os.environ.get("CI"):
        return False
    return sys.stdin.isatty()
