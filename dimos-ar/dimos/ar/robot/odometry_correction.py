from __future__ import annotations

import math

import numpy as np
from numpy.typing import NDArray

from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.msgs.nav_msgs.Path import Path

# Empirical XY correction between native DimOS and the AR wire frame. The same
# fixed mapping applies to every world point, never a robot-relative packet shift.
# Native sensor ranges and planner geometry remain unmodified. This heuristic
# expands displayed horizontal distances; it is not a calibrated sensor model.


def correct_odom_xy(x: float, y: float, *, factor: float) -> tuple[float, float]:
    _require_positive_factor(factor)
    return factor * x, factor * y


def uncorrect_odom_xy(x: float, y: float, *, factor: float) -> tuple[float, float]:
    _require_positive_factor(factor)
    return x / factor, y / factor


def correct_odom_points(points: NDArray[np.floating], *, factor: float) -> NDArray[np.float32]:
    """Map native world XYZ into AR coordinates once, without mutating shared clouds."""
    _require_positive_factor(factor)
    corrected = np.array(points, dtype=np.float32, copy=True)
    if corrected.ndim != 2 or corrected.shape[1] != 3:
        raise ValueError("expected Nx3 world points")
    corrected[:, :2] *= factor
    return corrected


def correct_odom_pose(pose: PoseStamped, *, factor: float) -> PoseStamped:
    corrected_x, corrected_y = correct_odom_xy(pose.x, pose.y, factor=factor)
    return PoseStamped(
        ts=pose.ts,
        frame_id="odom",
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
        frame_id="odom",
        poses=[correct_odom_pose(pose, factor=factor) for pose in path.poses],
    )


def uncorrect_odom_pose(pose: PoseStamped, *, factor: float) -> PoseStamped:
    uncorrected_x, uncorrected_y = uncorrect_odom_xy(pose.x, pose.y, factor=factor)
    return PoseStamped(
        ts=pose.ts,
        frame_id="odom",
        position=[uncorrected_x, uncorrected_y, pose.z],
        orientation=[
            pose.orientation.x,
            pose.orientation.y,
            pose.orientation.z,
            pose.orientation.w,
        ],
    )


def _require_positive_factor(factor: float) -> None:
    if not math.isfinite(factor) or factor <= 0.0:
        raise ValueError(f"odometry correction factor must be positive, got {factor}")
