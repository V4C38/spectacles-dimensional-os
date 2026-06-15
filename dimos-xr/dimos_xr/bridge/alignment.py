"""AlignmentController — AprilTag and manual alignment, camera-frame processing,
runtime drift correction, and align_status broadcasting.

Two calibration flows are supported:
- **assisted tag**: align_start{method:"tag", assist:true} — the robot drives itself
  through a 3-leg move while the user looks at the robot-mounted AprilTag (glasses
  camera only).  The bridge auto-commits at DONE via a fresh current_solve().
- **manual pose**: align_start{method:"manual"} + align_manual_pose — the user
  hand-places a pose, then align_commit commits it.

Owns the TagTracker, all alignment session state, the align-status broadcast
thread, and the async camera-frame pipeline.
"""

from __future__ import annotations

import asyncio
import math
import os
import threading
import time
from typing import TYPE_CHECKING, Any, Literal

from dimos.msgs.geometry_msgs.Quaternion import Quaternion
from dimos.msgs.geometry_msgs.Transform import Transform
from dimos.msgs.geometry_msgs.Vector3 import Vector3
from dimos.utils.logging_config import setup_logger
from dimos.utils.transform_utils import normalize_angle
import numpy as np

from dimos_xr.bridge.assist import AssistDriver
from dimos_xr.network.data_plane import DROPPED_POSE_LOG_INTERVAL_S
from dimos_xr.network.protocol import (
    AlignCommitMessage,
    AlignManualPoseMessage,
    AlignStartMessage,
    AlignStopMessage,
    AssistConfirmMessage,
    CameraInfoMessage,
    encode_align_status,
    encode_camera_frame_ack,
)
from dimos_xr.tracking.tag_tracker import (
    AlignmentCandidate,
    R_ALIGN,
    TagTracker,
    TagTrackerConfig,
    _yaw_from_T,
    build_camera_info,
    build_T_world_odom,
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

    from dimos_xr.adapters.base import XRRobotAdapterSpec
    from dimos_xr.bridge.odom_buffer import OdomBuffer
    from dimos_xr.bridge.sender import BridgeSender
    from dimos_xr.bridge.status_service import StatusService

_TRACE = os.getenv("DIMOS_XR_TRACE", "") not in ("", "0", "false")

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
        adapter: XRRobotAdapterSpec | None = None,
        world_anchor_tag_ids: list[int] | None = None,
        world_anchor_size_m: float = 0.056,
    ) -> None:
        self._robot_id = robot_id
        self._sender = sender
        self._calibration = calibration
        self._odom = odom
        self._status = status
        self._tag_tracker = TagTracker(
            tag_mounts,
            config=tracker_config,
            world_anchor_tag_ids=world_anchor_tag_ids,
            world_anchor_size_m=world_anchor_size_m,
        )
        self._frame_max_age_s = frame_max_age_s
        self._manual_alignment_quality = manual_alignment_quality
        self._runtime_correction_enabled = runtime_correction_enabled
        self._tag_smoothing_tau_s = tag_smoothing_tau_s
        self._tf_publish_static = tf_publish_static
        self._tf_publish_static_unsupported: bool = False  # set once on first NotImplementedError

        self._frame_in_flight: bool = False
        self._last_smooth_mono: float | None = None
        self._T_committed: np.ndarray | None = None
        self._pending_large_solves: list[np.ndarray] = []
        # _pending_candidate: manual pose awaiting commit (tag flow auto-commits at DONE)
        self._pending_candidate: AlignmentCandidate | None = None
        self._pending_candidate_ts: float | None = None
        self._session_method: Literal["tag", "manual"] | None = None  # None = no session
        self._world_anchor_refs: dict[int, np.ndarray] = {}

        self._manual_pose_first_logged: bool = False
        self._last_manual_inactive_log_mono: float = 0.0
        self._last_manual_odom_missing_log_mono: float = 0.0
        self._last_manual_candidate_log_mono: float = 0.0

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

    # ------------------------------------------------------------------
    # Assist stage change callback (called from AssistDriver under its lock)
    # ------------------------------------------------------------------

    def _on_assist_stage_change(self, stage: str, message: str) -> None:
        """Broadcast an immediate align_status when the assist stage transitions."""
        # Called from within AssistDriver._lock — must not re-enter the driver.
        import threading as _threading
        _threading.Thread(
            target=self._broadcast_align_status,
            kwargs={"message": message},
            daemon=True,
        ).start()

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
        if self._assist_driver is not None:
            self._assist_driver.on_new_session()
        self._clear_session()
        self._session_method = msg.method  # type: ignore[assignment]

        if msg.method == "tag":
            if self._assist_driver is None or not msg.assist:
                # Assisted calibration not available on this robot — use manual pose instead.
                logger.warning(
                    "align_start tag without assist driver — failing immediately",
                    assist=msg.assist,
                    has_driver=self._assist_driver is not None,
                )
                self._session_method = None
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

        self._manual_pose_first_logged = False
        self._last_manual_inactive_log_mono = 0.0
        self._last_manual_odom_missing_log_mono = 0.0
        self._last_manual_candidate_log_mono = 0.0
        logger.info("XR alignment started", method=self._session_method)
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
        session_method = self._session_method
        was_active = self._session_method is not None or self._pending_candidate is not None
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
        cand = self._pending_candidate
        if cand is None:
            self._broadcast_align_status(
                state="failed",
                method=self._session_method or "manual",
                message="No valid alignment candidate yet",
                ts=msg.ts,
            )
            return
        finish_ts = self._pending_candidate_ts if self._pending_candidate_ts is not None else msg.ts
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
        # Manual sessions never produce tag candidates — ack and skip.
        if self._session_method == "manual":
            self._sender.send(
                encode_camera_frame_ack(robot_id=self._robot_id, seq=seq)
            )
            return
        if not self._tag_tracker.has_camera_info():
            logger.warning("XR camera frame dropped: no camera intrinsics yet", seq=seq)
            self._sender.send(
                encode_camera_frame_ack(robot_id=self._robot_id, seq=seq)
            )
            if self._tag_tracker.active:
                self._broadcast_align_status(
                    state="failed",
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
            # Use interpolated odom lookup when registered so runtime tag corrections
            # are aligned to the actual capture timestamp instead of dropping frames
            # that land between buffered odom samples.
            # Use the relaxed at_or_latest lookup when not yet registered (alignment),
            # because the robot is stationary and a slightly stale pose is fine.
            odom_lookup = self._odom.at_interpolated if registered else self._odom.at_or_latest
            # Surface a visible stall to the Lens if no odom has ever arrived.
            if self._odom.latest() is None:
                self._broadcast_align_status(
                    state="detecting",
                    message="Waiting for robot odometry",
                )
            result = await asyncio.to_thread(
                self._tag_tracker.process_frame,
                header,
                jpeg,
                odom_lookup,
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
            self._sender.send(
                encode_camera_frame_ack(robot_id=self._robot_id, seq=seq)
            )
            self._apply_tracker_update(ts=float(header.get("ts", time.time())))
        finally:
            self._frame_in_flight = False

    def on_align_manual_pose(
        self, msg: AlignManualPoseMessage, _websocket: ServerConnection
    ) -> None:
        if self._session_method != "manual":
            now = time.monotonic()
            if now - self._last_manual_inactive_log_mono >= DROPPED_POSE_LOG_INTERVAL_S:
                self._last_manual_inactive_log_mono = now
                logger.warning(
                    "align_manual_pose dropped: no manual session open"
                    " (send align_start{method:'manual'} first)"
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
            now = time.monotonic()
            if now - self._last_manual_odom_missing_log_mono >= DROPPED_POSE_LOG_INTERVAL_S:
                self._last_manual_odom_missing_log_mono = now
                logger.warning("Manual alignment waiting on robot odometry")
            self._broadcast_align_status(
                state="detecting",
                message="Waiting for robot odometry",
                ts=msg.ts,
            )
            return
        self._process_manual_candidate(msg, odom)

    # ------------------------------------------------------------------
    # Disconnect reset
    # ------------------------------------------------------------------

    def clear_on_disconnect(self) -> None:
        if self._session_method is None and self._pending_candidate is None:
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
        if self._session_method == "manual":
            if self._pending_candidate is not None:
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
                if self._session_method is None:
                    break
                if self._assist_driver is not None:
                    self._assist_driver.tick(
                        obs_count=self._tag_tracker.observation_count(),
                        latest_obs_pos_world=None,
                    latest_odom=self._odom.latest(),
                    )
                    self._maybe_finish_assist()
                    # _maybe_finish_assist() may have auto-committed and cleared the
                    # session (nulling _session_method) and set the broadcast stop
                    # event. Do NOT fall through to the trailing
                    # _broadcast_align_status() below: it would enqueue a default
                    # state="detecting" AFTER the terminal "aligned" just emitted,
                    # which can coalesce-overwrite "aligned" before it is sent and
                    # reverts the client wizard out of "ready".
                    if self._session_method is None or self._broadcast_stop.is_set():
                        break
                self._broadcast_align_status()

        self._broadcast_thread = threading.Thread(
            target=loop,
            name="xr-align-status",
            daemon=True,
        )
        self._broadcast_thread.start()

    def _maybe_finish_assist(self) -> None:
        """Auto-commit when the assist driver reaches DONE.

        Computes a fresh current_solve(min_baseline_m=0.0) at DONE.
        If the solve is None (no observations), logs a warning and marks failed.
        No fallback — the SAMPLE phases ensure at least a few observations exist.
        """
        if self._assist_driver is None:
            return
        from dimos_xr.bridge.assist import AssistState
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
        self._pending_candidate = None
        self._pending_candidate_ts = None
        self._session_method = None
        self._pending_large_solves = []
        self._manual_pose_first_logged = False
        self._last_manual_inactive_log_mono = 0.0
        self._last_manual_odom_missing_log_mono = 0.0
        self._last_manual_candidate_log_mono = 0.0
        if self._assist_driver is not None:
            # Use silent reset so teardown emits no stage-change broadcast that
            # could race with and overwrite a terminal align_status already enqueued.
            # Re-arming via start() happens in on_align_start -> assist_driver.start().
            self._assist_driver.reset_to_idle()

    def _process_manual_candidate(
        self,
        msg: AlignManualPoseMessage,
        odom: OdomSample,
    ) -> AlignmentCandidate:
        norm_position, norm_orientation = normalize_ground_pose(msg.position, msg.orientation)
        T_world_base = pose_to_matrix(norm_position, norm_orientation)
        # normalize_ground_pose yields a yaw-only-about-world-Y rotation that omits the
        # odom(Z-up) -> world(Y-up) basis change. Apply R_ALIGN so the robot body +Z maps
        # to world +Y, matching the AprilTag path (build_T_world_odom = R_yaw @ R_ALIGN).
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
        self._pending_candidate = candidate
        self._pending_candidate_ts = msg.ts
        now = time.monotonic()
        if now - self._last_manual_candidate_log_mono >= DROPPED_POSE_LOG_INTERVAL_S:
            self._last_manual_candidate_log_mono = now
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
        self._T_committed = np.array(result.T_world_odom, dtype=np.float64, copy=True)

    def _apply_tracker_update(self, *, ts: float | None = None) -> None:
        if self._tag_tracker.active:
            # Assisted tag flow: tick the driver and broadcast tag-visible feedback.
            # No candidate production here — the commit happens in _maybe_finish_assist at DONE.
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
        if not self._calibration.is_registered or not self._runtime_correction_enabled:
            return
        anchor_solve = self._apply_world_anchor_correction()
        if anchor_solve is not None:
            self._commit_runtime_correction(anchor_solve)
            return
        solve = self._tag_tracker.current_solve()
        if solve is None:
            T_reference = self._T_committed
            if T_reference is None:
                T_reference = self._calibration.current_transform()
            if T_reference is not None:
                solve = self._tag_tracker.current_translation_solve(T_reference)
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
            if solve.method == "tag_translation" and solve.quality >= 0.85:
                # For a visible stationary robot, apply a fast first-step shrink in
                # translation while preserving the committed yaw. This avoids
                # forcing large, high-confidence tag sightings through the
                # baseline-based multi-solve gate used by the assisted path.
                t_old = self._T_committed[:3, 3]
                t_new = T_new[:3, 3]
                t_blend = t_old + 0.65 * (t_new - t_old)
                T_new = build_T_world_odom(
                    _yaw_from_T(self._T_committed),
                    (float(t_blend[0]), float(t_blend[1]), float(t_blend[2])),
                )
                T_new = gravity_level_transform(T_new)
                self._pending_large_solves = []
            else:
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
        self._commit_runtime_correction(T_new, now=now)

    def _apply_world_anchor_correction(self) -> np.ndarray | None:
        observations = self._tag_tracker.consume_world_anchor_observations()
        if not observations:
            return None
        T_current = self._T_committed
        if T_current is None:
            T_current = self._calibration.current_transform()
        if T_current is None:
            return None
        candidates: list[np.ndarray] = []
        weights: list[float] = []
        for observation in observations:
            ref = self._world_anchor_refs.get(observation.tag_id)
            if ref is None:
                self._world_anchor_refs[observation.tag_id] = np.array(
                    observation.T_world_tag,
                    dtype=np.float64,
                    copy=True,
                )
                continue
            delta = ref @ np.linalg.inv(observation.T_world_tag)
            candidate = gravity_level_transform(delta @ T_current)
            if not np.all(np.isfinite(candidate)):
                continue
            candidates.append(candidate)
            weights.append(max(observation.quality, 1e-3))
        if not candidates:
            return None
        if len(candidates) == 1:
            return candidates[0]
        weight_arr = np.asarray(weights, dtype=np.float64)
        weight_arr /= np.sum(weight_arr)
        translations = np.stack([candidate[:3, 3] for candidate in candidates], axis=0)
        mean_translation = np.sum(translations * weight_arr[:, np.newaxis], axis=0)
        reference = np.array(candidates[-1], dtype=np.float64, copy=True)
        reference[:3, 3] = mean_translation
        return gravity_level_transform(reference)

    def _commit_runtime_correction(self, T_world_odom: np.ndarray, *, now: float | None = None) -> None:
        self._T_committed = np.array(T_world_odom, dtype=np.float64, copy=True)
        self._last_smooth_mono = time.monotonic() if now is None else now
        self._calibration.register_from_alignment(self._T_committed)

    def _compute_progress(self, state: str) -> int:
        """Return a 0-100 progress integer for the current step."""
        if state in ("aligned", "ready"):
            return 100
        if state == "failed":
            return 0
        if self._session_method == "manual":
            return 100 if self._pending_candidate is not None else 0
        if self._assist_driver is not None:
            from dimos_xr.bridge.assist import AssistState
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
        effective_method = method or self._session_method or "tag"
        effective_state = state
        # Manual: a pending candidate → ready so Lens can offer Commit action.
        if state == "detecting" and self._session_method == "manual" and self._pending_candidate is not None:
            effective_state = "ready"
        if not message and state == "detecting":
            message = self._align_status_message()
        if progress is None:
            progress = self._compute_progress(effective_state)
        if tag_visible is None and effective_method == "tag":
            tag_visible = self._tag_detected()

        assist_stage: str | None = None
        robot_world_pose: dict[str, Any] | None = None
        step_index: int | None = None
        step_count: int | None = None
        if self._session_method == "tag" and self._assist_driver is not None:
            from dimos_xr.bridge.assist import AssistState
            if self._assist_driver.state not in (AssistState.IDLE, AssistState.DONE):
                assist_stage = self._assist_driver.stage_label
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
                robot_world_pose=robot_world_pose,
                step_index=step_index,
                step_count=step_count,
            )
        )

    def _send_frame_drop_ack(self, header: dict[str, Any]) -> None:
        self._sender.send(
            encode_camera_frame_ack(
                robot_id=self._robot_id,
                seq=int(header["seq"]),
            )
        )
