"""XR camera frame admission and processing for registration sessions."""

from __future__ import annotations

import asyncio
from enum import StrEnum
import math
import os
import time
from typing import TYPE_CHECKING, Any

from dimos.ar.network.protocol import CameraInfoMessage, encode_camera_frame_ack
from dimos.ar.registration.types import CaptureHint, RegistrationMode, RegistrationPhase
from dimos.ar.tag_tracking.solve import build_camera_info
from dimos.utils.logging_config import setup_logger

if TYPE_CHECKING:
    from websockets.asyncio.server import ServerConnection

    from dimos.ar.bridge.odom_buffer import OdomBuffer
    from dimos.ar.bridge.sender import BridgeSender
    from dimos.ar.registration.baseline import BaselineStatus
    from dimos.ar.tag_tracking.tracker import FrameResult, RobotAprilTagTracker
    from dimos.ar.world_frame.refinement import WorldFrameRefiner
    from dimos.ar.world_frame.registry import WorldRegistry
    from dimos.ar.world_frame.transforms import OdomSample

_TRACE = os.getenv("DIMOS_AR_TRACE", "") not in ("", "0", "false")

logger = setup_logger()


class FrameAdmission(StrEnum):
    ACK_ONLY = "ack_only"
    PROCESS = "process"


class RegistrationSessionFramesMixin:
    """XR camera intrinsics, frame admission, and async frame processing."""

    if TYPE_CHECKING:
        _tag_tracker: RobotAprilTagTracker
        _registry: WorldRegistry
        _world_frame_refiner: WorldFrameRefiner
        _odom: OdomBuffer
        _sender: BridgeSender
        _session: Any
        _frame_max_age_s: float
        _frame_in_flight: bool

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
        ) -> None: ...

        def _apply_tracker_update(
            self,
            *,
            ts: float | None = None,
            resolved_odom: OdomSample | None = None,
            frame_result: FrameResult | None = None,
        ) -> None: ...

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
            world_frame_committed = self._registry.state.is_committed
            T_committed = self._world_frame_refiner.committed_or_current_for_frame()
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
                world_frame_committed=world_frame_committed,
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
            if world_frame_committed:
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
        world_frame_committed = self._registry.state.is_committed
        lookup = (
            self._odom.at_interpolated_by_source
            if world_frame_committed
            else self._odom.at_or_latest_by_source
        )
        return lookup(capture_ts)

    def _frame_admission(
        self,
        header: dict[str, Any],
        frame_age: float,
    ) -> FrameAdmission:
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
