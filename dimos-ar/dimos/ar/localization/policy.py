from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass
import math
import time

from dimos.ar.localization.types import CapturePolicy, LocalizationProviderType, Observation

TRAVEL_THRESHOLD_M = 1.0
CLIENT_VPS_COOLDOWN_S = 30.0
ROBOT_VPS_COOLDOWN_S = 30.0
MARKER_OBSERVATION_COUNT = 3
VPS_OBSERVATION_COUNT = 1
MIXED_WAIT_TIMEOUT_S = 2.0


@dataclass(frozen=True)
class CaptureSpec:
    capture_policy: CapturePolicy
    observation_count: int
    wait_timeout_s: float | None = None


@dataclass(frozen=True)
class EpisodeWork:
    client_id: str
    observations: tuple[Observation, ...]


@dataclass
class _ClientEpisode:
    pending: bool = False
    last_success_travel_m: float | None = None
    held_observations: tuple[Observation, ...] | None = None
    prompt_due_at: float | None = None


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
    has_marker = LocalizationProviderType.FIDUCIAL_MARKER in providers
    has_vps = LocalizationProviderType.VPS in providers
    if has_marker and has_vps:
        return CaptureSpec(
            capture_policy=CapturePolicy.ROBOT_LOS_PREFERRED,
            observation_count=MARKER_OBSERVATION_COUNT,
            wait_timeout_s=MIXED_WAIT_TIMEOUT_S,
        )
    if has_marker:
        return CaptureSpec(
            capture_policy=CapturePolicy.ROBOT_LOS_REQUIRED,
            observation_count=MARKER_OBSERVATION_COUNT,
        )
    if has_vps:
        return CaptureSpec(
            capture_policy=CapturePolicy.ANY_ANGLE,
            observation_count=VPS_OBSERVATION_COUNT,
        )
    return None


class LocalizationPolicy:
    def __init__(
        self,
        providers: Sequence[LocalizationProviderType | str] = (),
        *,
        travel_threshold_m: float = TRAVEL_THRESHOLD_M,
        client_vps_cooldown_s: float = CLIENT_VPS_COOLDOWN_S,
        robot_vps_cooldown_s: float = ROBOT_VPS_COOLDOWN_S,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        if not math.isfinite(travel_threshold_m) or travel_threshold_m <= 0.0:
            raise ValueError(
                f"travel_threshold_m must be finite and positive, got {travel_threshold_m}"
            )
        if not math.isfinite(client_vps_cooldown_s) or client_vps_cooldown_s < 0.0:
            raise ValueError(
                "client_vps_cooldown_s must be finite and non-negative, "
                f"got {client_vps_cooldown_s}"
            )
        if not math.isfinite(robot_vps_cooldown_s) or robot_vps_cooldown_s < 0.0:
            raise ValueError(
                "robot_vps_cooldown_s must be finite and non-negative, "
                f"got {robot_vps_cooldown_s}"
            )
        self._providers = _canonical_providers(providers)
        self._capture_spec = _capture_spec(self._providers)
        self._travel_threshold_m = travel_threshold_m
        self._client_vps_cooldown_s = client_vps_cooldown_s
        self._robot_vps_cooldown_s = robot_vps_cooldown_s
        self._clock = clock
        self._travel_m = 0.0
        self._last_xy: tuple[float, float] | None = None
        self._clients: dict[str, _ClientEpisode] = {}
        self._client_vps_until = 0.0
        self._robot_vps_until = 0.0

    @property
    def providers(self) -> tuple[LocalizationProviderType, ...]:
        return self._providers

    @property
    def capture_spec(self) -> CaptureSpec | None:
        return self._capture_spec

    @property
    def travel_m(self) -> float:
        return self._travel_m

    def on_hello(self, client_id: str) -> str | None:
        return self._open_episode(client_id)

    def on_start_request(self, client_id: str) -> str | None:
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
                and self._travel_m - state.last_success_travel_m < self._travel_threshold_m
            ):
                continue
            prompted = self._open_episode(client_id)
            if prompted is not None:
                client_ids.append(prompted)
        return client_ids

    def on_odom(
        self, corrected_x: float, corrected_y: float
    ) -> tuple[list[str], list[EpisodeWork]]:
        if self._last_xy is not None:
            dx = corrected_x - self._last_xy[0]
            dy = corrected_y - self._last_xy[1]
            self._travel_m += math.hypot(dx, dy)
        self._last_xy = (corrected_x, corrected_y)
        return self.poll()

    def poll(self) -> tuple[list[str], list[EpisodeWork]]:
        now = self._clock()
        client_ids: list[str] = []
        episodes: list[EpisodeWork] = []
        for client_id, state in self._clients.items():
            if state.prompt_due_at is not None and now >= state.prompt_due_at:
                state.prompt_due_at = None
                if self._capture_spec is not None:
                    client_ids.append(client_id)
            if state.held_observations is not None and self.client_vps_ready():
                episodes.append(
                    EpisodeWork(client_id=client_id, observations=state.held_observations)
                )
                state.held_observations = None
        return client_ids, episodes

    def on_observations(
        self, client_id: str, observations: Sequence[Observation]
    ) -> EpisodeWork | None:
        state = self._clients.get(client_id)
        if state is None or not state.pending:
            return None
        if not observations:
            return None
        return EpisodeWork(client_id=client_id, observations=tuple(observations))

    def hold_for_client_vps(
        self, client_id: str, observations: Sequence[Observation]
    ) -> None:
        state = self._clients.get(client_id)
        if state is None or not state.pending:
            return
        state.held_observations = tuple(observations)

    def on_success(self, client_id: str) -> None:
        state = self._clients.get(client_id)
        if state is None:
            return
        state.pending = False
        state.held_observations = None
        state.prompt_due_at = None
        state.last_success_travel_m = self._travel_m

    def on_failure(self, client_id: str) -> None:
        state = self._clients.get(client_id)
        if state is None:
            return
        state.pending = False
        state.held_observations = None
        state.prompt_due_at = None

    def on_disconnect(self, client_id: str) -> None:
        self._clients.pop(client_id, None)

    def client_vps_ready(self) -> bool:
        return self._clock() >= self._client_vps_until

    def robot_vps_ready(self) -> bool:
        return self._clock() >= self._robot_vps_until

    def begin_client_vps(self) -> None:
        self._client_vps_until = self._clock() + self._client_vps_cooldown_s

    def begin_robot_vps(self) -> None:
        self._robot_vps_until = self._clock() + self._robot_vps_cooldown_s

    def _vps_only(self) -> bool:
        return self._providers == (LocalizationProviderType.VPS,)

    def _open_episode(self, client_id: str) -> str | None:
        if self._capture_spec is None:
            return None
        state = self._clients.setdefault(client_id, _ClientEpisode())
        if state.pending:
            return None
        state.pending = True
        state.held_observations = None
        if self._vps_only() and not self.client_vps_ready():
            state.prompt_due_at = self._client_vps_until
            return None
        return client_id
