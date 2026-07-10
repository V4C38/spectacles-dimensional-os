"""AprilTag and manual registration flows, status broadcast, and commit."""

from __future__ import annotations

import math
import time
from typing import TYPE_CHECKING, Any

import numpy as np

from dimos.ar.network.data_plane import DROPPED_POSE_LOG_INTERVAL_S
from dimos.ar.network.protocol import RegistrationCommandMessage, RegistrationPoseMessage
from dimos.ar.registration.types import (
    RegistrationCandidate,
    RegistrationMode,
    RegistrationPhase,
)
from dimos.ar.registration.wire import RegistrationStatusPayload, encode_registration_status
from dimos.ar.tag_tracking.solve import R_ALIGN, build_T_world_odom
from dimos.ar.utils.console import console_divider, log_checkpoint
from dimos.ar.world_frame.transforms import (
    OdomSample,
    normalize_ground_pose,
    pose_to_matrix,
    yaw_from_T,
)
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

TAG_REGISTRATION_WINDOW_S = 30.0
TAG_REGISTRATION_MAX_SPREAD_M = 0.10
TAG_REGISTRATION_MAX_YAW_SPREAD_DEG = 6.0
TAG_REGISTRATION_PROGRESS_SAMPLE_WEIGHT = 0.8
TAG_REGISTRATION_PROGRESS_CONFIDENCE_WEIGHT = 0.2


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
                    ts=msg.ts,
                )
                return

        if self._session.mode == RegistrationMode.APRIL_TAG:
            self._session.april_tag_started_mono = time.monotonic()
            self._set_tag_tracker_active(True, reason="april_tag_start")
            self._broadcast_status(
                phase=RegistrationPhase.SCANNING,
                message="Look at the AprilTag on your robot",
                ts=msg.ts,
            )
        else:
            self._set_tag_tracker_active(False, reason="manual_mode")
            self._broadcast_status(
                phase=RegistrationPhase.EDITING,
                message="Place the robot marker, then commit",
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
        if estimate.yaw_observable and not estimate.approximate:
            return True
        min_obs = self._world_frame_refiner.registration_min_observations()
        if estimate.observation_count >= min_obs and self._tag_registration_stability_met():
            return True
        return False

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
                self._fail_april_tag_registration("Registration timed out")
            return
        if estimate.observation_count < min_obs:
            if self._registration_scan_timed_out():
                self._fail_april_tag_registration("Registration timed out")
            return
        if not self._registration_ready(estimate):
            if self._registration_scan_timed_out():
                self._fail_april_tag_registration("Registration timed out")
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
        sample_part = obs_fraction * TAG_REGISTRATION_PROGRESS_SAMPLE_WEIGHT
        confidence_part = 0.0
        if estimate is not None and len(observations) >= min_obs:
            confidence_part = (
                estimate.confidence * TAG_REGISTRATION_PROGRESS_CONFIDENCE_WEIGHT
            )
        return max(0, min(100, round((sample_part + confidence_part) * 100)))

    def _april_tag_window_pose_samples(
        self,
        observations: list[Any],
    ) -> tuple[list[np.ndarray], list[float]]:
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
            yaws.append(yaw_from_T(T_world_base))
        return positions, yaws

    def _april_tag_window_spread_m(self, positions: list[np.ndarray]) -> float | None:
        min_obs = self._world_frame_refiner.registration_min_observations()
        if len(positions) < min_obs:
            return None
        arr = np.stack(positions, axis=0)
        center = np.median(arr, axis=0)
        return float(np.max(np.linalg.norm(arr - center, axis=1)))

    def _april_tag_window_max_yaw_delta_deg(self, yaws: list[float]) -> float | None:
        if len(yaws) < 2:
            return 0.0
        sin_sum = sum(math.sin(y) for y in yaws)
        cos_sum = sum(math.cos(y) for y in yaws)
        mean_yaw = math.atan2(sin_sum, cos_sum)
        max_yaw_delta = max(
            abs(math.atan2(math.sin(y - mean_yaw), math.cos(y - mean_yaw))) for y in yaws
        )
        return math.degrees(max_yaw_delta)

    def _tag_registration_stability_met(self) -> bool:
        observations = self._april_tag_window_observations()
        min_obs = self._world_frame_refiner.registration_min_observations()
        if len(observations) < min_obs:
            return False

        positions, yaws = self._april_tag_window_pose_samples(observations)
        if len(positions) < min_obs:
            return False

        spread_m = self._april_tag_window_spread_m(positions)
        if spread_m is None or spread_m > TAG_REGISTRATION_MAX_SPREAD_M:
            return False

        max_yaw_deg = self._april_tag_window_max_yaw_delta_deg(yaws)
        if max_yaw_deg is not None and max_yaw_deg > TAG_REGISTRATION_MAX_YAW_SPREAD_DEG:
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
            tag_visible=True,
            ts=msg.ts,
        )
        return candidate

    def _finish_registration(
        self,
        result: RegistrationCandidate,
        ts: float | None,
    ) -> None:
        # The registry seeds the runtime aligner from the accepted registration
        # observations.  Deactivate only after commit: the tracker clears its
        # disposable detector window when deactivated.
        self._registry.commit(result, odom=self._odom.latest())
        self._set_tag_tracker_active(False, reason="registration_finish")
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
        mode: RegistrationMode | None = None,
        tag_visible: bool | None = None,
        ts: float | None = None,
    ) -> None:
        effective_mode = mode or self._session.mode
        prev = self._session.last_status
        effective_phase = phase or (prev.phase if prev is not None else RegistrationPhase.IDLE)
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
            message=effective_message,
            tag_visible=tag_visible,
            preview_pose=self._preview_pose(),
            progress=progress,
            alignment_confidence=estimate.confidence if estimate is not None else None,
            refining=refining if effective_mode == RegistrationMode.APRIL_TAG else None,
            scale_confidence=estimate.scale_confidence if estimate is not None else None,
            scale_locked=(
                estimate.scale_confidence
                >= self._world_frame_refiner.scale_lock_confidence_threshold()
                if estimate is not None
                else None
            ),
        )
        self._session.last_status = payload
        self._sender.send(
            encode_registration_status(
                ts=ts,
                status=payload,
            )
        )
