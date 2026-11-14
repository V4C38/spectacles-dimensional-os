"""AR navigation admission, feedback and direct-drive publishing."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
import logging
import threading
import time
from typing import Any, Protocol

from dimos.ar.async_execution import (
    CONTROL_LEASE_S,
    HEARTBEAT_INTERVAL_S,
    HEARTBEAT_TIMEOUT_S,
    NativeRPC,
)
from dimos.ar.navigation.types import (
    NavGoalFrame,
    NavGoalRequest,
    NavJoystickRequest,
    NavOutcome,
    NavState,
)
from dimos.ar.robot.odometry_correction import correct_odom_path, uncorrect_odom_pose
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.msgs.geometry_msgs.Twist import Twist
from dimos.msgs.nav_msgs.Path import Path
from dimos.spec.utils import Spec


class ARNavigationControlSpec(Spec, Protocol):  # type: ignore[misc]
    def ar_navigation_heartbeat(self, epoch: str, revision: int, deadline: float) -> bool: ...

    def ar_navigation_goal(
        self, goal: PoseStamped, epoch: str, revision: int, deadline: float
    ) -> bool: ...

    def ar_navigation_recover(self, epoch: str, revision: int, deadline: float) -> bool: ...


logger = logging.getLogger(__name__)


class NavigationControlService:
    def __init__(
        self,
        runtime: ARNavigationControlSpec,
        state: Callable[[], tuple[str, int]],
        on_failure: Callable[[float], None],
        on_recovered: Callable[[], None] | None = None,
    ) -> None:
        self._rpc = NativeRPC(runtime)
        self._state = state
        self._on_failure = on_failure
        self._on_recovered = on_recovered
        self._heartbeat: asyncio.Task[None] | None = None
        self._worker: asyncio.Task[None] | None = None
        self._recovery: asyncio.Task[None] | None = None
        self._pending: tuple[PoseStamped, str, int, int] | None = None
        self._generation = 0
        self._closed = False
        self._fault = False
        self._stop_pending = False

    @property
    def faulted(self) -> bool:
        return self._fault

    @property
    def stop_pending(self) -> bool:
        return self._stop_pending

    def start(self) -> None:
        self._heartbeat = asyncio.create_task(self._renew())

    async def _renew(self) -> None:
        while not self._closed:
            if not self._fault and not self._stop_pending:
                epoch, revision = self._state()
                try:
                    await self._rpc.call(
                        "ar_navigation_heartbeat",
                        epoch,
                        revision,
                        time.monotonic() + CONTROL_LEASE_S,
                        timeout=HEARTBEAT_TIMEOUT_S,
                    )
                except Exception:
                    logger.exception("Native navigation heartbeat unavailable")
                    await self._rpc.wait_idle("ar_navigation_heartbeat")
            await asyncio.sleep(HEARTBEAT_INTERVAL_S)

    def submit(self, goal: PoseStamped, epoch: str, revision: int) -> bool:
        if self._closed or self._fault or self._stop_pending:
            return False
        self._pending = goal, epoch, revision, self._generation
        if self._worker is None or self._worker.done():
            self._worker = asyncio.create_task(self._drain())
        return True

    async def _drain(self) -> None:
        while self._pending is not None and not self._closed:
            goal, epoch, revision, generation = self._pending
            self._pending = None
            try:
                accepted = await self._rpc.call(
                    "ar_navigation_goal",
                    goal,
                    epoch,
                    revision,
                    time.monotonic() + 0.5,
                    timeout=2,
                )
            except Exception:
                logger.exception("Native navigation goal outcome unknown")
                accepted = False
                self._fault = True  # Withhold heartbeats: native watchdog stops motion.
            if generation == self._generation and not accepted:
                self._on_failure(float(goal.ts))

    def cancel(self) -> None:
        self._pending = None
        self._generation += 1
        if self._closed:
            return
        self._stop_pending = True
        if self._recovery is None or self._recovery.done():
            self._recovery = asyncio.create_task(self._recover())

    async def _recover(self) -> None:
        # Stop is not complete merely because its Bool was sent. Withhold native
        # admission/heartbeats until the old work drains and cancellation is
        # acknowledged. Repeated Stops also require their own current generation.
        reported = False
        while self._stop_pending and not self._closed:
            await self._rpc.wait_idle("ar_navigation_goal")
            await self._rpc.wait_idle("ar_navigation_recover")
            if self._closed:
                return
            epoch, revision = self._state()
            generation = self._generation
            try:
                stopped = await self._rpc.call(
                    "ar_navigation_recover", epoch, revision, time.monotonic() + 0.5
                )
            except Exception:
                stopped = False
                self._fault = True
                if not reported:
                    logger.exception("Native navigation stop could not be confirmed")
                    reported = True
            if (stopped and self._state()[0] == epoch
                    and generation == self._generation and not self._closed):
                self._stop_pending = False
                self._fault = False
                if self._on_recovered is not None:
                    self._on_recovered()
                return
            await asyncio.sleep(0.1)

    async def close(self) -> None:
        self._closed = True
        self.cancel()
        tasks: list[asyncio.Task[Any]] = [
            task for task in (self._heartbeat, self._worker, self._recovery) if task is not None
        ]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        self._rpc.close()


class NavGoalCoordinator:
    def __init__(self, *, odom_scale_correction_factor: float) -> None:
        self._odom_scale_correction_factor = odom_scale_correction_factor
        self._lock = threading.Lock()
        self._following_path = False
        self._outcome: NavOutcome | None = None
        self._retired_at = 0.0
        self._requested_goal_ts: float | None = None
        self._native_goal_ts: float | None = None

    def nav_state(self) -> NavState:
        with self._lock:
            if self._outcome is not None:
                return NavState(state="resolved", outcome=self._outcome)
            if self._following_path:
                return NavState(state="following_path", outcome=None)
            return NavState(state="idle", outcome=None)

    def submit_goal(self, msg: NavGoalRequest) -> PoseStamped:
        client_pose = PoseStamped(
            ts=time.time(),
            frame_id="odom",
            position=list(msg.position),
            orientation=list(msg.orientation),
        )
        goal = uncorrect_odom_pose(client_pose, factor=self._odom_scale_correction_factor)
        with self._lock:
            self._outcome = None
            self._retired_at = time.time()
            self._requested_goal_ts = float(goal.ts)
        return goal

    def on_path(self, msg: Path) -> tuple[NavGoalFrame | None, bool]:
        corrected = correct_odom_path(msg, factor=self._odom_scale_correction_factor)
        with self._lock:
            if self._retired_at and (not corrected.ts or corrected.ts <= self._retired_at):
                return None, False
            if not corrected.poses:
                return NavGoalFrame(
                    pose=None,
                    path_poses=[],
                    ts=corrected.ts or time.time(),
                ), False
            was_following = self._following_path
            was_resolved = self._outcome is not None
            self._following_path = True
            self._outcome = None
            path_poses = [(pose.x, pose.y, pose.z, pose.yaw) for pose in corrected.poses]
            nav_goal_frame = NavGoalFrame(
                pose=path_poses[-1],
                path_poses=path_poses,
                ts=corrected.ts,
            )
            state_changed = not was_following or was_resolved
            return nav_goal_frame, state_changed

    def accepts_path(self, timestamp: float) -> bool:
        with self._lock:
            return bool(timestamp and timestamp > self._retired_at)

    def on_native_status(self, goal_ts: float, phase: str) -> bool:
        with self._lock:
            if self._requested_goal_ts is not None and goal_ts != self._requested_goal_ts:
                return False
            if phase == "accepted":
                if self._requested_goal_ts is None and goal_ts <= self._retired_at:
                    return False
                if self._native_goal_ts is not None and goal_ts < self._native_goal_ts:
                    return False
                self._native_goal_ts = goal_ts
                self._outcome = None
                return False
            if phase not in {"succeeded", "failed"} or goal_ts not in {
                self._requested_goal_ts,
                self._native_goal_ts,
            }:
                return False
            self._requested_goal_ts = self._native_goal_ts = None
            self._outcome = "succeeded" if phase == "succeeded" else "failed"
            self._following_path = False
            self._retired_at = time.time()
            return True

    def on_estop(self) -> bool:
        with self._lock:
            changed = self._following_path or self._outcome is not None
            self._following_path = False
            self._outcome = None
            self._requested_goal_ts = self._native_goal_ts = None
            self._retired_at = time.time()
            return changed


HOLD_HZ = 10
HOLD_PERIOD_S = 1.0 / HOLD_HZ


def _clamp(value: float, limit: float) -> float:
    return max(-limit, min(limit, value))


class TeleCmdVelPublisher:
    def __init__(
        self,
        *,
        publish: Callable[[Twist], None],
        max_linear_mps: float,
        max_angular_rps: float,
        loop: asyncio.AbstractEventLoop,
    ) -> None:
        self._publish = publish
        self._max_linear_mps = max_linear_mps
        self._max_angular_rps = max_angular_rps
        self._loop = loop
        self._generation = 0
        self._task: asyncio.Task[None] | None = None
        self._last_nonzero = False

    def handle(self, msg: NavJoystickRequest) -> None:
        self._stop_hold()
        twist = self._twist_from(msg)
        moving = not twist.is_zero()
        if not moving:
            if not self._last_nonzero:
                return
            self._last_nonzero = False
            self._publish(twist)
            return
        self._last_nonzero = True
        self._publish(twist)
        if msg.duration:
            generation = self._generation
            self._task = self._loop.create_task(self._hold(twist, msg.duration, generation))

    def cancel(self) -> None:
        self._stop_hold()
        if self._last_nonzero:
            self._last_nonzero = False
            self._publish(Twist())

    def _stop_hold(self) -> None:
        self._generation += 1
        task = self._task
        self._task = None
        if task is not None and not task.done():
            self._cancel_task(task)

    def _cancel_task(self, task: asyncio.Task[None]) -> None:
        try:
            running = asyncio.get_running_loop()
        except RuntimeError:
            running = None
        if running is self._loop:
            task.cancel()
            return
        self._loop.call_soon_threadsafe(task.cancel)

    async def _hold(self, twist: Twist, duration: float, generation: int) -> None:
        deadline = self._loop.time() + duration
        try:
            while True:
                remaining = deadline - self._loop.time()
                if remaining <= 0.0:
                    break
                await asyncio.sleep(min(HOLD_PERIOD_S, remaining))
                if generation != self._generation:
                    return
                remaining = deadline - self._loop.time()
                if remaining <= 0.0:
                    break
                self._publish(twist)
            if generation != self._generation:
                return
            self._last_nonzero = False
            self._publish(Twist())
        except asyncio.CancelledError:
            return

    def _twist_from(self, msg: NavJoystickRequest) -> Twist:
        return Twist(
            linear=(
                _clamp(msg.linear[0], self._max_linear_mps),
                _clamp(msg.linear[1], self._max_linear_mps),
                0.0,
            ),
            angular=(
                0.0,
                0.0,
                _clamp(msg.angular[2], self._max_angular_rps),
            ),
        )
