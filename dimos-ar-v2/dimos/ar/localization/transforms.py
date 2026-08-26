from __future__ import annotations

import math
from typing import TYPE_CHECKING

import numpy as np

from dimos.msgs.geometry_msgs.Pose import Pose
from dimos.utils.transform_utils import (
    normalize_angle,
    pose_to_matrix,
)

if TYPE_CHECKING:
    from collections.abc import Sequence

    from numpy.typing import NDArray

_ODOM_UP = np.array([0.0, 0.0, 1.0], dtype=np.float64)


def yaw_from_transform(T: NDArray[np.float64]) -> float:
    rotation = np.asarray(T, dtype=np.float64)[:3, :3]
    return math.atan2(float(rotation[1, 0]), float(rotation[0, 0]))


def matrix_from_position_and_yaw(
    position: tuple[float, float, float],
    yaw: float,
) -> NDArray[np.float64]:
    half_yaw = yaw * 0.5
    orientation = (0.0, 0.0, math.sin(half_yaw), math.cos(half_yaw))
    return np.asarray(
        pose_to_matrix(Pose(list(position), list(orientation))),
        dtype=np.float64,
    )


def normalize_client_alignment(
    T: NDArray[np.float64],
    *,
    max_tilt_rad: float,
) -> NDArray[np.float64] | None:
    """Reject excessive tilt, then align client +Z with reference-frame +Z."""
    if max_tilt_rad < 0.0:
        raise ValueError(f"max_tilt_rad must be non-negative, got {max_tilt_rad}")

    transform = np.asarray(T, dtype=np.float64)
    if transform.shape != (4, 4):
        raise ValueError(f"client alignment must be a 4x4 matrix, got {transform.shape}")

    rotation = transform[:3, :3]
    up_axis = rotation[:, 2]
    up_norm = float(np.linalg.norm(up_axis))
    if up_norm < 1e-9:
        return None

    up_axis /= up_norm
    tilt_rad = math.acos(float(np.clip(np.dot(up_axis, _ODOM_UP), -1.0, 1.0)))
    if tilt_rad > max_tilt_rad:
        return None

    translation = transform[:3, 3]
    return matrix_from_position_and_yaw(
        (float(translation[0]), float(translation[1]), float(translation[2])),
        yaw_from_transform(transform),
    )


def fuse_pose_estimates(
    transforms: Sequence[NDArray[np.float64]],
    *,
    max_tilt_rad: float,
    max_position_residual_m: float,
    max_yaw_residual_rad: float,
) -> NDArray[np.float64] | None:
    if not transforms:
        return None

    normalized = [
        estimate
        for T in transforms
        if (estimate := normalize_client_alignment(T, max_tilt_rad=max_tilt_rad)) is not None
    ]
    if not normalized:
        return None

    positions = np.stack([T[:3, 3] for T in normalized], axis=0)
    yaws = np.array([yaw_from_transform(T) for T in normalized], dtype=np.float64)

    median_position = np.median(positions, axis=0)
    median_yaw = math.atan2(
        float(np.median(np.sin(yaws))),
        float(np.median(np.cos(yaws))),
    )

    keep = []
    for index, transform in enumerate(normalized):
        position = positions[index]
        position_residual = float(np.linalg.norm(position - median_position))
        yaw_residual = abs(normalize_angle(yaws[index] - median_yaw))
        if position_residual <= max_position_residual_m and yaw_residual <= max_yaw_residual_rad:
            keep.append(transform)

    if not keep:
        return None

    if len(keep) == 1:
        return keep[0]

    kept_positions = np.stack([T[:3, 3] for T in keep], axis=0)
    kept_yaws = np.array([yaw_from_transform(T) for T in keep], dtype=np.float64)
    fused_position = np.median(kept_positions, axis=0)
    fused_yaw = math.atan2(
        float(np.median(np.sin(kept_yaws))),
        float(np.median(np.cos(kept_yaws))),
    )
    return matrix_from_position_and_yaw(
        (float(fused_position[0]), float(fused_position[1]), float(fused_position[2])),
        fused_yaw,
    )
