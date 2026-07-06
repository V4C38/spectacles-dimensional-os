"""WorldFrameRefiner — post-commit tag-based pose refinement.

After world-frame commit, continuously refines T_world_odom from robot-mounted
AprilTag observations. Selects solve strategy by robot speed regime, applies yaw
gate, emits world_frame_correction when above deadband, and applies updated transform.
"""

from __future__ import annotations

from collections.abc import Callable
import math
import time
from typing import TYPE_CHECKING, Any, Literal

import numpy as np

from dimos.ar.tag_tracking.solve import TagSolve, _yaw_from_T
from dimos.ar.tag_tracking.tracker import RobotAprilTagTracker
from dimos.ar.world_frame.transforms import OdomSample, gravity_level_transform, pose_to_matrix
from dimos.ar.world_frame.wire import encode_world_frame_correction
from dimos.utils.logging_config import setup_logger
from dimos.utils.transform_utils import normalize_angle

if TYPE_CHECKING:
    from dimos.ar.bridge.odom_buffer import OdomBuffer
    from dimos.ar.bridge.sender import BridgeSender
    from dimos.ar.bridge.telemetry import TelemetryPublisher
    from dimos.ar.robot_profile.base import TagTrackingProfile
    from dimos.ar.world_frame.registry import WorldRegistry

logger = setup_logger()

RUNTIME_CORRECTION_LOG_INTERVAL_S: float = 1.0
MOVING_ROBOT_DIAG_LOG_INTERVAL_S: float = 2.0
YAW_GATE_LOG_INTERVAL_S: float = 2.0
MIN_REPORTED_CORRECTION_TRANS_M: float = 0.05
MIN_REPORTED_CORRECTION_YAW_DEG: float = 1.0
FLOOR_Y_SHIM_THRESHOLD_M: float = 0.03
FLOOR_Y_SHIM_PERSIST_S: float = 2.0
FLOOR_Y_SHIM_MIN_INTERVAL_S: float = 2.0

RuntimeRegime = Literal["static", "cruise", "fast"]


class WorldFrameRefiner:
    """Refines committed world-frame alignment from runtime tag observations."""

    def __init__(
        self,
        *,
        registry: WorldRegistry,
        telemetry: TelemetryPublisher,
        robot_id: str,
        sender: BridgeSender,
        odom: OdomBuffer,
        tag_tracker: RobotAprilTagTracker,
        runtime_profile: TagTrackingProfile,
        runtime_correction_enabled: bool,
        on_correction_committed: Callable[[], None] | None = None,
    ) -> None:
        self._registry = registry
        self._telemetry = telemetry
        self._robot_id = robot_id
        self._sender = sender
        self._state = registry.state
        self._odom = odom
        self._tag_tracker = tag_tracker
        self._runtime_profile = runtime_profile
        self._runtime_correction_enabled = runtime_correction_enabled
        self._on_correction_committed = on_correction_committed
        self._refinement_baseline: np.ndarray | None = None
        self._last_correction_log_mono: float = 0.0
        self._last_moving_diag_log_mono: float = 0.0
        self._last_yaw_gate_log_mono: float = 0.0
        self._last_regime: RuntimeRegime | None = None
        self._stop_yaw_armed: bool = True
        self._floor_base_world_y: float | None = None
        self._registration_yaw_rad: float | None = None
        self._registration_yaw_bias_logged: bool = False
        self._floor_y_exceed_since_mono: float | None = None
        self._last_floor_y_shim_mono: float = 0.0

    @property
    def refinement_baseline(self) -> np.ndarray | None:
        return self._refinement_baseline

    @property
    def floor_base_world_y(self) -> float | None:
        return self._floor_base_world_y

    def set_refinement_baseline(self, T_world_odom: np.ndarray) -> None:
        self._refinement_baseline = np.array(T_world_odom, dtype=np.float64, copy=True)

    def clear_refinement_baseline(self) -> None:
        """Reset refinement reference baseline without clearing live ``WorldFrameState``."""
        self._refinement_baseline = None

    def set_floor_lock(self, floor_base_world_y: float) -> None:
        self._floor_base_world_y = float(floor_base_world_y)

    def clear_floor_lock(self) -> None:
        self._floor_base_world_y = None
        self._floor_y_exceed_since_mono = None

    def set_registration_yaw(self, yaw_rad: float) -> None:
        self._registration_yaw_rad = float(yaw_rad)
        self._registration_yaw_bias_logged = False

    def clear_registration_yaw(self) -> None:
        self._registration_yaw_rad = None
        self._registration_yaw_bias_logged = False

    def committed_or_current_for_frame(self) -> np.ndarray | None:
        if self._refinement_baseline is not None:
            return np.array(self._refinement_baseline, dtype=np.float64, copy=True)
        if not self._state.is_committed:
            return None
        current = self._state.current_transform()
        if current is None:
            return None
        return np.array(current, dtype=np.float64, copy=True)

    def apply_tracker_update(
        self,
        *,
        resolved_odom: OdomSample | None = None,
    ) -> None:
        if not self._state.is_committed or not self._runtime_correction_enabled:
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
            self._last_regime = regime
            return

        T_reference = self._committed_or_current()
        if T_reference is None:
            return

        max_dist_cam_m = profile.runtime_solve_max_dist_cam_m
        translation_window_obs = profile.runtime_translation_window_obs
        translation_window_s = profile.runtime_translation_window_s
        use_yaw = False
        solve: TagSolve | None = None

        if regime == "static":
            from_cruise = self._last_regime in ("cruise", "fast")
            if from_cruise and self._stop_yaw_armed:
                # Stop-yaw solve uses approach trajectory before translation re-anchors.
                stop_solve = self._tag_tracker.current_solve(
                    max_age_s=profile.runtime_stop_yaw_window_s,
                    max_dist_cam_m=max_dist_cam_m,
                )
                if self._yaw_solve_eligible(stop_solve, profile):
                    solve = stop_solve
                    use_yaw = True
                    self._stop_yaw_armed = False
            if solve is None:
                solve = self._tag_tracker.current_translation_solve(
                    T_reference,
                    max_observations=translation_window_obs,
                    max_age_s=translation_window_s,
                    max_dist_cam_m=max_dist_cam_m,
                )
        else:
            if regime == "cruise":
                self._stop_yaw_armed = True
            full = self._tag_tracker.current_solve(
                max_age_s=profile.runtime_cruise_window_s,
                max_dist_cam_m=max_dist_cam_m,
            )
            use_yaw = self._yaw_solve_eligible(full, profile)
            if use_yaw and full is not None:
                solve = full
            else:
                if full is not None and full.method == "apriltag_full":
                    self._maybe_log_yaw_gate_failure(full, profile)
                solve = self._tag_tracker.current_translation_solve(
                    T_reference,
                    max_observations=translation_window_obs,
                    max_age_s=translation_window_s,
                    max_dist_cam_m=max_dist_cam_m,
                )
                use_yaw = False

        self._last_regime = regime

        if solve is None:
            return

        T_target = np.array(solve.T_world_odom, dtype=np.float64, copy=True)
        if self._refinement_baseline is None:
            self._registry.apply_runtime_transform(T_target, update_refiner_baseline=True)
            return

        T_new = self._resolve_runtime_transform(T_target)
        T_new = self._apply_floor_y_lock(T_new, resolved_odom=resolved_odom)

        trans_delta = float(np.linalg.norm(T_new[:3, 3] - self._refinement_baseline[:3, 3]))
        yaw_delta = abs(normalize_angle(_yaw_from_T(T_new) - _yaw_from_T(self._refinement_baseline)))
        yaw_delta_deg = math.degrees(yaw_delta)
        if (
            trans_delta >= MIN_REPORTED_CORRECTION_TRANS_M
            or yaw_delta_deg >= MIN_REPORTED_CORRECTION_YAW_DEG
        ):
            self._sender.send(
                encode_world_frame_correction(
                    ts=time.time(),
                    trans_delta_m=trans_delta,
                    yaw_delta_deg=yaw_delta_deg,
                    yaw_corrected=use_yaw,
                    solve_quality=solve.quality,
                    solve_method=solve.method,
                )
            )
        odom = resolved_odom if resolved_odom is not None else self._odom.latest()
        base_before = self._robot_base_world_position(odom)
        self._commit_runtime_correction(T_new, odom=odom)
        if use_yaw:
            self._maybe_log_registration_yaw_bias()
        self._maybe_log_runtime_correction(
            solve=solve,
            odom=odom,
            base_before=base_before,
            trans_delta_m=trans_delta,
            yaw_delta_deg=yaw_delta_deg,
        )

    def maybe_log_moving_robot_diag(
        self,
        *,
        header: dict[str, Any],
        receive_mono: float,
        frame_age: float,
        result: object,
        resolved_odom: OdomSample | None,
        capture_ts_robot: float,
    ) -> None:
        from dimos.ar.tag_tracking.tracker import FrameResult

        if not isinstance(result, FrameResult):
            return
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
        residual_along_track_m: float | None = None
        residual_cross_track_m: float | None = None
        residual_vertical_m: float | None = None
        residual_along_camera_ray_m: float | None = None
        if tag_estimate is not None and odom_base is not None:
            tag_pos = np.asarray(tag_estimate[0], dtype=np.float64)
            residual_m = float(np.linalg.norm(tag_pos - odom_base))
            (
                residual_along_track_m,
                residual_cross_track_m,
                residual_vertical_m,
                residual_along_camera_ray_m,
            ) = self._decompose_residual(
                tag_pos=tag_pos,
                odom_base=odom_base,
                resolved_odom=resolved_odom,
                cam_pos=header.get("cam_pos"),
            )

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
            residual_along_track_m=(
                round(residual_along_track_m, 4) if residual_along_track_m is not None else None
            ),
            residual_cross_track_m=(
                round(residual_cross_track_m, 4) if residual_cross_track_m is not None else None
            ),
            residual_vertical_m=(
                round(residual_vertical_m, 4) if residual_vertical_m is not None else None
            ),
            residual_along_camera_ray_m=(
                round(residual_along_camera_ray_m, 4)
                if residual_along_camera_ray_m is not None
                else None
            ),
            straightness=round(straightness, 4) if straightness is not None else None,
            obs_added=result.observations_added,
            total_rejections=total_rej,
            rej_reprojection=result.rejections_reprojection,
            rej_distance=result.rejections_distance,
            rej_up_tilt=result.rejections_up_tilt,
            rej_mount_residual=result.rejections_mount_residual,
            rej_innovation=result.rejections_innovation,
        )

    def check_floor_y_drift(self, odom: OdomSample) -> None:
        """Y watchdog entry point from pose telemetry — applies a y-only shim when needed."""
        if (
            not self._runtime_profile.flat_ground
            or self._floor_base_world_y is None
            or not self._state.is_committed
        ):
            self._floor_y_exceed_since_mono = None
            return

        base_world = self._robot_base_world_position(odom)
        if base_world is None:
            return

        delta_y = float(base_world[1]) - self._floor_base_world_y
        now = time.monotonic()
        if abs(delta_y) <= FLOOR_Y_SHIM_THRESHOLD_M:
            self._floor_y_exceed_since_mono = None
            return

        if self._floor_y_exceed_since_mono is None:
            self._floor_y_exceed_since_mono = now
            return

        if now - self._floor_y_exceed_since_mono < FLOOR_Y_SHIM_PERSIST_S:
            return
        if now - self._last_floor_y_shim_mono < FLOOR_Y_SHIM_MIN_INTERVAL_S:
            return

        T_current = self._state.current_transform()
        if T_current is None:
            return

        T_shim = np.array(T_current, dtype=np.float64, copy=True)
        T_shim[1, 3] -= delta_y
        self._last_floor_y_shim_mono = now
        self._floor_y_exceed_since_mono = None
        self._commit_runtime_correction(T_shim, odom=odom)
        logger.info(
            "floor_y_shim applied",
            delta_y_m=round(delta_y, 4),
            floor_base_world_y_m=round(self._floor_base_world_y, 4),
        )

    def _decompose_residual(
        self,
        *,
        tag_pos: np.ndarray,
        odom_base: np.ndarray,
        resolved_odom: OdomSample | None,
        cam_pos: object,
    ) -> tuple[float | None, float | None, float | None, float | None]:
        residual = tag_pos - odom_base
        residual_vertical_m = float(residual[1])

        residual_along_track_m: float | None = None
        residual_cross_track_m: float | None = None
        if resolved_odom is not None:
            _pos, ori = self._state.transform_pose(
                resolved_odom.position,
                resolved_odom.orientation,
            )
            yaw = _yaw_from_T(pose_to_matrix((0.0, 0.0, 0.0), ori))
            heading = np.array([math.cos(yaw), 0.0, -math.sin(yaw)], dtype=np.float64)
            horizontal = residual.copy()
            horizontal[1] = 0.0
            along = float(np.dot(horizontal, heading))
            cross_vec = horizontal - along * heading
            residual_along_track_m = along
            residual_cross_track_m = float(np.linalg.norm(cross_vec))

        residual_along_camera_ray_m: float | None = None
        if isinstance(cam_pos, (list, tuple)) and len(cam_pos) == 3:
            cam = np.asarray(cam_pos, dtype=np.float64)
            ray = tag_pos - cam
            ray_len = float(np.linalg.norm(ray))
            if ray_len > 1e-6:
                residual_along_camera_ray_m = float(np.dot(residual, ray / ray_len))

        return (
            residual_along_track_m,
            residual_cross_track_m,
            residual_vertical_m,
            residual_along_camera_ray_m,
        )

    def _yaw_solve_eligible(
        self,
        solve: TagSolve | None,
        profile: TagTrackingProfile,
    ) -> bool:
        return (
            solve is not None
            and solve.method == "apriltag_full"
            and solve.baseline_m >= profile.runtime_yaw_min_baseline_m
            and solve.straightness <= profile.runtime_yaw_straightness_max
        )

    def _maybe_log_yaw_gate_failure(
        self,
        full: TagSolve,
        profile: TagTrackingProfile,
    ) -> None:
        now = time.monotonic()
        if now - self._last_yaw_gate_log_mono < YAW_GATE_LOG_INTERVAL_S:
            return
        self._last_yaw_gate_log_mono = now

        failures: list[str] = []
        if full.baseline_m < profile.runtime_yaw_min_baseline_m:
            failures.append("baseline")
        if full.straightness > profile.runtime_yaw_straightness_max:
            failures.append("straightness")
        logger.info(
            "yaw_gate_failed",
            failed_conditions=failures,
            baseline_m=round(full.baseline_m, 3),
            baseline_min_m=profile.runtime_yaw_min_baseline_m,
            straightness=round(full.straightness, 3),
            straightness_max=profile.runtime_yaw_straightness_max,
            observation_count=full.observation_count,
        )

    def _maybe_log_registration_yaw_bias(self) -> None:
        if self._registration_yaw_bias_logged or self._registration_yaw_rad is None:
            return
        T_current = self._state.current_transform()
        if T_current is None:
            return
        committed_yaw_deg = math.degrees(self._registration_yaw_rad)
        runtime_yaw_deg = math.degrees(_yaw_from_T(T_current))
        bias_deg = math.degrees(
            normalize_angle(_yaw_from_T(T_current) - self._registration_yaw_rad)
        )
        self._registration_yaw_bias_logged = True
        logger.info(
            "registration_yaw_bias_deg",
            registration_yaw_deg=round(committed_yaw_deg, 2),
            runtime_yaw_deg=round(runtime_yaw_deg, 2),
            registration_yaw_bias_deg=round(bias_deg, 2),
        )

    def _apply_floor_y_lock(
        self,
        T_new: np.ndarray,
        *,
        resolved_odom: OdomSample | None,
    ) -> np.ndarray:
        if not self._runtime_profile.flat_ground or self._floor_base_world_y is None:
            return T_new
        odom = resolved_odom if resolved_odom is not None else self._odom.latest()
        if odom is None:
            return T_new
        T_locked = np.array(T_new, dtype=np.float64, copy=True)
        R_new = T_locked[:3, :3]
        p_odom = np.asarray(odom.position, dtype=np.float64)
        T_locked[1, 3] = self._floor_base_world_y - float((R_new @ p_odom)[1])
        return T_locked

    def _robot_base_world_position(self, odom: OdomSample | None) -> np.ndarray | None:
        if odom is None:
            return None
        position, _orientation = self._state.transform_pose(
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
        if self._refinement_baseline is not None:
            return np.array(self._refinement_baseline, dtype=np.float64, copy=True)
        current = self._state.current_transform()
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

    def _resolve_runtime_transform(self, T_target: np.ndarray) -> np.ndarray:
        return gravity_level_transform(
            np.array(T_target, dtype=np.float64, copy=True),
        )

    def _commit_runtime_correction(
        self,
        T_world_odom: np.ndarray,
        *,
        odom: OdomSample | None = None,
    ) -> None:
        self._registry.apply_runtime_transform(T_world_odom, update_refiner_baseline=True)
        sample = odom if odom is not None else self._odom.latest()
        if sample is None:
            return
        snapshot_ts = (
            sample.source_ts if sample.source_ts is not None else time.time()
        )
        self._telemetry.publish_pose_snapshot(
            ts=snapshot_ts,
            sample=sample,
            force=True,
        )
        if self._on_correction_committed is not None:
            self._on_correction_committed()
