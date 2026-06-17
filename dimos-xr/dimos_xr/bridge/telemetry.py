"""TelemetryPublisher — LiDAR and robot-pose outbound stream handlers.

Owns the LidarFilter, pose-rate state, and lidar/pose logging throttles.
Called from XRBridge.handle_xr_lidar / handle_xr_odom after odom and stream
freshness state have been updated.
"""

from __future__ import annotations

import time
from typing import TYPE_CHECKING

from dimos.utils.logging_config import setup_logger

from dimos_xr.network.data_plane import (
    DROPPED_POSE_LOG_INTERVAL_S,
    LIDAR_PAYLOAD_LOG_INTERVAL_S,
    build_lidar_payload,
    build_pose_payload,
)

if TYPE_CHECKING:
    from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
    from dimos.msgs.sensor_msgs.PointCloud2 import PointCloud2

    from dimos_xr.bridge.odom_buffer import OdomBuffer
    from dimos_xr.bridge.sender import BridgeSender
    from dimos_xr.tracking.filters import LidarFilter
    from dimos_xr.tracking.transforms import Calibration

from dimos_xr.tracking.filters import LidarObstacleDistanceConfig

logger = setup_logger()


class TelemetryPublisher:
    """Transforms inbound DimOS stream messages into XR WebSocket LiDAR/pose payloads."""

    def __init__(
        self,
        *,
        robot_id: str,
        sender: BridgeSender,
        calibration: Calibration,
        odom: OdomBuffer,
        lidar_filter: LidarFilter,
        target_points: int,
        obstacle_target_points: int,
        lidar_voxel_size_m: float,
        pose_max_hz: float,
        lidar_binary: bool = True,
    ) -> None:
        self._robot_id = robot_id
        self._sender = sender
        self._calibration = calibration
        self._odom = odom
        self._lidar_filter = lidar_filter
        self._full_target_points = target_points
        self._obstacle_target_points = obstacle_target_points
        self._lidar_voxel_size_m = lidar_voxel_size_m
        self._pose_max_hz = pose_max_hz
        self._lidar_binary = lidar_binary
        self._pose_last_emit: float = 0.0
        self._dropped_pose_count: int = 0
        self._last_dropped_pose_log_mono: float = 0.0
        self._logged_lidar_stream_active: bool = False
        self._last_lidar_payload_log_mono: float = 0.0
        self._lidar_mode: str = "full"
        self._obstacle_distance_config = LidarObstacleDistanceConfig()

    def publish_lidar(self, msg: PointCloud2) -> None:
        if not self._calibration.is_registered:
            return
        if self._lidar_mode == "off":
            return
        result = build_lidar_payload(
            msg,
            calibration=self._calibration,
            lidar_filter=self._lidar_filter,
            mode=self._lidar_mode,
            obstacle_distance_config=(
                self._obstacle_distance_config
                if self._lidar_mode == "obstacles"
                else None
            ),
            robot_world_pos=self._odom.latest_world_position(self._calibration),
            target_points=self._target_points_for_mode(),
            voxel_size=self._lidar_voxel_size_m,
            robot_id=self._robot_id,
            lidar_binary=self._lidar_binary,
        )
        if result is None:
            return
        payload, point_count = result
        if not self._logged_lidar_stream_active:
            self._logged_lidar_stream_active = True
            logger.info(
                "LiDAR stream active",
                hz=self._lidar_filter.config.max_hz,
                binary=self._lidar_binary,
            )
        self._maybe_log_lidar_payload(point_count, len(payload))
        if isinstance(payload, bytes):
            self._sender.send_binary(payload)
        else:
            self._sender.send(payload)

    def set_lidar_mode(
        self,
        *,
        mode: str,
        obstacle_min_distance_m: float,
        obstacle_opaque_distance_m: float,
        obstacle_max_distance_m: float,
    ) -> None:
        self._lidar_mode = mode
        self._obstacle_distance_config = LidarObstacleDistanceConfig(
            min_distance_m=obstacle_min_distance_m,
            opaque_distance_m=obstacle_opaque_distance_m,
            max_distance_m=obstacle_max_distance_m,
        )
        logger.info(
            "LiDAR mode updated",
            mode=mode,
            obstacle_min_distance_m=obstacle_min_distance_m,
            obstacle_opaque_distance_m=obstacle_opaque_distance_m,
            obstacle_max_distance_m=obstacle_max_distance_m,
        )

    def reset_lidar_mode(self) -> None:
        self.set_lidar_mode(
            mode="full",
            obstacle_min_distance_m=0.10,
            obstacle_opaque_distance_m=0.40,
            obstacle_max_distance_m=0.60,
        )

    def publish_pose(self, msg: PoseStamped) -> None:
        if not self._calibration.is_registered:
            return
        now = time.monotonic()
        pose_interval = 1.0 / self._pose_max_hz if self._pose_max_hz > 0 else 0.0
        if pose_interval > 0 and now - self._pose_last_emit < pose_interval:
            return
        self._pose_last_emit = now
        result = build_pose_payload(
            msg,
            calibration=self._calibration,
            sample_odom=self._odom.sample,
            robot_id=self._robot_id,
        )
        if result is None:
            self._dropped_pose_count += 1
            now = time.monotonic()
            if now - self._last_dropped_pose_log_mono >= DROPPED_POSE_LOG_INTERVAL_S:
                self._last_dropped_pose_log_mono = now
                logger.warning(
                    "XR pose dropped (non-finite after transform)",
                    drops=self._dropped_pose_count,
                )
            return
        pose_payload, _pos, _quat = result
        self._sender.send(pose_payload)

    def _target_points_for_mode(self) -> int:
        if self._lidar_mode == "obstacles":
            return self._obstacle_target_points
        return self._full_target_points

    def _maybe_log_lidar_payload(self, point_count: int, payload_bytes: int) -> None:
        now = time.monotonic()
        if now - self._last_lidar_payload_log_mono < LIDAR_PAYLOAD_LOG_INTERVAL_S:
            return
        self._last_lidar_payload_log_mono = now
        logger.debug(
            "LiDAR payload",
            points=point_count,
            bytes=payload_bytes,
            hz=self._lidar_filter.config.max_hz,
        )
