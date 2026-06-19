"""CalibrationSessionController — setup wizard for XR alignment.

Owns align_start/stop/commit, camera frames during calibration, assist driver,
manual pose, align_status broadcast, and TF publish. Delegates post-registration
pose refinement to RegisteredPoseRefiner.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from enum import StrEnum
import math
import os
import threading
import time
from typing import TYPE_CHECKING, Any, Literal

import numpy as np

from dimos.ar.bridge.assist import AssistDriver
from dimos.ar.bridge.pose_refinement import RegisteredPoseRefiner
from dimos.ar.network.data_plane import DROPPED_POSE_LOG_INTERVAL_S
from dimos.ar.network.protocol import (
    AlignCommitMessage,
    AlignManualPoseMessage,
    AlignStartMessage,
    AlignStopMessage,
    AssistConfirmMessage,
    CameraInfoMessage,
    encode_align_status,
    encode_camera_frame_ack,
)
from dimos.ar.tracking.robot_tag_tracker import (
    R_ALIGN,
    RobotAprilTagTracker,
    build_camera_info,
)
from dimos.ar.tracking.transforms import (
    Calibration,
    OdomSample,
    normalize_ground_pose,
    pose_to_matrix,
)
from dimos.msgs.geometry_msgs.Quaternion import Quaternion
from dimos.msgs.geometry_msgs.Transform import Transform
from dimos.msgs.geometry_msgs.Vector3 import Vector3
from dimos.utils.logging_config import setup_logger

if TYPE_CHECKING:
    from collections.abc import Callable

    from websockets.asyncio.server import ServerConnection

    from dimos.ar.adapters.base import ARRobotAdapterSpec, RuntimeAlignmentProfile
    from dimos.ar.bridge.odom_buffer import OdomBuffer
    from dimos.ar.bridge.sender import BridgeSender
    from dimos.ar.bridge.status_service import StatusService

_TRACE = os.getenv("DIMOS_AR_TRACE", "") not in ("", "0", "false")

logger = setup_logger()

ALIGN_STATUS_BROADCAST_INTERVAL_S: float = 0.3


@dataclass(frozen=True)
class AlignmentCandidate:
    T_world_odom: Any
    quality: float
    method: str
    approximate: bool


@dataclass
class AlignSession:
    method: Literal["tag", "manual"] | None = None
    pending_candidate: AlignmentCandidate | None = None
    pending_candidate_ts: float | None = None
    manual_pose_first_logged: bool = False
    last_manual_inactive_log_mono: float = 0.0
    last_manual_odom_missing_log_mono: float = 0.0
    last_manual_candidate_log_mono: float = 0.0


class FrameAdmission(StrEnum):
    ACK_ONLY = "ack_only"
    PROCESS = "process"


class CalibrationSessionController:
    """Owns calibration session state and camera-frame processing during setup."""

    def __init__(
        self,
        *,
        robot_id: str,
        sender: BridgeSender,
        calibration: Calibration,
        odom: OdomBuffer,
        status: StatusService,
        tag_tracker: RobotAprilTagTracker,
        frame_max_age_s: float,
        manual_alignment_quality: float,
        tf_publish_static: Callable[[Transform], None],
        pose_refiner: RegisteredPoseRefiner,
        adapter: ARRobotAdapterSpec | None = None,
        runtime_profile: RuntimeAlignmentProfile | None = None,
    ) -> None:
        self._robot_id = robot_id
        self._sender = sender
        self._calibration = calibration
        self._odom = odom
        self._status = status
        self._pose_refiner = pose_refiner
        self._tag_tracker = tag_tracker
        self._frame_max_age_s = frame_max_age_s
        self._manual_alignment_quality = manual_alignment_quality
        self._tf_publish_static = tf_publish_static
        self._tf_publish_static_unsupported: bool = False

        self._frame_in_flight: bool = False
        self._session = AlignSession()

        if runtime_profile is not None:
            self._runtime_profile = runtime_profile
        elif adapter is not None:
            self._runtime_profile = adapter.runtime_alignment_profile()
        else:
            from dimos.ar.adapters.base import RuntimeAlignmentProfile

            self._runtime_profile = RuntimeAlignmentProfile()

        self._broadcast_stop = threading.Event()
        self._broadcast_thread: threading.Thread | None = None

        self._assist_driver: AssistDriver | None = (
            AssistDriver(
                adapter=adapter,
                on_stage_change=self._on_assist_stage_change,
            )
            if adapter is not None
            else None
        )

    def _on_assist_stage_change(self, stage: str, message: str) -> None:
        threading.Thread(
            target=self._broadcast_align_status,
            kwargs={"message": message},
            daemon=True,
        ).start()

    def stop(self) -> None:
        self._tag_tracker.active = False
        self._stop_broadcast()

    def on_align_start(self, msg: AlignStartMessage, _websocket: ServerConnection) -> None:
        if self._assist_driver is not None:
            self._assist_driver.on_new_session()
        self._clear_session()
        self._session.method = msg.method  # type: ignore[assignment]

        if msg.method == "tag":
            if self._assist_driver is None or not msg.assist:
                logger.warning(
                    "align_start tag without assist driver — failing immediately",
                    assist=msg.assist,
                    has_driver=self._assist_driver is not None,
                )
                self._session.method = None
                self._broadcast_align_status(
                    state="failed",
                    method="tag",
                    message="Assisted calibration unavailable on this robot — place the robot pose manually",
                    ts=msg.ts,
                )
                return
            self._tag_tracker.active = True
            self._assist_driver.start()
        else:
            self._tag_tracker.active = False

        self._session.manual_pose_first_logged = False
        self._session.last_manual_inactive_log_mono = 0.0
        self._session.last_manual_odom_missing_log_mono = 0.0
        self._session.last_manual_candidate_log_mono = 0.0
        logger.info("XR alignment started", method=self._session.method)
        initial_message = (
            "Look at the AprilTag on your robot"
            if msg.method == "tag"
            else "Place the robot marker, then commit"
        )
        self._broadcast_align_status(state="detecting", message=initial_message, ts=msg.ts)
        self._start_broadcast()

    def on_assist_confirm(self, msg: AssistConfirmMessage, _websocket: ServerConnection) -> None:
        if self._assist_driver is not None:
            self._assist_driver.on_assist_confirm()

    def on_align_stop(self, msg: AlignStopMessage, _websocket: ServerConnection) -> None:
        if self._assist_driver is not None:
            self._assist_driver.on_align_stop()
        session_method = self._session.method
        was_active = self._session.method is not None or self._session.pending_candidate is not None
        self._tag_tracker.active = False
        self._stop_broadcast()
        self._clear_session()
        if not was_active:
            return
        logger.info("XR alignment stopped")
        self._broadcast_align_status(
            state="detecting",
            method=session_method or "tag",
            message="Alignment cancelled",
            ts=msg.ts,
        )

    def on_emergency_stop(self) -> None:
        if self._assist_driver is not None:
            self._assist_driver.on_emergency_stop()

    def on_align_commit(self, msg: AlignCommitMessage, _websocket: ServerConnection) -> None:
        cand = self._session.pending_candidate
        if cand is None:
            self._broadcast_align_status(
                state="failed",
                method=self._session.method or "manual",
                message="No valid alignment candidate yet",
                ts=msg.ts,
            )
            return
        finish_ts = (
            self._session.pending_candidate_ts
            if self._session.pending_candidate_ts is not None
            else msg.ts
        )
        self._finish_alignment(cand, finish_ts)

    def on_camera_info(self, msg: CameraInfoMessage, _websocket: ServerConnection) -> None:
        k = (
            msg.fx,
            0.0,
            msg.cx,
            0.0,
            msg.fy,
            msg.cy,
            0.0,
            0.0,
            1.0,
        )
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
        jpeg_bytes = len(jpeg)
        if _TRACE:
            logger.debug(
                "XR camera frame received",
                seq=seq,
                jpeg_bytes=jpeg_bytes,
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
            registered = self._calibration.is_registered
            T_committed = self._pose_refiner.committed_or_current_for_frame()
            if self._odom.latest() is None:
                self._broadcast_align_status(
                    state="detecting",
                    message="Waiting for robot odometry",
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

    def on_align_manual_pose(
        self, msg: AlignManualPoseMessage, _websocket: ServerConnection
    ) -> None:
        if self._session.method != "manual":
            now = time.monotonic()
            if (
                now - self._session.last_manual_inactive_log_mono
                >= DROPPED_POSE_LOG_INTERVAL_S
            ):
                self._session.last_manual_inactive_log_mono = now
                logger.warning(
                    "align_manual_pose dropped: no manual session open"
                    " (send align_start{method:'manual'} first)"
                )
            return
        if not self._session.manual_pose_first_logged:
            self._session.manual_pose_first_logged = True
            logger.info(
                "Manual alignment pose received",
                position=[round(v, 3) for v in msg.position],
            )
        odom = self._odom.latest()
        if odom is None:
            now = time.monotonic()
            if (
                now - self._session.last_manual_odom_missing_log_mono
                >= DROPPED_POSE_LOG_INTERVAL_S
            ):
                self._session.last_manual_odom_missing_log_mono = now
                logger.warning("Manual alignment waiting on robot odometry")
            self._broadcast_align_status(
                state="detecting",
                message="Waiting for robot odometry",
                ts=msg.ts,
            )
            return
        self._process_manual_candidate(msg, odom)

    def clear_on_disconnect(self) -> None:
        if self._session.method is None and self._session.pending_candidate is None:
            return
        self._tag_tracker.active = False
        self._stop_broadcast()
        self._clear_session()
        logger.info("Alignment session cleared on XR client disconnect")

    def resolve_frame_odom(self, header: dict[str, Any]) -> OdomSample | None:
        raw_capture_ts = header.get("capture_ts_robot")
        if raw_capture_ts is None:
            logger.debug(
                "pairing skip: missing capture_ts_robot",
                seq=int(header.get("seq", -1)),
            )
            return None
        if not isinstance(raw_capture_ts, (int, float)) or not math.isfinite(float(raw_capture_ts)):
            logger.debug(
                "pairing skip: invalid capture_ts_robot",
                seq=int(header.get("seq", -1)),
            )
            return None
        capture_ts = float(raw_capture_ts)
        registered = self._calibration.is_registered
        lookup = (
            self._odom.at_interpolated_by_source
            if registered
            else self._odom.at_or_latest_by_source
        )
        odom = lookup(capture_ts)
        if odom is None:
            logger.debug(
                "pairing skip: no odom at capture_ts_robot",
                seq=int(header.get("seq", -1)),
                capture_ts_robot=round(capture_ts, 6),
            )
        return odom

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
        if self._session.method == "manual":
            return FrameAdmission.ACK_ONLY
        if not self._tag_tracker.has_camera_info():
            logger.warning("XR camera frame dropped: no camera intrinsics yet", seq=seq)
            if self._tag_tracker.active:
                self._broadcast_align_status(
                    state="failed",
                    message="No camera intrinsics received",
                )
            return FrameAdmission.ACK_ONLY
        if self._assist_driver is not None:
            from dimos.ar.bridge.assist import AssistState

            if (
                self._assist_driver.state == AssistState.MOVE
                and not self._assist_driver.is_sampling
            ):
                return FrameAdmission.ACK_ONLY
        return FrameAdmission.PROCESS

    def _send_frame_ack(self, header: dict[str, Any]) -> None:
        self._sender.send(
            encode_camera_frame_ack(
                robot_id=self._robot_id,
                seq=int(header["seq"]),
            )
        )

    def _tag_detected(self) -> bool:
        return self._tag_tracker.last_tag_detected

    def _align_status_message(self) -> str:
        if self._session.method == "manual":
            if self._session.pending_candidate is not None:
                return "Manual robot pose ready — review and commit"
            return "Place the robot pose manually, then commit"
        if not self._tag_tracker.has_camera_info():
            return "Waiting for camera intrinsics..."
        if self._tag_detected():
            count = self._tag_tracker.observation_count()
            return f"Tag detected — collecting samples ({count})"
        return "Look at the AprilTag on your robot"

    def _start_broadcast(self) -> None:
        self._stop_broadcast()
        self._broadcast_stop.clear()

        def loop() -> None:
            while not self._broadcast_stop.wait(ALIGN_STATUS_BROADCAST_INTERVAL_S):
                if self._session.method is None:
                    break
                if self._assist_driver is not None:
                    self._assist_driver.tick(
                        obs_count=self._tag_tracker.observation_count(),
                        latest_obs_pos_world=None,
                        latest_odom=self._odom.latest(),
                    )
                    self._maybe_finish_assist()
                    if self._session.method is None or self._broadcast_stop.is_set():
                        break
                self._broadcast_align_status()

        self._broadcast_thread = threading.Thread(
            target=loop,
            name="ar-align-status",
            daemon=True,
        )
        self._broadcast_thread.start()

    def _maybe_finish_assist(self) -> None:
        if self._assist_driver is None:
            return
        from dimos.ar.bridge.assist import AssistState

        if self._assist_driver.state != AssistState.DONE:
            return
        solve = self._tag_tracker.current_solve(min_baseline_m=0.0)
        if solve is not None:
            logger.info("AssistDriver DONE — auto-committing alignment")
            candidate = AlignmentCandidate(
                T_world_odom=np.array(solve.T_world_odom, dtype=np.float64, copy=True),
                quality=solve.quality,
                method="tag",
                approximate=False,
            )
            self._finish_alignment(candidate, time.time())
        else:
            logger.warning("AssistDriver DONE but no solve produced — marking failed")
            self._tag_tracker.active = False
            self._stop_broadcast()
            self._clear_session()
            self._broadcast_align_status(
                state="failed",
                message="Assisted calibration produced no solve — retry",
            )

    def _stop_broadcast(self) -> None:
        self._broadcast_stop.set()
        thread = self._broadcast_thread
        if thread is not None and thread.is_alive() and thread is not threading.current_thread():
            thread.join(timeout=1.0)
        self._broadcast_thread = None

    def _clear_session(self) -> None:
        self._tag_tracker.reset_window()
        self._session = AlignSession()
        if self._assist_driver is not None:
            self._assist_driver.reset_to_idle()

    def _process_manual_candidate(
        self,
        msg: AlignManualPoseMessage,
        odom: OdomSample,
    ) -> AlignmentCandidate:
        norm_position, norm_orientation = normalize_ground_pose(msg.position, msg.orientation)
        T_world_base = pose_to_matrix(norm_position, norm_orientation)
        T_world_base[:3, :3] = T_world_base[:3, :3] @ R_ALIGN
        T_odom_base = pose_to_matrix(odom.position, odom.orientation)
        candidate = AlignmentCandidate(
            T_world_odom=np.array(
                T_world_base @ np.linalg.inv(T_odom_base),
                dtype=np.float64,
                copy=True,
            ),
            quality=self._manual_alignment_quality,
            method="manual",
            approximate=True,
        )
        self._session.pending_candidate = candidate
        self._session.pending_candidate_ts = msg.ts
        now = time.monotonic()
        if now - self._session.last_manual_candidate_log_mono >= DROPPED_POSE_LOG_INTERVAL_S:
            self._session.last_manual_candidate_log_mono = now
            logger.info(
                "Manual alignment candidate confirmed",
                quality=round(candidate.quality, 3),
                position=[round(v, 3) for v in norm_position],
            )
        self._broadcast_align_status(
            state="detecting",
            tag_visible=True,
            method="manual",
            message="Manual robot pose ready — review and commit",
            ts=msg.ts,
        )
        return candidate

    def _publish_world_odom_tf(self, T_world_odom: np.ndarray) -> None:
        if self._tf_publish_static_unsupported:
            return
        rot_mat = T_world_odom[:3, :3]
        tx = float(T_world_odom[0, 3])
        ty = float(T_world_odom[1, 3])
        tz = float(T_world_odom[2, 3])
        quat = Quaternion.from_rotation_matrix(rot_mat)
        tf = Transform(
            translation=Vector3(tx, ty, tz),
            rotation=quat,
            frame_id="world",
            child_frame_id="odom",
            ts=time.time(),
        )
        try:
            self._tf_publish_static(tf)
        except NotImplementedError:
            self._tf_publish_static_unsupported = True
            logger.debug(
                "TF publish_static not supported by current backend (PubSubTF) — "
                "skipping world→odom static TF broadcast"
            )
        except Exception as exc:
            logger.exception("TF publish_static failed", error=str(exc))

    def _finish_alignment(self, result: AlignmentCandidate, ts: float | None) -> None:
        self._tag_tracker.active = False
        self._stop_broadcast()
        self._calibration.register_from_alignment(result.T_world_odom)
        self._publish_world_odom_tf(result.T_world_odom)
        wire_method: Literal["tag", "manual"] = "manual" if result.method == "manual" else "tag"
        self._status.set_registered(
            True,
            method=wire_method,
            approximate=result.approximate,
        )
        logger.info(
            "Alignment succeeded",
            quality=round(result.quality, 3),
            method=wire_method,
            approximate=result.approximate,
        )
        self._clear_session()
        self._status.broadcast()
        self._broadcast_align_status(
            state="aligned",
            method=wire_method,
            message=(
                "Manual alignment committed"
                if result.method == "manual"
                else "Alignment successful"
            ),
            ts=ts,
        )
        self._pose_refiner.set_T_committed(result.T_world_odom)

    def _apply_tracker_update(
        self,
        *,
        ts: float | None = None,
        resolved_odom: OdomSample | None = None,
    ) -> None:
        if self._tag_tracker.active:
            if self._assist_driver is not None:
                frame_result_pos: tuple[float, float, float] | None = None
                if self._tag_tracker.last_tag_detected:
                    pose_estimate = self._tag_tracker.robot_world_pose_estimate()
                    if pose_estimate is not None:
                        frame_result_pos = pose_estimate[0]
                self._assist_driver.tick(
                    obs_count=self._tag_tracker.observation_count(),
                    latest_obs_pos_world=frame_result_pos,
                    latest_odom=self._odom.latest(),
                )
            self._broadcast_align_status()
            return
        self._pose_refiner.apply_tracker_update(
            ts=ts,
            resolved_odom=resolved_odom,
        )

    def _compute_progress(self, state: str) -> int:
        if state in ("aligned", "ready"):
            return 100
        if state == "failed":
            return 0
        if self._session.method == "manual":
            return 100 if self._session.pending_candidate is not None else 0
        if self._assist_driver is not None:
            from dimos.ar.bridge.assist import AssistState

            assist_state = self._assist_driver.state
            if assist_state != AssistState.IDLE:
                return self._assist_driver.progress_percent()
        return 0

    def _broadcast_align_status(
        self,
        *,
        state: str = "detecting",
        method: str | None = None,
        message: str = "",
        tag_visible: bool | None = None,
        progress: int | None = None,
        ts: float | None = None,
    ) -> None:
        effective_method = method or self._session.method or "tag"
        effective_state = state
        if (
            state == "detecting"
            and self._session.method == "manual"
            and self._session.pending_candidate is not None
        ):
            effective_state = "ready"
        if not message and state == "detecting":
            message = self._align_status_message()
        if progress is None:
            progress = self._compute_progress(effective_state)
        if tag_visible is None and effective_method == "tag":
            tag_visible = self._tag_detected()

        assist_stage: str | None = None
        robot_world_pose: dict[str, Any] | None = None
        sampling: bool | None = None
        step_index: int | None = None
        step_count: int | None = None
        if self._session.method == "tag" and self._assist_driver is not None:
            from dimos.ar.bridge.assist import AssistState

            if self._assist_driver.state not in (AssistState.IDLE, AssistState.DONE):
                assist_stage = self._assist_driver.stage_label
                sampling = self._assist_driver.is_sampling
                step_index = self._assist_driver.step_index
                step_count = self._assist_driver.step_count
            pose_result = self._tag_tracker.robot_world_pose_estimate(max_observations=2)
            if pose_result is not None:
                pos, ori, _conf = pose_result
                robot_world_pose = {
                    "position": list(pos),
                    "orientation": list(ori),
                }

        self._sender.send(
            encode_align_status(
                ts=ts,
                robot_id=self._robot_id,
                state=effective_state,
                method=effective_method,
                progress=progress,
                message=message,
                tag_visible=tag_visible,
                assist_stage=assist_stage,
                sampling=sampling,
                robot_world_pose=robot_world_pose,
                step_index=step_index,
                step_count=step_count,
            )
        )
