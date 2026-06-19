"""Outbound data-plane encoding helpers for the XR bridge.

These are pure functions — no module state, no side effects — that transform
inbound DimOS stream messages into XR WebSocket payloads. The bridge module
delegates to these helpers from its ``handle_xr_*`` stream methods.
"""

from __future__ import annotations

import time
from typing import TYPE_CHECKING

import numpy as np

from dimos_xr.network.protocol import (
    encode_lidar,
    encode_lidar_binary,
    encode_path,
    encode_path_preview,
    encode_pose,
)
from dimos_xr.tracking.filters import (
    LidarFilter,
    LidarObstacleDistanceConfig,
    filter_obstacle_points,
    subsample_points_near_robot,
)

if TYPE_CHECKING:
    from collections.abc import Callable

    from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
    from dimos.msgs.nav_msgs.Path import Path
    from dimos.msgs.sensor_msgs.PointCloud2 import PointCloud2

    from dimos_xr.tracking.transforms import Calibration, OdomSample

LIDAR_PAYLOAD_LOG_INTERVAL_S: float = 60.0
DROPPED_POSE_LOG_INTERVAL_S: float = 5.0


def build_lidar_payload(
    msg: PointCloud2,
    *,
    calibration: Calibration,
    lidar_filter: LidarFilter,
    mode: str,
    obstacle_distance_config: LidarObstacleDistanceConfig | None,
    robot_world_pos: tuple[float, float, float] | None,
    target_points: int,
    voxel_size: float,
    robot_id: str,
    lidar_binary: bool = True,
) -> tuple[str | bytes, int] | None:
    """Filter, transform, and encode a PointCloud2 into an XR LiDAR payload.

    Returns ``(payload, point_count)`` on success, or ``None`` if the lidar
    rate-limiter drops this frame. When ``lidar_binary=True`` (default), the
    payload is a compact binary frame (Float16, ~6 bytes/point); otherwise a
    JSON text string is returned.
    """
    if not lidar_filter.config.allow():
        return None
    downsampled = msg.voxel_downsample(voxel_size=voxel_size)
    points = downsampled.points_f32()
    world_pts = np.zeros((0, 3), dtype=np.float32)
    if points.size != 0:
        filtered = lidar_filter.filter(points)
        if len(filtered) != 0:
            world_pts = calibration.transform_points(filtered)
            if mode == "obstacles" and obstacle_distance_config is not None:
                world_pts = filter_obstacle_points(
                    world_pts,
                    obstacle_distance_config,
                    robot_position=robot_world_pos,
                    vertical_axis=1,
                    min_height_m=lidar_filter.config.min_height_m,
                    max_height_m=lidar_filter.config.max_height_m,
                )
            world_pts = subsample_points_near_robot(
                world_pts, robot_world_pos, target_points=target_points
            )
    if lidar_binary:
        payload: str | bytes = encode_lidar_binary(ts=msg.ts, points=world_pts)
    else:
        payload = encode_lidar(ts=msg.ts, points=world_pts, robot_id=robot_id)
    return payload, len(world_pts)


def build_pose_payload(
    msg: PoseStamped,
    *,
    calibration: Calibration,
    sample_odom: Callable[[PoseStamped], OdomSample],
    robot_id: str,
    speed_mps: float | None = None,
) -> tuple[str, tuple[float, float, float], tuple[float, float, float, float]] | None:
    """Transform odom pose into world frame and encode as an XR pose payload.

    Returns ``(payload_str, world_pos, world_quat)`` on success, or ``None`` if the
    transformed components are non-finite.
    """
    sample = sample_odom(msg)
    pos, quat = calibration.transform_pose(sample.position, sample.orientation)
    if not all(
        np.isfinite(v) for v in (pos[0], pos[1], pos[2], quat[0], quat[1], quat[2], quat[3])
    ):
        return None
    payload = encode_pose(
        ts=msg.ts,
        position=pos,
        orientation=quat,
        robot_id=robot_id,
        speed_mps=speed_mps,
    )
    return payload, pos, quat


def build_path_payload(
    msg: Path,
    *,
    calibration: Calibration,
    robot_id: str,
) -> tuple[str, list[tuple[float, float, float]]]:
    """Transform path waypoints into world frame and encode as an XR path payload."""
    waypoints: list[tuple[float, float, float]] = []
    for pose in msg.poses:
        world_pos, _ = calibration.transform_pose(
            (pose.x, pose.y, pose.z),
            (pose.orientation.x, pose.orientation.y, pose.orientation.z, pose.orientation.w),
        )
        waypoints.append(world_pos)
    payload = encode_path(ts=msg.ts, waypoints=waypoints, robot_id=robot_id)
    return payload, waypoints


def build_empty_path_payload(*, robot_id: str, ts: float | None = None) -> str:
    """Encode an empty path payload (used to clear the client path display)."""
    return encode_path(ts=ts if ts is not None else time.time(), waypoints=[], robot_id=robot_id)


def build_preview_path_payload(
    *,
    ts: float,
    target_world: tuple[float, float, float],
    waypoints: list[tuple[float, float, float]],
    robot_id: str,
) -> str:
    """Encode a preview path payload."""
    return encode_path_preview(ts=ts, waypoints=waypoints, robot_id=robot_id, target=target_world)


def normalize_nav_state(raw: str) -> str:
    """Normalise a raw DimOS navigation state string to one of idle/following_path/recovery."""
    state = raw.strip().lower()
    if state in {"idle", "following_path", "recovery"}:
        return state
    if "recover" in state:
        return "recovery"
    if any(token in state for token in ("follow", "path", "navig")):
        return "following_path"
    if state in {"arrived", "stopped"}:
        return "idle"
    if any(token in state for token in ("rotat", "initial", "final", "align", "execut", "move")):
        return "following_path"
    return "idle"
