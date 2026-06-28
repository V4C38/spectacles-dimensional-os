"""Fire-and-forget adapter motion dispatch with last-writer-wins intent arbiter."""

from __future__ import annotations

from collections.abc import Callable
from enum import StrEnum
import threading
from typing import TYPE_CHECKING

from dimos.ar.bridge.adapter_rpc_dispatch import dispatch_adapter_nowait
from dimos.utils.logging_config import setup_logger

if TYPE_CHECKING:
    from dimos.ar.adapters.base import ARRobotAdapterSpec
    from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped

logger = setup_logger()

CompleteCallback = Callable[[bool, BaseException | None], None]


class _ActiveIntent(StrEnum):
    NONE = "none"
    JOYSTICK = "joystick"
    NAVIGATING = "navigating"


class AdapterMotionRouter:
    """Last-writer-wins arbiter for joystick vs navigation adapter RPC."""

    def __init__(self, adapter: ARRobotAdapterSpec) -> None:
        self._adapter = adapter
        self._lock = threading.Lock()
        self._active_intent = _ActiveIntent.NONE

    def send_joystick_command(
        self,
        vx: float,
        vy: float,
        wz: float,
        *,
        on_complete: CompleteCallback | None = None,
    ) -> None:
        stop = (float(vx), float(vy), float(wz)) == (0.0, 0.0, 0.0)
        with self._lock:
            if not stop and self._active_intent == _ActiveIntent.NAVIGATING:
                dispatch_adapter_nowait(self._adapter.cancel_nav_goal)
            self._active_intent = _ActiveIntent.NONE if stop else _ActiveIntent.JOYSTICK
        dispatch_adapter_nowait(self._adapter.send_joystick_command, vx, vy, wz)
        self._invoke_complete(on_complete, True, None)

    def send_nav_goal(
        self,
        goal: PoseStamped,
        *,
        on_complete: CompleteCallback | None = None,
    ) -> None:
        with self._lock:
            if self._active_intent == _ActiveIntent.JOYSTICK:
                dispatch_adapter_nowait(self._adapter.send_joystick_command, 0.0, 0.0, 0.0)
            self._active_intent = _ActiveIntent.NAVIGATING
        try:
            dispatch_adapter_nowait(self._adapter.send_nav_goal, goal)
        except BaseException as exc:
            with self._lock:
                self._active_intent = _ActiveIntent.NONE
            self._invoke_complete(on_complete, False, exc)
            return
        self._invoke_complete(on_complete, True, None)

    def cancel_nav_goal(self, *, on_complete: CompleteCallback | None = None) -> None:
        with self._lock:
            self._active_intent = _ActiveIntent.NONE
        try:
            dispatch_adapter_nowait(self._adapter.cancel_nav_goal)
        except BaseException as exc:
            self._invoke_complete(on_complete, False, exc)
            return
        self._invoke_complete(on_complete, True, None)

    def emergency_stop(self, *, on_complete: CompleteCallback | None = None) -> None:
        with self._lock:
            self._active_intent = _ActiveIntent.NONE
        try:
            dispatch_adapter_nowait(self._adapter.emergency_stop)
        except BaseException as exc:
            self._invoke_complete(on_complete, False, exc)
            return
        self._invoke_complete(on_complete, True, None)

    def reset_intent(self) -> None:
        with self._lock:
            self._active_intent = _ActiveIntent.NONE

    @staticmethod
    def _invoke_complete(
        callback: CompleteCallback | None,
        ok: bool,
        err: BaseException | None,
    ) -> None:
        if callback is None:
            return
        try:
            callback(ok, err)
        except Exception:
            logger.exception("adapter motion router callback failed")
