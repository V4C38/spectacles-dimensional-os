from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass
import math
import time
from typing import Literal

from dimos.ar.localization.types import CapturePolicy, LocalizationProviderType, Observation

TRAVEL_THRESHOLD_M = 0.75
MARKER_OBSERVATION_COUNT = 3


@dataclass(frozen=True)
class CaptureSpec:
    capture_policy: CapturePolicy
    observation_count: int
    wait_timeout_s: float | None = None


@dataclass(frozen=True)
class EpisodeWork:
    client_id: str
    observations: tuple[Observation, ...]
    generation: int = 0
    capture_travel_m: float = 0.0
    capture_heading_rad: float | None = None


@dataclass
class _ClientEpisode:
    phase: Literal["idle", "capturing", "processing", "backoff"] = "idle"
    last_success_travel_m: float | None = None
    last_success_heading: float | None = None
    generation: int = 0
    prompt_due_at: float | None = None

    @property
    def pending(self) -> bool:
        return self.phase != "idle"

    @property
    def in_flight(self) -> bool:
        return self.phase == "processing"


def _canonical_providers(
    configured: Sequence[LocalizationProviderType | str],
) -> tuple[LocalizationProviderType, ...]:
    types = {LocalizationProviderType(provider) for provider in configured}
    ordered: list[LocalizationProviderType] = []
    if LocalizationProviderType.FIDUCIAL_MARKER in types:
        ordered.append(LocalizationProviderType.FIDUCIAL_MARKER)
    if LocalizationProviderType.VPS in types:
        ordered.append(LocalizationProviderType.VPS)
    return tuple(ordered)


def _capture_spec(
    providers: tuple[LocalizationProviderType, ...],
) -> CaptureSpec | None:
    if LocalizationProviderType.FIDUCIAL_MARKER in providers:
        return CaptureSpec(CapturePolicy.ROBOT_LOS_REQUIRED, MARKER_OBSERVATION_COUNT)
    return None


class LocalizationPolicy:
    def __init__(
        self,
        providers: Sequence[LocalizationProviderType | str] = (),
        *,
        travel_threshold_m: float = TRAVEL_THRESHOLD_M,
        heading_threshold_deg: float = 30.0,
        heading: Callable[[], float] = lambda: 0.0,
        clock: Callable[[], float] = time.monotonic,
        travel: Callable[[], float] = lambda: 0.0,
    ) -> None:
        if not math.isfinite(travel_threshold_m) or travel_threshold_m <= 0.0:
            raise ValueError(
                f"travel_threshold_m must be finite and positive, got {travel_threshold_m}"
            )
        self._heading_threshold = math.radians(heading_threshold_deg)
        self._heading = heading
        self._providers = _canonical_providers(providers)
        self._capture_spec = _capture_spec(self._providers)
        self._travel_threshold_m = travel_threshold_m
        self._clock = clock
        self._travel = travel
        self._clients: dict[str, _ClientEpisode] = {}

    @property
    def providers(self) -> tuple[LocalizationProviderType, ...]:
        return self._providers

    @property
    def capture_spec(self) -> CaptureSpec | None:
        return self._capture_spec

    @property
    def travel_m(self) -> float:
        return self._travel()

    def on_hello(self, client_id: str) -> str | None:
        return self._open_episode(client_id)

    def on_start_request(self, client_id: str) -> str | None:
        state = self._clients.get(client_id)
        if state is not None and state.pending:
            state.generation += 1
            state.phase = "backoff" if state.prompt_due_at is not None else "capturing"
            if state.prompt_due_at is None:
                return client_id
            return None
        return self._open_episode(client_id)

    def on_goal_reached(self, *, succeeded: bool) -> list[str]:
        if not succeeded or self._capture_spec is None:
            return []
        client_ids: list[str] = []
        for client_id, state in self._clients.items():
            if state.pending:
                continue
            if (
                state.last_success_travel_m is not None
                and self.travel_m - state.last_success_travel_m < self._travel_threshold_m
            ):
                continue
            prompted = self._open_episode(client_id)
            if prompted is not None:
                client_ids.append(prompted)
        return client_ids

    def on_odom(self) -> list[str]:
        prompts = self.poll()
        # Travel, rather than a planner completion event, makes correction due.
        # The client waits for the robot to enter its geometric capture gate.
        for client_id, state in self._clients.items():
            if (
                not state.pending
                and state.last_success_travel_m is not None
                and (
                    self.travel_m - state.last_success_travel_m >= self._travel_threshold_m
                    or (
                        state.last_success_heading is not None
                        and abs(
                            math.remainder(
                                self._heading() - state.last_success_heading, 2 * math.pi
                            )
                        )
                        >= self._heading_threshold
                    )
                )
            ):
                prompted = self._open_episode(client_id)
                if prompted is not None:
                    prompts.append(prompted)
        return prompts

    def poll(self) -> list[str]:
        now = self._clock()
        client_ids: list[str] = []
        for client_id, state in self._clients.items():
            if state.prompt_due_at is not None and now >= state.prompt_due_at:
                state.prompt_due_at = None
                state.phase = "capturing"
                if self._capture_spec is not None:
                    client_ids.append(client_id)
        return client_ids

    def on_observations(
        self,
        client_id: str,
        observations: Sequence[Observation],
        *,
        capture_travel_m: float | None = None,
        capture_heading_rad: float | None = None,
    ) -> EpisodeWork | None:
        state = self._clients.get(client_id)
        if state is None or not state.pending or state.in_flight or state.prompt_due_at is not None:
            return None
        if not observations:
            return None
        state.phase = "processing"
        return EpisodeWork(
            client_id=client_id,
            observations=tuple(observations),
            generation=state.generation,
            capture_travel_m=self.travel_m if capture_travel_m is None else capture_travel_m,
            capture_heading_rad=capture_heading_rad,
        )

    def is_current(self, work: EpisodeWork) -> bool:
        state = self._clients.get(work.client_id)
        return (
            state is not None
            and state.pending
            and state.in_flight
            and state.generation == work.generation
        )

    def on_success(
        self,
        client_id: str,
        *,
        capture_travel_m: float | None = None,
        capture_heading_rad: float | None = None,
    ) -> None:
        state = self._clients.get(client_id)
        if state is None:
            return
        state.phase = "idle"
        state.prompt_due_at = None
        state.last_success_heading = (
            self._heading() if capture_heading_rad is None else capture_heading_rad
        )
        state.last_success_travel_m = (
            self.travel_m if capture_travel_m is None else capture_travel_m
        )

    def on_failure(self, client_id: str) -> None:
        state = self._clients.get(client_id)
        if state is None:
            return
        state.phase = "idle"
        state.prompt_due_at = None

    def on_disconnect(self, client_id: str) -> None:
        self._clients.pop(client_id, None)

    def reset_source(self) -> None:
        self._clients.clear()

    def retry_failed_episode(self, client_id: str, *, backoff_s: float = 0.0) -> str | None:
        # A detection can finish after disconnect; do not resurrect that client.
        if client_id not in self._clients:
            return None
        self.on_failure(client_id)
        prompted = self._open_episode(client_id)
        if prompted is not None and backoff_s > 0:
            self._clients[client_id].phase = "backoff"
            self._clients[client_id].prompt_due_at = self._clock() + backoff_s
            return None
        return prompted

    def _open_episode(self, client_id: str) -> str | None:
        if self._capture_spec is None:
            return None
        state = self._clients.setdefault(client_id, _ClientEpisode())
        if state.pending:
            return None
        state.phase = "capturing"
        state.generation += 1
        return client_id
