"""AprilTag and manual registration flows, status broadcast, and commit."""

from __future__ import annotations

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
from dimos.ar.tag_tracking.solve import R_ALIGN, build_T_world_odom
from dimos.ar.utils.console import console_divider, log_checkpoint
from dimos.ar.world_frame.transforms import OdomSample, normalize_ground_pose, pose_to_matrix
from dimos.utils.logging_config import setup_logger

if TYPE_CHECKING:
    from dimos.ar.bridge.odom_buffer import OdomBuffer
    from dimos.ar.bridge.sender import BridgeSender
    from dimos.ar.bridge.status_service import StatusService
    from dimos.ar.tag_tracking.tracker import RobotAprilTagTracker
    from dimos.ar.world_frame.aligner import AlignmentEstimate
    from dimos.ar.world_frame.refinement import WorldFrameRefiner
    from dimos.ar.world_frame.registry import WorldRegistry

logger = setup_logger()

TAG_REGISTRATION_WINDOW_S = 15.0
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
        _world_frame_refiner: WorldFrameRefiner

        def _clear_session(self) -> None: ...

        def _set_tag_tracker_active(self, active: bool, *, reason: str) -> None: ...

        def _start_broadcast(self) -> None: ...

        def _stop_broadcast(self) -> None: ...

    def _handle_registration_command_start(
        self,
        msg: RegistrationCommandMessage,
    ) -> None:
        self._clear_session()
        self._registry.clear()
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

        if self._session.mode == RegistrationMode.APRIL_TAG:
            self._session.april_tag_started_mono = time.monotonic()
            self._set_tag_tracker_active(True, reason="april_tag_start")
            self._broadcast_status(
                phase=RegistrationPhase.SCANNING,
                message="Look at the AprilTag on your robot",
                capture=CaptureHint.BURST,
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

    def _registration_alignment_estimate(self) -> AlignmentEstimate | None:
        return self._world_frame_refiner.registration_alignment_estimate(
            now_mono=time.monotonic(),
            max_age_s=TAG_REGISTRATION_WINDOW_S,
        )

    def _registration_ready(self, estimate: AlignmentEstimate) -> bool:
        if estimate.confidence >= self._world_frame_refiner.registration_confidence_min():
            return True
        return estimate.yaw_observable and not estimate.approximate

    def _registration_scan_timed_out(self) -> bool:
        started = self._session.april_tag_started_mono
        if started is None:
            return False
        return bool(time.monotonic() - started >= TAG_REGISTRATION_WINDOW_S)

    def _fail_april_tag_registration(self, message: str) -> None:
        self._set_tag_tracker_active(False, reason="registration_failed")
        self._broadcast_status(
            phase=RegistrationPhase.FAILED,
            message=message,
            capture=CaptureHint.OFF,
        )
        self._stop_broadcast()
        self._clear_session()

    async def _maybe_finish_tag_registration(self) -> None:
        if self._session.mode != RegistrationMode.APRIL_TAG:
            return
        if self._registry.state.is_committed:
            return
        min_obs = self._world_frame_refiner.registration_min_observations()
        estimate = self._registration_alignment_estimate()
        if estimate is None:
            if self._registration_scan_timed_out():
                self._fail_april_tag_registration(
                    "Registration timed out — move around the robot while keeping the tag in view",
                )
            return
        if estimate.observation_count < min_obs:
            if self._registration_scan_timed_out():
                self._fail_april_tag_registration(
                    "Registration timed out — move around the robot while keeping the tag in view",
                )
            return
        if not self._registration_ready(estimate):
            if self._registration_scan_timed_out():
                self._fail_april_tag_registration(
                    "Registration timed out — move around the robot while keeping the tag in view",
                )
            return
        candidate = RegistrationCandidate(
            T_world_odom=np.array(
                build_T_world_odom(estimate.yaw_rad, estimate.translation_world),
                dtype=np.float64,
                copy=True,
            ),
            quality=estimate.confidence,
            mode=RegistrationMode.APRIL_TAG,
            approximate=estimate.approximate,
            odom_scale=estimate.scale,
        )
        logger.info(
            "AprilTag registration aligner commit",
            approximate=estimate.approximate,
            yaw_observable=estimate.yaw_observable,
            scale_observable=estimate.scale_observable,
            alignment_confidence=round(estimate.confidence, 4),
            n_obs=estimate.observation_count,
        )
        self._finish_registration(candidate, time.time())

    def _april_tag_window_observations(self) -> list[Any]:
        return self._tag_tracker.recent_observations(
            max_age_s=TAG_REGISTRATION_WINDOW_S,
        )

    def _april_tag_progress_percent(self, phase: RegistrationPhase) -> int | None:
        if self._session.mode != RegistrationMode.APRIL_TAG:
            return None
        if phase == RegistrationPhase.SUCCEEDED:
            return 100
        if phase != RegistrationPhase.SCANNING:
            return None
        if not self._tag_tracker.has_camera_info():
            return 0
        if not self._tag_tracker.last_tag_detected:
            return 0

        observations = self._april_tag_window_observations()
        min_obs = int(self._world_frame_refiner.registration_min_observations())
        estimate = self._registration_alignment_estimate()
        obs_fraction = min(len(observations) / max(min_obs, 1), 1.0)
        conf_fraction = estimate.confidence if estimate is not None else 0.0
        return max(0, min(100, round(min(obs_fraction, conf_fraction) * 100)))

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
        self._status.broadcast()
        self._stop_broadcast()
        self._clear_session()
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
            return ""
        return "Look at the AprilTag on your robot"

    def _preview_pose(self) -> dict[str, Any] | None:
        if self._session.mode != RegistrationMode.APRIL_TAG:
            return None
        pose_result = self._tag_tracker.robot_world_pose_estimate(
            max_observations=2,
        )
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
        else:
            effective_message = self._default_message()

        if tag_visible is None and effective_mode == RegistrationMode.APRIL_TAG:
            tag_visible = self._tag_tracker.last_tag_detected

        progress = (
            self._april_tag_progress_percent(effective_phase)
            if effective_mode == RegistrationMode.APRIL_TAG
            else None
        )
        estimate = None
        if effective_mode == RegistrationMode.APRIL_TAG:
            if self._registry.state.is_committed:
                estimate = self._world_frame_refiner.current_alignment_estimate(
                    now_mono=time.monotonic(),
                    min_observations=1,
                )
            else:
                estimate = self._registration_alignment_estimate()
        refining = (
            effective_mode == RegistrationMode.APRIL_TAG
            and self._registry.state.is_committed
            and self._registry.state.approximate
            and not self._tag_tracker.active
        )

        payload = RegistrationStatusPayload(
            mode=effective_mode,
            phase=effective_phase,
            capture=effective_capture,
            message=effective_message,
            tag_visible=tag_visible,
            preview_pose=self._preview_pose(),
            progress=progress,
            alignment_confidence=estimate.confidence if estimate is not None else None,
            refining=refining if effective_mode == RegistrationMode.APRIL_TAG else None,
        )
        self._session.last_status = payload
        self._sender.send(
            encode_registration_status(
                ts=ts,
                status=payload,
            )
        )
