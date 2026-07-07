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
from dimos.utils.logging_config import setup_logger

if TYPE_CHECKING:
    from numpy.typing import NDArray

logger = setup_logger()

ODOM_SCALE_MIN: float = 0.80
ODOM_SCALE_MAX: float = 1.25
ODOM_SCALE_INITIAL: float = 1.15
_ODOM_SCALE_CHANGE_EPS: float = 1e-6

WorldFrameMethod = Literal["april_tag", "manual_pose"] | None

OnChangeCallback = Callable[[], None]


class WorldFrameState:
    """Committed world←odom transform — single source of truth for coordinate conversion.

    Holds ``T_world_odom``, which maps robot odom-frame coordinates into the AR
    world frame. Outbound LiDAR, pose, and path payloads read through this object.

    Before commit: identity (odom coordinates pass through unchanged).
    After commit: ``T_world_odom`` is gravity-levelled; runtime refinement updates
    the transform via ``apply_transform`` without changing method/approximate flags.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._T_world_odom = np.eye(4, dtype=np.float64)
        self._odom_scale: float = 1.0
        self._odom_anchor_xy: tuple[float, float] = (0.0, 0.0)
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

    @property
    def odom_scale(self) -> float:
        with self._lock:
            return self._odom_scale

    @property
    def odom_anchor_xy(self) -> tuple[float, float]:
        with self._lock:
            return self._odom_anchor_xy

    def set_odom_anchor_xy(self, x: float, y: float) -> None:
        """Store registration odom x/y anchor for anchored planar scale."""
        with self._lock:
            self._odom_anchor_xy = (float(x), float(y))

    def set_odom_scale(self, value: float) -> bool:
        """Clamp and store planar odom x/y scale; fire ``on_change`` when it changes."""
        clamped = float(np.clip(value, ODOM_SCALE_MIN, ODOM_SCALE_MAX))
        on_change: OnChangeCallback | None
        changed = False
        with self._lock:
            if abs(clamped - value) > _ODOM_SCALE_CHANGE_EPS:
                logger.warning(
                    "odom_scale clamped",
                    requested=round(value, 4),
                    applied=round(clamped, 4),
                    min=ODOM_SCALE_MIN,
                    max=ODOM_SCALE_MAX,
                )
            if abs(clamped - self._odom_scale) > _ODOM_SCALE_CHANGE_EPS:
                self._odom_scale = clamped
                changed = True
                on_change = self._on_change
            else:
                on_change = None
        if on_change is not None:
            on_change()
        return changed

    @staticmethod
    def scale_odom_xy(
        x: float,
        y: float,
        *,
        odom_scale: float,
        odom_anchor_xy: tuple[float, float],
    ) -> tuple[float, float]:
        ax, ay = odom_anchor_xy
        return ax + odom_scale * (x - ax), ay + odom_scale * (y - ay)

    @staticmethod
    def unscale_odom_xy(
        x: float,
        y: float,
        *,
        odom_scale: float,
        odom_anchor_xy: tuple[float, float],
    ) -> tuple[float, float]:
        if abs(odom_scale) < _ODOM_SCALE_CHANGE_EPS:
            return x, y
        ax, ay = odom_anchor_xy
        return ax + (x - ax) / odom_scale, ay + (y - ay) / odom_scale

    @staticmethod
    def scale_odom_xyz_batch(
        pts: NDArray[np.float64],
        *,
        odom_scale: float,
        odom_anchor_xy: tuple[float, float],
    ) -> NDArray[np.float64]:
        out = pts.copy()
        ax, ay = odom_anchor_xy
        out[..., 0] = ax + odom_scale * (out[..., 0] - ax)
        out[..., 1] = ay + odom_scale * (out[..., 1] - ay)
        return out

    def scale_odom_point(self, x: float, y: float) -> tuple[float, float]:
        return self.scale_odom_xy(
            x,
            y,
            odom_scale=self.odom_scale,
            odom_anchor_xy=self.odom_anchor_xy,
        )

    def unscale_odom_point(self, x: float, y: float) -> tuple[float, float]:
        return self.unscale_odom_xy(
            x,
            y,
            odom_scale=self.odom_scale,
            odom_anchor_xy=self.odom_anchor_xy,
        )

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
            self._odom_scale = ODOM_SCALE_INITIAL
            self._odom_anchor_xy = (0.0, 0.0)
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
            self._odom_scale = 1.0
            self._odom_anchor_xy = (0.0, 0.0)
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
        xy_scale = self.odom_scale
        anchor_xy = self.odom_anchor_xy
        T = self._get_T()
        pts = np.asarray(points, dtype=np.float64)
        pts = self.scale_odom_xyz_batch(
            pts,
            odom_scale=xy_scale,
            odom_anchor_xy=anchor_xy,
        )
        ones = np.ones((len(pts), 1), dtype=np.float64)
        hom = np.hstack([pts, ones])
        out = (T @ hom.T).T[:, :3]
        return out.astype(np.float32)

    def transform_pose(
        self,
        position: tuple[float, float, float],
        orientation: tuple[float, float, float, float],
    ) -> tuple[tuple[float, float, float], tuple[float, float, float, float]]:
        scaled_x, scaled_y = self.scale_odom_point(position[0], position[1])
        scaled_position = (scaled_x, scaled_y, position[2])
        T_odom = pose_to_matrix(scaled_position, orientation)
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
        """Apply the rotation block of ``T_world_odom`` to a free vector.

        Odom scale is intentionally not applied: this rotates a direction (e.g.
        velocity heading). Scaling a direction would be wrong; position paths
        already apply scale via ``transform_pose``.
        """
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
        odom_x, odom_y = self.unscale_odom_point(float(out[0]), float(out[1]))
        return odom_x, odom_y, float(out[2])

    def inverse_transform_pose(
        self,
        position: tuple[float, float, float],
        orientation: tuple[float, float, float, float],
    ) -> tuple[tuple[float, float, float], tuple[float, float, float, float]]:
        T_world = pose_to_matrix(position, orientation)
        T_odom = self._get_T_inv() @ T_world
        odom_position, odom_orientation = matrix_to_pose(T_odom)
        odom_x, odom_y = self.unscale_odom_point(
            odom_position[0],
            odom_position[1],
        )
        return (
            (odom_x, odom_y, odom_position[2]),
            odom_orientation,
        )
