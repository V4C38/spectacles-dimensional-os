from __future__ import annotations

from dataclasses import dataclass
import math
import threading
import time
from typing import TYPE_CHECKING

import numpy as np

from dimos.ar.localization.types import LocalizedPose
from dimos.msgs.geometry_msgs.Transform import Transform
from dimos.utils.transform_utils import matrix_to_pose, pose_to_matrix

if TYPE_CHECKING:
    from numpy.typing import NDArray


@dataclass(frozen=True)
class OdomMapTransformConfig:
    min_vps_confidence: float = 0.5
    max_age_s: float = 60.0

    def __post_init__(self) -> None:
        if not math.isfinite(self.max_age_s) or self.max_age_s <= 0:
            raise ValueError("max_age_s must be finite and positive")
        if not math.isfinite(self.min_vps_confidence) or not 0.0 <= self.min_vps_confidence <= 1.0:
            raise ValueError(
                "min_vps_confidence must be finite and within [0, 1], "
                f"got {self.min_vps_confidence}"
            )


@dataclass(frozen=True)
class OdomMapTransformSample:
    T_odom_map: NDArray[np.float64]
    ts_server: float
    confidence: float | None = None
    travel_m: float | None = None
    map_code: str | None = None
    source_generation: int = 0


class OdomMapTransform:
    def __init__(self, *, config: OdomMapTransformConfig | None = None) -> None:
        self._config = config or OdomMapTransformConfig()
        self._lock = threading.Lock()
        self._vps_sample: OdomMapTransformSample | None = None
        self._relocalization_sample: OdomMapTransformSample | None = None

    def vps_sample(self) -> OdomMapTransformSample | None:
        with self._lock:
            return self._vps_sample

    @property
    def max_age_s(self) -> float:
        return self._config.max_age_s

    def clear(self) -> None:
        with self._lock:
            self._vps_sample = None
            self._relocalization_sample = None

    def relocalization_sample(self) -> OdomMapTransformSample | None:
        with self._lock:
            return self._relocalization_sample

    def update_from_vps(
        self,
        localization: LocalizedPose,
        *,
        ts_server: float,
        travel_m: float,
        map_code: str | None = None,
        source_generation: int = 0,
    ) -> bool:
        if localization.frame_id != "map":
            raise ValueError(
                f"VPS T_odom_map update expects frame_id='map', got {localization.frame_id!r}"
            )
        if (
            not all(math.isfinite(v) for v in (localization.confidence, ts_server, travel_m))
            or not self._config.min_vps_confidence <= localization.confidence <= 1.0
            or travel_m < 0
        ):
            return False

        T_map_odom = np.asarray(pose_to_matrix(localization.pose), dtype=np.float64)
        if not np.isfinite(T_map_odom).all():
            return False
        T_odom_map = np.asarray(np.linalg.inv(T_map_odom), dtype=np.float64)
        if not np.isfinite(T_odom_map).all():
            return False
        T_odom_map.setflags(write=False)

        sample = OdomMapTransformSample(
            T_odom_map=T_odom_map,
            ts_server=ts_server,
            confidence=localization.confidence,
            travel_m=travel_m,
            map_code=map_code,
            source_generation=source_generation,
        )
        with self._lock:
            self._vps_sample = sample
        return True

    def update_from_relocalization(self, transform: Transform, *, ts_server: float) -> bool:
        if transform.child_frame_id != "map":
            return False
        if transform.frame_id != "odom":
            return False

        T_odom_map = np.asarray(transform.to_matrix(), dtype=np.float64)
        if not np.isfinite(T_odom_map).all():
            return False

        sample = OdomMapTransformSample(
            T_odom_map=T_odom_map,
            ts_server=ts_server,
            confidence=None,
        )
        with self._lock:
            self._relocalization_sample = sample
        return True

    def is_vps_reusable(
        self,
        *,
        current_travel_m: float,
        max_travel_m: float = 1.0,
        now_server: float | None = None,
        source_generation: int = 0,
        map_code: str | None = None,
    ) -> bool:
        return self.is_sample_reusable(
            self.vps_sample(),
            current_travel_m=current_travel_m,
            max_travel_m=max_travel_m,
            now_server=now_server,
            source_generation=source_generation,
            map_code=map_code,
        )

    def is_sample_reusable(
        self,
        sample: OdomMapTransformSample | None,
        *,
        current_travel_m: float,
        max_travel_m: float = 1.0,
        now_server: float | None = None,
        source_generation: int = 0,
        map_code: str | None = None,
    ) -> bool:
        if sample is None or sample.travel_m is None:
            return False
        now = time.time() if now_server is None else now_server
        return (
            math.isfinite(now)
            and math.isfinite(current_travel_m)
            and 0 <= current_travel_m - sample.travel_m <= max_travel_m
            and -0.25 <= now - sample.ts_server <= self._config.max_age_s
            and sample.source_generation == source_generation
            and sample.map_code == map_code
        )

    def localization_in_odom(
        self, localization: LocalizedPose, *, sample: OdomMapTransformSample | None = None
    ) -> LocalizedPose | None:
        if localization.frame_id == "odom":
            return localization
        if localization.frame_id != "map":
            raise ValueError(f"unsupported localization frame_id {localization.frame_id!r}")

        sample = sample or self.vps_sample()
        if sample is None:
            return None

        T_map_client = np.asarray(pose_to_matrix(localization.pose), dtype=np.float64)
        T_odom_client = compose_odom_from_map(sample.T_odom_map, T_map_client)
        if not np.isfinite(T_odom_client).all():
            return None
        return LocalizedPose(
            pose=matrix_to_pose(T_odom_client),
            frame_id="odom",
            confidence=min(localization.confidence, sample.confidence or 0.0),
        )


def compose_odom_from_map(
    T_odom_map: NDArray[np.float64],
    T_map_client: NDArray[np.float64],
) -> NDArray[np.float64]:
    return T_odom_map @ T_map_client
