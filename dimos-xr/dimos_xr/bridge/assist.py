"""AssistDriver — robot-assisted baseline collection state machine.

State flow::

    IDLE → ESTIMATING → AWAITING_CONFIRM → MOVE → DONE
    (any state) --abort--> AWAITING_CONFIRM  [stop motion first]

Design constraints:
- No timeouts anywhere. Tag loss never aborts any step.
- MOVE is a 3-leg 1:2:1 out-and-back routine implemented as sub-states.
  The robot returns to approximately its starting position. No odom required.
- The robot is stopped only by an explicit zero Twist (Go2 WebRTC has no
  deadman). The abort path always calls assist_set_lateral_velocity(0.0).
- tick() is called from two threads concurrently; a single RLock guards all state.
"""

from __future__ import annotations

from collections.abc import Callable
from enum import StrEnum
import math
import threading
import time
from typing import TYPE_CHECKING

from dimos.utils.logging_config import setup_logger

if TYPE_CHECKING:
    from dimos_xr.adapters.base import XRRobotAdapterSpec

logger = setup_logger()

# ── tunables ─────────────────────────────────────────────────────────────────
MOVE_SPEED: float = 0.3           # raw joystick deflection in [-1, 1] (not m/s)
MOVE_LEG_S: float = 2.0           # duration of each short leg; long leg = 2×
MIN_ESTIMATING_OBS: int = 2       # observations needed to enter AWAITING_CONFIRM
ESTIMATING_SPREAD_M: float = 0.10 # max allowed XY tag-position spread

# Stop-and-sample tuning: how many stable observations are required per waypoint.
SAMPLE_MIN_OBS: int = 4
SAMPLE_SPREAD_M: float = 0.05     # max XY spread to consider observations stable


class AssistState(StrEnum):
    IDLE = "idle"
    ESTIMATING = "estimating"
    AWAITING_CONFIRM = "awaiting_confirm"
    MOVE = "move"
    DONE = "done"


# Sub-states within MOVE (not exposed on the wire — assist_stage stays "move")
class _MovePhase(StrEnum):
    LEG = "leg"      # robot is moving
    SAMPLE = "sample" # robot stopped, waiting for user to look at tag and collect samples


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
        self._move_start_mono: float | None = None   # t0 for the current leg
        self._move_velocity_active: bool = False
        self._move_leg_index: int = 0   # 0=leg1, 1=leg2, 2=leg3
        self._move_phase: _MovePhase = _MovePhase.LEG
        self._move_sample_positions: list[tuple[float, float, float]] = []  # for current sample phase

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
        Step 2 (Calibration): MOVE, DONE.
        """
        with self._lock:
            s = self._state
        if s in (AssistState.ESTIMATING, AssistState.AWAITING_CONFIRM):
            return 1
        return 2  # MOVE through DONE

    @property
    def step_count(self) -> int:
        """Total number of steps in this assist routine."""
        return 2

    def progress_percent(self) -> int:
        """Return 0-100 progress for the *current* step.

        Step 1: grows with observations collected, saturates at 100 when confirmed.
        Step 2: 0 at start of MOVE, advances per completed waypoint, 100 at DONE.
        """
        with self._lock:
            s = self._state
            estimating_count = len(self._estimating_positions)
            leg_index = self._move_leg_index
            move_phase = self._move_phase

        if s == AssistState.ESTIMATING:
            return min(99, int(estimating_count / max(1, MIN_ESTIMATING_OBS) * 99))
        if s == AssistState.AWAITING_CONFIRM:
            return 100
        if s == AssistState.MOVE:
            # 3 waypoints; each completed sample phase adds ~33 points
            completed_legs = leg_index if move_phase == _MovePhase.LEG else leg_index
            return min(99, int(completed_legs / 3 * 99))
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

    def reset_to_idle(self) -> None:
        """Silently reset to IDLE without firing on_stage_change.

        Use this during session teardown (clear_session) to avoid emitting a
        trailing stage-change broadcast that could race with and overwrite the
        terminal align_status (aligned/failed) already queued for the client.
        Re-arming happens via start(), which is called from on_align_start.
        """
        with self._lock:
            self._stop_motion()
            self._reset_internals()
            self._state = AssistState.IDLE

    def on_client_disconnect(self) -> None:
        with self._lock:
            self._abort("Client disconnected")

    def on_assist_confirm(self) -> None:
        with self._lock:
            if self._state != AssistState.AWAITING_CONFIRM:
                logger.debug("assist_confirm ignored in state", state=self._state.value)
                return
            self._start_move()

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
        self._move_start_mono = None
        self._move_velocity_active = False
        self._move_leg_index = 0
        self._move_phase = _MovePhase.LEG
        self._move_sample_positions = []
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

    # Leg velocity signs: leg0 = +, leg1 = -, leg2 = + (returns to origin).
    _LEG_DIRECTIONS: tuple[float, float, float] = (1.0, -1.0, 1.0)
    # Leg durations as multiples of MOVE_LEG_S: 1×, 2×, 1×.
    _LEG_MULTIPLIERS: tuple[float, float, float] = (1.0, 2.0, 1.0)
    _LEG_LABELS: tuple[str, str, str] = (
        "Robot moving — leg 1/3",
        "Robot moving — leg 2/3",
        "Robot moving — leg 3/3 (returning to start)",
    )

    def _start_move(self) -> None:
        """Enter MOVE and kick off leg 0."""
        self._move_leg_index = 0
        self._move_phase = _MovePhase.LEG
        self._move_sample_positions = []
        self._move_start_mono = time.monotonic()
        self._move_velocity_active = True
        self._adapter.assist_set_lateral_velocity(
            MOVE_SPEED * self._LEG_DIRECTIONS[0]
        )
        self._transition(AssistState.MOVE, self._LEG_LABELS[0])

    def _start_sample(self) -> None:
        """Stop the robot and begin the sample phase at the current waypoint."""
        self._stop_motion()
        self._move_phase = _MovePhase.SAMPLE
        self._move_sample_positions = []
        self._move_start_mono = None  # unused during sample phase
        leg = self._move_leg_index
        if self._on_stage_change is not None:
            try:
                self._on_stage_change(
                    AssistState.MOVE.value,
                    f"Look at the tag — collecting samples at waypoint {leg + 1}/3",
                )
            except Exception:
                pass

    def _start_next_leg(self) -> None:
        """Advance to the next leg; if all legs done, transition to DONE."""
        self._move_leg_index += 1
        if self._move_leg_index >= 3:
            self._stop_motion()
            self._transition(AssistState.DONE, "Baseline collection complete")
            return
        leg = self._move_leg_index
        self._move_phase = _MovePhase.LEG
        self._move_sample_positions = []
        self._move_start_mono = time.monotonic()
        self._move_velocity_active = True
        self._adapter.assist_set_lateral_velocity(
            MOVE_SPEED * self._LEG_DIRECTIONS[leg]
        )
        if self._on_stage_change is not None:
            try:
                self._on_stage_change(AssistState.MOVE.value, self._LEG_LABELS[leg])
            except Exception:
                pass

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

        if state == AssistState.MOVE:
            leg = self._move_leg_index

            if self._move_phase == _MovePhase.LEG:
                # Time-based leg completion
                if self._move_start_mono is None:
                    return
                elapsed = time.monotonic() - self._move_start_mono
                leg_duration = MOVE_LEG_S * self._LEG_MULTIPLIERS[leg]
                if elapsed >= leg_duration:
                    self._start_sample()
                return

            if self._move_phase == _MovePhase.SAMPLE:
                # Accumulate tag observations; advance when we have N stable ones.
                if latest_obs_pos_world is not None:
                    self._move_sample_positions.append(latest_obs_pos_world)
                if len(self._move_sample_positions) >= SAMPLE_MIN_OBS:
                    xs = [p[0] for p in self._move_sample_positions]
                    zs = [p[2] for p in self._move_sample_positions]
                    spread = math.sqrt(
                        (max(xs) - min(xs)) ** 2 + (max(zs) - min(zs)) ** 2
                    )
                    if spread <= SAMPLE_SPREAD_M:
                        self._start_next_leg()
                    else:
                        # Keep only the most-recent observations so we don't carry
                        # stale positions from a momentarily unstable period.
                        self._move_sample_positions = self._move_sample_positions[-SAMPLE_MIN_OBS:]
            return
