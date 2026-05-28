from __future__ import annotations

import multiprocessing
import os
from dataclasses import dataclass

from dimos.core.global_config import global_config
from dimos.robot.unitree.go2.cli.landiscovery import Go2Device, discover

from dimos_ar.robot_labels import format_discovered_robot
from dimos_ar.robot_select import RobotSelectionError, is_interactive_terminal, select_robot

REPLAY_ROBOT_ID = "go2"
_DEFAULT_DISCOVER_TIMEOUT = 2.0


@dataclass(frozen=True)
class LiveRobot:
    serial: str


@dataclass(frozen=True)
class ReplayMode:
    reason: str

    @property
    def robot_id(self) -> str:
        return REPLAY_ROBOT_ID


def _discover_timeout() -> float:
    raw = os.environ.get("DISCOVER_TIMEOUT")
    if raw is None:
        return _DEFAULT_DISCOVER_TIMEOUT
    return float(raw)


def _force_replay() -> bool:
    return os.environ.get("FORCE_REPLAY", "").lower() in ("1", "true", "yes")


def _prefer_serial() -> str | None:
    value = os.environ.get("ROBOT_SERIAL")
    if value is None or not value.strip():
        return None
    return value.strip()


def discover_devices(*, timeout: float | None = None) -> list[Go2Device]:
    return discover(timeout=timeout if timeout is not None else _discover_timeout())


def resolve_ip_for_serial(serial: str, *, timeout: float | None = None) -> str | None:
    """Return the current LAN IP for a Go2 serial, or None if not found."""
    for device in discover_devices(timeout=timeout):
        if device.serial == serial:
            return device.ip
    return None


def apply_robot_bootstrap() -> LiveRobot | ReplayMode:
    """Discover robots, optionally prompt the user, configure DimOS global_config."""
    global_config.update(robot_ip=None, replay=False)

    if _force_replay():
        global_config.update(replay=True)
        print("FORCE_REPLAY set — replay mode (no robot).", flush=True)
        return ReplayMode(reason="FORCE_REPLAY")

    print("Searching for robots...", flush=True)
    devices = discover_devices()

    if not devices:
        global_config.update(replay=True)
        print("No Go2 found on LAN — replay mode.", flush=True)
        return ReplayMode(reason="no robots on LAN")

    prefer_serial = _prefer_serial()
    interactive = is_interactive_terminal()

    try:
        chosen = select_robot(
            devices,
            prefer_serial=prefer_serial,
            interactive=interactive,
        )
    except RobotSelectionError as exc:
        raise SystemExit(str(exc)) from exc

    label = format_discovered_robot(chosen)
    if len(devices) == 1 and prefer_serial is None:
        print(f"Found 1 robot: {label} — connecting.", flush=True)
    else:
        print(f"Connecting to {label}.", flush=True)

    global_config.update(robot_ip=chosen.ip, replay=False)
    return LiveRobot(serial=chosen.serial)


_DISCOVERY_DONE_KEY = "DIMOS_AR_DISCOVERY_DONE"


def _bootstrap_from_env() -> LiveRobot | ReplayMode:
    """Worker subprocess: main process already ran discovery; read its decision from env."""
    if os.environ.get("DIMOS_AR_REPLAY", "").lower() in ("1", "true", "yes"):
        global_config.update(replay=True, robot_ip=None)
        return ReplayMode(reason="worker")
    serial = _prefer_serial()
    if serial:
        global_config.update(replay=False)
        return LiveRobot(serial=serial)
    global_config.update(replay=True, robot_ip=None)
    return ReplayMode(reason="worker")


def _is_worker() -> bool:
    """True in a DimOS worker subprocess (not the coordinator)."""
    if multiprocessing.parent_process() is not None:
        return True
    return os.environ.get(_DISCOVERY_DONE_KEY) == "1"


def bootstrap_for_blueprint() -> LiveRobot | ReplayMode:
    """Discover robots once in the coordinator; workers must not re-bind UDP discovery."""
    if _is_worker():
        return _bootstrap_from_env()
    result = apply_robot_bootstrap()
    os.environ[_DISCOVERY_DONE_KEY] = "1"
    if isinstance(result, LiveRobot):
        os.environ["ROBOT_SERIAL"] = result.serial
        os.environ["DIMOS_AR_REPLAY"] = "0"
    else:
        os.environ["DIMOS_AR_REPLAY"] = "1"
    return result
