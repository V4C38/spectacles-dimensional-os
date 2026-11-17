"""Adapt DimOS's optional saved-map TF into the localization frame owner."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from dataclasses import dataclass
import math
from typing import Protocol

import numpy as np
from numpy.typing import NDArray

from dimos.ar.localization.transforms import normalize_pose_estimate
from dimos.msgs.geometry_msgs.Transform import Transform


class NativeTransformBuffer(Protocol):
    def get(
        self, parent_frame: str, child_frame: str, *, warn: bool = True
    ) -> Transform | None: ...


@dataclass(frozen=True)
class NativeMapSample:
    T_native_odom: NDArray[np.float64]
    ts_server: float
    native_map_id: str


class NativeMapAdapter:
    """Read native world<-map TF; identical periodic republishes are not new fixes.

    The owning source session supplies the map identity and disposes this adapter
    together with its TF buffer when that source or configured map changes.
    """

    def __init__(
        self, native_map_id: str, *, world_frame: str = "world", map_frame: str = "map"
    ) -> None:
        if not native_map_id.strip():
            raise ValueError("native map identity must not be empty")
        self._native_map_id = native_map_id
        self._world_frame = world_frame
        self._map_frame = map_frame
        self._previous: NDArray[np.float64] | None = None
        self._task: asyncio.Task[None] | None = None
        self._retired = False

    def reset(self) -> None:
        """Retire this source; its native map pipeline must restart before reuse.

        Upstream republishes old fixes with fresh timestamps, so timestamp fences
        cannot prove a registration belongs to a replacement odometry source.
        """
        self._retired = True

    def start(
        self, buffer: NativeTransformBuffer, on_sample: Callable[[NativeMapSample], bool]
    ) -> None:
        """Poll on the coordinator's owning event loop.

        The callback returns whether the sample was handled, not whether it
        changed accepted state. False requests a retry when odometry is not ready.
        """
        if self._task is None:
            self._task = asyncio.create_task(self._run(buffer, on_sample))

    async def close(self) -> None:
        if self._task is not None:
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)
            self._task = None

    async def _run(
        self, buffer: NativeTransformBuffer, on_sample: Callable[[NativeMapSample], bool]
    ) -> None:
        while True:
            sample = self.poll(buffer)
            if sample is not None and not on_sample(sample):
                # A fix offered before odometry is ready must be retried.
                self._previous = None
            await asyncio.sleep(0.1)

    def poll(self, buffer: NativeTransformBuffer) -> NativeMapSample | None:
        if self._retired:
            return None
        transform = buffer.get(self._world_frame, self._map_frame, warn=False)
        if transform is None or not math.isfinite(transform.ts):
            return None
        matrix = np.asarray(transform.to_matrix(), dtype=np.float64)
        if matrix.shape != (4, 4) or not np.isfinite(matrix).all():
            return None
        rotation = matrix[:3, :3]
        if (
            not np.allclose(matrix[3], [0, 0, 0, 1], atol=1e-8)
            or not np.allclose(rotation.T @ rotation, np.eye(3), atol=1e-6)
            or not math.isclose(float(np.linalg.det(rotation)), 1.0, abs_tol=1e-6)
        ):
            return None
        if self._previous is not None and np.allclose(
            matrix, self._previous, rtol=0, atol=1e-8
        ):
            return None
        # DimOS publishes T_world_map, while our owner accepts T_native_odom.
        normalized = normalize_pose_estimate(np.linalg.inv(matrix), max_tilt_rad=math.radians(5))
        if normalized is None:
            return None
        native_odom = normalized
        native_odom.setflags(write=False)
        self._previous = matrix.copy()
        return NativeMapSample(native_odom, float(transform.ts), self._native_map_id)
