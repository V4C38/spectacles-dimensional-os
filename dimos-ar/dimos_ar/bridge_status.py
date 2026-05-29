from __future__ import annotations

import threading
from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal

from dimos_ar.robot_bootstrap import LiveRobot, ReplayMode

BridgeMode = Literal["live", "replay"]
RegistrationMethod = Literal["marker", "manual"] | None

StatusChangeCallback = Callable[[], None]


@dataclass(frozen=True)
class BridgeStatusSnapshot:
    robot_id: str
    mode: BridgeMode
    robot_connected: bool
    robot_model: str
    robot_serial: str | None
    streams_active: bool
    registered: bool
    reconnecting: bool
    registration_method: RegistrationMethod
    registration_approximate: bool


class BridgeStatusTracker:
    """Thread-safe bridge/robot state for WebSocket bridge_status messages."""

    def __init__(
        self,
        *,
        robot_id: str,
        mode: BridgeMode,
        robot_model: str,
        robot_serial: str | None,
        robot_connected: bool,
    ) -> None:
        self._lock = threading.Lock()
        self._robot_id = robot_id
        self._mode = mode
        self._robot_model = robot_model
        self._robot_serial = robot_serial
        self._robot_connected = robot_connected
        self._streams_active = False
        self._registered = False
        self._reconnecting = False
        self._registration_method: RegistrationMethod = None
        self._registration_approximate = False
        self._on_change: StatusChangeCallback | None = None

    def set_on_change(self, callback: StatusChangeCallback | None) -> None:
        with self._lock:
            self._on_change = callback

    def _notify(self) -> None:
        callback = self._on_change
        if callback is not None:
            callback()

    def set_streams_active(self, active: bool) -> None:
        with self._lock:
            if self._streams_active == active:
                return
            self._streams_active = active
        self._notify()

    def set_registered(
        self,
        registered: bool,
        *,
        method: RegistrationMethod | None = None,
        approximate: bool | None = None,
    ) -> None:
        with self._lock:
            next_method = self._registration_method if method is None else method
            next_approximate = (
                self._registration_approximate
                if approximate is None
                else approximate
            )
            if (
                self._registered == registered
                and self._registration_method == next_method
                and self._registration_approximate == next_approximate
            ):
                return
            self._registered = registered
            self._registration_method = next_method if registered else None
            self._registration_approximate = next_approximate if registered else False
        self._notify()

    def set_reconnecting(self, reconnecting: bool) -> None:
        with self._lock:
            if self._reconnecting == reconnecting:
                return
            self._reconnecting = reconnecting
        self._notify()

    def snapshot(self) -> BridgeStatusSnapshot:
        with self._lock:
            return BridgeStatusSnapshot(
                robot_id=self._robot_id,
                mode=self._mode,
                robot_connected=self._robot_connected,
                robot_model=self._robot_model,
                robot_serial=self._robot_serial,
                streams_active=self._streams_active,
                registered=self._registered,
                reconnecting=self._reconnecting,
                registration_method=self._registration_method,
                registration_approximate=self._registration_approximate,
            )


def tracker_from_bootstrap(
    bootstrap: LiveRobot | ReplayMode,
    *,
    robot_model: str,
) -> BridgeStatusTracker:
    if isinstance(bootstrap, LiveRobot):
        return BridgeStatusTracker(
            robot_id=bootstrap.serial,
            mode="live",
            robot_model=robot_model,
            robot_serial=bootstrap.serial,
            robot_connected=True,
        )
    return BridgeStatusTracker(
        robot_id=bootstrap.robot_id,
        mode="replay",
        robot_model=robot_model,
        robot_serial=None,
        robot_connected=True,
    )


bridge_status_tracker: BridgeStatusTracker | None = None


def get_bridge_status_tracker() -> BridgeStatusTracker | None:
    return bridge_status_tracker


def set_bridge_status_tracker(tracker: BridgeStatusTracker) -> None:
    global bridge_status_tracker
    bridge_status_tracker = tracker
