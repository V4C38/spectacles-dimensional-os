from __future__ import annotations

import asyncio
from collections.abc import Callable, Sequence
from dataclasses import dataclass
import time
from typing import Protocol

from dimos.ar.localization.odom_map_transform import OdomMapTransform, OdomMapTransformSample
from dimos.ar.localization.policy import LocalizationPolicy
from dimos.ar.localization.types import (
    LocalizationProviderType,
    LocalizationResult,
    LocalizedPose,
    Observation,
    SnapshotLocalizer,
)
from dimos.ar.localization.vps.robot_observation_buffer import RobotObservationBuffer
from dimos.ar.localization.worker import LocalizationWorker
from dimos.msgs.geometry_msgs.Transform import Transform
from dimos.utils.logging_config import setup_logger

logger = setup_logger()


class AsyncLocalizer(Protocol):
    async def localize(self, observations: Sequence[Observation]) -> LocalizedPose | None: ...

    async def close(self) -> None: ...


@dataclass(frozen=True)
class LocalizationOutcome:
    result: LocalizationResult | None = None
    used_vps: bool = False
    defer_vps: bool = False


class LocalizationCoordinator:
    """Event-loop-owned policy/anchor composition with cancellable providers.

    CPU work receives frozen history; HTTP awaits never hold a socket's read loop.
    VPS map coordinates are independent of DimOS's optional premap frame.
    """

    def __init__(
        self,
        *,
        policy: LocalizationPolicy,
        odom_map_transform: OdomMapTransform,
        robot_observations: RobotObservationBuffer,
        marker: SnapshotLocalizer | None,
        vps: AsyncLocalizer | None,
        map_code: str | None = None,
        worker: LocalizationWorker | None = None,
        clock: Callable[[], float] = time.time,
        source_generation: Callable[[], int] = lambda: 0,
    ) -> None:
        self._policy = policy
        self._odom_map_transform = odom_map_transform
        self._robot_observations = robot_observations
        self._marker = marker
        self._vps = vps
        self._map_code = map_code
        self._worker = worker or LocalizationWorker()
        self._clock = clock
        self._source_generation = source_generation
        self._vps_lock = asyncio.Lock()

    def on_relocalization_transform(self, transform: Transform, *, ts_server: float) -> bool:
        return self._odom_map_transform.update_from_relocalization(transform, ts_server=ts_server)

    async def close(self) -> None:
        try:
            if self._vps is not None:
                await self._vps.close()
        finally:
            self._worker.close()

    def invalidate_source(self) -> None:
        self._odom_map_transform.clear()
        self._robot_observations.clear()

    async def run(
        self, observations: Sequence[Observation], *, client_id: str | None = None
    ) -> LocalizationOutcome:
        if not observations:
            return LocalizationOutcome()
        newest = max(observations, key=lambda observation: observation.ts_server)
        # Admission age, not a post-HTTP image-age limit.
        age = self._clock() - newest.ts_server
        if not -0.25 <= age <= 2.0:
            logger.warning(
                "localization capture rejected", client_id=client_id,
                reason="capture_age", capture_age_s=round(age, 3), max_age_s=2.0,
            )
            return LocalizationOutcome()
        generation = self._source_generation()
        if (
            self._marker is not None
            and LocalizationProviderType.FIDUCIAL_MARKER in self._policy.providers
        ):
            marker = self._marker.snapshot()
            localized = await self._worker.run(lambda: marker.localize(tuple(observations)))
            if generation != self._source_generation():
                return LocalizationOutcome()
            if localized is not None:
                return LocalizationOutcome(result=self._result_in_odom(localized, newest.ts_server))
        if self._vps is None or LocalizationProviderType.VPS not in self._policy.providers:
            return LocalizationOutcome()
        # asyncio.Lock is FIFO. Only one robot + headset VPS workflow may own the
        # shared anchor/cooldown at a time; marker detection remains independent.
        async with self._vps_lock:
            if generation != self._source_generation():
                return LocalizationOutcome()
            if not self._policy.client_vps_ready(client_id):
                return LocalizationOutcome(defer_vps=True)
            if not -0.25 <= self._clock() - newest.ts_server <= 2.0:
                return LocalizationOutcome(defer_vps=True)
            return await self._run_client_vps(newest, generation, client_id)

    def _reusable(self, sample: OdomMapTransformSample | None, generation: int) -> bool:
        return (
            self._odom_map_transform.is_sample_reusable(
                sample,
                current_travel_m=self._policy.travel_m,
                now_server=self._clock(),
                map_code=self._map_code,
                source_generation=generation,
            )
            and generation == self._source_generation()
        )

    async def _run_client_vps(
        self, newest: Observation, generation: int, client_id: str | None
    ) -> LocalizationOutcome:
        anchor = self._odom_map_transform.vps_sample()
        if not self._reusable(anchor, generation):
            if not self._policy.robot_vps_ready():
                return LocalizationOutcome(used_vps=True, defer_vps=True)
            robot = self._robot_observations.newest(now_server=self._clock())
            if robot is None or robot.source_generation != generation:
                return LocalizationOutcome(used_vps=True)
            assert self._vps is not None
            # Reserve cooldown at dispatch. Cancellation cannot undo vendor work.
            self._policy.begin_robot_vps()
            localized = await self._vps.localize([robot.observation])
            if localized is None or generation != self._source_generation():
                return LocalizationOutcome(used_vps=True)
            # A slow query must not commit an already-expired robot fix.
            if not (
                0 <= self._policy.travel_m - robot.travel_m <= 1.0
                and -0.25
                <= self._clock() - robot.observation.ts_server
                <= self._odom_map_transform.max_age_s
            ):
                return LocalizationOutcome(used_vps=True)
            if not self._odom_map_transform.update_from_vps(
                localized,
                ts_server=robot.observation.ts_server,
                travel_m=robot.travel_m,
                map_code=self._map_code,
                source_generation=generation,
            ):
                return LocalizationOutcome(used_vps=True)
            anchor = self._odom_map_transform.vps_sample()
        if not self._reusable(anchor, generation):
            return LocalizationOutcome(used_vps=True)
        assert self._vps is not None
        self._policy.begin_client_vps(client_id)
        localized = await self._vps.localize([newest])
        if localized is None or not self._reusable(anchor, generation):
            return LocalizationOutcome(used_vps=True)
        # Compose with the exact snapshot used for this workflow, never a later fix.
        odom_pose = self._odom_map_transform.localization_in_odom(localized, sample=anchor)
        if odom_pose is None:
            return LocalizationOutcome(used_vps=True)
        return LocalizationOutcome(
            result=self._result_in_odom(odom_pose, newest.ts_server),
            used_vps=True,
        )

    def _result_in_odom(self, localized: LocalizedPose, ts_server: float) -> LocalizationResult:
        if localized.frame_id != "odom":
            raise ValueError(
                f"localization_result expects frame_id='odom', got {localized.frame_id!r}"
            )
        return LocalizationResult(
            position=(localized.pose.x, localized.pose.y, localized.pose.z),
            orientation=(
                localized.pose.orientation.x,
                localized.pose.orientation.y,
                localized.pose.orientation.z,
                localized.pose.orientation.w,
            ),
            confidence=localized.confidence,
            ts_server=ts_server,
        )
