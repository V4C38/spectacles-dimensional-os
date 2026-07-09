"""WorldFrameRefiner — floor-lock, diagnostics, and aligner delegation."""

from __future__ import annotations

import math
import time
from typing import TYPE_CHECKING, Any

import numpy as np

from dimos.ar.tag_tracking.tracker import RobotAprilTagTracker
from dimos.ar.world_frame.state import WorldFrameState
from dimos.ar.world_frame.transforms import OdomSample, pose_to_matrix, yaw_from_T
from dimos.utils.logging_config import setup_logger

if TYPE_CHECKING:
    from dimos.ar.bridge.odom_buffer import OdomBuffer
    from dimos.ar.bridge.telemetry import TelemetryPublisher
    from dimos.ar.robot_profile.base import TagTrackingProfile
    from dimos.ar.world_frame.aligner import AlignmentEstimate, SimilarityAligner
    from dimos.ar.world_frame.registry import WorldRegistry

logger = setup_logger()

MOVING_ROBOT_DIAG_LOG_INTERVAL_S: float = 2.0
FLOOR_Y_SHIM_THRESHOLD_M: float = 0.03
FLOOR_Y_SHIM_PERSIST_S: float = 2.0
FLOOR_Y_SHIM_MIN_INTERVAL_S: float = 2.0


class WorldFrameRefiner:
    """Owns floor-Y correction and moving-robot diagnostics."""

    def __init__(
        self,
        *,
        registry: WorldRegistry,
        telemetry: TelemetryPublisher,
        odom: OdomBuffer,
        tag_tracker: RobotAprilTagTracker,
        runtime_profile: TagTrackingProfile,
        runtime_correction_enabled: bool,
        diag_latest_observations: int = 1,
    ) -> None:
        self._registry = registry
        self._telemetry = telemetry
        self._state = registry.state
        self._odom = odom
        self._tag_tracker = tag_tracker
        self._runtime_profile = runtime_profile
        self._runtime_correction_enabled = runtime_correction_enabled
        self._diag_latest_observations = diag_latest_observations
        self._similarity_aligner: SimilarityAligner | None = None
        self._refinement_baseline: np.ndarray | None = None
        self._last_moving_diag_log_mono: float = 0.0
        self._floor_base_world_y: float | None = None
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

    def attach_aligner(self, aligner: SimilarityAligner) -> None:
        self._similarity_aligner = aligner

    def current_alignment_estimate(
        self,
        *,
        now_mono: float | None = None,
        min_observations: int | None = None,
    ) -> AlignmentEstimate | None:
        if self._similarity_aligner is None:
            return None
        return self._similarity_aligner.current_estimate(
            now_mono=now_mono,
            min_observations=min_observations,
            emit_skip_log=False,
        )

    def registration_alignment_estimate(
        self,
        *,
        now_mono: float | None = None,
        max_age_s: float,
        min_observations: int | None = None,
    ) -> AlignmentEstimate | None:
        if self._similarity_aligner is None:
            return None
        min_obs = (
            self.registration_min_observations()
            if min_observations is None
            else int(min_observations)
        )
        return self._similarity_aligner.registration_estimate(
            now_mono=now_mono,
            max_age_s=max_age_s,
            min_observations=min_obs,
        )

    def registration_confidence_min(self) -> float:
        if self._similarity_aligner is None:
            return 0.7
        return float(self._similarity_aligner._config.ALIGN_REG_CONF_MIN)

    def registration_min_observations(self) -> int:
        if self._similarity_aligner is None:
            return 4
        return self._similarity_aligner._config.ALIGN_REG_MIN_OBS

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
        if (
            not self._state.is_committed
            or not self._runtime_correction_enabled
            or self._similarity_aligner is None
        ):
            return
        self._similarity_aligner.update(
            resolved_odom=resolved_odom,
            now_mono=time.monotonic(),
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
        regime = (
            "static"
            if speed_mps <= profile.runtime_static_speed_mps
            else "moving"
        )

        latest_tag_estimate = self._tag_tracker.robot_world_pose_estimate(
            max_observations=self._diag_latest_observations,
        )
        centroid_tag_estimate = self._tag_tracker.robot_world_pose_estimate()
        odom_base = self._robot_base_world_position(resolved_odom)
        latest_residual_m: float | None = None
        window_centroid_residual_m: float | None = None
        residual_along_track_m: float | None = None
        residual_cross_track_m: float | None = None
        residual_vertical_m: float | None = None
        residual_along_camera_ray_m: float | None = None
        if latest_tag_estimate is not None and odom_base is not None:
            tag_pos = np.asarray(latest_tag_estimate[0], dtype=np.float64)
            latest_residual_m = float(np.linalg.norm(tag_pos - odom_base))
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
        if centroid_tag_estimate is not None and odom_base is not None:
            centroid_tag_pos = np.asarray(centroid_tag_estimate[0], dtype=np.float64)
            window_centroid_residual_m = float(np.linalg.norm(centroid_tag_pos - odom_base))

        total_rej = (
            result.rejections_reprojection
            + result.rejections_skew
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
            latest_residual_m=round(latest_residual_m, 4) if latest_residual_m is not None else None,
            window_centroid_residual_m=(
                round(window_centroid_residual_m, 4)
                if window_centroid_residual_m is not None
                else None
            ),
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
            obs_added=result.observations_added,
            total_rejections=total_rej,
            rej_reprojection=result.rejections_reprojection,
            rej_skew=result.rejections_skew,
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
            yaw = yaw_from_T(pose_to_matrix((0.0, 0.0, 0.0), ori))
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

    def _apply_floor_y_lock(
        self,
        T_new: np.ndarray,
        resolved_odom: OdomSample | None,
    ) -> np.ndarray:
        # Floor lock recomputes world-y from live odom; x/y use odom_scale like other consumers.
        if not self._runtime_profile.flat_ground or self._floor_base_world_y is None:
            return T_new
        odom = resolved_odom if resolved_odom is not None else self._odom.latest()
        if odom is None:
            return T_new
        T_locked = np.array(T_new, dtype=np.float64, copy=True)
        R_new = T_locked[:3, :3]
        p_odom = np.asarray(odom.position, dtype=np.float64)
        odom_scale = self._state.odom_scale
        anchor_xy = self._state.odom_anchor_xy
        scaled_x, scaled_y = WorldFrameState.scale_odom_xy(
            float(p_odom[0]),
            float(p_odom[1]),
            odom_scale=odom_scale,
            odom_anchor_xy=anchor_xy,
        )
        p_odom_scaled = np.array([scaled_x, scaled_y, p_odom[2]], dtype=np.float64)
        T_locked[1, 3] = self._floor_base_world_y - float((R_new @ p_odom_scaled)[1])
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
