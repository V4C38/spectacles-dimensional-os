"""TelemetryPublisher — LiDAR and robot-pose outbound stream handlers."""

from __future__ import annotations

import time
from typing import TYPE_CHECKING

from dimos.ar.network.data_plane import (
    DROPPED_POSE_LOG_INTERVAL_S,
    LIDAR_PAYLOAD_LOG_INTERVAL_S,
    build_lidar_payload,
    build_pose_payload,
    build_pose_payload_from_sample,
)
from dimos.ar.network.protocol import SetLidarModeMessage
from dimos.utils.logging_config import setup_logger

if TYPE_CHECKING:
    from dimos.ar.bridge.odom_buffer import OdomBuffer
    from dimos.ar.bridge.sender import BridgeSender
    from dimos.ar.lidar.filters import LidarFilter, LidarObstacleDistanceConfig
    from dimos.ar.world_frame.state import WorldFrameState
    from dimos.ar.world_frame.transforms import OdomSample
    from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
    from dimos.msgs.sensor_msgs.PointCloud2 import PointCloud2

from dimos.ar.lidar.filters import LidarObstacleDistanceConfig

logger = setup_logger()

ODOM_EGRESS_AGE_LOG_INTERVAL_S = 5.0


class TelemetryPublisher:
    """Transforms inbound DimOS stream messages into XR WebSocket LiDAR/pose payloads."""

    def __init__(
        self,
        *,
        robot_id: str,
        sender: BridgeSender,
        world_frame: WorldFrameState,
        odom: OdomBuffer,
        lidar_filter: LidarFilter,
        target_points: int,
        obstacle_target_points: int,
        lidar_voxel_size_m: float,
        pose_max_hz: float,
        speed_horizon_s: float = 0.4,
    ) -> None:
        self._robot_id = robot_id
        self._sender = sender
        self._world_frame = world_frame
        self._odom = odom
        self._lidar_filter = lidar_filter
        self._full_target_points = target_points
        self._obstacle_target_points = obstacle_target_points
        self._lidar_voxel_size_m = lidar_voxel_size_m
        self._pose_max_hz = pose_max_hz
        self._speed_horizon_s = speed_horizon_s
        self._pose_last_emit: float = 0.0
        self._dropped_pose_count: int = 0
        self._last_dropped_pose_log_mono: float = 0.0
        self._logged_lidar_stream_active: bool = False
        self._last_lidar_payload_log_mono: float = 0.0
        self._last_odom_egress_age_log_mono: float = 0.0
        self._odom_egress_age_max_s: float = 0.0
        self._lidar_mode: str = "off"
        self._logged_lidar_config_key: str | None = None
        self._obstacle_distance_config = LidarObstacleDistanceConfig()

    def publish_lidar(self, msg: PointCloud2) -> None:
        if not self._world_frame.is_committed:
            return
        if self._lidar_mode == "off":
            return
        result = build_lidar_payload(
            msg,
            world_frame=self._world_frame,
            lidar_filter=self._lidar_filter,
            mode=self._lidar_mode,
            obstacle_distance_config=(
                self._obstacle_distance_config
                if self._lidar_mode == "obstacles"
                else None
            ),
            robot_world_pos=self._odom.latest_world_position(self._world_frame),
            target_points=self._target_points_for_mode(),
            voxel_size=self._lidar_voxel_size_m,
        )
        if result is None:
            return
        payload, point_count = result
        if not self._logged_lidar_stream_active:
            self._logged_lidar_stream_active = True
            logger.info(
                "LiDAR stream active",
                hz=self._lidar_filter.config.max_hz,
            )
        self._maybe_log_lidar_payload(point_count, len(payload))
        self._sender.send_binary(payload)

    def apply_set_lidar_mode(self, msg: SetLidarModeMessage) -> None:
        defaults = LidarObstacleDistanceConfig()
        self.set_lidar_mode(
            mode=msg.mode,
            obstacle_min_distance_m=(
                msg.obstacle_min_distance_m
                if msg.obstacle_min_distance_m is not None
                else defaults.min_distance_m
            ),
            obstacle_opaque_distance_m=(
                msg.obstacle_opaque_distance_m
                if msg.obstacle_opaque_distance_m is not None
                else defaults.opaque_distance_m
            ),
            obstacle_max_distance_m=(
                msg.obstacle_max_distance_m
                if msg.obstacle_max_distance_m is not None
                else defaults.max_distance_m
            ),
        )

    def set_lidar_mode(
        self,
        *,
        mode: str,
        obstacle_min_distance_m: float,
        obstacle_opaque_distance_m: float,
        obstacle_max_distance_m: float,
    ) -> None:
        config_key = (
            f"{mode}|{obstacle_min_distance_m}|{obstacle_opaque_distance_m}|"
            f"{obstacle_max_distance_m}"
        )
        self._lidar_mode = mode
        self._obstacle_distance_config = LidarObstacleDistanceConfig(
            min_distance_m=obstacle_min_distance_m,
            opaque_distance_m=obstacle_opaque_distance_m,
            max_distance_m=obstacle_max_distance_m,
        )
        if config_key == self._logged_lidar_config_key:
            return
        self._logged_lidar_config_key = config_key
        logger.info(
            "LiDAR mode updated",
            mode=mode,
            obstacle_min_distance_m=obstacle_min_distance_m,
            obstacle_opaque_distance_m=obstacle_opaque_distance_m,
            obstacle_max_distance_m=obstacle_max_distance_m,
        )

    def reset_lidar_mode(self) -> None:
        defaults = LidarObstacleDistanceConfig()
        self.set_lidar_mode(
            mode="off",
            obstacle_min_distance_m=defaults.min_distance_m,
            obstacle_opaque_distance_m=defaults.opaque_distance_m,
            obstacle_max_distance_m=defaults.max_distance_m,
        )

    def publish_pose(self, msg: PoseStamped) -> None:
        if not self._world_frame.is_committed:
            return
        now = time.monotonic()
        pose_interval = 1.0 / self._pose_max_hz if self._pose_max_hz > 0 else 0.0
        if pose_interval > 0 and now - self._pose_last_emit < pose_interval:
            return
        self._pose_last_emit = now
        self._maybe_log_odom_egress_age(msg)
        speed_mps = self._odom.speed_windowed(now, self._speed_horizon_s)
        result = build_pose_payload(
            msg,
            world_frame=self._world_frame,
            sample_odom=self._odom.sample,
            speed_mps=speed_mps,
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

    def publish_pose_snapshot(
        self,
        *,
        ts: float,
        sample: OdomSample,
        force: bool = True,
    ) -> bool:
        """Emit world-frame pose from a cached odom sample (e.g. after runtime correction)."""
        if not self._world_frame.is_committed:
            return False
        now = time.monotonic()
        pose_interval = 1.0 / self._pose_max_hz if self._pose_max_hz > 0 else 0.0
        if not force and pose_interval > 0 and now - self._pose_last_emit < pose_interval:
            return False
        speed_mps = self._odom.speed_windowed(now, self._speed_horizon_s)
        result = build_pose_payload_from_sample(
            sample,
            ts=ts,
            world_frame=self._world_frame,
            speed_mps=speed_mps,
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
            return False
        pose_payload, _pos, _quat = result
        self._sender.send(pose_payload)
        self._pose_last_emit = time.monotonic()
        return True

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

    def _maybe_log_odom_egress_age(self, msg: PoseStamped) -> None:
        age_s = max(0.0, time.time() - float(msg.ts))
        self._odom_egress_age_max_s = max(self._odom_egress_age_max_s, age_s)
        now = time.monotonic()
        if now - self._last_odom_egress_age_log_mono < ODOM_EGRESS_AGE_LOG_INTERVAL_S:
            return
        self._last_odom_egress_age_log_mono = now
        logger.info(
            "odom egress age",
            age_s=round(age_s, 3),
            age_max_s=round(self._odom_egress_age_max_s, 3),
            pose_hz_cap=self._pose_max_hz,
        )
        self._odom_egress_age_max_s = 0.0
