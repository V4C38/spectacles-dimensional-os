"""Frame alignment: robot odom frame <-> AR world frame.

OdomSample and TBuffer incompatibility note:
The bridge correlates ``camera_frame`` reception time (``time.monotonic()``) with
the robot odometry pose at that instant. DimOS ``TBuffer.get(time_point,
time_tolerance)`` uses wall-clock timestamps (``Transform.ts``), while the bridge
needs monotonic-clock lookup for accurate latency compensation. TBuffer is
therefore not a drop-in replacement here; OdomSample bookkeeping is retained.
"""

from __future__ import annotations

from dataclasses import dataclass
import math
import threading
import time
from typing import TYPE_CHECKING

import numpy as np

from dimos.msgs.geometry_msgs.Pose import Pose
from dimos.msgs.geometry_msgs.Quaternion import Quaternion
from dimos.msgs.geometry_msgs.Vector3 import Vector3
from dimos.utils.logging_config import setup_logger
from dimos.utils.transform_utils import (
    matrix_to_pose as _dimos_matrix_to_pose,
    normalize_angle,
    pose_to_matrix as _dimos_pose_to_matrix,
)

logger = setup_logger()

# Rate-limit the gravity_level_transform tilt warning to once per 30 s.
# Tilt angles of 23–69° are observed when the headset is held at an angle while
# scanning — this is expected during registration setup.  The warning is retained (not
# silenced) because a tilt that large on a flat-floor robot indicates a
# genuinely malformed registration input; we just don't flood the log.
_GRAVITY_WARN_INTERVAL_S: float = 30.0
_gravity_warn_last_mono: float = 0.0
_gravity_warn_lock = threading.Lock()
_gravity_warn_diagnostic_emitted: bool = False

if TYPE_CHECKING:
    from numpy.typing import NDArray

__all__ = [
    "SEMANTIC_FORWARD_AXIS_INDEX",
    "WORLD_UP_AXIS_INDEX",
    "OdomSample",
    "gravity_level_transform",
    "matrix_to_pose",
    "normalize_angle",
    "normalize_ground_pose",
    "pose_to_matrix",
    "up_axis_angle_deg",
]

WORLD_UP_AXIS_INDEX = 1
SEMANTIC_FORWARD_AXIS_INDEX = 0


def pose_to_matrix(
    position: tuple[float, float, float],
    orientation: tuple[float, float, float, float],
) -> NDArray[np.float64]:
    """Build 4x4 homogeneous transform from position and quaternion [qx, qy, qz, qw].

    Delegates to ``dimos.utils.transform_utils.pose_to_matrix``; provides the
    tuple-based calling convention used throughout the XR bridge.
    """
    qx, qy, qz, qw = orientation
    return _dimos_pose_to_matrix(  # type: ignore[no-any-return]
        Pose(Vector3(*position), Quaternion(qx, qy, qz, qw))
    )


def matrix_to_pose(
    T: NDArray[np.float64],
) -> tuple[tuple[float, float, float], tuple[float, float, float, float]]:
    """Extract position and quaternion [qx, qy, qz, qw] from a 4x4 matrix.

    Delegates to ``dimos.utils.transform_utils.matrix_to_pose``; returns tuples
    used throughout the XR bridge wire-encoding layer.
    """
    p = _dimos_matrix_to_pose(T)
    return (
        (float(p.position.x), float(p.position.y), float(p.position.z)),
        (
            float(p.orientation.x),
            float(p.orientation.y),
            float(p.orientation.z),
            float(p.orientation.w),
        ),
    )


def normalize_ground_pose(
    position: tuple[float, float, float],
    orientation: tuple[float, float, float, float],
) -> tuple[tuple[float, float, float], tuple[float, float, float, float]]:
    """Keep position but flatten rotation to yaw around the world-up Y axis.

    XR-specific: registration setup intentionally treats the tracked marker object's
    local +X axis as the semantic "forward" direction in AR world space. This
    matches the Lens-side yaw helpers and navigation placement math.

    Only for the ground-robot registration step; does not imply the full
    world←odom transform should be yaw-only after world-frame commit.
    """
    T = pose_to_matrix(position, orientation)
    rotation = T[:3, :3]
    forward = rotation[:, SEMANTIC_FORWARD_AXIS_INDEX]
    planar = np.array([forward[0], 0.0, forward[2]], dtype=np.float64)
    norm = float(np.linalg.norm(planar))
    if norm < 1e-6:
        return position, (0.0, 0.0, 0.0, 1.0)
    planar /= norm
    yaw = math.atan2(float(-planar[2]), float(planar[0]))
    half_yaw = yaw * 0.5
    return position, (0.0, math.sin(half_yaw), 0.0, math.cos(half_yaw))


def up_axis_angle_deg(T: NDArray[np.float64]) -> float:
    """Return the angle between the transform's local +Z axis and world +Y."""
    R = T[:3, :3]
    up_world = R[:, 2]
    up_norm = float(np.linalg.norm(up_world))
    if up_norm < 1e-9:
        return 90.0
    up_world = up_world / up_norm
    target_up = np.array([0.0, 1.0, 0.0], dtype=np.float64)
    dot = float(np.clip(np.dot(up_world, target_up), -1.0, 1.0))
    return math.degrees(math.acos(dot))


def gravity_level_transform(T: NDArray[np.float64]) -> NDArray[np.float64]:
    """Gravity-level a 4x4 transform so its local +Z axis maps exactly to world +Y.

    XR-specific: forces the AR floor to be perfectly planar by aligning the
    odom frame's up-axis with the world up-axis while preserving yaw and
    translation. DimOS has no equivalent for this AR coordinate convention.
    """
    R = T[:3, :3]
    translation = T[:3, 3]

    up_world = R[:, 2]
    up_world_norm = float(np.linalg.norm(up_world))
    if up_world_norm < 1e-9:
        T_flat = np.eye(4, dtype=np.float64)
        T_flat[:3, 3] = translation
        return T_flat

    up_world = up_world / up_world_norm
    target_up = np.array([0.0, 1.0, 0.0], dtype=np.float64)

    cross = np.cross(up_world, target_up)
    dot = float(np.dot(up_world, target_up))

    if dot > 0.9999:
        return T.copy()

    if dot < -0.9999:
        if abs(up_world[0]) < 0.9:
            perp = np.array([1.0, 0.0, 0.0], dtype=np.float64)
        else:
            perp = np.array([0.0, 1.0, 0.0], dtype=np.float64)
        axis = np.cross(up_world, perp)
        axis /= np.linalg.norm(axis)
        angle = math.pi
    else:
        axis = cross / np.linalg.norm(cross)
        angle = math.acos(np.clip(dot, -1.0, 1.0))

    if angle > math.radians(15.0):
        global _gravity_warn_diagnostic_emitted, _gravity_warn_last_mono
        now = time.monotonic()
        with _gravity_warn_lock:
            if not _gravity_warn_diagnostic_emitted:
                _gravity_warn_diagnostic_emitted = True
                logger.warning(
                    "gravity_level_transform diagnostic: translation=%s up_world=%s input_rotation=%s",
                    np.array2string(translation, precision=3),
                    np.array2string(up_world, precision=3),
                    np.array2string(R, precision=3),
                )
            if now - _gravity_warn_last_mono >= _GRAVITY_WARN_INTERVAL_S:
                _gravity_warn_last_mono = now
                logger.warning(
                    "gravity_level_transform: input up-axis far from world-up "
                    "(angle=%.1f deg) — registration input likely malformed; "
                    "this warning is rate-limited to once per %.0f s",
                    math.degrees(angle),
                    _GRAVITY_WARN_INTERVAL_S,
                )

    K = np.array(
        [
            [0, -axis[2], axis[1]],
            [axis[2], 0, -axis[0]],
            [-axis[1], axis[0], 0],
        ],
        dtype=np.float64,
    )
    R_align = np.eye(3, dtype=np.float64) + math.sin(angle) * K + (1 - math.cos(angle)) * (K @ K)
    R_flat = R_align @ R

    x_axis = R_flat[:, 0]
    z_axis = target_up
    x_axis = x_axis - np.dot(x_axis, z_axis) * z_axis
    x_norm = np.linalg.norm(x_axis)
    if x_norm < 1e-9:
        x_axis = np.array([1.0, 0.0, 0.0], dtype=np.float64)
    else:
        x_axis = x_axis / x_norm
    y_axis = np.cross(z_axis, x_axis)

    T_flat = np.eye(4, dtype=np.float64)
    T_flat[:3, :3] = np.column_stack([x_axis, y_axis, z_axis])
    T_flat[:3, 3] = translation
    return T_flat


@dataclass
class OdomSample:
    """Timestamped odometry snapshot.

    ``source_ts`` is the robot production timestamp (``PoseStamped.ts`` /
    ``Odometry.ts``). Frame pairing uses ``source_ts`` via ``OdomBuffer``
    source-key lookup after Lens clock sync maps capture time to the bridge clock.

    Monotonic receive time is stored separately on the buffer keys for legacy
    speed estimation (``speed_windowed``).
    """

    position: tuple[float, float, float]
    orientation: tuple[float, float, float, float]
    source_ts: float | None = None
    measured_speed_mps: float | None = None
