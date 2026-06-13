"""AssistDriver — robot-assisted baseline collection state machine.

State flow::

    IDLE → ESTIMATING → AWAITING_CONFIRM → COUNTDOWN
         → COLLECT(0) → MOVE(+0.35 m) → SETTLE
         → COLLECT(1) → MOVE(−0.35 m) → SETTLE
         → COLLECT(2) → DONE
    (any state) --abort--> AWAITING_CONFIRM  [stop motion first]

Design constraints:
- No timeouts anywhere.  Tag loss never aborts any step.
- MOVE is odom-gated: completes when XY displacement ≥ target, regardless of tag.
- Odom-staleness fault guard: if odom freezes while a velocity command is active,
  send stop and abort to AWAITING_CONFIRM (hardware-fault safety, not a timeout).
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
    from dimos_xr.bridge.odom_buffer import OdomBuffer
    from dimos_xr.tracking.transforms import OdomSample

logger = setup_logger()

# ── tunables ─────────────────────────────────────────────────────────────────
MOVE_SPEED_M_S: float = 0.12          # lateral strafe speed (body-frame y)
MOVE_DISTANCE_M: float = 0.35         # distance for each half-stroke
MIN_ESTIMATING_OBS: int = 2           # observations needed to enter AWAITING_CONFIRM
ESTIMATING_SPREAD_M: float = 0.10     # max allowed XY tag-position spread
COLLECT_OBS_REQUIRED: int = 4         # new observations required per COLLECT station
SETTLE_DURATION_S: float = 0.8        # debounce: seconds after stop before SETTLE done
SETTLE_SPEED_THRESHOLD_M_S: float = 0.03
COUNTDOWN_DURATION_S: float = 3.0
ODOM_FRESHNESS_WINDOW_S: float = 0.5  # fault guard: max allowed odom silence during move


class AssistState(str, Enum):
    IDLE = "idle"
    ESTIMATING = "estimating"
    AWAITING_CONFIRM = "awaiting_confirm"
    COUNTDOWN = "countdown"
    COLLECT = "collect"
    MOVE = "move"
    SETTLE = "settle"
    DONE = "done"


class AssistDriver:
    """Event-driven state machine for robot-assisted baseline collection.

    ``tick()`` must be called periodically (from the broadcast loop) and on
    every new tracker update (from the camera-frame pipeline).  Both callers
    may run concurrently — all state is guarded by ``_lock``.
    """

    def __init__(
        self,
        *,
        adapter: XRRobotAdapterSpec,
        odom: OdomBuffer,
        on_stage_change: Callable[[str, str], None] | None = None,
    ) -> None:
        self._adapter = adapter
        self._odom = odom
        self._on_stage_change = on_stage_change   # (stage, message)
        self._lock = threading.RLock()

        # public-readable state
        self._state: AssistState = AssistState.IDLE
        self._abort_message: str = ""

        # per-session tracking
        self._session_obs_count: int = 0        # total obs at session start
        self._collect_index: int = 0            # which COLLECT station (0, 1, 2)
        self._collect_obs_at_entry: int = 0     # obs count when COLLECT started
        self._move_sign: float = 1.0            # +1 or -1
        self._move_start_pos: tuple[float, float, float] | None = None
        self._move_velocity_active: bool = False
        self._settle_stop_mono: float | None = None
        self._countdown_start: float | None = None

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

    def start(self) -> None:
        """Enter ESTIMATING from IDLE.  No-op if assist is not available."""
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
        odom: OdomSample | None,
    ) -> None:
        """Drive the state machine.

        Args:
            obs_count: Total number of observations in the tracker window.
            latest_obs_pos_world: World-frame XZ position of the most-recently
                added observation tag (XY ground plane in world coords), or None
                if no tag was detected in this frame.
            odom: Latest odometry sample, or None.
        """
        with self._lock:
            self._tick_locked(obs_count, latest_obs_pos_world, odom)

    # ── internal helpers ─────────────────────────────────────────────────────

    def _reset_internals(self) -> None:
        self._collect_index = 0
        self._collect_obs_at_entry = 0
        self._move_sign = 1.0
        self._move_start_pos = None
        self._move_velocity_active = False
        self._settle_stop_mono = None
        self._countdown_start = None
        self._estimating_positions = []
        self._abort_message = ""

    def _transition(self, new_state: AssistState, message: str) -> None:
        old = self._state
        self._state = new_state
        logger.info("AssistDriver transition", from_=old.value, to=new_state.value, msg=message)
        if self._on_stage_change is not None:
            try:
                self._on_stage_change(new_state.value if new_state not in (AssistState.IDLE, AssistState.DONE) else "", message)
            except Exception:
                pass

    def _abort(self, reason: str) -> None:
        if self._state == AssistState.IDLE:
            return
        if self._move_velocity_active:
            try:
                self._adapter.assist_set_lateral_velocity(0.0)
            except Exception:
                pass
            self._move_velocity_active = False
        self._abort_message = reason
        self._transition(AssistState.AWAITING_CONFIRM, reason)

    def _odom_stale_fault(self) -> bool:
        """Return True if odom is stale while a velocity command is active."""
        if not self._move_velocity_active:
            return False
        latest_mono = self._odom.latest_mono()
        if latest_mono is None:
            return True
        return (time.monotonic() - latest_mono) > ODOM_FRESHNESS_WINDOW_S

    def _tick_locked(
        self,
        obs_count: int,
        latest_obs_pos_world: tuple[float, float, float] | None,
        odom: OdomSample | None,
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
                # Enter first COLLECT
                self._collect_index = 0
                self._collect_obs_at_entry = obs_count
                self._transition(
                    AssistState.COLLECT,
                    "Look at the robot tag — collecting baseline observations",
                )
            return

        if state == AssistState.COLLECT:
            new_obs = obs_count - self._collect_obs_at_entry
            if new_obs >= COLLECT_OBS_REQUIRED:
                if self._collect_index < 2:
                    # Transition to MOVE
                    self._move_sign = 1.0 if self._collect_index == 0 else -1.0
                    if odom is not None:
                        self._move_start_pos = odom.position
                    else:
                        self._move_start_pos = None
                    self._move_velocity_active = True
                    self._adapter.assist_set_lateral_velocity(self._move_sign * MOVE_SPEED_M_S)
                    self._transition(
                        AssistState.MOVE,
                        f"Robot moving {'left' if self._move_sign > 0 else 'right'}…",
                    )
                else:
                    # collect_index == 2 → DONE
                    self._transition(AssistState.DONE, "Baseline collection complete")
            return

        if state == AssistState.MOVE:
            # Odom-staleness fault guard
            if self._odom_stale_fault():
                logger.warning("AssistDriver: odom stale during MOVE — aborting for safety")
                self._abort("Odometry data lost during robot move — please retry")
                return

            if odom is not None:
                # Re-issue velocity command (called on broadcast cadence ~0.3 s)
                self._adapter.assist_set_lateral_velocity(self._move_sign * MOVE_SPEED_M_S)

                start = self._move_start_pos
                if start is None:
                    self._move_start_pos = odom.position
                    start = odom.position

                dx = odom.position[0] - start[0]
                dy_odom = odom.position[1] - start[1]
                displacement = math.sqrt(dx * dx + dy_odom * dy_odom)
                if displacement >= MOVE_DISTANCE_M:
                    self._adapter.assist_set_lateral_velocity(0.0)
                    self._move_velocity_active = False
                    self._settle_stop_mono = time.monotonic()
                    self._transition(AssistState.SETTLE, "Robot stopping — settling…")
            return

        if state == AssistState.SETTLE:
            if self._settle_stop_mono is None:
                self._settle_stop_mono = time.monotonic()
            elapsed = time.monotonic() - self._settle_stop_mono
            # Check odom speed
            speed = 0.0
            if odom is not None:
                # We use position delta-based speed from the settle entry
                speed = 0.0  # odom doesn't give us velocity directly; rely on elapsed time
            if elapsed >= SETTLE_DURATION_S:
                # Advance: collect_index increments, enter next COLLECT
                self._collect_index += 1
                self._collect_obs_at_entry = obs_count
                self._transition(
                    AssistState.COLLECT,
                    "Look at the robot tag — collecting observations at new position",
                )
            return
