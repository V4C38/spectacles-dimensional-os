"""WorldFrameState — committed world←odom transform and coordinate conversion."""

from __future__ import annotations

from collections.abc import Callable
import threading
from typing import TYPE_CHECKING, Literal

import numpy as np

from dimos.ar.world_frame.transforms import (
    gravity_level_transform,
    matrix_to_pose,
    pose_to_matrix,
)

if TYPE_CHECKING:
    from numpy.typing import NDArray

WorldFrameMethod = Literal["april_odom_baseline", "manual_pose"] | None

OnChangeCallback = Callable[[], None]


class WorldFrameState:
    """Committed world←odom transform — single source of truth for coordinate conversion.

    Holds ``T_world_odom``, which maps robot odom-frame coordinates into the XR
    world frame. Outbound LiDAR, pose, and path payloads read through this object.

    Before commit: identity (odom coordinates pass through unchanged).
    After commit: ``T_world_odom`` is gravity-levelled; runtime refinement updates
    the transform via ``apply_transform`` without changing method/approximate flags.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._T_world_odom = np.eye(4, dtype=np.float64)
        self._committed = False
        self._method: WorldFrameMethod = None
        self._approximate = False
        self._on_change: OnChangeCallback | None = None

    @property
    def is_committed(self) -> bool:
        with self._lock:
            return self._committed

    @property
    def method(self) -> WorldFrameMethod:
        with self._lock:
            return self._method

    @property
    def approximate(self) -> bool:
        with self._lock:
            return self._approximate

    def set_on_change(self, callback: OnChangeCallback | None) -> None:
        with self._lock:
            self._on_change = callback

    def commit(
        self,
        T_world_odom: NDArray[np.float64],
        *,
        method: WorldFrameMethod,
        approximate: bool,
    ) -> None:
        """Apply a precomputed world←odom transform from the alignment pipeline.

        Gravity-levels the transform to ensure the AR floor is perfectly planar.
        """
        T_flat = gravity_level_transform(T_world_odom)
        on_change: OnChangeCallback | None
        with self._lock:
            self._T_world_odom = T_flat.astype(np.float64)
            self._committed = True
            self._method = method
            self._approximate = approximate
            on_change = self._on_change
        if on_change is not None:
            on_change()

    def apply_transform(self, T_world_odom: NDArray[np.float64]) -> None:
        """Update ``T_world_odom`` without changing method or approximate flags.

        Used for runtime pose refinement after the initial commit.
        """
        T_flat = gravity_level_transform(T_world_odom)
        with self._lock:
            self._T_world_odom = T_flat.astype(np.float64)
            self._committed = True

    def clear(self) -> None:
        """Reset to pre-commit identity transform."""
        on_change: OnChangeCallback | None
        with self._lock:
            self._T_world_odom = np.eye(4, dtype=np.float64)
            self._committed = False
            self._method = None
            self._approximate = False
            on_change = self._on_change
        if on_change is not None:
            on_change()

    def current_transform(self) -> NDArray[np.float64] | None:
        with self._lock:
            if not self._committed:
                return None
            return np.array(self._T_world_odom, dtype=np.float64, copy=True)

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
        if not np.all(np.isfinite(T_world)):
            _nan3: tuple[float, float, float] = (float("nan"), float("nan"), float("nan"))
            _nan4: tuple[float, float, float, float] = (
                float("nan"),
                float("nan"),
                float("nan"),
                float("nan"),
            )
            return _nan3, _nan4
        return matrix_to_pose(T_world)

    def rotate_vector(
        self,
        vector: tuple[float, float, float],
    ) -> tuple[float, float, float]:
        """Apply the rotation block of ``T_world_odom`` to a free vector."""
        T = self._get_T()
        v = np.asarray(vector, dtype=np.float64)
        out = T[:3, :3] @ v
        return float(out[0]), float(out[1]), float(out[2])

    def inverse_transform_point(
        self,
        position: tuple[float, float, float],
    ) -> tuple[float, float, float]:
        T_inv = self._get_T_inv()
        hom = np.array([position[0], position[1], position[2], 1.0], dtype=np.float64)
        out = T_inv @ hom
        return float(out[0]), float(out[1]), float(out[2])

    def inverse_transform_pose(
        self,
        position: tuple[float, float, float],
        orientation: tuple[float, float, float, float],
    ) -> tuple[tuple[float, float, float], tuple[float, float, float, float]]:
        T_world = pose_to_matrix(position, orientation)
        T_odom = self._get_T_inv() @ T_world
        return matrix_to_pose(T_odom)
