from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import Literal, Protocol

from dimos.msgs.geometry_msgs.Pose import Pose

DistortionModel = Literal["none", "plumb_bob", "equidistant"]


class CapturePolicy(StrEnum):
    ROBOT_LOS_REQUIRED = "robot_los_required"
    ROBOT_LOS_PREFERRED = "robot_los_preferred"
    ANY_ANGLE = "any_angle"


class LocalizationProviderType(StrEnum):
    FIDUCIAL_MARKER = "fiducial_marker"
    VPS = "vps"


@dataclass(frozen=True)
class Intrinsics:
    fx: float
    fy: float
    cx: float
    cy: float
    width: int
    height: int
    distortion_model: DistortionModel
    distortion: tuple[float, ...]


@dataclass(frozen=True)
class Observation:
    jpeg: bytes
    intrinsics: Intrinsics
    camera_pose: Pose
    ts_server: float


@dataclass(frozen=True)
class LocalizedPose:
    pose: Pose
    frame_id: str
    confidence: float


@dataclass(frozen=True)
class LocalizationResult:
    position: tuple[float, float, float]
    orientation: tuple[float, float, float, float]
    confidence: float
    ts_server: float


class Localizer(Protocol):
    def localize(self, observations: Sequence[Observation]) -> LocalizedPose | None: ...
