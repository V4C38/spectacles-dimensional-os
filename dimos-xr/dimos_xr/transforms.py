"""Frame alignment: robot odom frame <-> AR world frame."""

from __future__ import annotations

import math
import threading
from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

WORLD_UP_AXIS_INDEX = 1
SEMANTIC_FORWARD_AXIS_INDEX = 0


def _normalize_quaternion(
    qx: float,
    qy: float,
    qz: float,
    qw: float,
) -> tuple[float, float, float, float]:
    norm = math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw)
    if norm < 1e-12:
        return 0.0, 0.0, 0.0, 1.0
    return qx / norm, qy / norm, qz / norm, qw / norm


def _quat_to_matrix(qx: float, qy: float, qz: float, qw: float) -> NDArray[np.float64]:
    """Quaternion [qx, qy, qz, qw] to 3x3 rotation matrix."""
    x, y, z, w = qx, qy, qz, qw
    return np.array(
        [
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
        ],
        dtype=np.float64,
    )


def pose_to_matrix(
    position: tuple[float, float, float],
    orientation: tuple[float, float, float, float],
) -> NDArray[np.float64]:
    """Build 4x4 homogeneous transform from position and quaternion [qx,qy,qz,qw]."""
    qx, qy, qz, qw = _normalize_quaternion(*orientation)
    T = np.eye(4, dtype=np.float64)
    T[:3, :3] = _quat_to_matrix(qx, qy, qz, qw)
    T[:3, 3] = position
    return T


def normalize_ground_pose(
    position: tuple[float, float, float],
    orientation: tuple[float, float, float, float],
) -> tuple[tuple[float, float, float], tuple[float, float, float, float]]:
    """Keep position but flatten rotation to yaw around the world-up Y axis.

    Calibration intentionally treats the tracked marker object's local ``+X`` axis as the
    semantic "forward" direction in AR world space. This matches the Lens-side yaw helpers
    and the navigation placement math, even though Lens Studio's camera-facing convention is
    often discussed in terms of ``-Z`` being visually forward.

    This function is only for the ground-robot calibration step. It does *not* mean the full
    world<-odom transform should be yaw-only after calibration; the solved transform may still
    encode the fixed basis change between DimOS robot frames and Lens world coordinates.
    """
    rotation = _quat_to_matrix(*_normalize_quaternion(*orientation))
    forward = rotation[:, SEMANTIC_FORWARD_AXIS_INDEX]
    planar = np.array([forward[0], 0.0, forward[2]], dtype=np.float64)
    norm = float(np.linalg.norm(planar))
    if norm < 1e-6:
        return position, (0.0, 0.0, 0.0, 1.0)

    planar /= norm
    yaw = math.atan2(float(-planar[2]), float(planar[0]))
    half_yaw = yaw * 0.5
    return position, (0.0, math.sin(half_yaw), 0.0, math.cos(half_yaw))


def gravity_level_transform(T: NDArray[np.float64]) -> NDArray[np.float64]:
    """Gravity-level a 4x4 transform so its local +Z axis maps exactly to world +Y.
    
    Forces the AR floor to be perfectly planar by aligning the odom frame's up-axis
    with the world up-axis, while preserving yaw (heading) and translation.
    
    Args:
        T: 4x4 homogeneous transform (e.g. T_world_odom)
    
    Returns:
        Flattened 4x4 transform with the same translation and yaw, but pitch/roll removed.
    """
    R = T[:3, :3]
    translation = T[:3, 3]
    
    # Current world-space image of odom +Z axis
    up_world = R[:, 2]
    up_world_norm = float(np.linalg.norm(up_world))
    if up_world_norm < 1e-9:
        # Degenerate rotation, return identity rotation
        T_flat = np.eye(4, dtype=np.float64)
        T_flat[:3, 3] = translation
        return T_flat
    
    up_world = up_world / up_world_norm
    target_up = np.array([0.0, 1.0, 0.0], dtype=np.float64)
    
    # Compute minimal rotation axis and angle from up_world to target_up
    cross = np.cross(up_world, target_up)
    dot = float(np.dot(up_world, target_up))
    
    # If already aligned, no correction needed
    if dot > 0.9999:
        T_flat = T.copy()
        return T_flat
    
    # If perfectly opposed (dot ~ -1), pick an arbitrary perpendicular axis
    if dot < -0.9999:
        # Find a perpendicular axis to up_world
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
    
    # Rodrigues rotation formula for axis-angle to matrix
    K = np.array([
        [0, -axis[2], axis[1]],
        [axis[2], 0, -axis[0]],
        [-axis[1], axis[0], 0]
    ], dtype=np.float64)
    R_align = np.eye(3, dtype=np.float64) + math.sin(angle) * K + (1 - math.cos(angle)) * (K @ K)
    
    # Apply alignment rotation and re-orthonormalize
    R_flat = R_align @ R
    
    # Gram-Schmidt orthonormalization to clean up numerical errors
    x_axis = R_flat[:, 0]
    y_axis = R_flat[:, 1]
    z_axis = R_flat[:, 2]
    
    # Force z to be exactly (0, 1, 0)
    z_axis = target_up
    
    # Make x perpendicular to z (project out z component)
    x_axis = x_axis - np.dot(x_axis, z_axis) * z_axis
    x_norm = np.linalg.norm(x_axis)
    if x_norm < 1e-9:
        # Degenerate, pick arbitrary x in XZ plane
        x_axis = np.array([1.0, 0.0, 0.0], dtype=np.float64)
    else:
        x_axis = x_axis / x_norm
    
    # y = z cross x (right-handed)
    y_axis = np.cross(z_axis, x_axis)
    
    R_flat = np.column_stack([x_axis, y_axis, z_axis])
    
    T_flat = np.eye(4, dtype=np.float64)
    T_flat[:3, :3] = R_flat
    T_flat[:3, 3] = translation
    return T_flat


def matrix_to_pose(
    T: NDArray[np.float64],
) -> tuple[tuple[float, float, float], tuple[float, float, float, float]]:
    """Extract position and quaternion [qx,qy,qz,qw] from 4x4 matrix."""
    R = T[:3, :3]
    pos = (float(T[0, 3]), float(T[1, 3]), float(T[2, 3]))
    trace = float(np.trace(R))
    if trace > 0:
        s = 0.5 / np.sqrt(trace + 1.0)
        qw = 0.25 / s
        qx = (R[2, 1] - R[1, 2]) * s
        qy = (R[0, 2] - R[2, 0]) * s
        qz = (R[1, 0] - R[0, 1]) * s
    elif R[0, 0] > R[1, 1] and R[0, 0] > R[2, 2]:
        s = 2.0 * np.sqrt(1.0 + R[0, 0] - R[1, 1] - R[2, 2])
        qw = (R[2, 1] - R[1, 2]) / s
        qx = 0.25 * s
        qy = (R[0, 1] + R[1, 0]) / s
        qz = (R[0, 2] + R[2, 0]) / s
    elif R[1, 1] > R[2, 2]:
        s = 2.0 * np.sqrt(1.0 + R[1, 1] - R[0, 0] - R[2, 2])
        qw = (R[0, 2] - R[2, 0]) / s
        qx = (R[0, 1] + R[1, 0]) / s
        qy = 0.25 * s
        qz = (R[1, 2] + R[2, 1]) / s
    else:
        s = 2.0 * np.sqrt(1.0 + R[2, 2] - R[0, 0] - R[1, 1])
        qw = (R[1, 0] - R[0, 1]) / s
        qx = (R[0, 2] + R[2, 0]) / s
        qy = (R[1, 2] + R[2, 1]) / s
        qz = 0.25 * s
    quat = _normalize_quaternion(float(qx), float(qy), float(qz), float(qw))
    return pos, quat


@dataclass
class OdomSample:
    position: tuple[float, float, float]
    orientation: tuple[float, float, float, float]


class Calibration:
    """Holds T_world_odom mapping points from odom frame to AR world frame.

    Before calibration: identity (odom coordinates pass through as world).
    After calibration: T_world_odom maps robot odom into XR world coordinates.

    Assumption: the AprilTag marker is rigidly attached at the robot base, co-located
    with the odom pose frame. If the marker is offset from the base, calibration
    will be wrong until marker-to-base offsets are applied (see DimOS MarkerTfModule).
    This remains marker-agnostic at the transform layer; marker identity lives in the
    higher-level alignment protocol.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._T_world_odom = np.eye(4, dtype=np.float64)
        self._registered = False

    @property
    def is_registered(self) -> bool:
        with self._lock:
            return self._registered

    def current_transform(self) -> NDArray[np.float64] | None:
        with self._lock:
            if not self._registered:
                return None
            return np.array(self._T_world_odom, dtype=np.float64, copy=True)

    def register_marker_pose(
        self,
        marker_position: tuple[float, float, float],
        marker_orientation: tuple[float, float, float, float],
        odom: OdomSample,
    ) -> None:
        T_world_marker = pose_to_matrix(marker_position, marker_orientation)
        T_odom_robot = pose_to_matrix(odom.position, odom.orientation)
        T_world_odom = T_world_marker @ np.linalg.inv(T_odom_robot)
        self.register_from_alignment(T_world_odom)

    def register_from_alignment(self, T_world_odom: NDArray[np.float64]) -> None:
        """Apply a precomputed world<-odom transform from AprilTag dual detection.
        
        Gravity-levels the transform to ensure the AR floor is perfectly planar by forcing
        the odom +Z axis to map exactly to world +Y axis, while preserving yaw and translation.
        """
        T_flat = gravity_level_transform(T_world_odom)
        with self._lock:
            self._T_world_odom = T_flat.astype(np.float64)
            self._registered = True

    def _get_T(self) -> NDArray[np.float64]:
        with self._lock:
            return self._T_world_odom.copy()

    def _get_T_inv(self) -> NDArray[np.float64]:
        with self._lock:
            return np.linalg.inv(self._T_world_odom).astype(np.float64)

    def transform_points(self, points: NDArray[np.floating]) -> NDArray[np.float32]:
        if points.size == 0:
            return np.zeros((0, 3), dtype=np.float32)
        T = self._get_T()
        pts = np.asarray(points, dtype=np.float64)
        ones = np.ones((len(pts), 1), dtype=np.float64)
        hom = np.hstack([pts, ones])
        out = (T @ hom.T).T[:, :3]
        return out.astype(np.float32)

    def transform_pose(
        self,
        position: tuple[float, float, float],
        orientation: tuple[float, float, float, float],
    ) -> tuple[tuple[float, float, float], tuple[float, float, float, float]]:
        T_odom = pose_to_matrix(position, orientation)
        T_world = self._get_T() @ T_odom
        return matrix_to_pose(T_world)

    def inverse_transform_point(
        self,
        position: tuple[float, float, float],
    ) -> tuple[float, float, float]:
        """Map a point from AR world frame to robot odom frame."""
        T_inv = self._get_T_inv()
        hom = np.array([position[0], position[1], position[2], 1.0], dtype=np.float64)
        out = T_inv @ hom
        return float(out[0]), float(out[1]), float(out[2])

    def inverse_transform_pose(
        self,
        position: tuple[float, float, float],
        orientation: tuple[float, float, float, float],
    ) -> tuple[tuple[float, float, float], tuple[float, float, float, float]]:
        """Map a pose from AR world frame to robot odom frame."""
        T_world = pose_to_matrix(position, orientation)
        T_odom = self._get_T_inv() @ T_world
        return matrix_to_pose(T_odom)
