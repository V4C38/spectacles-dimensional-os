"""Immutable accepted shared/native/odometry relationships; all transforms are metric SE(3)."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from dimos.msgs.geometry_msgs.Pose import Pose
from dimos.utils.transform_utils import matrix_to_pose, pose_to_matrix

Matrix = NDArray[np.float64]


def frozen_matrix(value: Matrix) -> Matrix:
    result = np.array(value, dtype=np.float64, copy=True)
    if result.shape != (4, 4) or not np.isfinite(result).all():
        raise ValueError("frame transform must be a finite 4x4 matrix")
    rotation = result[:3, :3]
    if (
        not np.allclose(result[3], [0, 0, 0, 1])
        or not np.allclose(rotation.T @ rotation, np.eye(3), atol=1e-6)
        or not np.isclose(np.linalg.det(rotation), 1, atol=1e-6)
    ):
        raise ValueError("frame transform must be rigid")
    result.setflags(write=False)
    return result


@dataclass(frozen=True)
class FrameSnapshot:
    shared_frame_id: str
    odom_reference_id: str
    revision: int
    T_map_odom: Matrix
    T_map_native: Matrix
    T_native_odom: Matrix | None = None
    native_map_id: str | None = None
    ts: float = 0.0
    confidence: float = 1.0

    def __post_init__(self) -> None:
        for name in ("T_map_odom", "T_map_native", "T_native_odom"):
            value = getattr(self, name)
            if value is not None:
                object.__setattr__(self, name, frozen_matrix(value))

    @property
    def T_odom_map(self) -> Matrix:
        return frozen_matrix(np.asarray(np.linalg.inv(self.T_map_odom), dtype=np.float64))

    @classmethod
    def identity(cls, odom_reference_id: str = "odom") -> FrameSnapshot:
        return cls.initial(odom_reference_id)

    @classmethod
    def initial(cls, odom_reference_id: str) -> FrameSnapshot:
        return cls(
            f"session:{odom_reference_id}",
            odom_reference_id,
            0,
            frozen_matrix(np.eye(4)),
            frozen_matrix(np.eye(4)),
        )


def transform_point(matrix: Matrix, position: Sequence[float]) -> tuple[float, float, float]:
    point = matrix[:3, :3] @ np.asarray(position, dtype=np.float64) + matrix[:3, 3]
    return float(point[0]), float(point[1]), float(point[2])


def transform_direction(matrix: Matrix, direction: Sequence[float]) -> tuple[float, float, float]:
    vector = matrix[:3, :3] @ np.asarray(direction, dtype=np.float64)
    return float(vector[0]), float(vector[1]), float(vector[2])


def transform_pose(
    matrix: Matrix, position: Sequence[float], orientation: Sequence[float]
) -> tuple[tuple[float, float, float], tuple[float, float, float, float]]:
    pose = matrix_to_pose(matrix @ pose_to_matrix(Pose(list(position), list(orientation))))
    return (
        (float(pose.x), float(pose.y), float(pose.z)),
        (
            float(pose.orientation.x),
            float(pose.orientation.y),
            float(pose.orientation.z),
            float(pose.orientation.w),
        ),
    )
