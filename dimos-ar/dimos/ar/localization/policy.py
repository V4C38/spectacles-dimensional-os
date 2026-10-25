from __future__ import annotations

from collections import deque
from collections.abc import Callable, Sequence
from dataclasses import dataclass
import math
import time

from dimos.ar.localization.types import CapturePolicy, LocalizationProviderType, Observation

TRAVEL_THRESHOLD_M = 0.75
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
    generation: int = 0
    capture_travel_m: float = 0.0


@dataclass
class _ClientEpisode:
    pending: bool = False
    last_success_travel_m: float | None = None
    in_flight: bool = False
    generation: int = 0
    prompt_due_at: float | None = None
    vps_waiting: bool = False


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
                f"robot_vps_cooldown_s must be finite and non-negative, got {robot_vps_cooldown_s}"
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
        self._vps_waiters: deque[str] = deque()
        self._vps_turn_until = 0.0

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
        state = self._clients.get(client_id)
        if state is not None and state.pending:
            state.generation += 1
            state.in_flight = False
            if state.vps_waiting and not self.client_vps_ready(client_id):
                state.prompt_due_at = max(self._clock() + 0.25, self._client_vps_until)
                return None
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
        prompts, episodes = self.poll()
        # Travel, rather than a planner completion event, makes correction due.
        # The client waits for the robot to enter its geometric capture gate.
        for client_id, state in self._clients.items():
            if (
                not state.pending
                and state.last_success_travel_m is not None
                and self._travel_m - state.last_success_travel_m >= self._travel_threshold_m
            ):
                prompted = self._open_episode(client_id)
                if prompted is not None:
                    prompts.append(prompted)
        return prompts, episodes

    def poll(self) -> tuple[list[str], list[EpisodeWork]]:
        now = self._clock()
        self._rotate_expired_vps_turn()
        client_ids: list[str] = []
        episodes: list[EpisodeWork] = []
        for client_id, state in self._clients.items():
            if state.prompt_due_at is not None and now >= state.prompt_due_at:
                if state.vps_waiting and not self.client_vps_ready(client_id):
                    state.prompt_due_at = max(now + 0.25, self._client_vps_until)
                    continue
                state.prompt_due_at = None
                if self._capture_spec is not None:
                    client_ids.append(client_id)
        return client_ids, episodes

    def on_observations(
        self,
        client_id: str,
        observations: Sequence[Observation],
        *,
        capture_travel_m: float | None = None,
    ) -> EpisodeWork | None:
        state = self._clients.get(client_id)
        if state is None or not state.pending or state.in_flight or state.prompt_due_at is not None:
            return None
        if not observations:
            return None
        state.in_flight = True
        return EpisodeWork(
            client_id=client_id,
            observations=tuple(observations),
            generation=state.generation,
            capture_travel_m=self._travel_m if capture_travel_m is None else capture_travel_m,
        )

    def is_current(self, work: EpisodeWork) -> bool:
        state = self._clients.get(work.client_id)
        return (
            state is not None
            and state.pending
            and state.in_flight
            and state.generation == work.generation
        )

    def defer_vps(self, client_id: str) -> None:
        state = self._clients.get(client_id)
        if state is None or not state.pending:
            return
        # Keep only the waiting client. A cooldown must never retain old pixels.
        state.vps_waiting = True
        self._enqueue_vps(client_id)
        state.in_flight = False
        state.generation += 1
        state.prompt_due_at = max(
            self._clock() + 2.0, self._client_vps_until, self._robot_vps_until
        )

    def on_success(self, client_id: str, *, capture_travel_m: float | None = None) -> None:
        state = self._clients.get(client_id)
        if state is None:
            return
        state.pending = False
        self._remove_vps_waiter(client_id)
        state.vps_waiting = False
        state.in_flight = False
        state.prompt_due_at = None
        state.last_success_travel_m = (
            self._travel_m if capture_travel_m is None else capture_travel_m
        )

    def on_failure(self, client_id: str) -> None:
        state = self._clients.get(client_id)
        if state is None:
            return
        state.pending = False
        self._remove_vps_waiter(client_id)
        state.vps_waiting = False
        state.in_flight = False
        state.prompt_due_at = None

    def on_disconnect(self, client_id: str) -> None:
        self._remove_vps_waiter(client_id)
        self._clients.pop(client_id, None)

    def reset_source(self) -> None:
        self._clients.clear()
        self._vps_waiters.clear()
        self._last_xy = None
        self._travel_m = 0.0

    def retry_failed_episode(self, client_id: str, *, backoff_s: float = 0.0) -> str | None:
        # A detection can finish after disconnect; do not resurrect that client.
        if client_id not in self._clients:
            return None
        self.on_failure(client_id)
        prompted = self._open_episode(client_id)
        if prompted is not None and backoff_s > 0:
            self._clients[client_id].prompt_due_at = self._clock() + backoff_s
            return None
        return prompted

    def client_vps_ready(self, client_id: str | None = None) -> bool:
        if client_id is not None:
            self._enqueue_vps(client_id)
        return self._clock() >= self._client_vps_until and (
            client_id is None or not self._vps_waiters or self._vps_waiters[0] == client_id
        )

    def _enqueue_vps(self, client_id: str) -> None:
        if client_id not in self._vps_waiters:
            self._vps_waiters.append(client_id)
            if len(self._vps_waiters) == 1:
                self._vps_turn_until = max(self._clock(), self._client_vps_until) + 5.0

    def _remove_vps_waiter(self, client_id: str) -> None:
        if client_id in self._vps_waiters:
            was_head = self._vps_waiters[0] == client_id
            self._vps_waiters.remove(client_id)
            if was_head:
                self._vps_turn_until = max(self._clock(), self._client_vps_until) + 5.0

    def _rotate_expired_vps_turn(self) -> None:
        # A paused setup or denied camera cannot reserve the VPS slot forever.
        if not self._vps_waiters or self._clock() < self._vps_turn_until:
            return
        client_id = self._vps_waiters[0]
        state = self._clients.get(client_id)
        if state is not None and state.in_flight:
            return
        self._vps_waiters.rotate(-1)
        self._vps_turn_until = max(self._clock(), self._client_vps_until) + 5.0
        if state is not None and state.pending:
            state.prompt_due_at = self._clock() + 0.25

    def robot_vps_ready(self) -> bool:
        return self._clock() >= self._robot_vps_until

    def begin_client_vps(self, client_id: str | None = None) -> None:
        self._client_vps_until = self._clock() + self._client_vps_cooldown_s
        if client_id is not None:
            self._remove_vps_waiter(client_id)

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
        state.in_flight = False
        state.generation += 1
        if self._vps_only():
            state.vps_waiting = True
            if not self.client_vps_ready(client_id):
                state.prompt_due_at = max(self._clock() + 0.25, self._client_vps_until)
                return None
        return client_id
