"""AprilTag and manual registration flows, status broadcast, and commit."""

from __future__ import annotations

import math
import time
from typing import TYPE_CHECKING, Any

import numpy as np

from dimos.ar.network.data_plane import DROPPED_POSE_LOG_INTERVAL_S
from dimos.ar.network.protocol import RegistrationCommandMessage, RegistrationPoseMessage
from dimos.ar.registration.types import (
    CaptureHint,
    RegistrationCandidate,
    RegistrationMode,
    RegistrationPhase,
)
from dimos.ar.registration.wire import RegistrationStatusPayload, encode_registration_status
from dimos.ar.tag_tracking.solve import R_ALIGN, _yaw_from_T
from dimos.ar.utils.console import console_divider, log_checkpoint
from dimos.ar.world_frame.transforms import OdomSample, normalize_ground_pose, pose_to_matrix
from dimos.utils.logging_config import setup_logger

if TYPE_CHECKING:
    from dimos.ar.bridge.odom_buffer import OdomBuffer
    from dimos.ar.bridge.sender import BridgeSender
    from dimos.ar.bridge.status_service import StatusService
    from dimos.ar.tag_tracking.tracker import RobotAprilTagTracker
    from dimos.ar.world_frame.registry import WorldRegistry

logger = setup_logger()

TAG_REGISTRATION_MIN_OBS = 4
TAG_REGISTRATION_WINDOW_S = 5.0
TAG_REGISTRATION_MAX_SPREAD_M = 0.10
TAG_REGISTRATION_MAX_YAW_SPREAD_DEG = 6.0
TAG_REGISTRATION_MAX_DIST_M = 2.5


class RegistrationFlowsMixin:
    """AprilTag/manual registration flows and status broadcasting."""

    if TYPE_CHECKING:
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

        if self._session.mode == RegistrationMode.APRIL_TAG:
            if not self._tag_tracker.mounts_configured():
                logger.warning("registration_command start april_tag unavailable")
                self._session.mode = None
                self._broadcast_status(
                    phase=RegistrationPhase.FAILED,
                    message="AprilTag registration unavailable on this robot",
                    capture=CaptureHint.OFF,
                    ts=msg.ts,
                )
                return

        self._registry.clear()

        if self._session.mode == RegistrationMode.APRIL_TAG:
            self._set_tag_tracker_active(True, reason="april_tag_start")
            self._broadcast_status(
                phase=RegistrationPhase.SCANNING,
                message="Look at the AprilTag on your robot",
                capture=CaptureHint.STEADY,
                ts=msg.ts,
            )
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
        logger.info("AR registration started", mode=self._session.mode.value)
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

    async def _maybe_finish_tag_registration(self) -> None:
        if self._session.mode != RegistrationMode.APRIL_TAG:
            return
        if not self._tag_registration_stability_met():
            return
        odom = self._odom.latest()
        if odom is None:
            return
        pose_result = self._tag_tracker.robot_world_pose_estimate()
        if pose_result is None:
            return
        pos, ori, confidence = pose_result
        T_world_base = pose_to_matrix(pos, ori)
        T_world_base[:3, :3] = T_world_base[:3, :3] @ R_ALIGN
        T_odom_base = pose_to_matrix(odom.position, odom.orientation)
        candidate = RegistrationCandidate(
            T_world_odom=np.array(
                T_world_base @ np.linalg.inv(T_odom_base),
                dtype=np.float64,
                copy=True,
            ),
            quality=confidence,
            mode=RegistrationMode.APRIL_TAG,
            approximate=False,
        )
        logger.info("AprilTag registration stability gate passed — auto-committing")
        self._finish_registration(candidate, time.time())

    def _tag_registration_stability_met(self) -> bool:
        observations = self._tag_tracker.recent_observations(
            max_age_s=TAG_REGISTRATION_WINDOW_S,
        )
        if len(observations) < TAG_REGISTRATION_MIN_OBS:
            return False

        mounts = self._tag_tracker.mounts_snapshot()
        positions: list[np.ndarray] = []
        yaws: list[float] = []
        for obs in observations:
            mount = mounts.get(obs.tag_id)
            if mount is None:
                continue
            T_world_tag = obs.T_world_tag
            T_world_base = T_world_tag @ np.linalg.inv(mount.T_base_tag)
            positions.append(T_world_base[:3, 3])
            yaws.append(_yaw_from_T(T_world_base))

        if len(positions) < TAG_REGISTRATION_MIN_OBS:
            return False

        arr = np.stack(positions, axis=0)
        center = np.median(arr, axis=0)
        spread_m = float(np.max(np.linalg.norm(arr - center, axis=1)))
        if spread_m > TAG_REGISTRATION_MAX_SPREAD_M:
            return False

        if len(yaws) >= 2:
            sin_sum = sum(math.sin(y) for y in yaws)
            cos_sum = sum(math.cos(y) for y in yaws)
            mean_yaw = math.atan2(sin_sum, cos_sum)
            max_yaw_delta = max(
                abs(math.atan2(math.sin(y - mean_yaw), math.cos(y - mean_yaw)))
                for y in yaws
            )
            if math.degrees(max_yaw_delta) > TAG_REGISTRATION_MAX_YAW_SPREAD_DEG:
                return False

        return True

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
        self._registry.commit(result, odom=self._odom.latest())
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
        if self._session.mode != RegistrationMode.APRIL_TAG:
            return None
        pose_result = self._tag_tracker.robot_world_pose_estimate(max_observations=2)
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
    ) -> None:
        effective_mode = mode or self._session.mode
        prev = self._session.last_status
        effective_phase = phase or (prev.phase if prev is not None else RegistrationPhase.IDLE)
        effective_capture = capture or (prev.capture if prev is not None else CaptureHint.OFF)
        if message:
            effective_message = message
        elif prev is not None:
            effective_message = prev.message
        else:
            effective_message = self._default_message()

        if tag_visible is None and effective_mode == RegistrationMode.APRIL_TAG:
            tag_visible = self._tag_tracker.last_tag_detected

        payload = RegistrationStatusPayload(
            mode=effective_mode,
            phase=effective_phase,
            capture=effective_capture,
            message=effective_message,
            tag_visible=tag_visible,
            preview_pose=self._preview_pose(),
        )
        self._session.last_status = payload
        self._sender.send(
            encode_registration_status(
                ts=ts,
                status=payload,
            )
        )
