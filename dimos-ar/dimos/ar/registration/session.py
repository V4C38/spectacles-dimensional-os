"""RegistrationSession — setup wizard for XR frame registration."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from enum import StrEnum
import math
import os
import time
from typing import TYPE_CHECKING, Any

import numpy as np

from dimos.ar.network.data_plane import DROPPED_POSE_LOG_INTERVAL_S
from dimos.ar.network.protocol import (
    CameraInfoMessage,
    RegistrationCommandMessage,
    RegistrationPoseMessage,
    encode_camera_frame_ack,
)
from dimos.ar.registration.baseline import BaselineCollector, BaselineStatus
from dimos.ar.registration.motion_params import BaselineMotionParams
from dimos.ar.registration.refinement import RegisteredPoseRefiner
from dimos.ar.registration.registry import WorldRegistry
from dimos.ar.registration.tracker import (
    R_ALIGN,
    FrameResult,
    RobotAprilTagTracker,
    build_camera_info,
)
from dimos.ar.registration.transforms import (
    OdomSample,
    normalize_ground_pose,
    pose_to_matrix,
)
from dimos.ar.registration.types import (
    CaptureHint,
    RegistrationCandidate,
    RegistrationMode,
    RegistrationPhase,
)
from dimos.ar.registration.wire import RegistrationStatusPayload, encode_registration_status
from dimos.utils.logging_config import setup_logger

if TYPE_CHECKING:
    from websockets.asyncio.server import ServerConnection

    from dimos.ar.adapters.base import ARRobotAdapterSpec, RuntimeRegistrationProfile
    from dimos.ar.bridge.odom_buffer import OdomBuffer
    from dimos.ar.bridge.sender import BridgeSender
    from dimos.ar.bridge.status_service import StatusService

_TRACE = os.getenv("DIMOS_AR_TRACE", "") not in ("", "0", "false")

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


class FrameAdmission(StrEnum):
    ACK_ONLY = "ack_only"
    PROCESS = "process"


class RegistrationSession:
    """Owns registration session state and camera-frame processing during setup.

    Registration commands are invoked from the WebSocket ORDERED dispatch lane.
    The periodic status tick belongs to the bridge asyncio loop and is started
    or stopped with ``run_coroutine_threadsafe`` when called off-loop.
    """

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
        pose_refiner: RegisteredPoseRefiner,
        adapter: ARRobotAdapterSpec | None = None,
        runtime_profile: RuntimeRegistrationProfile | None = None,
        baseline_motion_available: bool = False,
        baseline_motion_params: BaselineMotionParams | None = None,
    ) -> None:
        self._robot_id = robot_id
        self._sender = sender
        self._registry = registry
        self._odom = odom
        self._status = status
        self._pose_refiner = pose_refiner
        self._tag_tracker = tag_tracker
        self._loop = loop
        self._frame_max_age_s = frame_max_age_s
        self._manual_registration_quality = manual_registration_quality
        self._baseline_motion_available = baseline_motion_available

        self._frame_in_flight = False
        self._session = _Session()

        if runtime_profile is not None:
            self._runtime_profile = runtime_profile
        elif adapter is not None:
            self._runtime_profile = adapter.runtime_registration_profile()
        else:
            from dimos.ar.adapters.base import RuntimeRegistrationProfile

            self._runtime_profile = RuntimeRegistrationProfile()

        self._broadcast_task: asyncio.Task[None] | None = None
        self._broadcast_stop_requested = False

        self._baseline: BaselineCollector | None = (
            BaselineCollector(
                adapter=adapter,
                motion_available=baseline_motion_available,
                motion_params=baseline_motion_params or BaselineMotionParams(),
                on_status=self._on_baseline_status,
            )
            if adapter is not None
            else None
        )
        self._baseline_was_sampling = False

    def _on_baseline_status(self, baseline_status: BaselineStatus) -> None:
        if (
            baseline_status.phase == RegistrationPhase.SAMPLING
            and not self._baseline_was_sampling
        ):
            self._tag_tracker.begin_waypoint_sample()
        self._baseline_was_sampling = baseline_status.phase == RegistrationPhase.SAMPLING
        self._broadcast_status(override=baseline_status)

    def stop(self) -> None:
        self._tag_tracker.active = False
        self._stop_broadcast()
        if self._baseline is not None:
            self._baseline.shutdown()

    def on_registration_command(
        self, msg: RegistrationCommandMessage, websocket: ServerConnection
    ) -> None:
        if msg.command == "start":
            self._handle_registration_command_start(msg)
        elif msg.command == "authorize_motion":
            self._handle_registration_command_authorize_motion(msg)
        elif msg.command == "stop":
            self._handle_registration_command_stop(msg)
        elif msg.command == "commit":
            self._handle_registration_command_commit(msg)

    def _handle_registration_command_start(self, msg: RegistrationCommandMessage) -> None:
        if self._baseline is not None:
            self._baseline.reset_to_idle()
        self._clear_session()
        self._session.mode = RegistrationMode(msg.mode)

        if self._session.mode == RegistrationMode.APRIL_ODOM_BASELINE:
            if self._baseline is None or not self._baseline_motion_available:
                logger.warning("registration_command start april_odom_baseline unavailable")
                self._session.mode = None
                self._broadcast_status(
                    phase=RegistrationPhase.FAILED,
                    message="AprilTag baseline registration unavailable on this robot",
                    capture=CaptureHint.OFF,
                    ts=msg.ts,
                )
                return
            self._tag_tracker.active = True
            self._baseline.start()
        else:
            self._tag_tracker.active = False
            self._broadcast_status(
                phase=RegistrationPhase.EDITING,
                message="Place the robot marker, then commit",
                capture=CaptureHint.OFF,
                ts=msg.ts,
            )

        self._session.manual_pose_first_logged = False
        self._session.last_manual_inactive_log_mono = 0.0
        self._session.last_manual_odom_missing_log_mono = 0.0
        self._session.last_manual_candidate_log_mono = 0.0
        logger.info("XR registration started", mode=self._session.mode.value)
        self._start_broadcast()

    def _handle_registration_command_authorize_motion(self, msg: RegistrationCommandMessage) -> None:
        if self._baseline is None:
            logger.warning("authorize_motion ignored: no baseline")
            return
        self._baseline.authorize_motion()
        self._broadcast_status(ts=msg.ts)
        logger.info("XR registration authorize_motion handled")

    def _handle_registration_command_stop(self, msg: RegistrationCommandMessage) -> None:
        if self._baseline is not None:
            self._baseline.stop(message="Registration cancelled")
        session_mode = self._session.mode
        was_active = (
            self._session.mode is not None or self._session.pending_candidate is not None
        )
        self._tag_tracker.active = False
        self._stop_broadcast()
        self._clear_session()
        if not was_active:
            return
        logger.info("XR registration stopped")
        self._broadcast_status(
            phase=RegistrationPhase.IDLE,
            message="Registration cancelled",
            capture=CaptureHint.OFF,
            mode=session_mode,
            ts=msg.ts,
        )

    def on_emergency_stop(self) -> None:
        if self._baseline is not None:
            self._baseline.fail("Emergency stop received")
        if self._session.mode is not None:
            self._tag_tracker.active = False
            self._stop_broadcast()
            self._clear_session()
            self._broadcast_status(
                phase=RegistrationPhase.FAILED,
                message="Emergency stop received",
                capture=CaptureHint.OFF,
            )

    def _handle_registration_command_commit(self, msg: RegistrationCommandMessage) -> None:
        cand = self._session.pending_candidate
        if cand is None:
            self._broadcast_status(
                phase=RegistrationPhase.FAILED,
                message="No valid registration candidate yet",
                capture=CaptureHint.OFF,
                ts=msg.ts,
            )
            return
        finish_ts = (
            self._session.pending_candidate_ts
            if self._session.pending_candidate_ts is not None
            else msg.ts
        )
        self._finish_registration(cand, finish_ts)

    def on_camera_info(self, msg: CameraInfoMessage, _websocket: ServerConnection) -> None:
        k = (msg.fx, 0.0, msg.cx, 0.0, msg.fy, msg.cy, 0.0, 0.0, 1.0)
        info = build_camera_info(
            width=msg.width,
            height=msg.height,
            k=k,
            d=msg.distortion,
            frame_id="xr_camera",
        )
        self._tag_tracker.set_camera_info(info)
        logger.info(
            "XR camera intrinsics received",
            resolution=f"{msg.width}x{msg.height}",
            device=msg.device_model,
        )

    async def on_camera_frame(
        self,
        header: dict[str, Any],
        jpeg: bytes,
        _websocket: ServerConnection,
    ) -> None:
        seq = int(header.get("seq", -1))
        frame_age = float(header["send_ts"]) - float(header["ts"])
        if _TRACE:
            logger.debug(
                "XR camera frame received",
                seq=seq,
                jpeg_bytes=len(jpeg),
                frame_age_s=round(frame_age, 3),
            )
        admission = self._frame_admission(header, frame_age)
        if admission == FrameAdmission.ACK_ONLY:
            self._send_frame_ack(header)
            return
        resolved_odom = self.resolve_frame_odom(header)
        if resolved_odom is None:
            self._send_frame_ack(header)
            return
        self._frame_in_flight = True
        try:
            receive_mono = time.monotonic()
            registered = self._registry.calibration.is_registered
            T_committed = self._pose_refiner.committed_or_current_for_frame()
            if self._odom.latest() is None:
                self._broadcast_status(
                    phase=RegistrationPhase.SCANNING,
                    message="Waiting for robot odometry",
                    capture=CaptureHint.STEADY,
                )
            result = await asyncio.to_thread(
                self._tag_tracker.process_frame,
                header,
                jpeg,
                odom=resolved_odom,
                receive_mono=receive_mono,
                T_committed=T_committed,
                registered=registered,
            )
            if _TRACE:
                logger.debug(
                    "XR camera frame processed",
                    seq=seq,
                    tag_detected=result.tag_detected,
                    tag_ids=result.tag_ids if result.tag_ids else None,
                    quality=round(result.quality, 3) if result.quality else None,
                )
            self._send_frame_ack(header)
            self._apply_tracker_update(
                ts=float(header.get("ts", time.time())),
                resolved_odom=resolved_odom,
                frame_result=result,
            )
            if registered:
                self._pose_refiner.maybe_log_moving_robot_diag(
                    header=header,
                    receive_mono=receive_mono,
                    frame_age=frame_age,
                    result=result,
                    resolved_odom=resolved_odom,
                    capture_ts_robot=float(header["capture_ts_robot"]),
                )
        finally:
            self._frame_in_flight = False

    def on_registration_pose(
        self, msg: RegistrationPoseMessage, _websocket: ServerConnection
    ) -> None:
        if self._session.mode != RegistrationMode.MANUAL_POSE:
            now = time.monotonic()
            if now - self._session.last_manual_inactive_log_mono >= DROPPED_POSE_LOG_INTERVAL_S:
                self._session.last_manual_inactive_log_mono = now
                logger.warning(
                    "registration_pose dropped: no manual session open"
                    " (send registration_command{command:'start',mode:'manual_pose'} first)"
                )
            return
        if not self._session.manual_pose_first_logged:
            self._session.manual_pose_first_logged = True
            logger.info(
                "Manual registration pose received",
                position=[round(v, 3) for v in msg.position],
            )
        odom = self._odom.latest()
        if odom is None:
            now = time.monotonic()
            if now - self._session.last_manual_odom_missing_log_mono >= DROPPED_POSE_LOG_INTERVAL_S:
                self._session.last_manual_odom_missing_log_mono = now
                logger.warning("Manual registration waiting on robot odometry")
            self._broadcast_status(
                phase=RegistrationPhase.EDITING,
                message="Waiting for robot odometry",
                capture=CaptureHint.OFF,
                ts=msg.ts,
            )
            return
        self._process_manual_candidate(msg, odom)

    def clear_on_disconnect(self) -> None:
        if self._session.mode is None and self._session.pending_candidate is None:
            return
        if self._baseline is not None:
            self._baseline.reset_to_idle()
        self._tag_tracker.active = False
        self._stop_broadcast()
        self._clear_session()
        logger.info("Registration session cleared on XR client disconnect")

    def resolve_frame_odom(self, header: dict[str, Any]) -> OdomSample | None:
        raw_capture_ts = header.get("capture_ts_robot")
        if raw_capture_ts is None:
            return None
        if not isinstance(raw_capture_ts, (int, float)) or not math.isfinite(float(raw_capture_ts)):
            return None
        capture_ts = float(raw_capture_ts)
        registered = self._registry.calibration.is_registered
        lookup = (
            self._odom.at_interpolated_by_source
            if registered
            else self._odom.at_or_latest_by_source
        )
        return lookup(capture_ts)

    def _frame_admission(self, header: dict[str, Any], frame_age: float) -> FrameAdmission:
        seq = int(header.get("seq", -1))
        if self._frame_in_flight:
            logger.warning("XR camera frame dropped: previous frame still in flight", seq=seq)
            return FrameAdmission.ACK_ONLY
        if frame_age > self._frame_max_age_s:
            logger.warning(
                "XR camera frame dropped: too old",
                seq=seq,
                frame_age_s=round(frame_age, 3),
                max_age_s=self._frame_max_age_s,
            )
            return FrameAdmission.ACK_ONLY
        if self._session.mode == RegistrationMode.MANUAL_POSE:
            return FrameAdmission.ACK_ONLY
        if not self._tag_tracker.has_camera_info():
            logger.warning("XR camera frame dropped: no camera intrinsics yet", seq=seq)
            if self._tag_tracker.active:
                self._broadcast_status(
                    phase=RegistrationPhase.FAILED,
                    message="No camera intrinsics received",
                    capture=CaptureHint.OFF,
                )
            return FrameAdmission.ACK_ONLY
        return FrameAdmission.PROCESS

    def _send_frame_ack(self, header: dict[str, Any]) -> None:
        self._sender.send(
            encode_camera_frame_ack(
                seq=int(header["seq"]),
            )
        )

    def _default_message(self) -> str:
        if self._session.mode == RegistrationMode.MANUAL_POSE:
            if self._session.pending_candidate is not None:
                return "Manual robot pose ready — review and commit"
            return "Place the robot marker, then commit"
        if not self._tag_tracker.has_camera_info():
            return "Waiting for camera intrinsics..."
        if self._tag_tracker.last_tag_detected:
            count = self._tag_tracker.observation_count()
            return f"Tag detected — collecting samples ({count})"
        return "Look at the AprilTag on your robot"

    def _start_broadcast(self) -> None:
        if not self._loop.is_running():
            return
        if self._is_on_loop():
            asyncio.create_task(self._start_broadcast_on_loop())
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
                    if (
                        self._session.mode == RegistrationMode.APRIL_ODOM_BASELINE
                        and self._baseline is not None
                    ):
                        if self._baseline.is_active:
                            self._baseline.tick(
                                obs_count=self._tag_tracker.observation_count(),
                                latest_obs_pos_world=None,
                            )
                        await self._maybe_finish_baseline()
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

    async def _maybe_finish_baseline(self) -> None:
        if self._baseline is None or not self._baseline.is_done:
            return
        solve = await asyncio.to_thread(
            self._tag_tracker.current_solve,
            min_baseline_m=0.0,
        )
        if solve is not None:
            logger.info("BaselineCollector DONE — auto-committing registration")
            candidate = RegistrationCandidate(
                T_world_odom=np.array(solve.T_world_odom, dtype=np.float64, copy=True),
                quality=solve.quality,
                mode=RegistrationMode.APRIL_ODOM_BASELINE,
                approximate=False,
            )
            self._finish_registration(candidate, time.time())
        else:
            logger.warning("BaselineCollector DONE but no solve produced — marking failed")
            self._tag_tracker.active = False
            self._stop_broadcast()
            self._clear_session()
            self._broadcast_status(
                phase=RegistrationPhase.FAILED,
                message="Baseline registration produced no solve — retry",
                capture=CaptureHint.OFF,
            )

    def _stop_broadcast(self) -> None:
        if not self._loop.is_running():
            return
        if self._is_on_loop():
            asyncio.create_task(self._cancel_broadcast_on_loop())
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

    def _clear_session(self) -> None:
        self._tag_tracker.reset_window()
        self._baseline_was_sampling = False
        self._session = _Session()
        if self._baseline is not None:
            self._baseline.reset_to_idle()

    def _process_manual_candidate(
        self,
        msg: RegistrationPoseMessage,
        odom: OdomSample,
    ) -> RegistrationCandidate:
        norm_position, norm_orientation = normalize_ground_pose(msg.position, msg.orientation)
        T_world_base = pose_to_matrix(norm_position, norm_orientation)
        T_world_base[:3, :3] = T_world_base[:3, :3] @ R_ALIGN
        T_odom_base = pose_to_matrix(odom.position, odom.orientation)
        candidate = RegistrationCandidate(
            T_world_odom=np.array(
                T_world_base @ np.linalg.inv(T_odom_base),
                dtype=np.float64,
                copy=True,
            ),
            quality=self._manual_registration_quality,
            mode=RegistrationMode.MANUAL_POSE,
            approximate=True,
        )
        self._session.pending_candidate = candidate
        self._session.pending_candidate_ts = msg.ts
        now = time.monotonic()
        if now - self._session.last_manual_candidate_log_mono >= DROPPED_POSE_LOG_INTERVAL_S:
            self._session.last_manual_candidate_log_mono = now
            logger.info(
                "Manual registration candidate confirmed",
                quality=round(candidate.quality, 3),
                position=[round(v, 3) for v in norm_position],
            )
        self._broadcast_status(
            phase=RegistrationPhase.AWAITING_COMMIT,
            message="Manual robot pose ready — review and commit",
            capture=CaptureHint.OFF,
            tag_visible=True,
            ts=msg.ts,
        )
        return candidate

    def _finish_registration(self, result: RegistrationCandidate, ts: float | None) -> None:
        self._tag_tracker.active = False
        self._stop_broadcast()
        self._registry.commit(result)
        self._status.set_registered(
            True,
            method=result.mode.value,
            approximate=result.approximate,
        )
        logger.info(
            "Registration succeeded",
            quality=round(result.quality, 3),
            mode=result.mode.value,
            approximate=result.approximate,
        )
        self._clear_session()
        self._status.broadcast()
        self._broadcast_status(
            phase=RegistrationPhase.SUCCEEDED,
            message=(
                "Manual registration committed"
                if result.mode == RegistrationMode.MANUAL_POSE
                else "Registration successful"
            ),
            capture=CaptureHint.OFF,
            mode=result.mode,
            ts=ts,
        )
        self._pose_refiner.set_T_committed(result.T_world_odom)

    def _apply_tracker_update(
        self,
        *,
        ts: float | None = None,
        resolved_odom: OdomSample | None = None,
        frame_result: FrameResult | None = None,
    ) -> None:
        if self._tag_tracker.active:
            if self._baseline is not None:
                if frame_result is not None and frame_result.observations_added > 0:
                    tick_pos: tuple[float, float, float] | None = None
                    if self._baseline.is_sampling:
                        self._tag_tracker.record_latest_waypoint_observation()
                        tick_pos = self._tag_tracker.latest_waypoint_robot_world_position()
                    elif self._baseline.is_estimating:
                        pose = self._tag_tracker.robot_world_pose_estimate(
                            max_observations=1,
                        )
                        if pose is not None:
                            tick_pos = pose[0]
                    if tick_pos is not None:
                        self._baseline.tick(
                            obs_count=self._tag_tracker.observation_count(),
                            latest_obs_pos_world=tick_pos,
                        )
                self._broadcast_status()
            else:
                if self._session.last_status is None or self._session.last_status.phase in (
                    RegistrationPhase.SCANNING,
                ):
                    self._broadcast_status()
            return
        self._pose_refiner.apply_tracker_update(
            ts=ts,
            resolved_odom=resolved_odom,
        )

    def _preview_pose(self) -> dict[str, Any] | None:
        if self._session.mode != RegistrationMode.APRIL_ODOM_BASELINE:
            return None
        prev = self._session.last_status
        max_obs = 2
        if prev is not None and prev.phase == RegistrationPhase.MOVING:
            max_obs = 1
        pose_result = self._tag_tracker.robot_world_pose_estimate(max_observations=max_obs)
        if pose_result is None or len(pose_result) < 3:
            return None
        pos, ori, _conf = pose_result
        return {"position": list(pos), "orientation": list(ori)}

    def _broadcast_status(
        self,
        *,
        phase: RegistrationPhase | None = None,
        message: str = "",
        capture: CaptureHint | None = None,
        mode: RegistrationMode | None = None,
        tag_visible: bool | None = None,
        ts: float | None = None,
        override: BaselineStatus | None = None,
    ) -> None:
        effective_mode = mode or self._session.mode
        if override is not None:
            effective_phase = override.phase
            effective_capture = override.capture
            effective_message = override.message
            motion = override.motion
        else:
            prev = self._session.last_status
            effective_phase = phase or (prev.phase if prev is not None else RegistrationPhase.IDLE)
            effective_capture = capture or (prev.capture if prev is not None else CaptureHint.OFF)
            if message:
                effective_message = message
            elif prev is not None:
                effective_message = prev.message
            else:
                effective_message = self._default_message()
            motion = prev.motion if prev is not None and phase is None else None

        if tag_visible is None and effective_mode == RegistrationMode.APRIL_ODOM_BASELINE:
            tag_visible = self._tag_tracker.last_tag_detected

        payload = RegistrationStatusPayload(
            mode=effective_mode,
            phase=effective_phase,
            capture=effective_capture,
            message=effective_message,
            tag_visible=tag_visible,
            motion=motion,
            preview_pose=self._preview_pose(),
        )
        self._session.last_status = payload
        self._sender.send(
            encode_registration_status(
                ts=ts,
                status=payload,
            )
        )
