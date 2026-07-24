"""Direct motion stream publish with last-writer-wins intent arbiter."""

from __future__ import annotations

from collections.abc import Callable
from enum import StrEnum
import threading
import time
from typing import TYPE_CHECKING

from dimos_lcm.std_msgs import Bool

from dimos.msgs.geometry_msgs.Twist import Twist
from dimos.msgs.geometry_msgs.Vector3 import Vector3
from dimos.utils.logging_config import setup_logger

if TYPE_CHECKING:
    from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped

logger = setup_logger()

CompleteCallback = Callable[[bool, BaseException | None], None]

JOYSTICK_REPUBLISH_HZ = 12
_MOTION_LOG_INTERVAL_S = 2.0


class _ActiveIntent(StrEnum):
    NONE = "none"
    JOYSTICK = "joystick"
    NAVIGATING = "navigating"


class MotionRouter:
    """Last-writer-wins arbiter; publishes directly to bridge Out streams."""

    def __init__(
        self,
        *,
        publish_cmd_vel: Callable[[Twist], None],
        publish_nav_goal: Callable[[PoseStamped], None],
        publish_stop_movement: Callable[[Bool], None] | None = None,
        hard_stop: Callable[[], None] | None = None,
        on_nav_preempted: Callable[[], None] | None = None,
    ) -> None:
        self._publish_cmd_vel = publish_cmd_vel
        self._publish_nav_goal = publish_nav_goal
        self._publish_stop_movement = publish_stop_movement
        self._hard_stop = hard_stop
        self._on_nav_preempted = on_nav_preempted
        self._lock = threading.Lock()
        self._active_intent = _ActiveIntent.NONE
        self._joystick_lock = threading.Lock()
        self._joystick_thread: threading.Thread | None = None
        self._joystick_target = (0.0, 0.0, 0.0)
        self._joystick_publish_count = 0
        self._joystick_publish_window_start = time.monotonic()
        self._last_motion_log_mono = 0.0

    def send_joystick_command(
        self,
        vx: float,
        vy: float,
        wz: float,
        *,
        on_complete: CompleteCallback | None = None,
    ) -> None:
        stop = (float(vx), float(vy), float(wz)) == (0.0, 0.0, 0.0)
        preempted = False
        try:
            with self._lock:
                if not stop and self._active_intent == _ActiveIntent.NAVIGATING:
                    self._publish_cancel_transports()
                    preempted = True
                self._active_intent = _ActiveIntent.NONE if stop else _ActiveIntent.JOYSTICK
            if preempted and self._on_nav_preempted is not None:
                self._on_nav_preempted()

            target = (float(vx), float(vy), float(wz))
            with self._joystick_lock:
                self._joystick_target = target

            if stop:
                self._publish_joystick_twist(*target)
            else:
                self._publish_joystick_twist(*target)
                with self._joystick_lock:
                    if self._joystick_thread is None or not self._joystick_thread.is_alive():
                        thread = threading.Thread(
                            target=self._joystick_loop,
                            daemon=True,
                            name="ar-joystick-republish",
                        )
                        self._joystick_thread = thread
                        thread.start()
        except Exception as exc:
            logger.exception("motion router send_joystick_command failed")
            self._invoke_complete(on_complete, False, exc)
            return
        self._log_motion("send_joystick_command", vx=vx, vy=vy, wz=wz)
        self._invoke_complete(on_complete, True, None)

    def send_nav_goal(
        self,
        goal: PoseStamped,
        *,
        on_complete: CompleteCallback | None = None,
    ) -> None:
        try:
            with self._lock:
                if self._active_intent == _ActiveIntent.JOYSTICK:
                    self._stop_joystick_republisher()
                    self._publish_joystick_twist(0.0, 0.0, 0.0)
                self._active_intent = _ActiveIntent.NAVIGATING
            self._publish_nav_goal(goal)
        except Exception as exc:
            logger.exception("motion router send_nav_goal failed")
            with self._lock:
                self._active_intent = _ActiveIntent.NONE
            self._invoke_complete(on_complete, False, exc)
            return
        self._log_motion("send_nav_goal")
        self._invoke_complete(on_complete, True, None)

    def cancel_nav_goal(self, *, on_complete: CompleteCallback | None = None) -> None:
        try:
            self._halt_motion()
            with self._lock:
                self._active_intent = _ActiveIntent.NONE
            self._publish_cancel_transports()
        except Exception as exc:
            logger.exception("motion router cancel_nav_goal failed")
            self._invoke_complete(on_complete, False, exc)
            return
        self._log_motion("cancel_nav_goal")
        self._invoke_complete(on_complete, True, None)

    def emergency_stop(self, *, on_complete: CompleteCallback | None = None) -> None:
        try:
            self._halt_motion()
            with self._lock:
                self._active_intent = _ActiveIntent.NONE
            self._publish_cancel_transports()
            if self._hard_stop is not None:
                threading.Thread(
                    target=self._invoke_hard_stop,
                    daemon=True,
                    name="ar-hard-stop",
                ).start()
        except Exception as exc:
            logger.exception("motion router emergency_stop failed")
            self._invoke_complete(on_complete, False, exc)
            return
        self._log_motion("emergency_stop")
        self._invoke_complete(on_complete, True, None)

    def reset_intent(self) -> None:
        with self._lock:
            self._active_intent = _ActiveIntent.NONE

    def validate_transports(
        self,
        *,
        has_pose_goal: bool,
        has_cancel: bool,
    ) -> None:
        if not has_pose_goal:
            logger.warning("motion router has no navigation goal transport")
        if not has_cancel:
            logger.warning("motion router has no cancellation transport")

    def _halt_motion(self) -> None:
        self._stop_joystick_republisher()
        self._publish_joystick_twist(0.0, 0.0, 0.0)

    def _stop_joystick_republisher(self) -> None:
        with self._joystick_lock:
            self._joystick_target = (0.0, 0.0, 0.0)

    def _publish_cancel_transports(self) -> None:
        if self._publish_stop_movement is not None:
            self._publish_stop_movement(Bool(data=True))

    def _invoke_hard_stop(self) -> None:
        if self._hard_stop is None:
            return
        try:
            self._hard_stop()
        except Exception:
            logger.exception("profile hard_stop failed")

    def _joystick_loop(self) -> None:
        interval = 1.0 / JOYSTICK_REPUBLISH_HZ
        while True:
            with self._joystick_lock:
                vx, vy, wz = self._joystick_target
            if (vx, vy, wz) == (0.0, 0.0, 0.0):
                break
            self._publish_joystick_twist(vx, vy, wz)
            time.sleep(interval)

    def _publish_joystick_twist(self, vx: float, vy: float, wz: float) -> None:
        now = time.monotonic()
        self._joystick_publish_count += 1
        window = now - self._joystick_publish_window_start
        if window >= 1.0:
            logger.info(
                "joystick republisher Hz",
                hz=round(self._joystick_publish_count / window, 1),
            )
            self._joystick_publish_count = 0
            self._joystick_publish_window_start = now
        self._publish_cmd_vel(
            Twist(
                linear=Vector3(vx, vy, 0.0),
                angular=Vector3(0.0, 0.0, wz),
            )
        )

    def _log_motion(self, method: str, **fields: object) -> None:
        now = time.monotonic()
        if now - self._last_motion_log_mono < _MOTION_LOG_INTERVAL_S:
            return
        self._last_motion_log_mono = now
        logger.info(
            "motion router direct publish",
            method=method,
            publish_mono=round(now, 6),
            **fields,
        )

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
            logger.exception("motion router callback failed")
