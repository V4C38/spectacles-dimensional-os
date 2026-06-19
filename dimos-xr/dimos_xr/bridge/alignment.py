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
    encode_pose,
    encode_pose_correction,
)
from dimos_xr.tracking.tag_tracker import (
    R_ALIGN,
    AlignmentCandidate,
    FrameResult,
    TagSolve,
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

    from dimos_xr.adapters.base import RuntimeAlignmentProfile, XRRobotAdapterSpec
    from dimos_xr.bridge.odom_buffer import OdomBuffer
    from dimos_xr.bridge.sender import BridgeSender
    from dimos_xr.bridge.status_service import StatusService

_TRACE = os.getenv("DIMOS_XR_TRACE", "") not in ("", "0", "false")

logger = setup_logger()

ALIGN_STATUS_BROADCAST_INTERVAL_S: float = 0.3
RUNTIME_CORRECTION_LOG_INTERVAL_S: float = 1.0
# Rate limit for the moving-robot capture-timing diagnostic log (issue-4 investigation).
MOVING_ROBOT_DIAG_LOG_INTERVAL_S: float = 2.0
# Minimum correction magnitude for a pose_correction event to be sent to the Lens.
# Continuous micro-refinements below these thresholds still update T_world_odom but
# are silent — the Lens treats pose_correction as a user-visible "Refined Tracking"
# notification that should only fire when the robot position actually jumped.
MIN_REPORTED_CORRECTION_TRANS_M: float = 0.05
MIN_REPORTED_CORRECTION_YAW_DEG: float = 1.0

RuntimeRegime = Literal["static", "cruise", "fast"]


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
        tf_publish_static: Callable[[Transform], None],
        adapter: XRRobotAdapterSpec | None = None,
        world_anchor_tag_ids: list[int] | None = None,
        world_anchor_size_m: float = 0.056,
        runtime_profile: RuntimeAlignmentProfile | None = None,
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
        self._tf_publish_static = tf_publish_static
        self._tf_publish_static_unsupported: bool = False  # set once on first NotImplementedError

        self._frame_in_flight: bool = False
        self._T_committed: np.ndarray | None = None
        # _pending_candidate: manual pose awaiting commit (tag flow auto-commits at DONE)
        self._pending_candidate: AlignmentCandidate | None = None
        self._pending_candidate_ts: float | None = None
        self._session_method: Literal["tag", "manual"] | None = None  # None = no session
        self._world_anchor_refs: dict[int, np.ndarray] = {}

        self._manual_pose_first_logged: bool = False
        self._last_manual_inactive_log_mono: float = 0.0
        self._last_manual_odom_missing_log_mono: float = 0.0
        self._last_manual_candidate_log_mono: float = 0.0
        self._last_correction_log_mono: float = 0.0
        self._last_moving_diag_log_mono: float = 0.0

        if runtime_profile is not None:
            self._runtime_profile = runtime_profile
        elif adapter is not None:
            self._runtime_profile = adapter.runtime_alignment_profile()
        else:
            from dimos_xr.adapters.base import RuntimeAlignmentProfile

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
        if self._assist_driver is not None:
            from dimos_xr.bridge.assist import AssistState

            if (
                self._assist_driver.state == AssistState.MOVE
                and not self._assist_driver.is_sampling
            ):
                self._sender.send(
                    encode_camera_frame_ack(robot_id=self._robot_id, seq=seq)
                )
                return
        resolved_odom = self.resolve_frame_odom(header)
        if resolved_odom is None:
            self._sender.send(
                encode_camera_frame_ack(robot_id=self._robot_id, seq=seq)
            )
            return
        self._frame_in_flight = True
        try:
            receive_mono = time.monotonic()
            registered = self._calibration.is_registered
            T_committed = self._T_committed
            if registered and T_committed is None:
                T_committed = self._calibration.current_transform()
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
            self._sender.send(
                encode_camera_frame_ack(robot_id=self._robot_id, seq=seq)
            )
            self._apply_tracker_update(
                ts=float(header.get("ts", time.time())),
                resolved_odom=resolved_odom,
                capture_ts_robot=float(header["capture_ts_robot"]),
            )
            if registered:
                self._maybe_log_moving_robot_diag(
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

    def resolve_frame_odom(self, header: dict[str, Any]) -> OdomSample | None:
        """Pair frame capture time to odom via ``capture_ts_robot`` (required)."""
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

    def _robot_base_world_position(self, odom: OdomSample | None) -> np.ndarray | None:
        if odom is None:
            return None
        position, _orientation = self._calibration.transform_pose(
            odom.position,
            odom.orientation,
        )
        base_world = np.asarray(position, dtype=np.float64)
        if base_world.shape != (3,) or not np.all(np.isfinite(base_world)):
            return None
        return base_world

    def _maybe_log_runtime_correction(
        self,
        *,
        solve: TagSolve,
        odom: OdomSample | None,
        base_before: np.ndarray | None,
        trans_delta_m: float,
        yaw_delta_deg: float,
    ) -> None:
        now = time.monotonic()
        if now - self._last_correction_log_mono < RUNTIME_CORRECTION_LOG_INTERVAL_S:
            return
        self._last_correction_log_mono = now
        base_after = self._robot_base_world_position(odom)
        marker_jump_m: float | None = None
        if base_before is not None and base_after is not None:
            marker_jump_m = float(np.linalg.norm(base_after - base_before))
        logger.info(
            "Runtime correction applied",
            solve_method=solve.method,
            solve_quality=round(solve.quality, 3),
            observation_count=solve.observation_count,
            baseline_m=round(solve.baseline_m, 3),
            trans_delta_m=round(trans_delta_m, 3),
            yaw_delta_deg=round(yaw_delta_deg, 2),
            marker_jump_m=round(marker_jump_m, 3) if marker_jump_m is not None else None,
            base_before=(
                [round(float(v), 3) for v in base_before]
                if base_before is not None
                else None
            ),
            base_after=(
                [round(float(v), 3) for v in base_after]
                if base_after is not None
                else None
            ),
        )

    def _committed_or_current(self) -> np.ndarray | None:
        if self._T_committed is not None:
            return np.array(self._T_committed, dtype=np.float64, copy=True)
        current = self._calibration.current_transform()
        if current is None:
            return None
        return np.array(current, dtype=np.float64, copy=True)

    def _runtime_regime(self, speed_mps: float) -> RuntimeRegime:
        profile = self._runtime_profile
        if speed_mps >= profile.runtime_max_correct_speed_mps:
            return "fast"
        if speed_mps < profile.runtime_static_speed_mps:
            return "static"
        return "cruise"

    def _resolve_runtime_transform(
        self,
        T_committed: np.ndarray,
        T_target: np.ndarray,
        *,
        use_yaw: bool,
    ) -> np.ndarray:
        """Apply the tag solve directly; yaw gate selects full vs translation-only."""
        T_target = gravity_level_transform(
            np.array(T_target, dtype=np.float64, copy=True),
        )
        if use_yaw:
            return T_target
        yaw = _yaw_from_T(T_committed)
        t = T_target[:3, 3]
        return gravity_level_transform(
            build_T_world_odom(
                yaw,
                (float(t[0]), float(t[1]), float(t[2])),
            ),
        )

    def _apply_tracker_update(
        self,
        *,
        ts: float | None = None,
        resolved_odom: OdomSample | None = None,
        capture_ts_robot: float | None = None,
    ) -> None:
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
            self._commit_runtime_correction(anchor_solve, ts=ts)
            return

        profile = self._runtime_profile
        if resolved_odom is not None and resolved_odom.measured_speed_mps is not None:
            speed_mps = resolved_odom.measured_speed_mps
        else:
            lookup_ts = self._odom.latest_mono() or time.monotonic()
            speed = self._odom.speed_windowed(lookup_ts, profile.runtime_speed_horizon_s)
            speed_mps = speed if speed is not None else 0.0
        regime = self._runtime_regime(speed_mps)
        if regime == "fast":
            return

        T_reference = self._committed_or_current()
        if T_reference is None:
            return

        if regime == "static":
            solve = self._tag_tracker.current_translation_solve(
                T_reference,
                max_observations=1,
            )
        else:
            solve = self._tag_tracker.current_solve(
                max_age_s=profile.runtime_cruise_window_s,
            )
            if solve is None:
                solve = self._tag_tracker.current_translation_solve(
                    T_reference,
                    max_observations=1,
                )

        if solve is None:
            return

        T_target = np.array(solve.T_world_odom, dtype=np.float64, copy=True)
        if self._T_committed is None:
            self._T_committed = gravity_level_transform(T_target)
            self._calibration.register_from_alignment(self._T_committed)
            return

        use_yaw = (
            regime == "cruise"
            and solve.method == "tag"
            and solve.baseline_m >= profile.runtime_yaw_min_baseline_m
            and solve.straightness <= profile.runtime_yaw_straightness_max
        )
        T_new = self._resolve_runtime_transform(
            self._T_committed,
            T_target,
            use_yaw=use_yaw,
        )

        trans_delta = float(np.linalg.norm(T_new[:3, 3] - self._T_committed[:3, 3]))
        yaw_delta = abs(normalize_angle(_yaw_from_T(T_new) - _yaw_from_T(self._T_committed)))
        yaw_delta_deg = math.degrees(yaw_delta)
        # Only notify the Lens when the correction is large enough to be meaningful.
        # Continuous sub-threshold micro-refinements still update T_world_odom (below)
        # but do not fire the user-visible "Refined Tracking" event.
        if (
            trans_delta >= MIN_REPORTED_CORRECTION_TRANS_M
            or yaw_delta_deg >= MIN_REPORTED_CORRECTION_YAW_DEG
        ):
            self._sender.send(
                encode_pose_correction(
                    ts=ts,
                    robot_id=self._robot_id,
                    trans_delta_m=trans_delta,
                    yaw_delta_deg=yaw_delta_deg,
                    yaw_corrected=use_yaw,
                    solve_quality=solve.quality,
                    solve_method=solve.method,
                )
            )
        odom = self._odom.latest()
        base_before = self._robot_base_world_position(odom)
        self._commit_runtime_correction(T_new, ts=ts)
        self._maybe_log_runtime_correction(
            solve=solve,
            odom=odom,
            base_before=base_before,
            trans_delta_m=trans_delta,
            yaw_delta_deg=yaw_delta_deg,
        )

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

    def _commit_runtime_correction(
        self, T_world_odom: np.ndarray, *, ts: float | None = None
    ) -> None:
        self._T_committed = np.array(T_world_odom, dtype=np.float64, copy=True)
        self._calibration.register_from_alignment(self._T_committed)
        odom = self._odom.latest()
        if odom is None:
            return
        position, orientation = self._calibration.transform_pose(
            odom.position,
            odom.orientation,
        )
        if not all(
            np.isfinite(v)
            for v in (
                position[0],
                position[1],
                position[2],
                orientation[0],
                orientation[1],
                orientation[2],
                orientation[3],
            )
        ):
            return
        self._sender.send(
            encode_pose(
                ts=ts if ts is not None else time.time(),
                position=position,
                orientation=orientation,
                robot_id=self._robot_id,
            )
        )

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
        sampling: bool | None = None
        step_index: int | None = None
        step_count: int | None = None
        if self._session_method == "tag" and self._assist_driver is not None:
            from dimos_xr.bridge.assist import AssistState
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

    def _maybe_log_moving_robot_diag(
        self,
        *,
        header: dict[str, Any],
        receive_mono: float,
        frame_age: float,
        result: FrameResult,
        resolved_odom: OdomSample | None,
        capture_ts_robot: float,
    ) -> None:
        """Rate-limited diagnostic log for runtime re-alignment validation.

        Logs capture timing, smoothed robot speed, world-frame position residual
        (tag estimate vs odom-projected base), straightness, and regime.
        """
        now = time.monotonic()
        if now - self._last_moving_diag_log_mono < MOVING_ROBOT_DIAG_LOG_INTERVAL_S:
            return
        self._last_moving_diag_log_mono = now

        profile = self._runtime_profile
        if resolved_odom is not None and resolved_odom.measured_speed_mps is not None:
            speed_mps = resolved_odom.measured_speed_mps
        else:
            lookup_ts = self._odom.latest_mono() or receive_mono
            speed = self._odom.speed_windowed(lookup_ts, profile.runtime_speed_horizon_s)
            speed_mps = speed if speed is not None else 0.0
        regime = self._runtime_regime(speed_mps)

        tag_estimate = self._tag_tracker.robot_world_pose_estimate()
        odom_base = self._robot_base_world_position(resolved_odom)
        residual_m: float | None = None
        if tag_estimate is not None and odom_base is not None:
            tag_pos = np.asarray(tag_estimate[0], dtype=np.float64)
            residual_m = float(np.linalg.norm(tag_pos - odom_base))

        solve = self._tag_tracker.current_solve(
            max_age_s=profile.runtime_cruise_window_s,
        )
        straightness = solve.straightness if solve is not None else None

        total_rej = (
            result.rejections_reprojection
            + result.rejections_distance
            + result.rejections_up_tilt
            + result.rejections_mount_residual
            + result.rejections_innovation
        )

        source_ts_gap: float | None = None
        if resolved_odom is not None and resolved_odom.source_ts is not None:
            source_ts_gap = capture_ts_robot - resolved_odom.source_ts

        logger.info(
            "moving_robot_diag",
            seq=int(header.get("seq", -1)),
            frame_age_s=round(frame_age, 4),
            capture_ts_robot=round(capture_ts_robot, 6),
            source_ts_gap_s=round(source_ts_gap, 6) if source_ts_gap is not None else None,
            robot_speed_ms=round(speed_mps, 3),
            regime=regime,
            world_residual_m=round(residual_m, 4) if residual_m is not None else None,
            straightness=round(straightness, 4) if straightness is not None else None,
            obs_added=result.observations_added,
            total_rejections=total_rej,
            rej_reprojection=result.rejections_reprojection,
            rej_distance=result.rejections_distance,
            rej_up_tilt=result.rejections_up_tilt,
            rej_mount_residual=result.rejections_mount_residual,
            rej_innovation=result.rejections_innovation,
        )

    def _send_frame_drop_ack(self, header: dict[str, Any]) -> None:
        self._sender.send(
            encode_camera_frame_ack(
                robot_id=self._robot_id,
                seq=int(header["seq"]),
            )
        )
