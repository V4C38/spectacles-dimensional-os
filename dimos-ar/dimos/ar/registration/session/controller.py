"""RegistrationSession — public API, command dispatch, and lifecycle."""

from __future__ import annotations

import asyncio
from collections.abc import Coroutine
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from dimos.ar.registration.session.flows import RegistrationFlowsMixin
from dimos.ar.registration.session.session_frames import RegistrationSessionFramesMixin
from dimos.ar.registration.types import (
    RegistrationCandidate,
    RegistrationMode,
    RegistrationPhase,
)
from dimos.ar.registration.wire import RegistrationStatusPayload
from dimos.ar.tag_tracking.tracker import FrameResult, RobotAprilTagTracker
from dimos.ar.world_frame.refinement import WorldFrameRefiner
from dimos.ar.world_frame.registry import WorldRegistry
from dimos.ar.world_frame.transforms import OdomSample
from dimos.utils.logging_config import setup_logger

if TYPE_CHECKING:
    from websockets.asyncio.server import ServerConnection

    from dimos.ar.bridge.odom_buffer import OdomBuffer
    from dimos.ar.bridge.sender import BridgeSender
    from dimos.ar.bridge.status_service import StatusService
    from dimos.ar.network.protocol import RegistrationCommandMessage
    from dimos.ar.robot_profile.base import TagTrackingProfile

logger = setup_logger()

STATUS_BROADCAST_INTERVAL_S: float = 0.3


@dataclass
class _Session:
    mode: RegistrationMode | None = None
    pending_candidate: RegistrationCandidate | None = None
    pending_candidate_ts: float | None = None
    manual_pose_first_logged: bool = False
    last_manual_inactive_log_mono: float = 0.0
    last_manual_odom_missing_log_mono: float = 0.0
    last_manual_candidate_log_mono: float = 0.0
    last_status: RegistrationStatusPayload | None = None
    april_tag_started_mono: float | None = None
    last_registration_scan_log_mono: float = 0.0


class RegistrationSession(
    RegistrationSessionFramesMixin,
    RegistrationFlowsMixin,
):
    """Owns registration session state and camera-frame processing during setup."""

    def __init__(
        self,
        *,
        robot_id: str,
        sender: BridgeSender,
        registry: WorldRegistry,
        odom: OdomBuffer,
        status: StatusService,
        tag_tracker: RobotAprilTagTracker,
        loop: asyncio.AbstractEventLoop,
        frame_max_age_s: float,
        manual_registration_quality: float,
        world_frame_refiner: WorldFrameRefiner,
        capture_min_tag_px: float,
        capture_max_distance_margin: float,
        capture_max_speed_mps: float,
        capture_min_distance_m: float,
        align_min_obs: int,
        runtime_profile: TagTrackingProfile | None = None,
    ) -> None:
        self._robot_id = robot_id
        self._sender = sender
        self._registry = registry
        self._odom = odom
        self._status = status
        self._world_frame_refiner = world_frame_refiner
        self._tag_tracker = tag_tracker
        self._loop = loop
        self._frame_max_age_s = frame_max_age_s
        self._manual_registration_quality = manual_registration_quality
        self._capture_min_tag_px = capture_min_tag_px
        self._capture_max_distance_margin = capture_max_distance_margin
        self._capture_max_speed_mps = capture_max_speed_mps
        self._capture_min_distance_m = capture_min_distance_m
        self._align_min_obs = align_min_obs
        self._max_capture_distance_m: float | None = None

        self._frame_in_flight = False
        self._session = _Session()

        if runtime_profile is not None:
            self._runtime_profile = runtime_profile
        else:
            from dimos.ar.robot_profile.base import TagTrackingProfile

            self._runtime_profile = TagTrackingProfile()

        self._broadcast_task: asyncio.Task[None] | None = None
        self._broadcast_stop_requested = False
        self._loop_tasks: set[asyncio.Task[None]] = set()

    def _set_tag_tracker_active(self, active: bool, *, reason: str) -> None:
        self._tag_tracker.active = active
        logger.debug("tag tracker active updated", active=active, reason=reason)

    def stop(self) -> None:
        self._set_tag_tracker_active(False, reason="session_stop")
        self._stop_broadcast()

    def on_registration_command(
        self, msg: RegistrationCommandMessage, websocket: ServerConnection
    ) -> None:
        if msg.command == "start":
            self._handle_registration_command_start(msg)
        elif msg.command == "stop":
            self._handle_registration_command_stop(msg)
        elif msg.command == "commit":
            self._handle_registration_command_commit(msg)

    def _handle_registration_command_stop(self, msg: RegistrationCommandMessage) -> None:
        session_mode = self._session.mode
        was_active = (
            self._session.mode is not None or self._session.pending_candidate is not None
        )
        if not was_active:
            return
        self._set_tag_tracker_active(False, reason="session_stop")
        self._stop_broadcast()
        self._clear_session()
        logger.info("AR registration stopped")
        self._broadcast_status(
            phase=RegistrationPhase.IDLE,
            message="Registration cancelled",
            mode=session_mode,
            ts=msg.ts,
        )

    def on_emergency_stop(self) -> None:
        if self._session.mode is not None:
            self._set_tag_tracker_active(False, reason="session_stop")
            self._stop_broadcast()
            self._clear_session()
            self._broadcast_status(
                phase=RegistrationPhase.FAILED,
                message="Emergency stop received",
            )

    def _handle_registration_command_commit(self, msg: RegistrationCommandMessage) -> None:
        cand = self._session.pending_candidate
        if cand is None:
            logger.warning("AR registration commit rejected", reason="no_candidate")
            self._broadcast_status(
                phase=RegistrationPhase.FAILED,
                message="No valid registration candidate yet",
                ts=msg.ts,
            )
            return
        finish_ts = (
            self._session.pending_candidate_ts
            if self._session.pending_candidate_ts is not None
            else msg.ts
        )
        self._finish_registration(cand, finish_ts)

    def clear_on_disconnect(self) -> None:
        if self._session.mode is None and self._session.pending_candidate is None:
            return
        self._set_tag_tracker_active(False, reason="session_stop")
        self._stop_broadcast()
        self._clear_session()
        logger.info("Registration session cleared on AR client disconnect")

    def _start_broadcast(self) -> None:
        if not self._loop.is_running():
            return
        if self._is_on_loop():
            self._schedule_on_loop(self._start_broadcast_on_loop())
            return
        future = asyncio.run_coroutine_threadsafe(
            self._start_broadcast_on_loop(),
            self._loop,
        )
        try:
            future.result(timeout=1.0)
        except Exception:
            logger.exception("registration broadcast task start failed")

    async def _start_broadcast_on_loop(self) -> None:
        await self._cancel_broadcast_on_loop()
        self._broadcast_stop_requested = False
        self._broadcast_task = asyncio.create_task(
            self._broadcast_loop(),
            name="ar-registration-status",
        )

    async def _broadcast_loop(self) -> None:
        try:
            while not self._broadcast_stop_requested:
                await asyncio.sleep(STATUS_BROADCAST_INTERVAL_S)
                try:
                    if self._session.mode is None:
                        break
                    if self._session.mode == RegistrationMode.APRIL_TAG:
                        await self._maybe_finish_tag_registration()
                        if self._session.mode is None or self._broadcast_stop_requested:
                            break
                    self._broadcast_status()
                except Exception:
                    logger.exception("registration broadcast tick failed")
        except asyncio.CancelledError:
            raise
        finally:
            if asyncio.current_task() is self._broadcast_task:
                self._broadcast_task = None

    def _stop_broadcast(self) -> None:
        if not self._loop.is_running():
            return
        if self._is_on_loop():
            self._schedule_on_loop(self._cancel_broadcast_on_loop())
            return
        future = asyncio.run_coroutine_threadsafe(
            self._cancel_broadcast_on_loop(),
            self._loop,
        )
        try:
            future.result(timeout=1.0)
        except Exception:
            logger.exception("registration broadcast task stop failed")

    async def _cancel_broadcast_on_loop(self) -> None:
        self._broadcast_stop_requested = True
        task = self._broadcast_task
        if task is None:
            return
        if task is asyncio.current_task():
            return
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        self._broadcast_task = None

    def _is_on_loop(self) -> bool:
        try:
            return asyncio.get_running_loop() is self._loop
        except RuntimeError:
            return False

    def _schedule_on_loop(self, coro: Coroutine[Any, Any, None]) -> None:
        task = asyncio.create_task(coro)
        self._loop_tasks.add(task)
        task.add_done_callback(self._loop_tasks.discard)

    def _clear_session(self) -> None:
        self._frame_in_flight = False
        self._tag_tracker.reset_window()
        self._session = _Session()

    def _apply_tracker_update(
        self,
        *,
        resolved_odom: OdomSample | None = None,
        frame_result: FrameResult | None = None,
    ) -> Any:
        if self._tag_tracker.active:
            if self._session.last_status is None or self._session.last_status.phase in (
                RegistrationPhase.SCANNING,
            ):
                self._broadcast_status()
            from dimos.ar.world_frame.refinement import CaptureEpisodeOutcome

            return CaptureEpisodeOutcome(state="idle")
        return self._world_frame_refiner.apply_tracker_update(
            resolved_odom=resolved_odom,
            observations_added=0 if frame_result is None else frame_result.observations_added,
        )

    @property
    def max_capture_distance_m(self) -> float | None:
        """Max camera-tag distance from last camera_info (same value as capture_policy)."""
        return self._max_capture_distance_m
