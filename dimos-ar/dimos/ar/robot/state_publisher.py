from __future__ import annotations

from collections.abc import Callable
import math
import time
from typing import TYPE_CHECKING, Protocol

from dimos.ar.robot.odometry_correction import correct_odom_points, correct_odom_pose
from dimos.ar.sensors.lidar_filter import (
    DEFAULT_TARGET_POINTS,
    LidarFilterSettings,
    prepare_lidar_points,
)
from dimos.ar.sensors.lidar_settings import LidarSettings
from dimos.ar.timing_diagnostics import TimingSummary
from dimos.ar.websocket.protocol import encode_lidar_binary, encode_pose
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.msgs.sensor_msgs.PointCloud2 import PointCloud2

if TYPE_CHECKING:
    from dimos.ar.websocket.server import WebSocketServer

DEFAULT_POSE_MAX_HZ = 15.0
DEFAULT_LIDAR_MAX_HZ = 2.0


class _BroadcastSink(Protocol):
    def schedule_broadcast_text(self, text: str) -> None: ...

    def schedule_broadcast_binary(self, data: bytes) -> None: ...


class RobotStatePublisher:
    """DimOS stream handlers → client-ready pose and LiDAR for all clients."""

    def __init__(
        self,
        ws_server: WebSocketServer | _BroadcastSink,
        *,
        odom_scale_correction_factor: float,
        robot_position: Callable[[], tuple[float, float, float] | None],
        pose_max_hz: float = DEFAULT_POSE_MAX_HZ,
        lidar_max_hz: float = DEFAULT_LIDAR_MAX_HZ,
        lidar_voxel_size_m: float = 0.05,
        lidar_target_points: int = DEFAULT_TARGET_POINTS,
    ) -> None:
        self._ws = ws_server
        self._odom_scale_correction_factor = odom_scale_correction_factor
        self._pose_max_hz = pose_max_hz
        self._lidar_max_hz = lidar_max_hz
        self._lidar_voxel_size_m = lidar_voxel_size_m
        self._lidar_target_points = lidar_target_points
        self._robot_position = robot_position
        self._pose_last_emit_mono = 0.0
        self._lidar_last_emit_mono = 0.0
        self._lidar_timing = TimingSummary("robot lidar processing timing")

    def publish_odom(self, msg: PoseStamped) -> None:
        if not self._allow_emit(self._pose_last_emit_mono, self._pose_max_hz):
            return
        corrected = correct_odom_pose(msg, factor=self._odom_scale_correction_factor)
        position = (corrected.x, corrected.y, corrected.z)
        orientation = (
            corrected.orientation.x,
            corrected.orientation.y,
            corrected.orientation.z,
            corrected.orientation.w,
        )
        if not _is_finite_pose(position, orientation):
            return
        self._pose_last_emit_mono = time.monotonic()
        self._ws.schedule_broadcast_text(
            encode_pose(
                position=position,
                orientation=orientation,
                ts=corrected.ts,
            )
        )

    def publish_lidar(self, msg: PointCloud2, *, lidar: LidarSettings) -> None:
        if not lidar.enabled:
            return
        if not self._allow_emit(self._lidar_last_emit_mono, self._lidar_max_hz):
            return
        robot_position = self._robot_position()
        if robot_position is None:
            return
        started = time.monotonic()
        source_age_ms = (time.time() - msg.ts) * 1000
        downsampled = msg.voxel_downsample(voxel_size=self._lidar_voxel_size_m)
        points = downsampled.points_f32()
        downsampled_count = len(points)
        downsampled_at = time.monotonic()
        settings = LidarFilterSettings.from_lidar_settings(
            lidar,
            target_points=self._lidar_target_points,
        )
        prepared = prepare_lidar_points(
            points,
            settings=settings,
            robot_position=robot_position,
        )
        # Filter/downsample using native sensor metres, then use the exact same
        # constant XY mapping as pose/path. Accumulated voxels stay stationary.
        corrected = correct_odom_points(prepared, factor=self._odom_scale_correction_factor)
        points = [tuple(point) for point in corrected]
        self._lidar_last_emit_mono = time.monotonic()
        self._ws.schedule_broadcast_binary(
            encode_lidar_binary(ts=msg.ts, points=points),
        )
        processing_ms = (time.monotonic() - started) * 1000
        self._lidar_timing.record(
            counts={"processed": 1, "slow_processing": int(processing_ms >= 100)},
            maxima={
                "processing_max_ms": processing_ms,
                "downsample_max_ms": (downsampled_at - started) * 1000,
                "source_age_max_ms": source_age_ms,
                "input_points_max": float(getattr(msg, "width", 0) * getattr(msg, "height", 0)),
                "downsampled_points_max": float(downsampled_count),
                "output_points_max": float(len(points)),
            },
        )

    def _allow_emit(self, last_emit_mono: float, max_hz: float) -> bool:
        if max_hz <= 0.0:
            return True
        interval_s = 1.0 / max_hz
        now = time.monotonic()
        return now - last_emit_mono >= interval_s


def _is_finite_pose(
    position: tuple[float, float, float],
    orientation: tuple[float, float, float, float],
) -> bool:
    return all(math.isfinite(value) for value in (*position, *orientation))
