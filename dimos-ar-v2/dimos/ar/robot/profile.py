from __future__ import annotations

from dataclasses import dataclass
import math
from typing import TYPE_CHECKING

import numpy as np

from dimos.msgs.geometry_msgs.Pose import Pose
from dimos.utils.transform_utils import pose_to_matrix

if TYPE_CHECKING:
    from numpy.typing import NDArray


@dataclass(frozen=True)
class FiducialMarkerMount:
    marker_id: int
    size_m: float
    position: tuple[float, float, float]
    orientation: tuple[float, float, float, float]

    def __post_init__(self) -> None:
        if self.marker_id < 0:
            raise ValueError(f"marker_id must be non-negative, got {self.marker_id}")
        if not math.isfinite(self.size_m) or self.size_m <= 0.0:
            raise ValueError(f"size_m must be finite and positive, got {self.size_m}")
        if not all(math.isfinite(value) for value in self.position):
            raise ValueError(f"position must contain finite values, got {self.position}")
        if not all(math.isfinite(value) for value in self.orientation):
            raise ValueError(f"orientation must contain finite values, got {self.orientation}")

        norm = math.sqrt(sum(value * value for value in self.orientation))
        if not math.isclose(norm, 1.0, rel_tol=1e-6, abs_tol=1e-6):
            raise ValueError(f"orientation must be a unit quaternion, got norm {norm}")

    @property
    def T_base_marker(self) -> NDArray[np.float64]:
        return np.asarray(
            pose_to_matrix(Pose(*self.position, *self.orientation)),
            dtype=np.float64,
        )


@dataclass(frozen=True)
class RobotProfile:
    display_name: str
    body_bounds_m: tuple[float, float, float]
    footprint_m: tuple[float, float]
    base_height_m: float
    odom_correction_factor: float
