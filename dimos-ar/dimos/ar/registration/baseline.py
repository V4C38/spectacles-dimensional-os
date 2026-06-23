"""BaselineCollector — robot strafe + stop-and-sample recipe for april_odom_baseline."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from enum import StrEnum
import math
import threading
import time
from typing import TYPE_CHECKING

from dimos.ar.bridge.baseline_motion import BaselineMotionExecutor
from dimos.ar.registration.motion_params import BaselineMotionParams
from dimos.ar.registration.types import CaptureHint, MotionHint, RegistrationPhase
from dimos.utils.logging_config import setup_logger

if TYPE_CHECKING:
    from dimos.ar.adapters.base import ARRobotAdapterSpec
    from dimos.ar.registration.transforms import OdomSample

logger = setup_logger()

MOVE_LEG_S: float = 2.0
MOVE_LEG_TARGET_M: float = 0.20  # UI motion-hint distance only; legs stop on timer
SAMPLE_SETTLE_S: float = 0.3
MIN_ESTIMATING_OBS: int = 2
ESTIMATING_SPREAD_M: float = 0.10
SAMPLE_MIN_OBS: int = 3
SAMPLE_SPREAD_M: float = 0.05
WAYPOINT_TOTAL: int = 3


class _BaselineState(StrEnum):
    IDLE = "idle"
    ESTIMATING = "estimating"
    AWAITING_CONFIRM = "awaiting_confirm"
    MOVE = "move"
    DONE = "done"
    FAILED = "failed"


class _MovePhase(StrEnum):
    LEG = "leg"
    SAMPLE = "sample"


@dataclass(frozen=True)
class BaselineStatus:
    phase: RegistrationPhase
    capture: CaptureHint
    message: str
    motion: MotionHint | None = None


class BaselineCollector:
    """Bridge-owned baseline strafe recipe.

    State transitions are memory-only. Adapter I/O is limited to lateral
    velocity side effects and must never block while holding ``_lock``.
    """

    _LEG_DIRECTIONS: tuple[float, float, float] = (1.0, -1.0, 1.0)
    _LEG_MULTIPLIERS: tuple[float, float, float] = (1.0, 2.0, 1.0)

    def __init__(
        self,
        *,
        adapter: ARRobotAdapterSpec,
        motion_available: bool,
        motion_params: BaselineMotionParams,
        on_status: Callable[[BaselineStatus], None] | None = None,
    ) -> None:
        self._adapter = adapter
        self._motion_available = motion_available
        self._motion_params = motion_params
        self._motion_executor = BaselineMotionExecutor(adapter)
        self._on_status = on_status
        self._lock = threading.RLock()
        self._state: _BaselineState = _BaselineState.IDLE
        self._move_start_mono: float | None = None
        self._move_velocity_active = False
        self._move_leg_index = 0
        self._move_phase = _MovePhase.LEG
        self._move_sample_positions: list[tuple[float, float, float]] = []
        self._sample_settle_mono: float | None = None
        self._estimating_positions: list[tuple[float, float, float]] = []

    @property
    def state(self) -> _BaselineState:
        with self._lock:
            return self._state

    @property
    def motion_available(self) -> bool:
        return self._motion_available

    @property
    def is_active(self) -> bool:
        with self._lock:
            return self._state not in (_BaselineState.IDLE, _BaselineState.DONE, _BaselineState.FAILED)

    @property
    def is_sampling(self) -> bool:
        with self._lock:
            return self._state == _BaselineState.MOVE and self._move_phase == _MovePhase.SAMPLE

    @property
    def is_estimating(self) -> bool:
        with self._lock:
            return self._state == _BaselineState.ESTIMATING

    @property
    def is_done(self) -> bool:
        with self._lock:
            return self._state == _BaselineState.DONE

    @property
    def is_failed(self) -> bool:
        with self._lock:
            return self._state == _BaselineState.FAILED

    def start(self) -> None:
        with self._lock:
            if not self._motion_available:
                self._fail("Baseline motion unavailable on this robot")
                return
            self._reset_internals()
            self._state = _BaselineState.ESTIMATING
            self._emit(
                RegistrationPhase.SCANNING,
                CaptureHint.STEADY,
                "Look at the AprilTag on your robot",
            )

    def authorize_motion(self) -> None:
        with self._lock:
            if self._state != _BaselineState.AWAITING_CONFIRM:
                logger.debug("authorize_motion ignored", state=self._state.value)
                return
            self._start_move()

    def stop(self, *, message: str = "Registration stopped") -> None:
        with self._lock:
            if self._state == _BaselineState.IDLE:
                return
            self._stop_motion()
            self._reset_internals()
            self._state = _BaselineState.IDLE
            self._emit(RegistrationPhase.IDLE, CaptureHint.OFF, message)

    def fail(self, reason: str) -> None:
        with self._lock:
            self._fail(reason)

    def reset_to_idle(self) -> None:
        with self._lock:
            self._stop_motion()
            self._reset_internals()
            self._state = _BaselineState.IDLE

    def shutdown(self) -> None:
        """Stop the robot and tear down the velocity executor (bridge shutdown)."""
        with self._lock:
            self._stop_motion()
            self._reset_internals()
            self._state = _BaselineState.IDLE
        self._motion_executor.shutdown()

    def tick(
        self,
        *,
        obs_count: int,
        latest_obs_pos_world: tuple[float, float, float] | None,
        latest_odom: OdomSample | None = None,
    ) -> None:
        with self._lock:
            self._tick_locked(obs_count, latest_obs_pos_world, latest_odom)

    def _reset_internals(self) -> None:
        self._move_start_mono = None
        self._move_velocity_active = False
        self._move_leg_index = 0
        self._move_phase = _MovePhase.LEG
        self._move_sample_positions = []
        self._sample_settle_mono = None
        self._estimating_positions = []

    def _fail(self, reason: str) -> None:
        self._stop_motion()
        self._reset_internals()
        self._state = _BaselineState.FAILED
        logger.info("BaselineCollector failed", reason=reason)
        self._emit(RegistrationPhase.FAILED, CaptureHint.OFF, reason)

    def _emit(
        self,
        phase: RegistrationPhase,
        capture: CaptureHint,
        message: str,
        *,
        leg_index: int | None = None,
        in_sample: bool = False,
    ) -> None:
        motion: MotionHint | None = None
        if phase in (RegistrationPhase.AWAITING_MOTION, RegistrationPhase.MOVING):
            idx = (leg_index if leg_index is not None else self._move_leg_index) + 1
            sign = self._LEG_DIRECTIONS[(leg_index if leg_index is not None else self._move_leg_index)]
            motion = self._motion_hint(idx, sign)
        elif phase == RegistrationPhase.SAMPLING and leg_index is not None:
            motion = MotionHint(
                frame="robot",
                axis="lateral",
                direction="left" if self._LEG_DIRECTIONS[leg_index] > 0 else "right",
                distance_m=MOVE_LEG_TARGET_M * self._LEG_MULTIPLIERS[leg_index],
                waypoint_index=leg_index + 1,
                waypoint_total=WAYPOINT_TOTAL,
            )
        if self._on_status is not None:
            try:
                self._on_status(
                    BaselineStatus(
                        phase=phase,
                        capture=capture,
                        message=message,
                        motion=motion,
                    )
                )
            except Exception:
                pass

    def _motion_hint(self, waypoint_index: int, sign: float) -> MotionHint:
        leg = waypoint_index - 1
        return MotionHint(
            frame="robot",
            axis="lateral",
            direction="left" if sign > 0 else "right",
            distance_m=MOVE_LEG_TARGET_M * self._LEG_MULTIPLIERS[leg],
            waypoint_index=waypoint_index,
            waypoint_total=WAYPOINT_TOTAL,
        )

    def _set_lateral_velocity_async(self, velocity: float) -> None:
        self._motion_executor.submit_lateral_velocity(velocity)

    def _stop_motion(self) -> None:
        if self._move_velocity_active:
            self._motion_executor.stop_motion()
            self._move_velocity_active = False

    def _start_move(self) -> None:
        leg = 0
        self._move_leg_index = leg
        self._move_phase = _MovePhase.LEG
        self._move_sample_positions = []
        self._sample_settle_mono = None
        self._move_start_mono = time.monotonic()
        self._move_velocity_active = True
        self._state = _BaselineState.MOVE
        speed = self._motion_params.strafe_speed * self._LEG_DIRECTIONS[leg]
        self._emit(
            RegistrationPhase.MOVING,
            CaptureHint.STEADY,
            "Robot moving — waypoint 1/3",
            leg_index=leg,
        )
        logger.info("BaselineCollector MOVE leg=%d", leg)
        self._set_lateral_velocity_async(speed)

    def _start_sample(self) -> None:
        self._stop_motion()
        self._move_phase = _MovePhase.SAMPLE
        self._move_sample_positions = []
        self._move_start_mono = None
        self._sample_settle_mono = time.monotonic()
        leg = self._move_leg_index
        self._emit(
            RegistrationPhase.SAMPLING,
            CaptureHint.BURST,
            f"Collecting samples at waypoint {leg + 1}/{WAYPOINT_TOTAL}",
            leg_index=leg,
            in_sample=True,
        )

    def _start_next_leg(self) -> None:
        self._move_leg_index += 1
        if self._move_leg_index >= WAYPOINT_TOTAL:
            self._stop_motion()
            self._state = _BaselineState.DONE
            self._emit(
                RegistrationPhase.SCANNING,
                CaptureHint.STEADY,
                "Baseline collection complete",
            )
            return
        leg = self._move_leg_index
        self._move_phase = _MovePhase.LEG
        self._move_sample_positions = []
        self._sample_settle_mono = None
        self._move_start_mono = time.monotonic()
        self._move_velocity_active = True
        speed = self._motion_params.strafe_speed * self._LEG_DIRECTIONS[leg]
        self._emit(
            RegistrationPhase.MOVING,
            CaptureHint.STEADY,
            f"Robot moving — waypoint {leg + 1}/{WAYPOINT_TOTAL}",
            leg_index=leg,
        )
        logger.info("BaselineCollector MOVE leg=%d", leg)
        self._set_lateral_velocity_async(speed)

    def _tick_locked(
        self,
        obs_count: int,
        latest_obs_pos_world: tuple[float, float, float] | None,
        _latest_odom: OdomSample | None,
    ) -> None:
        state = self._state
        if state in (_BaselineState.IDLE, _BaselineState.DONE, _BaselineState.FAILED):
            return

        if state == _BaselineState.ESTIMATING:
            if latest_obs_pos_world is not None:
                self._estimating_positions.append(latest_obs_pos_world)
            if len(self._estimating_positions) >= MIN_ESTIMATING_OBS:
                xs = [p[0] for p in self._estimating_positions]
                zs = [p[2] for p in self._estimating_positions]
                spread = math.sqrt((max(xs) - min(xs)) ** 2 + (max(zs) - min(zs)) ** 2)
                if spread <= ESTIMATING_SPREAD_M:
                    self._state = _BaselineState.AWAITING_CONFIRM
                    self._emit(
                        RegistrationPhase.AWAITING_MOTION,
                        CaptureHint.STEADY,
                        "Confirm to start baseline collection",
                    )
            return

        if state == _BaselineState.AWAITING_CONFIRM:
            return

        if state == _BaselineState.MOVE:
            leg = self._move_leg_index
            if self._move_phase == _MovePhase.LEG:
                if self._move_start_mono is None:
                    return
                elapsed = time.monotonic() - self._move_start_mono
                leg_duration = MOVE_LEG_S * self._LEG_MULTIPLIERS[leg]
                if elapsed >= leg_duration:
                    self._start_sample()
                return

            if self._move_phase == _MovePhase.SAMPLE:
                if self._sample_settle_mono is not None:
                    if time.monotonic() - self._sample_settle_mono < SAMPLE_SETTLE_S:
                        return
                if latest_obs_pos_world is not None:
                    self._move_sample_positions.append(latest_obs_pos_world)
                if len(self._move_sample_positions) >= SAMPLE_MIN_OBS:
                    xs = [p[0] for p in self._move_sample_positions]
                    zs = [p[2] for p in self._move_sample_positions]
                    spread = math.sqrt((max(xs) - min(xs)) ** 2 + (max(zs) - min(zs)) ** 2)
                    if spread <= SAMPLE_SPREAD_M:
                        self._start_next_leg()
                    else:
                        self._move_sample_positions = self._move_sample_positions[-SAMPLE_MIN_OBS:]
