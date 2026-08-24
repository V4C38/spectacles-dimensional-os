from __future__ import annotations

from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.msgs.nav_msgs.Path import Path

# Go2 leg odometry under-reports horizontal travel; this file applies a fixed
# multiplier to raw odom X/Y at the protocol boundary (pose/nav_goal out, nav_goal_request in).
# Z, orientation, and LiDAR stay uncorrected — slip is ground-plane only.


def correct_odom_xy(x: float, y: float, *, factor: float) -> tuple[float, float]:
    _require_positive_factor(factor)
    return factor * x, factor * y


def uncorrect_odom_xy(x: float, y: float, *, factor: float) -> tuple[float, float]:
    _require_positive_factor(factor)
    return x / factor, y / factor


def correct_odom_pose(pose: PoseStamped, *, factor: float) -> PoseStamped:
    corrected_x, corrected_y = correct_odom_xy(pose.x, pose.y, factor=factor)
    return PoseStamped(
        ts=pose.ts,
        frame_id=pose.frame_id,
        position=[corrected_x, corrected_y, pose.z],
        orientation=[
            pose.orientation.x,
            pose.orientation.y,
            pose.orientation.z,
            pose.orientation.w,
        ],
    )


def correct_odom_path(path: Path, *, factor: float) -> Path:
    return Path(
        ts=path.ts,
        frame_id=path.frame_id,
        poses=[correct_odom_pose(pose, factor=factor) for pose in path.poses],
    )


def uncorrect_odom_pose(pose: PoseStamped, *, factor: float) -> PoseStamped:
    uncorrected_x, uncorrected_y = uncorrect_odom_xy(pose.x, pose.y, factor=factor)
    return PoseStamped(
        ts=pose.ts,
        frame_id=pose.frame_id,
        position=[uncorrected_x, uncorrected_y, pose.z],
        orientation=[
            pose.orientation.x,
            pose.orientation.y,
            pose.orientation.z,
            pose.orientation.w,
        ],
    )


def _require_positive_factor(factor: float) -> None:
    if factor <= 0.0:
        raise ValueError(f"odometry correction factor must be positive, got {factor}")
