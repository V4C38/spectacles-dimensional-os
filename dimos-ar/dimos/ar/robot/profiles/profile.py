from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
import math
from typing import TYPE_CHECKING

import numpy as np

from dimos.ar.robot.capabilities import CapabilityName
from dimos.msgs.geometry_msgs.Pose import Pose
from dimos.utils.transform_utils import pose_to_matrix

if TYPE_CHECKING:
    from numpy.typing import NDArray


class RobotName(StrEnum):
    UNITREE_GO2 = "unitree_go2"


@dataclass(frozen=True)
class RobotDescription:
    display_name: str
    body_bounds_m: tuple[float, float, float]
    footprint_m: tuple[float, float]
    base_height_m: float


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
    odom_scale_correction_factor: float
    fiducial_dictionary: str | None
    fiducial_marker_mounts: tuple[FiducialMarkerMount, ...]
    T_base_camera_optical: NDArray[np.float64] | None
    supported_capabilities: frozenset[CapabilityName]

    def __post_init__(self) -> None:
        if not self.display_name.strip():
            raise ValueError("display_name must be non-empty")
        _require_positive_tuple("body_bounds_m", self.body_bounds_m)
        _require_positive_tuple("footprint_m", self.footprint_m)
        if not math.isfinite(self.base_height_m) or self.base_height_m < 0.0:
            raise ValueError(
                f"base_height_m must be finite and non-negative, got {self.base_height_m}"
            )
        if (
            not math.isfinite(self.odom_scale_correction_factor)
            or self.odom_scale_correction_factor <= 0.0
        ):
            raise ValueError(
                "odom_scale_correction_factor must be finite and positive, "
                f"got {self.odom_scale_correction_factor}"
            )
        if self.fiducial_marker_mounts and not self.fiducial_dictionary:
            raise ValueError("fiducial_dictionary is required when fiducial_marker_mounts is set")
        if self.fiducial_dictionary and not self.fiducial_marker_mounts:
            raise ValueError("fiducial_marker_mounts is required when fiducial_dictionary is set")
        marker_ids = [mount.marker_id for mount in self.fiducial_marker_mounts]
        if len(marker_ids) != len(set(marker_ids)):
            raise ValueError("fiducial_marker_mounts must have unique marker IDs")
        if CapabilityName.LOCALIZATION in self.supported_capabilities:
            raise ValueError(
                "localization is derived from configured providers, not the robot profile"
            )
        if (
            CapabilityName.NAVIGATION in self.supported_capabilities
            and CapabilityName.ESTOP not in self.supported_capabilities
        ):
            raise ValueError("navigation requires estop")
        if self.T_base_camera_optical is not None:
            object.__setattr__(
                self,
                "T_base_camera_optical",
                _immutable_rigid_transform(self.T_base_camera_optical),
            )

    @property
    def description(self) -> RobotDescription:
        return RobotDescription(
            display_name=self.display_name,
            body_bounds_m=self.body_bounds_m,
            footprint_m=self.footprint_m,
            base_height_m=self.base_height_m,
        )


def get_profile(name: RobotName) -> RobotProfile:
    if name is RobotName.UNITREE_GO2:
        from dimos.ar.robot.profiles.unitree_go2 import UNITREE_GO2_PROFILE

        return UNITREE_GO2_PROFILE
    raise ValueError(f"unknown robot {name!r}")


def _require_positive_tuple(name: str, values: tuple[float, ...]) -> None:
    if not all(math.isfinite(value) and value > 0.0 for value in values):
        raise ValueError(f"{name} must contain finite positive values, got {values}")


def _immutable_rigid_transform(matrix: NDArray[np.float64]) -> NDArray[np.float64]:
    transform = np.array(matrix, dtype=np.float64, copy=True)
    if transform.shape != (4, 4):
        raise ValueError(f"T_base_camera_optical must be 4x4, got shape {transform.shape}")
    if not np.isfinite(transform).all():
        raise ValueError("T_base_camera_optical must contain finite values")
    if not np.allclose(transform[3], (0.0, 0.0, 0.0, 1.0)):
        raise ValueError("T_base_camera_optical must be a homogeneous rigid transform")
    rotation = transform[:3, :3]
    if not np.allclose(rotation @ rotation.T, np.eye(3), atol=1e-5):
        raise ValueError("T_base_camera_optical rotation must be orthonormal")
    if not math.isclose(abs(float(np.linalg.det(rotation))), 1.0, abs_tol=1e-5):
        raise ValueError("T_base_camera_optical rotation determinant must have absolute value 1")
    transform.setflags(write=False)
    return transform
