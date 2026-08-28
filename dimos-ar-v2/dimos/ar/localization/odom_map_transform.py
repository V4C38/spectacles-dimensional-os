from __future__ import annotations

from dataclasses import dataclass
import math
import threading
from typing import TYPE_CHECKING, Literal

import numpy as np

from dimos.ar.localization.types import LocalizedPose
from dimos.msgs.geometry_msgs.Transform import Transform
from dimos.utils.transform_utils import matrix_to_pose, pose_to_matrix

if TYPE_CHECKING:
    from numpy.typing import NDArray

OdomMapTransformSource = Literal["vps", "relocalization"]
_ODOM_PARENT_FRAMES = frozenset({"odom", "world"})


@dataclass(frozen=True)
class OdomMapTransformConfig:
    min_vps_confidence: float = 0.5

    def __post_init__(self) -> None:
        if not math.isfinite(self.min_vps_confidence) or not 0.0 <= self.min_vps_confidence <= 1.0:
            raise ValueError(
                "min_vps_confidence must be finite and within [0, 1], "
                f"got {self.min_vps_confidence}"
            )


@dataclass(frozen=True)
class OdomMapTransformSample:
    T_odom_map: NDArray[np.float64]
    ts_server: float
    confidence: float
    source: OdomMapTransformSource
    travel_m: float | None = None
    map_code: str | None = None


class OdomMapTransform:
    def __init__(self, *, config: OdomMapTransformConfig | None = None) -> None:
        self._config = config or OdomMapTransformConfig()
        self._lock = threading.Lock()
        self._sample: OdomMapTransformSample | None = None

    def current(self) -> OdomMapTransformSample | None:
        with self._lock:
            return self._sample

    def T_odom_map(self) -> NDArray[np.float64] | None:
        sample = self.current()
        if sample is None:
            return None
        return sample.T_odom_map.copy()

    def update_from_vps(
        self,
        localization: LocalizedPose,
        *,
        ts_server: float,
        travel_m: float,
        map_code: str | None = None,
    ) -> bool:
        if localization.frame_id != "map":
            raise ValueError(
                f"VPS T_odom_map update expects frame_id='map', got {localization.frame_id!r}"
            )
        if localization.confidence < self._config.min_vps_confidence:
            return False

        T_map_odom = np.asarray(pose_to_matrix(localization.pose), dtype=np.float64)
        if not np.isfinite(T_map_odom).all():
            return False
        T_odom_map = np.asarray(np.linalg.inv(T_map_odom), dtype=np.float64)
        if not np.isfinite(T_odom_map).all():
            return False

        sample = OdomMapTransformSample(
            T_odom_map=T_odom_map,
            ts_server=ts_server,
            confidence=localization.confidence,
            source="vps",
            travel_m=travel_m,
            map_code=map_code,
        )
        with self._lock:
            self._sample = sample
        return True

    def update_from_relocalization(self, transform: Transform) -> bool:
        if transform.child_frame_id != "map":
            return False
        if transform.frame_id not in _ODOM_PARENT_FRAMES:
            return False

        T_odom_map = np.asarray(transform.to_matrix(), dtype=np.float64)
        if not np.isfinite(T_odom_map).all():
            return False

        sample = OdomMapTransformSample(
            T_odom_map=T_odom_map,
            ts_server=float(transform.ts),
            confidence=1.0,
            source="relocalization",
        )
        with self._lock:
            self._sample = sample
        return True

    def is_vps_reusable(self, *, current_travel_m: float, max_travel_m: float = 1.0) -> bool:
        sample = self.current()
        if sample is None or sample.source != "vps" or sample.travel_m is None:
            return False
        return current_travel_m - sample.travel_m <= max_travel_m

    def localization_in_odom(self, localization: LocalizedPose) -> LocalizedPose | None:
        if localization.frame_id == "odom":
            return localization
        if localization.frame_id != "map":
            raise ValueError(f"unsupported localization frame_id {localization.frame_id!r}")

        sample = self.current()
        if sample is None or sample.source != "vps":
            return None

        T_map_client = np.asarray(pose_to_matrix(localization.pose), dtype=np.float64)
        T_odom_client = compose_odom_from_map(sample.T_odom_map, T_map_client)
        if not np.isfinite(T_odom_client).all():
            return None
        return LocalizedPose(
            pose=matrix_to_pose(T_odom_client),
            frame_id="odom",
            confidence=localization.confidence,
        )


def compose_odom_from_map(
    T_odom_map: NDArray[np.float64],
    T_map_client: NDArray[np.float64],
) -> NDArray[np.float64]:
    return T_odom_map @ T_map_client
