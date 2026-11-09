from __future__ import annotations

import asyncio
from collections.abc import Callable, Mapping
from concurrent.futures import ThreadPoolExecutor
from functools import partial
import math
import time
from typing import TYPE_CHECKING, Protocol

from dimos.ar.localization.pose_buffer import PoseSample
from dimos.ar.robot.odometry_correction import correct_odom_points
from dimos.ar.sensors.lidar_filter import (
    DEFAULT_TARGET_POINTS,
    LidarFilterSettings,
    prepare_lidar_points,
)
from dimos.ar.sensors.lidar_settings import LidarSettings
from dimos.ar.timing_diagnostics import TimingSummary
from dimos.ar.websocket.protocol import encode_lidar_binary, encode_pose
from dimos.msgs.sensor_msgs.PointCloud2 import PointCloud2
from dimos.utils.logging_config import setup_logger

logger = setup_logger()

if TYPE_CHECKING:
    from dimos.ar.websocket.server import WebSocketServer

DEFAULT_POSE_MAX_HZ = 15.0
DEFAULT_LIDAR_MAX_HZ = 2.0


class _BroadcastSink(Protocol):
    def schedule_broadcast_text(self, text: str) -> None: ...

    def schedule_broadcast_binary(self, data: bytes) -> None: ...

    def schedule_send_binary_to_client(self, client_id: str, data: bytes) -> None: ...


class RobotStatePublisher:
    """DimOS stream handlers → client-ready pose and LiDAR for all clients."""

    def __init__(
        self,
        ws_server: WebSocketServer | _BroadcastSink,
        *,
        odom_scale_correction_factor: float,
        robot_position: Callable[[], tuple[float, float, float] | None],
        pose_max_hz: float = DEFAULT_POSE_MAX_HZ,
        lidar_max_hz: float = DEFAULT_LIDAR_MAX_HZ,
        lidar_voxel_size_m: float = 0.05,
        lidar_target_points: int = DEFAULT_TARGET_POINTS,
        subscriptions: Callable[[], Mapping[str, LidarSettings]] | None = None,
    ) -> None:
        self._ws = ws_server
        self._subscriptions = subscriptions
        self._odom_scale_correction_factor = odom_scale_correction_factor
        self._pose_max_hz = pose_max_hz
        self._lidar_max_hz = lidar_max_hz
        self._lidar_voxel_size_m = lidar_voxel_size_m
        self._lidar_target_points = lidar_target_points
        self._robot_position = robot_position
        self._pose_last_emit_mono = 0.0
        self._lidar_last_emit_mono = 0.0
        self._lidar_timing = TimingSummary("robot lidar processing timing")
        self._lidar_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="ar-lidar")
        self._lidar_task: asyncio.Task[None] | None = None
        self._lidar_pending: tuple[PointCloud2, LidarSettings, tuple[float, float, float] | None,
                                  dict[str, LidarSettings] | None, int] | None = None
        self._source_generation = 0
        self._closed = False

    async def publish_lidar_async(self, msg: PointCloud2, *, lidar: LidarSettings) -> None:
        if self._closed or not lidar.enabled:
            return
        self._lidar_pending = (
            msg, lidar, self._robot_position(),
            dict(self._subscriptions()) if self._subscriptions is not None else None,
            self._source_generation,
        )
        if self._lidar_task is None or self._lidar_task.done():
            self._lidar_task = asyncio.create_task(self._drain_lidar())
            self._lidar_task.add_done_callback(self._lidar_done)

    def _lidar_done(self, task: asyncio.Task[None]) -> None:
        if not task.cancelled() and (error := task.exception()) is not None:
            logger.error("LiDAR worker failed", error=type(error).__name__)
        if self._lidar_pending is not None and not self._closed:
            self._lidar_task = asyncio.create_task(self._drain_lidar())
            self._lidar_task.add_done_callback(self._lidar_done)

    async def _drain_lidar(self) -> None:
        while self._lidar_pending is not None and not self._closed:
            if self._lidar_max_hz > 0:
                delay = self._lidar_last_emit_mono + 1 / self._lidar_max_hz - time.monotonic()
                if delay > 0:
                    await asyncio.sleep(delay)
            pending, self._lidar_pending = self._lidar_pending, None
            if pending is None:
                return
            msg, settings, position, subscriptions, generation = pending
            loop = asyncio.get_running_loop()
            future = loop.run_in_executor(
                self._lidar_executor,
                partial(self.publish_lidar, msg, lidar=settings,
                        _snapshot=(position, subscriptions, generation)),
            )
            future.add_done_callback(lambda done: None if done.cancelled() else done.exception())
            # Actual work remains exclusive after cancellation: no replacement
            # job can accumulate behind a blocked native voxel downsampler.
            await asyncio.shield(future)

    def invalidate_source(self) -> None:
        self._source_generation += 1
        self._lidar_pending = None

    async def close(self) -> None:
        self._closed = True
        self.invalidate_source()
        if self._lidar_task is not None:
            self._lidar_task.cancel()
            await asyncio.gather(self._lidar_task, return_exceptions=True)
        self._lidar_executor.shutdown(wait=False, cancel_futures=True)

    def publish_odom(self, sample: PoseSample) -> None:
        if not self._allow_emit(self._pose_last_emit_mono, self._pose_max_hz):
            return
        if not _is_finite_pose(sample.position, sample.orientation):
            return
        self._pose_last_emit_mono = time.monotonic()
        self._ws.schedule_broadcast_text(
            encode_pose(position=sample.position, orientation=sample.orientation, ts=sample.ts_server)
        )

    def publish_lidar(
        self, msg: PointCloud2, *, lidar: LidarSettings,
        _snapshot: tuple[tuple[float, float, float] | None, dict[str, LidarSettings] | None, int] | None = None,
    ) -> None:
        if not lidar.enabled:
            return
        if not self._allow_emit(self._lidar_last_emit_mono, self._lidar_max_hz):
            return
        robot_position = self._robot_position() if _snapshot is None else _snapshot[0]
        if robot_position is None:
            return
        started = time.monotonic()
        source_age_ms = (time.time() - msg.ts) * 1000
        downsampled = msg.voxel_downsample(voxel_size=self._lidar_voxel_size_m)
        points = downsampled.points_f32()
        downsampled_count = len(points)
        downsampled_at = time.monotonic()
        groups: dict[LidarSettings, list[str]] = {}
        subscriptions = (
            self._subscriptions() if self._subscriptions is not None else None
        ) if _snapshot is None else _snapshot[1]
        if subscriptions is not None:
            for client_id, settings in subscriptions.items():
                if settings.enabled:
                    groups.setdefault(settings, []).append(client_id)
        else:
            groups[lidar] = []
        output_count = 0
        for preference, clients in groups.items():
            prepared = prepare_lidar_points(
                points,
                settings=LidarFilterSettings.from_lidar_settings(
                    preference, target_points=self._lidar_target_points
                ),
                robot_position=robot_position,
            )
            corrected = correct_odom_points(prepared, factor=self._odom_scale_correction_factor)
            output = [tuple(point) for point in corrected]
            output_count = max(output_count, len(output))
            payload = encode_lidar_binary(ts=msg.ts, points=output)
            if self._closed or (_snapshot is not None and _snapshot[2] != self._source_generation):
                return
            if subscriptions is None:
                self._ws.schedule_broadcast_binary(payload)
            else:
                for client_id in clients:
                    self._ws.schedule_send_binary_to_client(client_id, payload)
        self._lidar_last_emit_mono = time.monotonic()
        processing_ms = (time.monotonic() - started) * 1000
        self._lidar_timing.record(
            counts={"processed": 1, "slow_processing": int(processing_ms >= 100)},
            maxima={
                "processing_max_ms": processing_ms,
                "downsample_max_ms": (downsampled_at - started) * 1000,
                "source_age_max_ms": source_age_ms,
                "input_points_max": float(getattr(msg, "width", 0) * getattr(msg, "height", 0)),
                "downsampled_points_max": float(downsampled_count),
                "output_points_max": float(output_count),
            },
        )

    def _allow_emit(self, last_emit_mono: float, max_hz: float) -> bool:
        if max_hz <= 0.0:
            return True
        interval_s = 1.0 / max_hz
        now = time.monotonic()
        return now - last_emit_mono >= interval_s


def _is_finite_pose(
    position: tuple[float, float, float],
    orientation: tuple[float, float, float, float],
) -> bool:
    return all(math.isfinite(value) for value in (*position, *orientation))
