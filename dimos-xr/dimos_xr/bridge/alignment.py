"""AlignmentController — AprilTag and manual alignment, camera-frame processing,
runtime drift correction, and align_status broadcasting.

Owns the TagTracker, all alignment session state, the align-status broadcast
thread, and the async camera-frame pipeline.
"""

from __future__ import annotations

import asyncio
import math
import threading
import time
from typing import TYPE_CHECKING, Any, Literal

from dimos.msgs.geometry_msgs.Quaternion import Quaternion
from dimos.msgs.geometry_msgs.Transform import Transform
from dimos.msgs.geometry_msgs.Vector3 import Vector3
from dimos.utils.logging_config import setup_logger
from dimos.utils.transform_utils import normalize_angle
import numpy as np

from dimos_xr.network.data_plane import DROPPED_POSE_LOG_INTERVAL_S
from dimos_xr.network.protocol import (
    AlignCommitMessage,
    AlignManualPoseMessage,
    AlignStartMessage,
    AlignStopMessage,
    CameraInfoMessage,
    encode_align_status,
    encode_camera_frame_ack,
)
from dimos_xr.tracking.tag_tracker import (
    ALIGNMENT_CLUSTER_MIN_SAMPLES,
    ALIGNMENT_CLUSTER_WINDOW,
    AlignmentCandidate,
    TagTracker,
    TagTrackerConfig,
    _yaw_from_T,
    average_cluster_transform,
    build_camera_info,
    build_T_world_odom,
    collect_alignment_cluster,
    score_alignment_cluster,
)
from dimos_xr.tracking.transforms import (
    Calibration,
    OdomSample,
    gravity_level_transform,
    normalize_ground_pose,
    pose_to_matrix,
)

if TYPE_CHECKING:
    from collections.abc import Callable

    from websockets.asyncio.server import ServerConnection

    from dimos_xr.bridge.odom_buffer import OdomBuffer
    from dimos_xr.bridge.sender import BridgeSender
    from dimos_xr.bridge.status_service import StatusService

logger = setup_logger()

ALIGN_STATUS_BROADCAST_INTERVAL_S: float = 0.3


class AlignmentController:
    """Owns all AprilTag / manual alignment state and camera-frame processing."""

    def __init__(
        self,
        *,
        robot_id: str,
        sender: BridgeSender,
        calibration: Calibration,
        odom: OdomBuffer,
        status: StatusService,
        tag_mounts: Any,
        tracker_config: TagTrackerConfig,
        frame_max_age_s: float,
        manual_alignment_quality: float,
        runtime_correction_enabled: bool,
        tag_smoothing_tau_s: float,
        tf_publish_static: Callable[[Transform], None],
    ) -> None:
        self._robot_id = robot_id
        self._sender = sender
        self._calibration = calibration
        self._odom = odom
        self._status = status
        self._tag_tracker = TagTracker(tag_mounts, config=tracker_config)
        self._frame_max_age_s = frame_max_age_s
        self._manual_alignment_quality = manual_alignment_quality
        self._runtime_correction_enabled = runtime_correction_enabled
        self._tag_smoothing_tau_s = tag_smoothing_tau_s
        self._tf_publish_static = tf_publish_static

        self._frame_in_flight: bool = False
        self._last_smooth_mono: float | None = None
        self._T_committed: np.ndarray | None = None
        self._pending_large_solves: list[np.ndarray] = []
        self._best_alignment: AlignmentCandidate | None = None
        self._best_alignment_ts: float | None = None
        self._latest_alignment_quality: float | None = None
        self._candidate_count: int = 0
        self._alignment_mode: str = "marker"
        self._recent_marker_candidates: list[AlignmentCandidate] = []
        self._last_debug_tag_detected: bool | None = None
        self._align_start_mono: float | None = None

        self._manual_pose_first_logged: bool = False
        self._last_manual_inactive_log_mono: float = 0.0
        self._last_manual_odom_missing_log_mono: float = 0.0
        self._last_manual_candidate_log_mono: float = 0.0

        self._broadcast_stop = threading.Event()
        self._broadcast_thread: threading.Thread | None = None

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def stop(self) -> None:
        self._tag_tracker.active = False
        self._stop_broadcast()

    # ------------------------------------------------------------------
    # WebSocket message handlers
    # ------------------------------------------------------------------

    def on_align_start(self, msg: AlignStartMessage, _websocket: ServerConnection) -> None:
        self._tag_tracker.active = True
        self._clear_session()
        self._last_debug_tag_detected = None
        self._align_start_mono = time.monotonic()
        self._alignment_mode = "marker"
        self._manual_pose_first_logged = False
        self._last_manual_inactive_log_mono = 0.0
        self._last_manual_odom_missing_log_mono = 0.0
        self._last_manual_candidate_log_mono = 0.0
        logger.info("XR alignment started", mode=self._alignment_mode)
        self._broadcast_align_status(
            state="detecting",
            tag_detected=False,
            has_candidate=False,
            message="Look at the AprilTag on your robot",
            ts=msg.ts,
        )
        self._start_broadcast()

    def on_align_stop(self, msg: AlignStopMessage, _websocket: ServerConnection) -> None:
        alignment_mode = self._alignment_mode
        was_active = (
            self._tag_tracker.active
            or self._best_alignment is not None
            or self._candidate_count > 0
        )
        self._tag_tracker.active = False
        self._stop_broadcast()
        self._clear_session()
        if not was_active:
            return
        logger.info("XR alignment stopped")
        self._broadcast_align_status(
            state="detecting",
            tag_detected=False,
            has_candidate=False,
            method=alignment_mode,
            message="Alignment cancelled",
            ts=msg.ts,
        )

    def on_align_commit(self, msg: AlignCommitMessage, _websocket: ServerConnection) -> None:
        best = self._best_alignment
        if best is None:
            self._broadcast_align_status(
                state="failed",
                tag_detected=self._tag_detected(),
                quality=self._latest_alignment_quality,
                best_quality=None,
                has_candidate=False,
                method=self._alignment_mode,
                message="No valid alignment candidate yet",
                ts=msg.ts,
            )
            return
        finish_ts = self._best_alignment_ts if self._best_alignment_ts is not None else msg.ts
        commit_candidate = best
        if best.method == "marker":
            cluster = collect_alignment_cluster(best, self._recent_marker_candidates)
            if len(cluster) >= ALIGNMENT_CLUSTER_MIN_SAMPLES:
                T_avg, yaw_spread, trans_spread = average_cluster_transform(cluster)
                commit_candidate = AlignmentCandidate(
                    T_world_odom=T_avg,
                    quality=best.quality,
                    method=best.method,
                    approximate=best.approximate,
                    reprojection_error_px=best.reprojection_error_px,
                    sample_quality=best.sample_quality,
                    cluster_size=len(cluster),
                )
                logger.info(
                    "AprilTag alignment commit averaged cluster",
                    cluster_size=len(cluster),
                    yaw_spread_deg=round(math.degrees(yaw_spread), 2),
                    trans_spread_m=round(trans_spread, 4),
                    committed_yaw_deg=round(
                        math.degrees(_yaw_from_T(T_avg)),
                        2,
                    ),
                )
        self._finish_alignment(commit_candidate, finish_ts)

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
        logger.info(
            "XR camera frame received",
            seq=seq,
            jpeg_bytes=jpeg_bytes,
            frame_age_s=round(frame_age, 3),
        )
        # Always ack, even for dropped frames — the Lens uses the ack to clear
        # its single-flight state; a silent drop forces it into the in-flight
        # timeout path and can pile up capture pipelines (memory pressure).
        if self._frame_in_flight:
            logger.warning("XR camera frame dropped: previous frame still in flight", seq=seq)
            self._send_frame_drop_ack(header)
            return
        if frame_age > self._frame_max_age_s:
            logger.warning(
                "XR camera frame dropped: too old",
                seq=seq,
                frame_age_s=round(frame_age, 3),
                max_age_s=self._frame_max_age_s,
            )
            self._send_frame_drop_ack(header)
            return
        if not self._tag_tracker.has_camera_info():
            logger.warning("XR camera frame dropped: no camera intrinsics yet", seq=seq)
            self._sender.send(
                encode_camera_frame_ack(
                    robot_id=self._robot_id,
                    seq=seq,
                    tag_detected=False,
                )
            )
            if self._tag_tracker.active:
                self._broadcast_align_status(
                    state="failed",
                    tag_detected=False,
                    message="No camera intrinsics received",
                )
            return
        self._frame_in_flight = True
        try:
            receive_mono = time.monotonic()
            registered = self._calibration.is_registered
            T_committed = self._T_committed
            if registered and T_committed is None:
                T_committed = self._calibration.current_transform()
            result = await asyncio.to_thread(
                self._tag_tracker.process_frame,
                header,
                jpeg,
                self._odom.at,
                receive_mono=receive_mono,
                T_committed=T_committed,
                registered=registered,
            )
            logger.info(
                "XR camera frame processed",
                seq=seq,
                tag_detected=result.tag_detected,
                tag_ids=result.tag_ids if result.tag_ids else None,
                quality=round(result.quality, 3) if result.quality else None,
            )
            self._sender.send(
                encode_camera_frame_ack(
                    robot_id=self._robot_id,
                    seq=seq,
                    tag_detected=result.tag_detected,
                    tag_ids=result.tag_ids if result.tag_ids else None,
                    quality=result.quality,
                )
            )
            self._apply_tracker_update(ts=float(header.get("ts", time.time())))
        finally:
            self._frame_in_flight = False

    def on_align_manual_pose(
        self, msg: AlignManualPoseMessage, _websocket: ServerConnection
    ) -> None:
        if not self._tag_tracker.active:
            now = time.monotonic()
            if now - self._last_manual_inactive_log_mono >= DROPPED_POSE_LOG_INTERVAL_S:
                self._last_manual_inactive_log_mono = now
                logger.warning(
                    "align_manual_pose dropped: alignment session inactive (send align_start first)"
                )
            return
        if not self._manual_pose_first_logged:
            self._manual_pose_first_logged = True
            logger.info(
                "Manual alignment pose received",
                position=[round(v, 3) for v in msg.position],
            )
        odom = self._odom.latest()
        if odom is None:
            self._alignment_mode = "manual"
            now = time.monotonic()
            if now - self._last_manual_odom_missing_log_mono >= DROPPED_POSE_LOG_INTERVAL_S:
                self._last_manual_odom_missing_log_mono = now
                logger.warning("Manual alignment waiting on robot odometry")
            self._broadcast_align_status(
                state="detecting",
                tag_detected=False,
                quality=self._latest_alignment_quality,
                has_candidate=False,
                method="manual",
                message="Waiting for robot odometry",
                ts=msg.ts,
            )
            return
        self._process_manual_candidate(msg, odom)

    # ------------------------------------------------------------------
    # Disconnect reset
    # ------------------------------------------------------------------

    def clear_on_disconnect(self) -> None:
        if (
            not self._tag_tracker.active
            and self._best_alignment is None
            and self._candidate_count == 0
        ):
            return
        self._tag_tracker.active = False
        self._stop_broadcast()
        self._clear_session()
        logger.info("Alignment session cleared on XR client disconnect")

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _tag_detected(self) -> bool:
        return self._tag_tracker.last_tag_detected

    def _align_status_message(self) -> str:
        if self._alignment_mode == "manual":
            if self._best_alignment is not None:
                return "Manual robot pose ready — review and commit"
            return "Place the robot pose manually, then commit"
        if not self._tag_tracker.has_camera_info():
            return "Waiting for camera intrinsics..."
        if self._best_alignment is not None:
            best = round(self._best_alignment.quality * 100)
            return f"Tag tracked — best alignment {best}% ready"
        if self._tag_detected():
            count = self._tag_tracker.observation_count()
            return f"Tag detected — collecting samples ({count})"
        return "Look at the AprilTag on your robot"

    def _start_broadcast(self) -> None:
        self._stop_broadcast()
        self._broadcast_stop.clear()

        def loop() -> None:
            while not self._broadcast_stop.wait(ALIGN_STATUS_BROADCAST_INTERVAL_S):
                if not self._tag_tracker.active:
                    break
                self._broadcast_align_status()

        self._broadcast_thread = threading.Thread(
            target=loop,
            name="xr-align-status",
            daemon=True,
        )
        self._broadcast_thread.start()

    def _stop_broadcast(self) -> None:
        self._broadcast_stop.set()
        thread = self._broadcast_thread
        if thread is not None and thread.is_alive() and thread is not threading.current_thread():
            thread.join(timeout=1.0)
        self._broadcast_thread = None

    def _clear_session(self) -> None:
        self._tag_tracker.reset_window()
        self._best_alignment = None
        self._best_alignment_ts = None
        self._latest_alignment_quality = None
        self._candidate_count = 0
        self._alignment_mode = "marker"
        self._recent_marker_candidates = []
        self._pending_large_solves = []
        self._manual_pose_first_logged = False
        self._last_manual_inactive_log_mono = 0.0
        self._last_manual_odom_missing_log_mono = 0.0
        self._last_manual_candidate_log_mono = 0.0

    def _process_tag_solve(self, *, ts: float | None = None) -> AlignmentCandidate | None:
        solve = self._tag_tracker.current_solve()
        if solve is None:
            return None
        method = "marker" if solve.method == "tag" else solve.method
        candidate = AlignmentCandidate(
            T_world_odom=np.array(solve.T_world_odom, dtype=np.float64, copy=True),
            quality=solve.quality,
            method=method,
            approximate=False,
            sample_quality=solve.quality,
            cluster_size=solve.observation_count,
        )
        self._recent_marker_candidates.append(candidate)
        if len(self._recent_marker_candidates) > ALIGNMENT_CLUSTER_WINDOW:
            self._recent_marker_candidates = self._recent_marker_candidates[
                -ALIGNMENT_CLUSTER_WINDOW:
            ]
        stable_quality, cluster_size, mean_translation_error, mean_yaw_error = (
            score_alignment_cluster(candidate, self._recent_marker_candidates)
        )
        candidate = AlignmentCandidate(
            T_world_odom=candidate.T_world_odom,
            quality=stable_quality,
            method=candidate.method,
            approximate=candidate.approximate,
            sample_quality=candidate.sample_quality,
            cluster_size=cluster_size,
        )
        self._latest_alignment_quality = candidate.quality
        self._candidate_count += 1
        improved = False
        is_stable_candidate = cluster_size >= ALIGNMENT_CLUSTER_MIN_SAMPLES
        if is_stable_candidate and (
            self._best_alignment is None or candidate.quality > self._best_alignment.quality
        ):
            self._best_alignment = candidate
            self._best_alignment_ts = ts if ts is not None else time.time()
            improved = True
            logger.info(
                "Tag alignment improved",
                quality=round(candidate.quality, 3),
                method=solve.method,
                baseline_m=round(solve.baseline_m, 3),
                cluster_size=cluster_size,
                mean_translation_error_m=round(mean_translation_error, 4),
                mean_yaw_error_deg=round(math.degrees(mean_yaw_error), 2),
                samples=self._candidate_count,
            )
        self._broadcast_align_status(
            state="detecting",
            tag_detected=self._tag_detected(),
            observation_count=solve.observation_count,
            baseline_m=solve.baseline_m,
            quality=candidate.quality,
            best_quality=self._best_alignment.quality if self._best_alignment is not None else None,
            has_candidate=self._best_alignment is not None,
            method=method,
            message=(
                "Alignment improved — hold steady for best result"
                if improved
                else (
                    f"Tracking tag — hold steady ({cluster_size}/{ALIGNMENT_CLUSTER_MIN_SAMPLES})"
                    if not is_stable_candidate
                    else "Tracking tag — refining best alignment"
                )
            ),
            ts=ts,
            cluster_size=cluster_size,
            required_samples=ALIGNMENT_CLUSTER_MIN_SAMPLES,
        )
        return candidate

    def _process_manual_candidate(
        self,
        msg: AlignManualPoseMessage,
        odom: OdomSample,
    ) -> AlignmentCandidate:
        norm_position, norm_orientation = normalize_ground_pose(msg.position, msg.orientation)
        T_world_base = pose_to_matrix(norm_position, norm_orientation)
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
            sample_quality=self._manual_alignment_quality,
        )
        self._alignment_mode = "manual"
        self._latest_alignment_quality = candidate.quality
        self._candidate_count += 1
        self._best_alignment = candidate
        self._best_alignment_ts = msg.ts
        now = time.monotonic()
        if now - self._last_manual_candidate_log_mono >= DROPPED_POSE_LOG_INTERVAL_S:
            self._last_manual_candidate_log_mono = now
            logger.info(
                "Manual alignment candidate confirmed",
                quality=round(candidate.quality, 3),
                position=[round(v, 3) for v in norm_position],
                samples=self._candidate_count,
            )
        self._broadcast_align_status(
            state="detecting",
            tag_detected=True,
            quality=candidate.quality,
            best_quality=candidate.quality,
            has_candidate=True,
            method="manual",
            message="Manual robot pose ready — review and commit",
            ts=msg.ts,
        )
        return candidate

    def _publish_world_odom_tf(self, T_world_odom: np.ndarray) -> None:
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
        except Exception as exc:
            logger.exception("TF publish_static failed", error=str(exc))

    def _finish_alignment(self, result: AlignmentCandidate, ts: float | None) -> None:
        self._tag_tracker.active = False
        self._stop_broadcast()
        self._calibration.register_from_alignment(result.T_world_odom)
        self._publish_world_odom_tf(result.T_world_odom)
        method: Literal["manual", "marker"] = "manual" if result.method == "manual" else "marker"
        self._status.set_registered(
            True,
            method=method,
            approximate=result.approximate,
        )
        logger.info(
            "Alignment succeeded",
            quality=round(result.quality, 3),
            samples=self._candidate_count,
            method=method,
            approximate=result.approximate,
        )
        self._clear_session()
        self._status.broadcast()
        self._broadcast_align_status(
            state="aligned",
            tag_detected=True,
            quality=result.quality,
            best_quality=result.quality,
            has_candidate=True,
            method=method,
            message=(
                "Manual alignment committed"
                if result.method == "manual"
                else "Alignment successful"
            ),
            ts=ts,
        )
        self._T_committed = np.array(result.T_world_odom, dtype=np.float64, copy=True)

    def _apply_tracker_update(self, *, ts: float | None = None) -> None:
        if self._tag_tracker.active:
            self._process_tag_solve(ts=ts)
            return
        if not self._calibration.is_registered or not self._runtime_correction_enabled:
            return
        solve = self._tag_tracker.current_solve()
        if solve is None:
            return
        T_new = np.array(solve.T_world_odom, dtype=np.float64, copy=True)
        now = time.monotonic()
        if self._T_committed is None:
            self._T_committed = T_new
            self._calibration.register_from_alignment(T_new)
            self._last_smooth_mono = now
            return
        trans_delta = float(np.linalg.norm(T_new[:3, 3] - self._T_committed[:3, 3]))
        yaw_delta = abs(normalize_angle(_yaw_from_T(T_new) - _yaw_from_T(self._T_committed)))
        if trans_delta > 0.5 or yaw_delta > math.radians(10.0):
            self._pending_large_solves.append(T_new)
            if len(self._pending_large_solves) > 3:
                self._pending_large_solves = self._pending_large_solves[-3:]
            if len(self._pending_large_solves) < 3:
                return
            solves = self._pending_large_solves
            spreads = [
                float(np.linalg.norm(solves[i][:3, 3] - solves[j][:3, 3]))
                for i in range(len(solves))
                for j in range(i + 1, len(solves))
            ]
            if max(spreads) > 0.2:
                return
            T_new = self._pending_large_solves[-1]
            self._pending_large_solves = []
        else:
            dt = now - (self._last_smooth_mono or now)
            alpha = 1.0 - math.exp(-dt / self._tag_smoothing_tau_s)
            yaw_new = _yaw_from_T(T_new)
            yaw_old = _yaw_from_T(self._T_committed)
            yaw_blend = normalize_angle(yaw_old + alpha * normalize_angle(yaw_new - yaw_old))
            t_old = self._T_committed[:3, 3]
            t_new = T_new[:3, 3]
            t_blend = t_old + alpha * (t_new - t_old)
            T_new = build_T_world_odom(
                yaw_blend, (float(t_blend[0]), float(t_blend[1]), float(t_blend[2]))
            )
            T_new = gravity_level_transform(T_new)
        self._T_committed = T_new
        self._last_smooth_mono = now
        self._calibration.register_from_alignment(T_new)

    def _broadcast_align_status(
        self,
        *,
        state: str = "detecting",
        tag_detected: bool | None = None,
        observation_count: int | None = None,
        baseline_m: float | None = None,
        quality: float | None = None,
        best_quality: float | None = None,
        has_candidate: bool | None = None,
        method: str | None = None,
        message: str = "",
        ts: float | None = None,
        cluster_size: int | None = None,
        required_samples: int | None = None,
    ) -> None:
        if tag_detected is None:
            tag_detected = self._tag_detected()
        if observation_count is None:
            observation_count = self._tag_tracker.observation_count()
        if best_quality is None and self._best_alignment is not None:
            best_quality = self._best_alignment.quality
        if has_candidate is None:
            has_candidate = self._best_alignment is not None
        if method is None and self._best_alignment is not None:
            method = self._best_alignment.method
        if method is None and self._alignment_mode == "manual":
            method = "manual"
        if not message and state == "detecting":
            message = self._align_status_message()
        if state == "detecting" and tag_detected != self._last_debug_tag_detected:
            self._last_debug_tag_detected = tag_detected
        self._sender.send(
            encode_align_status(
                ts=ts,
                robot_id=self._robot_id,
                state=state,
                tag_detected=tag_detected,
                observation_count=observation_count,
                baseline_m=baseline_m,
                quality=quality,
                best_quality=best_quality,
                has_candidate=has_candidate,
                method=method,
                message=message,
                cluster_size=cluster_size,
                required_samples=required_samples,
            )
        )

    def _send_frame_drop_ack(self, header: dict[str, Any]) -> None:
        self._sender.send(
            encode_camera_frame_ack(
                robot_id=self._robot_id,
                seq=int(header["seq"]),
                tag_detected=False,
            )
        )
