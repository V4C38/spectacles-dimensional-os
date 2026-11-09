from __future__ import annotations

from dataclasses import dataclass
import math
import threading
from typing import TYPE_CHECKING

import numpy as np

from dimos.ar.localization.types import LocalizedPose
from dimos.utils.transform_utils import pose_to_matrix

if TYPE_CHECKING:
    from numpy.typing import NDArray


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
    confidence: float | None = None
    travel_m: float | None = None
    map_code: str | None = None
    source_generation: int = 0


class OdomMapTransform:
    def __init__(self, *, config: OdomMapTransformConfig | None = None) -> None:
        self._config = config or OdomMapTransformConfig()
        self._lock = threading.Lock()
        self._vps_sample: OdomMapTransformSample | None = None

    def vps_sample(self) -> OdomMapTransformSample | None:
        with self._lock:
            return self._vps_sample

    def clear(self) -> None:
        with self._lock:
            self._vps_sample = None

    def update_from_vps(
        self,
        localization: LocalizedPose,
        *,
        ts_server: float,
        travel_m: float,
        map_code: str | None = None,
        source_generation: int = 0,
        min_confidence: float | None = None,
    ) -> bool:
        # Marker callers have already passed their own detection/fusion gates.
        minimum = self._config.min_vps_confidence if min_confidence is None else min_confidence
        if not math.isfinite(minimum) or not 0 <= minimum <= 1:
            raise ValueError("minimum confidence must be in [0, 1]")
        if localization.frame_id != "map":
            raise ValueError(
                f"VPS T_odom_map update expects frame_id='map', got {localization.frame_id!r}"
            )
        if (
            not all(math.isfinite(v) for v in (localization.confidence, ts_server, travel_m))
            or not minimum <= localization.confidence <= 1.0
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
