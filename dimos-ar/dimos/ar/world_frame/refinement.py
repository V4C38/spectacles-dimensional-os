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
from dimos.ar.world_frame.transforms import OdomSample, gravity_level_transform
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
MIN_REPORTED_CORRECTION_TRANS_M: float = 0.05
MIN_REPORTED_CORRECTION_YAW_DEG: float = 1.0

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

    @property
    def refinement_baseline(self) -> np.ndarray | None:
        return self._refinement_baseline

    def set_refinement_baseline(self, T_world_odom: np.ndarray) -> None:
        self._refinement_baseline = np.array(T_world_odom, dtype=np.float64, copy=True)

    def clear_refinement_baseline(self) -> None:
        """Reset refinement reference baseline without clearing live ``WorldFrameState``."""
        self._refinement_baseline = None

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
        ts: float | None = None,
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
            return

        T_reference = self._committed_or_current()
        if T_reference is None:
            return

        translation_window_obs = profile.runtime_translation_window_obs
        translation_window_s = profile.runtime_translation_window_s
        use_yaw = False
        if regime == "static":
            solve = self._tag_tracker.current_translation_solve(
                T_reference,
                max_observations=translation_window_obs,
                max_age_s=translation_window_s,
            )
        else:
            full = self._tag_tracker.current_solve(
                max_age_s=profile.runtime_cruise_window_s,
            )
            use_yaw = (
                full is not None
                and full.method == "apriltag_full"
                and full.baseline_m >= profile.runtime_yaw_min_baseline_m
                and full.straightness <= profile.runtime_yaw_straightness_max
            )
            if use_yaw:
                solve = full
            else:
                solve = self._tag_tracker.current_translation_solve(
                    T_reference,
                    max_observations=translation_window_obs,
                    max_age_s=translation_window_s,
                )
                use_yaw = False

        if solve is None:
            return

        T_target = np.array(solve.T_world_odom, dtype=np.float64, copy=True)
        if self._refinement_baseline is None:
            self._registry.apply_runtime_transform(T_target, update_refiner_baseline=True)
            return

        T_new = self._resolve_runtime_transform(T_target)

        trans_delta = float(np.linalg.norm(T_new[:3, 3] - self._refinement_baseline[:3, 3]))
        yaw_delta = abs(normalize_angle(_yaw_from_T(T_new) - _yaw_from_T(self._refinement_baseline)))
        yaw_delta_deg = math.degrees(yaw_delta)
        if (
            trans_delta >= MIN_REPORTED_CORRECTION_TRANS_M
            or yaw_delta_deg >= MIN_REPORTED_CORRECTION_YAW_DEG
        ):
            self._sender.send(
                encode_world_frame_correction(
                    ts=ts,
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
        self, T_world_odom: np.ndarray, *, ts: float | None = None
    ) -> None:
        self._registry.apply_runtime_transform(T_world_odom, update_refiner_baseline=True)
        odom = self._odom.latest()
        if odom is None:
            return
        self._telemetry.publish_pose_snapshot(
            ts=ts if ts is not None else time.time(),
            sample=odom,
            force=True,
        )
        if self._on_correction_committed is not None:
            self._on_correction_committed()
