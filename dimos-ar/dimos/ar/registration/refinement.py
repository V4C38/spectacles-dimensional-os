"""RegisteredPoseRefiner — post-registration tag-based pose refinement.

After calibration commits, continuously refines T_world_odom from robot-mounted
AprilTag observations. Selects solve strategy by robot speed regime, applies yaw
gate, emits pose_correction when above deadband, and commits updated transform.
"""

from __future__ import annotations

import math
import time
from typing import TYPE_CHECKING, Any, Literal

import numpy as np

from dimos.ar.network.protocol import encode_pose, encode_pose_correction
from dimos.ar.registration.tracker import (
    RobotAprilTagTracker,
    TagSolve,
    _yaw_from_T,
    build_T_world_odom,
)
from dimos.ar.registration.transforms import (
    Calibration,
    OdomSample,
    gravity_level_transform,
)
from dimos.utils.logging_config import setup_logger
from dimos.utils.transform_utils import normalize_angle

if TYPE_CHECKING:
    from dimos.ar.adapters.base import RuntimeRegistrationProfile
    from dimos.ar.bridge.odom_buffer import OdomBuffer
    from dimos.ar.bridge.sender import BridgeSender

logger = setup_logger()

RUNTIME_CORRECTION_LOG_INTERVAL_S: float = 1.0
MOVING_ROBOT_DIAG_LOG_INTERVAL_S: float = 2.0
MIN_REPORTED_CORRECTION_TRANS_M: float = 0.05
MIN_REPORTED_CORRECTION_YAW_DEG: float = 1.0

RuntimeRegime = Literal["static", "cruise", "fast"]


class RegisteredPoseRefiner:
    """Refines registered alignment from runtime tag observations."""

    def __init__(
        self,
        *,
        robot_id: str,
        sender: BridgeSender,
        calibration: Calibration,
        odom: OdomBuffer,
        tag_tracker: RobotAprilTagTracker,
        runtime_profile: RuntimeRegistrationProfile,
        runtime_correction_enabled: bool,
    ) -> None:
        self._robot_id = robot_id
        self._sender = sender
        self._calibration = calibration
        self._odom = odom
        self._tag_tracker = tag_tracker
        self._runtime_profile = runtime_profile
        self._runtime_correction_enabled = runtime_correction_enabled
        self._T_committed: np.ndarray | None = None
        self._last_correction_log_mono: float = 0.0
        self._last_moving_diag_log_mono: float = 0.0

    @property
    def T_committed(self) -> np.ndarray | None:
        return self._T_committed

    def set_T_committed(self, T_world_odom: np.ndarray) -> None:
        self._T_committed = np.array(T_world_odom, dtype=np.float64, copy=True)

    def committed_or_current_for_frame(self) -> np.ndarray | None:
        if self._T_committed is not None:
            return np.array(self._T_committed, dtype=np.float64, copy=True)
        if not self._calibration.is_registered:
            return None
        current = self._calibration.current_transform()
        if current is None:
            return None
        return np.array(current, dtype=np.float64, copy=True)

    def apply_tracker_update(
        self,
        *,
        ts: float | None = None,
        resolved_odom: OdomSample | None = None,
    ) -> None:
        if not self._calibration.is_registered or not self._runtime_correction_enabled:
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
            self._calibration.register_world_odom(self._T_committed)
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
        from dimos.ar.registration.tracker import FrameResult

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

    def _commit_runtime_correction(
        self, T_world_odom: np.ndarray, *, ts: float | None = None
    ) -> None:
        self._T_committed = np.array(T_world_odom, dtype=np.float64, copy=True)
        self._calibration.register_world_odom(self._T_committed)
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
