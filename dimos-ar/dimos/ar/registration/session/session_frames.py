"""AR camera frame admission and processing for registration sessions."""

from __future__ import annotations

import asyncio
from enum import StrEnum
import math
import os
import time
from typing import TYPE_CHECKING, Any

from dimos.ar.network.protocol import (
    CameraInfoMessage,
    encode_camera_frame_ack,
    encode_capture_policy,
)
from dimos.ar.registration.types import RegistrationMode, RegistrationPhase
from dimos.ar.tag_tracking.solve import (
    build_camera_info,
    capture_max_stream_distance_m,
)
from dimos.utils.logging_config import setup_logger

if TYPE_CHECKING:
    from websockets.asyncio.server import ServerConnection

    from dimos.ar.bridge.odom_buffer import OdomBuffer
    from dimos.ar.bridge.sender import BridgeSender
    from dimos.ar.tag_tracking.tracker import FrameResult, RobotAprilTagTracker
    from dimos.ar.world_frame.refinement import WorldFrameRefiner
    from dimos.ar.world_frame.registry import WorldRegistry
    from dimos.ar.world_frame.transforms import OdomSample

_TRACE = os.getenv("DIMOS_AR_TRACE", "") not in ("", "0", "false")

logger = setup_logger()

REGISTRATION_SCAN_DIAG_LOG_INTERVAL_S = 2.0


class FrameAdmission(StrEnum):
    ACK_ONLY = "ack_only"
    PROCESS = "process"


class RegistrationSessionFramesMixin:
    """AR camera intrinsics, frame admission, and async frame processing."""

    if TYPE_CHECKING:
        _tag_tracker: RobotAprilTagTracker
        _registry: WorldRegistry
        _world_frame_refiner: WorldFrameRefiner
        _odom: OdomBuffer
        _sender: BridgeSender
        _session: Any
        _frame_max_age_s: float
        _frame_in_flight: bool
        _capture_min_tag_px: float
        _capture_max_distance_margin: float
        _capture_max_speed_mps: float
        _capture_min_distance_m: float
        _align_min_obs: int
        _runtime_profile: Any
        _capture_max_stream_distance_m: float | None

        @property
        def capture_max_stream_distance_m(self) -> float | None: ...

        def _broadcast_status(
            self,
            *,
            phase: RegistrationPhase | None = None,
            message: str = "",
            mode: RegistrationMode | None = None,
            tag_visible: bool | None = None,
            ts: float | None = None,
        ) -> None: ...

        def _apply_tracker_update(
            self,
            *,
            resolved_odom: OdomSample | None = None,
            frame_result: FrameResult | None = None,
        ) -> Any: ...

    def on_camera_info(
        self,
        msg: CameraInfoMessage,
        _websocket: ServerConnection,
    ) -> None:
        k = (msg.fx, 0.0, msg.cx, 0.0, msg.fy, msg.cy, 0.0, 0.0, 1.0)
        info = build_camera_info(
            width=msg.width,
            height=msg.height,
            k=k,
            d=msg.distortion,
            frame_id="ar_camera",
        )
        self._tag_tracker.set_camera_info(info)
        d_max = capture_max_stream_distance_m(
            msg.fx,
            self._tag_tracker.primary_tag_size_m,
            self._capture_min_tag_px,
            margin=self._capture_max_distance_margin,
        )
        self._capture_max_stream_distance_m = d_max
        self._sender.send(
            encode_capture_policy(
                max_stream_distance_m=d_max,
                min_stream_distance_m=self._capture_min_distance_m,
                max_capture_speed_mps=self._capture_max_speed_mps,
                static_speed_mps=self._runtime_profile.runtime_static_speed_mps,
                min_observations=self._align_min_obs,
            )
        )
        logger.info(
            "AR camera intrinsics received",
            resolution=f"{msg.width}x{msg.height}",
            device=msg.device_model,
            capture_max_stream_distance_m=round(d_max, 4),
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
                "AR camera frame received",
                seq=seq,
                jpeg_bytes=len(jpeg),
                frame_age_s=round(frame_age, 3),
            )
        admission = self._frame_admission(header, frame_age)
        if admission == FrameAdmission.ACK_ONLY:
            self._send_frame_ack(header, obs_added=False)
            return
        resolved_odom = self.resolve_frame_odom(header)
        if resolved_odom is None:
            if (
                self._session.mode == RegistrationMode.APRIL_TAG
                and self._tag_tracker.active
            ):
                logger.info(
                    "Tag frame skipped: no odom at capture time",
                    seq=seq,
                )
            self._send_frame_ack(header, obs_added=False)
            return
        self._frame_in_flight = True
        try:
            receive_mono = time.monotonic()
            refining_committed_frame = self._refining_committed_frame()
            world_frame_committed = refining_committed_frame
            T_committed = (
                self._world_frame_refiner.committed_or_current_for_frame()
                if refining_committed_frame
                else None
            )
            if self._odom.latest() is None:
                self._broadcast_status(
                    phase=RegistrationPhase.SCANNING,
                    message="Waiting for robot odometry",
                )
            result = await asyncio.to_thread(
                self._tag_tracker.process_frame,
                header,
                jpeg,
                odom=resolved_odom,
                receive_mono=receive_mono,
                T_committed=T_committed,
                world_frame_committed=world_frame_committed,
                max_distance_m=self.capture_max_stream_distance_m,
            )
            if _TRACE:
                logger.debug(
                    "AR camera frame processed",
                    seq=seq,
                    tag_detected=result.tag_detected,
                    tag_ids=result.tag_ids if result.tag_ids else None,
                    quality=round(result.quality, 3) if result.quality else None,
                )
            outcome = self._apply_tracker_update(
                resolved_odom=resolved_odom,
                frame_result=result,
            )
            self._send_frame_ack(
                header,
                obs_added=result.observations_added > 0,
                refinement_complete=outcome.refinement_complete,
            )
            if self._session.mode == RegistrationMode.APRIL_TAG and self._tag_tracker.active:
                self._maybe_log_registration_scan_diag(
                    header=header,
                    result=result,
                    resolved_odom=resolved_odom,
                )
            if refining_committed_frame:
                self._world_frame_refiner.maybe_log_moving_robot_diag(
                    header=header,
                    receive_mono=receive_mono,
                    frame_age=frame_age,
                    result=result,
                    resolved_odom=resolved_odom,
                    capture_ts_robot=float(header["capture_ts_robot"]),
                )
        finally:
            self._frame_in_flight = False

    def resolve_frame_odom(
        self,
        header: dict[str, Any],
    ) -> OdomSample | None:
        raw_capture_ts = header.get("capture_ts_robot")
        if raw_capture_ts is None:
            return None
        if not isinstance(raw_capture_ts, (int, float)) or not math.isfinite(float(raw_capture_ts)):
            return None
        capture_ts = float(raw_capture_ts)
        sample = self._odom.at_interpolated_by_source(capture_ts)
        if sample is not None:
            return sample
        return self._odom.at_or_latest_by_source(capture_ts)

    def _maybe_log_registration_scan_diag(
        self,
        *,
        header: dict[str, Any],
        result: FrameResult,
        resolved_odom: OdomSample,
    ) -> None:
        now = time.monotonic()
        if now - self._session.last_registration_scan_log_mono < REGISTRATION_SCAN_DIAG_LOG_INTERVAL_S:
            return
        self._session.last_registration_scan_log_mono = now
        capture_ts_robot = float(header["capture_ts_robot"])
        source_ts = resolved_odom.source_ts
        source_ts_gap: float | None = None
        if source_ts is not None:
            source_ts_gap = capture_ts_robot - source_ts
        logger.info(
            "registration scan frame",
            seq=int(header.get("seq", -1)),
            tag_detected=result.tag_detected,
            observations_added=result.observations_added,
            observation_count=self._tag_tracker.observation_count(),
            rejections_reprojection=result.rejections_reprojection,
            rejections_skew=result.rejections_skew,
            rejections_distance=result.rejections_distance,
            source_ts_gap_s=round(source_ts_gap, 4) if source_ts_gap is not None else None,
        )

    def _frame_admission(
        self,
        header: dict[str, Any],
        frame_age: float,
    ) -> FrameAdmission:
        seq = int(header.get("seq", -1))
        if self._frame_in_flight:
            logger.warning("AR camera frame dropped: previous frame still in flight", seq=seq)
            return FrameAdmission.ACK_ONLY
        if frame_age > self._frame_max_age_s:
            logger.warning(
                "AR camera frame dropped: too old",
                seq=seq,
                frame_age_s=round(frame_age, 3),
                max_age_s=self._frame_max_age_s,
            )
            return FrameAdmission.ACK_ONLY
        if self._session.mode == RegistrationMode.MANUAL_POSE:
            return FrameAdmission.ACK_ONLY
        if not self._tag_tracker.has_camera_info():
            logger.warning("AR camera frame dropped: no camera intrinsics yet", seq=seq)
            if self._tag_tracker.active:
                self._broadcast_status(
                    phase=RegistrationPhase.FAILED,
                    message="No camera intrinsics received",
                )
            return FrameAdmission.ACK_ONLY
        return FrameAdmission.PROCESS

    def _refining_committed_frame(self) -> bool:
        """Runtime refinement uses the committed frame; tag registration must not."""
        return self._registry.state.is_committed and not self._tag_tracker.active

    def _send_frame_ack(
        self,
        header: dict[str, Any],
        *,
        obs_added: bool = False,
        refinement_complete: bool = False,
    ) -> None:
        self._sender.send(
            encode_camera_frame_ack(
                seq=int(header["seq"]),
                obs_added=obs_added,
                refinement_complete=refinement_complete,
            )
        )
