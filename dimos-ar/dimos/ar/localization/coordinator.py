from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass
import time
from typing import Protocol

from dimos.ar.localization.types import (
    LocalizationResult,
    LocalizedPose,
    Observation,
    SnapshotLocalizer,
)
from dimos.ar.worker import BoundedWorker
from dimos.utils.logging_config import setup_logger

logger = setup_logger()


class AsyncLocalizer(Protocol):
    async def localize(self, observations: Sequence[Observation]) -> LocalizedPose | None: ...

    async def close(self) -> None: ...


@dataclass(frozen=True)
class LocalizationOutcome:
    result: LocalizationResult | None = None


class LocalizationCoordinator:
    """Marker-only localization; map/VPS workflows belong to MapLocalization."""

    def __init__(
        self,
        *,
        marker: SnapshotLocalizer | None,
        worker: BoundedWorker | None = None,
        clock: Callable[[], float] = time.time,
        source_generation: Callable[[], int] = lambda: 0,
    ) -> None:
        self._marker = marker
        self._owns_worker = worker is None
        self._worker = worker or BoundedWorker()
        self._clock = clock
        self._source_generation = source_generation

    async def close(self) -> None:
        if self._owns_worker:
            self._worker.close()

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
        if self._marker is not None:
            marker = self._marker.snapshot()
            localized = await self._worker.run(lambda: marker.localize(tuple(observations)))
            if generation != self._source_generation():
                return LocalizationOutcome()
            if localized is not None:
                return LocalizationOutcome(result=self._result_in_odom(localized, newest.ts_server))
        return LocalizationOutcome()

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
