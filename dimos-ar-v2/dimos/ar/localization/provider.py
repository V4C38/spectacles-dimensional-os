from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal, Protocol

from dimos.msgs.geometry_msgs.Pose import Pose

DistortionModel = Literal["none", "plumb_bob", "equidistant"]


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
    capture_ts: float


@dataclass(frozen=True)
class Localization:
    pose: Pose
    frame_id: str
    confidence: float


class AlignmentProvider(Protocol):
    def localize(self, observations: Sequence[Observation]) -> Localization | None: ...
