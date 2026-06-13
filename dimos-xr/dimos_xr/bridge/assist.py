"""AssistDriver — robot-assisted baseline collection state machine.

State flow::

    IDLE → ESTIMATING → AWAITING_CONFIRM → COUNTDOWN → MOVE → DONE
    (any state) --abort--> AWAITING_CONFIRM  [stop motion first]

Design constraints:
- No timeouts anywhere. Tag loss never aborts any step.
- MOVE is open-loop / time-based: strafe left for MOVE_LEG_S, then right for
  2 x MOVE_LEG_S, then stop. No odom required, no displacement check.
- The robot is stopped only by an explicit zero Twist (Go2 WebRTC has no
  deadman). The abort path always calls assist_set_lateral_velocity(0.0).
- tick() is called from two threads concurrently; a single RLock guards all state.
"""

from __future__ import annotations

import math
import threading
import time
from enum import Enum
from typing import TYPE_CHECKING, Callable

from dimos.utils.logging_config import setup_logger

if TYPE_CHECKING:
    from dimos_xr.adapters.base import XRRobotAdapterSpec

logger = setup_logger()

# ── tunables ─────────────────────────────────────────────────────────────────
MOVE_SPEED: float = 0.4           # raw joystick deflection in [-1, 1] (not m/s)
MOVE_LEG_S: float = 3.0           # duration of the left leg; right leg = 2 x
MIN_ESTIMATING_OBS: int = 2       # observations needed to enter AWAITING_CONFIRM
ESTIMATING_SPREAD_M: float = 0.10 # max allowed XY tag-position spread
COUNTDOWN_DURATION_S: float = 3.0


class AssistState(str, Enum):
    IDLE = "idle"
    ESTIMATING = "estimating"
    AWAITING_CONFIRM = "awaiting_confirm"
    COUNTDOWN = "countdown"
    MOVE = "move"
    DONE = "done"


class AssistDriver:
    """Event-driven state machine for robot-assisted baseline collection.

    ``tick()`` must be called periodically (from the broadcast loop) and on
    every new tracker update (from the camera-frame pipeline). Both callers
    may run concurrently — all state is guarded by ``_lock``.
    """

    def __init__(
        self,
        *,
        adapter: XRRobotAdapterSpec,
        on_stage_change: Callable[[str, str], None] | None = None,
    ) -> None:
        self._adapter = adapter
        self._on_stage_change = on_stage_change   # (stage, message)
        self._lock = threading.RLock()

        # public-readable state
        self._state: AssistState = AssistState.IDLE
        self._abort_message: str = ""

        # per-session tracking
        self._countdown_start: float | None = None
        self._move_start_mono: float | None = None   # t0 for the open-loop timer
        self._move_right_started: bool = False        # guard: switch to right once only
        self._move_velocity_active: bool = False

        # ESTIMATING: world tag positions seen
        self._estimating_positions: list[tuple[float, float, float]] = []

    # ── public API ───────────────────────────────────────────────────────────

    @property
    def state(self) -> AssistState:
        with self._lock:
            return self._state

    @property
    def stage_label(self) -> str | None:
        """Wire value for assist_stage field in align_status."""
        with self._lock:
            s = self._state
        if s in (AssistState.IDLE, AssistState.DONE):
            return None
        return s.value

    @property
    def step_index(self) -> int:
        """1-based step index for the two-step assist flow.

        Step 1 (Pre-alignment): ESTIMATING, AWAITING_CONFIRM.
        Step 2 (Calibration): COUNTDOWN, MOVE, DONE.
        """
        with self._lock:
            s = self._state
        if s in (AssistState.ESTIMATING, AssistState.AWAITING_CONFIRM):
            return 1
        return 2  # COUNTDOWN through DONE

    @property
    def step_count(self) -> int:
        """Total number of steps in this assist routine."""
        return 2

    def progress_percent(self) -> int:
        """Return 0-100 progress for the *current* step.

        Step 1: grows with observations collected, saturates at 100 when confirmed.
        Step 2: 0 at COUNTDOWN, ramps 0-99 during MOVE, 100 at DONE.
        """
        with self._lock:
            s = self._state
            estimating_count = len(self._estimating_positions)
            move_start = self._move_start_mono

        if s == AssistState.ESTIMATING:
            return min(99, int(estimating_count / max(1, MIN_ESTIMATING_OBS) * 99))
        if s == AssistState.AWAITING_CONFIRM:
            return 100
        if s == AssistState.COUNTDOWN:
            return 0
        if s == AssistState.MOVE:
            if move_start is None:
                return 0
            elapsed = time.monotonic() - move_start
            total = 3.0 * MOVE_LEG_S
            return min(99, int(elapsed / total * 99))
        if s == AssistState.DONE:
            return 100
        return 0

    def start(self) -> None:
        """Enter ESTIMATING from IDLE. No-op if assist is not available."""
        with self._lock:
            if not self._adapter.assist_motion_available():
                return
            self._reset_internals()
            self._transition(AssistState.ESTIMATING, "Scan the robot tag to estimate its position")

    def on_align_stop(self) -> None:
        with self._lock:
            self._abort("Alignment stopped")

    def on_emergency_stop(self) -> None:
        with self._lock:
            self._abort("Emergency stop received")

    def on_new_session(self) -> None:
        """Called when a new align_start arrives — treat as abort."""
        with self._lock:
            self._abort("New session started")

    def on_client_disconnect(self) -> None:
        with self._lock:
            self._abort("Client disconnected")

    def on_assist_confirm(self) -> None:
        with self._lock:
            if self._state != AssistState.AWAITING_CONFIRM:
                logger.debug("assist_confirm ignored in state", state=self._state.value)
                return
            self._countdown_start = time.monotonic()
            self._transition(AssistState.COUNTDOWN, "Starting in 3…")

    def tick(
        self,
        *,
        obs_count: int,
        latest_obs_pos_world: tuple[float, float, float] | None,
    ) -> None:
        """Drive the state machine.

        Args:
            obs_count: Total number of observations in the tracker window.
            latest_obs_pos_world: World-frame XYZ position of the most-recently
                added observation tag, or None if no tag was detected.
        """
        with self._lock:
            self._tick_locked(obs_count, latest_obs_pos_world)

    # ── internal helpers ─────────────────────────────────────────────────────

    def _reset_internals(self) -> None:
        self._countdown_start = None
        self._move_start_mono = None
        self._move_right_started = False
        self._move_velocity_active = False
        self._estimating_positions = []
        self._abort_message = ""

    def _transition(self, new_state: AssistState, message: str) -> None:
        old = self._state
        self._state = new_state
        logger.info("AssistDriver transition", from_=old.value, to=new_state.value, msg=message)
        if self._on_stage_change is not None:
            try:
                self._on_stage_change(
                    new_state.value if new_state not in (AssistState.IDLE, AssistState.DONE) else "",
                    message,
                )
            except Exception:
                pass

    def _abort(self, reason: str) -> None:
        if self._state == AssistState.IDLE:
            return
        self._stop_motion()
        self._abort_message = reason
        self._transition(AssistState.AWAITING_CONFIRM, reason)

    def _stop_motion(self) -> None:
        """Publish a zero Twist to stop the robot. Safe to call repeatedly."""
        if self._move_velocity_active:
            try:
                self._adapter.assist_set_lateral_velocity(0.0)
            except Exception:
                pass
            self._move_velocity_active = False

    def _tick_locked(
        self,
        obs_count: int,
        latest_obs_pos_world: tuple[float, float, float] | None,
    ) -> None:
        state = self._state

        if state == AssistState.IDLE:
            return

        if state == AssistState.ESTIMATING:
            if latest_obs_pos_world is not None:
                self._estimating_positions.append(latest_obs_pos_world)
            if len(self._estimating_positions) >= MIN_ESTIMATING_OBS:
                xs = [p[0] for p in self._estimating_positions]
                zs = [p[2] for p in self._estimating_positions]
                spread = math.sqrt(
                    (max(xs) - min(xs)) ** 2 + (max(zs) - min(zs)) ** 2
                )
                if spread <= ESTIMATING_SPREAD_M:
                    self._transition(
                        AssistState.AWAITING_CONFIRM,
                        "Robot position estimated — press Continue to start assisted calibration",
                    )
            return

        if state == AssistState.AWAITING_CONFIRM:
            return

        if state == AssistState.COUNTDOWN:
            if self._countdown_start is None:
                self._countdown_start = time.monotonic()
            elapsed = time.monotonic() - self._countdown_start
            remaining = max(0.0, COUNTDOWN_DURATION_S - elapsed)
            if remaining > 0:
                label = max(1, math.ceil(remaining))
                if self._on_stage_change:
                    try:
                        self._on_stage_change(AssistState.COUNTDOWN.value, f"Starting in {label}…")
                    except Exception:
                        pass
            else:
                # Enter MOVE: start left leg
                self._move_start_mono = time.monotonic()
                self._move_right_started = False
                self._move_velocity_active = True
                self._adapter.assist_set_lateral_velocity(MOVE_SPEED)
                self._transition(AssistState.MOVE, "Robot moving left…")
            return

        if state == AssistState.MOVE:
            if self._move_start_mono is None:
                return
            elapsed = time.monotonic() - self._move_start_mono
            total = 3.0 * MOVE_LEG_S
            if elapsed >= total:
                # Both legs done — stop and finish
                self._adapter.assist_set_lateral_velocity(0.0)
                self._move_velocity_active = False
                self._transition(AssistState.DONE, "Baseline collection complete")
            elif elapsed >= MOVE_LEG_S and not self._move_right_started:
                # Switch to right leg (once)
                self._move_right_started = True
                self._adapter.assist_set_lateral_velocity(-MOVE_SPEED)
                if self._on_stage_change:
                    try:
                        self._on_stage_change(AssistState.MOVE.value, "Robot moving right…")
                    except Exception:
                        pass
            return
