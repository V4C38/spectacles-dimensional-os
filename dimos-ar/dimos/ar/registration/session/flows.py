"""Baseline and manual registration flows, status broadcast, and commit."""

from __future__ import annotations

import asyncio
import time
from typing import TYPE_CHECKING, Any

import numpy as np

from dimos.ar.network.data_plane import DROPPED_POSE_LOG_INTERVAL_S
from dimos.ar.network.protocol import RegistrationCommandMessage, RegistrationPoseMessage
from dimos.ar.registration.baseline import BaselineStatus
from dimos.ar.registration.types import (
    CaptureHint,
    RegistrationCandidate,
    RegistrationMode,
    RegistrationPhase,
)
from dimos.ar.registration.wire import RegistrationStatusPayload, encode_registration_status
from dimos.ar.tag_tracking.solve import R_ALIGN
from dimos.ar.utils.console import console_divider, log_checkpoint
from dimos.ar.world_frame.transforms import OdomSample, normalize_ground_pose, pose_to_matrix
from dimos.utils.logging_config import setup_logger

if TYPE_CHECKING:
    from dimos.ar.bridge.odom_buffer import OdomBuffer
    from dimos.ar.bridge.sender import BridgeSender
    from dimos.ar.bridge.status_service import StatusService
    from dimos.ar.registration.baseline import BaselineCollector
    from dimos.ar.tag_tracking.tracker import RobotAprilTagTracker
    from dimos.ar.world_frame.registry import WorldRegistry

logger = setup_logger()


class RegistrationFlowsMixin:
    """Baseline/manual registration flows and status broadcasting."""

    if TYPE_CHECKING:
        _baseline: BaselineCollector | None
        _baseline_motion_available: bool
        _session: Any
        _odom: OdomBuffer
        _tag_tracker: RobotAprilTagTracker
        _manual_registration_quality: float
        _registry: WorldRegistry
        _status: StatusService
        _sender: BridgeSender

        def _clear_session(self) -> None: ...

        def _set_tag_tracker_active(self, active: bool, *, reason: str) -> None: ...

        def _start_broadcast(self) -> None: ...

        def _stop_broadcast(self) -> None: ...

    def _handle_registration_command_start(
        self,
        msg: RegistrationCommandMessage,
    ) -> None:
        if self._baseline is not None:
            self._baseline.reset_to_idle()
        self._clear_session()
        start_mode = msg.mode
        if start_mode is None:
            logger.warning("registration_command start missing mode")
            self._broadcast_status(
                phase=RegistrationPhase.FAILED,
                message="Registration start requires mode",
                capture=CaptureHint.OFF,
                ts=msg.ts,
            )
            return
        self._session.mode = RegistrationMode(str(start_mode))

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

        self._registry.clear()

        if self._session.mode == RegistrationMode.APRIL_ODOM_BASELINE:
            self._set_tag_tracker_active(True, reason="baseline_start")
            assert self._baseline is not None
            self._baseline.start()
        else:
            self._set_tag_tracker_active(False, reason="manual_mode")
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

    def on_registration_pose(
        self,
        msg: RegistrationPoseMessage,
        _websocket: object,
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
            self._set_tag_tracker_active(False, reason="manual_mode")
            self._stop_broadcast()
            self._clear_session()
            self._broadcast_status(
                phase=RegistrationPhase.FAILED,
                message="Baseline registration produced no solve — retry",
                capture=CaptureHint.OFF,
            )

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

    def _finish_registration(
        self,
        result: RegistrationCandidate,
        ts: float | None,
    ) -> None:
        self._set_tag_tracker_active(False, reason="registration_finish")
        self._stop_broadcast()
        self._registry.commit(result)
        log_checkpoint(
            logger,
            kind="success",
            event="Registration succeeded",
            quality=round(result.quality, 3),
            mode=result.mode.value,
            approximate=result.approximate,
        )
        console_divider(
            f"Registration succeeded mode={result.mode.value} quality={round(result.quality, 2)}",
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
