"""Independent robot-map correction and per-headset map alignment.

All mutable policy, admission and commit state belongs to the module event loop.
The native robot reference and planner are never changed by these corrections.
"""

from __future__ import annotations

import asyncio
from collections import OrderedDict
from collections.abc import Callable, Sequence
from dataclasses import dataclass
import math
import time
from typing import Any, Literal, cast
from uuid import uuid4

import numpy as np

from dimos.ar.async_execution import BoundedWorker
from dimos.ar.localization.odom_map_transform import OdomMapTransform
from dimos.ar.localization.types import (
    AsyncLocalizer,
    LocalizedPose,
    Observation,
    SnapshotLocalizer,
)
from dimos.ar.localization.vps.admission import QueryDeferredError, VpsAdmission
from dimos.ar.localization.vps.robot_observation_buffer import RobotObservationBuffer
from dimos.ar.numeric import quaternion_yaw
from dimos.ar.robot.odometry import RobotOdometry
from dimos.ar.websocket.protocol import (
    LocalizationCaptureProgress,
    LocalizationTracking,
    TimeSync,
    encode_text,
)
from dimos.msgs.geometry_msgs.Pose import Pose
from dimos.utils.logging_config import setup_logger
from dimos.utils.transform_utils import matrix_to_pose, pose_to_matrix

logger = setup_logger()


CapturePurpose = Literal["robot", "headset"]
CapturePhase = Literal["requested", "waiting", "capturing", "submitted", "processing"]


@dataclass
class CaptureEpisode:
    id: str
    purpose: CapturePurpose
    deadline: float
    phase: CapturePhase = "requested"
    capture_ts: float | None = None
    travel_m: float = 0.0
    gate_deadline: float | None = None

    def update_progress(
        self,
        message: LocalizationCaptureProgress,
        sync: TimeSync,
        *,
        now: float,
        preference_s: float,
        timeout_s: float,
    ) -> None:
        if message.phase == "waiting" and self.phase in ("requested", "capturing"):
            # Losing LOS cannot renew an episode's original preference window.
            self.deadline = self.gate_deadline or now + max(0.25, preference_s)
        if message.phase == "capturing" and self.phase in ("requested", "waiting"):
            self.deadline = now + timeout_s
        self.phase = cast("CapturePhase", message.phase)
        self.travel_m = message.travel_m
        if message.capture_ts is not None:
            self.capture_ts = sync.to_server_ts(message.capture_ts)
            self.deadline = now + timeout_s

    def begin_processing(self) -> None:
        self.phase = "processing"


@dataclass(frozen=True)
class RelativeAlignment:
    """Accepted tag baselines in this client's current tracking/source reference."""

    travel_m: float
    robot_travel_m: float
    robot_heading: float


@dataclass(frozen=True)
class MapAlignment:
    id: str
    map_code: str
    odom_reference_id: str
    tracking_reference_id: str
    travel_m: float
    ts: float
    confidence: float
    position: tuple[float, float, float]
    orientation: tuple[float, float, float, float]

    def wire(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "map_code": self.map_code,
            "odom_reference_id": self.odom_reference_id,
            "tracking_reference_id": self.tracking_reference_id,
            "travel_m": self.travel_m,
            "ts": self.ts,
            "confidence": self.confidence,
            "position": list(self.position),
            "orientation": list(self.orientation),
        }

    def matches(self, tracking: LocalizationTracking, odom_reference: str, map_code: str) -> bool:
        return (
            self.tracking_reference_id == tracking.tracking_reference_id
            and self.odom_reference_id == odom_reference
            and self.map_code == map_code
            and tracking.travel_m >= self.travel_m
        )


@dataclass(frozen=True)
class PendingAlignment:
    id: str
    deadline: float


@dataclass
class MapClient:
    reference: str = ""
    active: bool = False
    seen_at: float = 0.0
    travel_m: float = 0.0
    alignment: MapAlignment | None = None
    episode: CaptureEpisode | None = None
    retry_at: float = 0.0
    manual: bool = True
    force: bool = False
    pending_alignment: PendingAlignment | None = None
    relative_alignment: RelativeAlignment | None = None
    next_attempt: Literal["vps", "tag"] = "vps"

    def reset_reference(self) -> None:
        self.alignment = None
        self.episode = None
        self.pending_alignment = None
        self.manual = True
        self.relative_alignment = None
        self.next_attempt = "vps"
        self.force = False

    def request_manual_alignment(self) -> None:
        self.manual = True
        self.force = True
        self.pending_alignment = None
        self.retry_at = 0.0
        if self.relative_alignment is not None:
            self.next_attempt = "tag"

    def issue_alignment(self, alignment: MapAlignment, *, now: float) -> None:
        # An accepted baseline remains valid while its replacement awaits acknowledgment.
        self.pending_alignment = PendingAlignment(alignment.id, now + 3.0)
        self.manual = False

    def acknowledge_alignment(self, alignment: MapAlignment) -> None:
        self.alignment = alignment
        self.relative_alignment = None
        pending = self.pending_alignment
        if pending is not None and pending.id == alignment.id:
            self.pending_alignment = None
            self.manual = False
            self.force = False
        elif pending is None:
            self.manual = False

    def awaiting_acceptance(self, *, now: float) -> bool:
        if self.pending_alignment is None:
            return False
        if now < self.pending_alignment.deadline:
            return True
        self.pending_alignment = None
        return False

    def finish_capture(self) -> None:
        self.episode = None

    def accept_relative_alignment(self, alignment: RelativeAlignment) -> None:
        self.relative_alignment = alignment
        self.manual = self.force = False
        self.next_attempt = "tag"
        self.retry_at = 0.0


def _pose_payload(matrix: Any) -> dict[str, Any]:
    pose = matrix_to_pose(matrix)
    return {
        "position": [pose.x, pose.y, pose.z],
        "orientation": [
            pose.orientation.x,
            pose.orientation.y,
            pose.orientation.z,
            pose.orientation.w,
        ],
    }


class MapLocalization:
    def __init__(
        self,
        *,
        odometry: RobotOdometry,
        transforms: OdomMapTransform,
        robot_images: RobotObservationBuffer,
        marker: SnapshotLocalizer | None,
        vps: AsyncLocalizer,
        worker: BoundedWorker,
        admission: VpsAdmission,
        map_code: str,
        send: Callable[[str, str], None],
        travel_threshold_m: float,
        heading_threshold_deg: float,
        marker_preference_s: float,
        headset_travel_threshold_m: float,
        timeout_s: float,
        clock: Callable[[], float] = time.monotonic,
        wall_clock: Callable[[], float] = time.time,
    ) -> None:
        self._clock = clock
        self._wall_clock = wall_clock
        self._odometry = odometry
        self._transforms = transforms
        self._robot_images = robot_images
        self._marker = marker
        self._vps = vps
        self._worker = worker
        self._admission = admission
        self._map_code = map_code
        self._send = send
        self._distance = travel_threshold_m
        self._angle = math.radians(heading_threshold_deg)
        self._preference = marker_preference_s
        self._headset_distance = headset_travel_threshold_m
        self._timeout = timeout_s
        self._clients: OrderedDict[str, MapClient] = OrderedDict()
        self._issued: OrderedDict[str, MapAlignment] = OrderedDict()
        self._revision = 0
        self._robot_travel: float | None = None
        self._robot_heading: float | None = None
        self._robot_retry = 0.0
        self._robot_manual = False
        self._robot_episode: tuple[str, str] | None = None
        self._cloud_task: asyncio.Task[None] | None = None
        self._jobs: set[asyncio.Task[None]] = set()
        self._tag_jobs: dict[str, asyncio.Task[None]] = {}
        self._poll_task: asyncio.Task[None] | None = None
        self._prefer_robot = True
        self._closed = False

    def start(self) -> None:
        if self._closed or self._poll_task is not None:
            return
        self._poll_task = asyncio.create_task(self._poll())

    async def close(self) -> None:
        self._closed = True
        tasks = tuple(self._jobs)
        if self._poll_task is not None:
            self._poll_task.cancel()
            tasks += (self._poll_task,)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    def reset(self) -> None:
        for task in tuple(self._jobs):
            task.cancel()
        self._clients.clear()
        self._issued.clear()
        self._robot_travel = None
        self._robot_heading = None
        self._robot_episode = None
        self._robot_retry = 0.0
        self._robot_manual = False
        self._transforms.clear()

    def _emit(self, client_id: str, body: dict[str, Any]) -> None:
        self._send(client_id, encode_text(body))

    def _context(self) -> dict[str, Any]:
        return {"map_code": self._map_code, "odom_reference_id": self._odometry.reference_id}

    def connect(self, client_id: str) -> None:
        self._clients[client_id] = MapClient()
        self._emit(client_id, {"type": "localization_context", **self._context()})
        transform = self._map_payload()
        if transform is not None:
            self._emit(client_id, transform)

    def disconnect(self, client_id: str) -> None:
        self._clients.pop(client_id, None)
        task = self._tag_jobs.pop(client_id, None)
        if task is not None:
            task.cancel()
        if self._robot_episode is not None and self._robot_episode[0] == client_id:
            self._robot_episode = None
        # Issued alignments can be resumed by their opaque identity in the same
        # map/source/tracking reference. The cache is bounded below.

    def manual(self, client_id: str) -> None:
        client = self._clients.get(client_id)
        if client is None:
            return
        if client.episode is not None:
            return
        if client.alignment is not None:
            # A runtime re-localize requests robot correction. Keep the accepted
            # headset map reference available for the normal fiducial-first path.
            self._robot_manual = True
            self._robot_retry = 0.0
            self._prefer_robot = True
        else:
            # Setup/reference recovery still needs an independent headset fix.
            client.request_manual_alignment()

    def progress(
        self,
        message: LocalizationTracking | LocalizationCaptureProgress,
        client_id: str,
        sync: TimeSync,
    ) -> None:
        client = self._clients.get(client_id)
        if client is None:
            return
        now = self._clock()
        if isinstance(message, LocalizationTracking):
            if client.reference and client.reference != message.tracking_reference_id:
                client.reset_reference()
                if self._robot_episode is not None and self._robot_episode[0] == client_id:
                    self._robot_episode = None
            if (
                client.reference == message.tracking_reference_id
                and message.travel_m < client.travel_m
            ):
                return
            client.reference = message.tracking_reference_id
            client.active = message.active
            client.seen_at = now
            client.travel_m = message.travel_m
            if message.alignment_id is not None:
                alignment = self._issued.get(message.alignment_id)
                if alignment is not None and alignment.matches(
                    message, self._odometry.reference_id, self._map_code
                ):
                    client.acknowledge_alignment(alignment)
                else:
                    client.alignment = None
                    self._emit(
                        client_id,
                        {"type": "localization_context", **self._context(), "reset": True},
                    )
            elif client.pending_alignment is None:
                client.alignment = None
            return
        episode = client.episode
        if episode is None or episode.id != message.episode_id:
            return
        if message.phase == "unavailable":
            if episode.purpose == "robot":
                self._tag_unavailable(client_id)
            else:
                self._finish_capture(client_id, "failed", "capture_unavailable")
                client.retry_at = now + 2.0
                self._offer_tag_fallback(client_id)
            return
        episode.update_progress(
            message, sync, now=now, preference_s=self._preference, timeout_s=self._timeout
        )

    def observations(self, observations: Sequence[Observation], client_id: str) -> None:
        client = self._clients.get(client_id)
        episode = client.episode if client is not None else None
        if client is None or episode is None or episode.phase != "submitted" or not observations:
            return
        newest = max(observations, key=lambda item: item.ts_server)
        if episode.capture_ts is None or abs(newest.ts_server - episode.capture_ts) > 0.000001:
            return
        if not -0.25 <= self._wall_clock() - newest.ts_server <= 2.0:
            self._finish_capture(client_id, "deferred", "fresh_capture_required")
            client.retry_at = self._clock() + 0.25
            return
        episode.begin_processing()
        if episode.purpose == "robot":
            task = self._spawn(self._tag(client_id, client, episode, tuple(observations)))
            self._tag_jobs[client_id] = task
        elif self._cloud_task is None or self._cloud_task.done():
            self._cloud_task = self._spawn(self._headset(client_id, client, episode, newest))
        else:
            self._finish_capture(client_id, "deferred", "query_busy")
            client.retry_at = self._clock() + 0.25

    def _spawn(self, awaitable: Any) -> asyncio.Task[None]:
        task: asyncio.Task[None] = asyncio.create_task(awaitable)
        self._jobs.add(task)
        task.add_done_callback(self._done)
        return task

    def _done(self, task: asyncio.Task[None]) -> None:
        self._jobs.discard(task)
        if not task.cancelled() and task.exception() is not None:
            logger.error("map localization task failed", error=type(task.exception()).__name__)

    def _active(self, client: MapClient) -> bool:
        return client.active and self._clock() - client.seen_at <= 2.5

    def _headset_due(self, client: MapClient) -> bool:
        if client.awaiting_acceptance(now=self._clock()):
            return False
        relative = client.relative_alignment
        if relative is not None:
            latest = self._odometry.history.latest()
            return (
                client.force
                or client.manual
                or client.travel_m - relative.travel_m >= self._headset_distance
                or self._odometry.travel() - relative.robot_travel_m >= self._distance
                or (
                    latest is not None
                    and abs(
                        math.remainder(
                            quaternion_yaw(latest.orientation) - relative.robot_heading, 2 * math.pi
                        )
                    )
                    >= self._angle
                )
            )
        return (
            client.force
            or client.manual
            or client.alignment is None
            or (client.travel_m - client.alignment.travel_m >= self._headset_distance)
        )

    def _robot_due(self) -> bool:
        latest = self._odometry.history.latest()
        if latest is None:
            return False
        return (
            self._robot_manual
            or self._robot_travel is None
            or self._robot_heading is None
            or (
                self._odometry.travel() - self._robot_travel >= self._distance
                or abs(
                    math.remainder(
                        quaternion_yaw(latest.orientation) - self._robot_heading, 2 * math.pi
                    )
                )
                >= self._angle
            )
        )

    async def _poll(self) -> None:
        while True:
            self._tick()
            await asyncio.sleep(0.1)

    def _tick(self) -> None:
        now = self._clock()
        for client_id, client in tuple(self._clients.items()):
            episode = client.episode
            if episode is not None and now >= episode.deadline:
                if episode.purpose == "robot":
                    self._tag_unavailable(client_id)
                else:
                    self._finish_capture(client_id, "failed", "capture_timeout")
                    client.retry_at = now + 2.0
                    self._offer_tag_fallback(client_id)
        active = [(key, value) for key, value in self._clients.items() if self._active(value)]
        if not active:
            return
        # A failed initial VPS attempt can always try a tag, even before a map
        # anchor exists. Relative alignments prefer tags for subsequent fixes.
        tag = next(
            (
                (key, value)
                for key, value in active
                if value.episode is None
                and now >= value.retry_at
                and value.next_attempt == "tag"
                and self._headset_due(value)
            ),
            None,
        )
        if self._marker is not None and tag is not None and self._robot_episode is None:
            key, client = tag
            client.next_attempt = "vps"
            episode = self._request(key, client, "robot")
            self._robot_episode = (key, episode.id)
            return
        if self._cloud_task is not None and not self._cloud_task.done():
            return
        # A requested headset frame owns the next cloud turn while it is being
        # collected. Robot motion cannot repeatedly overtake slow camera startup.
        if any(
            client.episode is not None and client.episode.purpose == "headset"
            for _, client in active
        ):
            return
        headset = next(
            (
                (key, value)
                for key, value in active
                if value.episode is None and now >= value.retry_at and self._headset_due(value)
            ),
            None,
        )
        robot_due = (
            self._robot_due()
            and self._robot_episode is None
            and now >= self._robot_retry
            and any(value.alignment is not None or self._headset_due(value) for _, value in active)
        )
        if robot_due and (self._prefer_robot or headset is None or self._map_payload() is None):
            self._prefer_robot = False
            eligible = next(
                (
                    (key, value)
                    for key, value in active
                    if value.alignment is not None
                    and value.episode is None
                    and not self._headset_due(value)
                ),
                None,
            )
            if self._marker is not None and eligible is not None:
                key, client = eligible
                episode = self._request(key, client, "robot")
                self._robot_episode = (key, episode.id)
            else:
                self._launch_robot()
            return
        if headset is not None and self._map_payload() is not None and self._admission.delay() == 0:
            key, client = headset
            self._clients.move_to_end(key)
            self._request(key, client, "headset")
            self._prefer_robot = True
        elif robot_due:
            self._launch_robot()
        elif headset is not None and self._admission.delay() > 0:
            self._offer_tag_fallback(headset[0])

    def _request(
        self, client_id: str, client: MapClient, purpose: CapturePurpose
    ) -> CaptureEpisode:
        episode = CaptureEpisode(
            uuid4().hex,
            purpose,
            self._clock() + (max(0.25, self._preference) if purpose == "robot" else self._timeout),
        )
        if purpose == "robot":
            episode.gate_deadline = episode.deadline
        client.episode = episode
        self._clients.move_to_end(client_id)
        payload: dict[str, Any] = {
            "type": "localization_observations_request",
            "episode_id": episode.id,
            "purpose": purpose,
            "result_timeout_s": self._timeout + 3.0,
            "capture_policy": "robot_los_preferred" if purpose == "robot" else "any_angle",
            "observation_count": 3 if purpose == "robot" else 1,
        }
        if purpose == "robot":
            payload["wait_timeout_s"] = self._preference
        self._emit(client_id, payload)
        return episode

    def _offer_tag_fallback(self, client_id: str | None = None) -> None:
        if self._marker is None:
            return
        for key, client in self._clients.items():
            if (
                (client_id is None or key == client_id)
                and client.alignment is None
                and client.episode is None
                and self._active(client)
                and self._headset_due(client)
            ):
                client.next_attempt = "tag"
                # Cloud admission can defer for 30 s; local tag recovery only
                # needs the ordinary short retry backoff, not that cloud wait.
                client.retry_at = min(client.retry_at, self._clock() + 2.0)

    def _tag_unavailable(self, key: str) -> None:
        client = self._clients[key]
        self._finish_capture(key, "deferred", "tag_unavailable")
        self._robot_episode = None
        client.next_attempt = "vps"
        client.retry_at = self._clock() + 2.0
        self._robot_retry = 0.0
        self._prefer_robot = True
        self._launch_robot()

    def _robot_failed(self, reason: str) -> None:
        self._robot_status("failed", reason)
        self._robot_retry = self._clock() + 2.0
        self._offer_tag_fallback()

    def _finish_capture(
        self,
        client_id: str,
        status: str,
        reason: str,
        retry_after_s: float | None = None,
    ) -> None:
        client = self._clients.get(client_id)
        episode = client.episode if client is not None else None
        if client is None or episode is None:
            return
        payload: dict[str, Any] = {
            "type": "localization_status",
            **self._context(),
            "scope": episode.purpose,
            "episode_id": episode.id,
            "status": status,
            "reason": reason,
        }
        if retry_after_s is not None:
            payload["retry_after_s"] = retry_after_s
        if episode.capture_ts is not None:
            payload["ts"] = episode.capture_ts
        self._emit(client_id, payload)
        client.finish_capture()

    def _robot_status(self, status: str, reason: str) -> None:
        for key, client in self._clients.items():
            if client.alignment is not None or self._active(client):
                self._emit(
                    key,
                    {
                        "type": "localization_status",
                        **self._context(),
                        "scope": "robot",
                        "status": status,
                        "reason": reason,
                    },
                )

    def _map_payload(self) -> dict[str, Any] | None:
        sample = self._transforms.vps_sample()
        if sample is None or sample.source_generation != self._odometry.generation:
            return None
        return {
            "type": "localization_map_transform",
            **self._context(),
            "revision": self._revision,
            "ts": sample.ts_server,
            "confidence": sample.confidence or 0.0,
            **_pose_payload(sample.T_odom_map),
        }

    def _commit_robot(
        self,
        localized: LocalizedPose,
        timestamp: float,
        travel: float,
        heading: float,
        generation: int,
        *,
        fiducial: bool = False,
    ) -> bool:
        previous = self._transforms.vps_sample()
        if generation != self._odometry.generation or (
            previous is not None and timestamp <= previous.ts_server
        ):
            return False
        if not self._transforms.update_from_vps(
            localized,
            ts_server=timestamp,
            travel_m=travel,
            map_code=self._map_code,
            source_generation=generation,
            min_confidence=0.0 if fiducial else None,
        ):
            return False
        self._robot_travel = travel
        self._robot_heading = heading
        self._robot_manual = False
        self._robot_retry = 0.0
        self._revision += 1
        payload = self._map_payload()
        assert payload is not None
        for key in self._clients:
            self._emit(key, payload)
        self._robot_status("succeeded", "aligned")
        return True

    async def _query(self, observation: Observation) -> LocalizedPose | None:
        token = self._admission.capture_ts.set(observation.ts_server)
        try:
            return await self._vps.localize([observation])
        finally:
            self._admission.capture_ts.reset(token)

    def _launch_robot(self) -> None:
        if not self._robot_due():
            return
        if any(
            client.episode is not None and client.episode.purpose == "headset"
            for client in self._clients.values()
        ):
            return
        if self._cloud_task is not None and not self._cloud_task.done():
            return
        delay = self._admission.delay()
        if delay > 0:
            # Cloud throttling must not suppress a new fiducial opportunity.
            self._robot_retry = self._clock() + min(2.0, delay)
            self._offer_tag_fallback()
            return
        self._cloud_task = self._spawn(self._robot())

    async def _robot(self) -> None:
        generation = self._odometry.generation
        try:
            async with asyncio.timeout(self._timeout):
                sample = self._robot_images.newest(now_server=self._wall_clock())
                if sample is None or sample.source_generation != generation:
                    self._robot_failed("robot_capture_unavailable")
                    return
                pose = self._odometry.history.at_image_ts(sample.observation.ts_server)
                if pose is None:
                    self._robot_failed("robot_pose_unavailable")
                    return
                localized = await self._query(sample.observation)
                if generation != self._odometry.generation:
                    return
                previous = self._transforms.vps_sample()
                if previous is not None and previous.ts_server >= sample.observation.ts_server:
                    return
                if localized is None or not self._commit_robot(
                    localized,
                    sample.observation.ts_server,
                    sample.travel_m,
                    quaternion_yaw(pose.orientation),
                    generation,
                ):
                    self._robot_failed("robot_localization_failed")
        except QueryDeferredError as exc:
            self._robot_retry = self._clock() + max(0.25, min(2.0, exc.retry_after_s))
            self._offer_tag_fallback()
        except Exception as exc:
            if generation == self._odometry.generation:
                logger.warning(
                    "robot map correction failed", error=type(exc).__name__, exc_info=True
                )
                self._robot_failed("robot_localization_failed")

    def _issue_alignment(self, client: MapClient, alignment: MapAlignment) -> None:
        self._issued[alignment.id] = alignment
        protected = {
            value.alignment.id for value in self._clients.values() if value.alignment is not None
        }
        protected.update(
            value.pending_alignment.id
            for value in self._clients.values()
            if value.pending_alignment is not None
        )
        protected.add(alignment.id)
        while len(self._issued) > 256 + len(protected):
            oldest = next(
                (identity for identity in self._issued if identity not in protected), None
            )
            if oldest is None:
                break
            del self._issued[oldest]
        client.issue_alignment(alignment, now=self._clock())

    async def _headset(
        self,
        key: str,
        client: MapClient,
        episode: CaptureEpisode,
        observation: Observation,
    ) -> None:
        generation = self._odometry.generation
        reference = client.reference
        try:
            async with asyncio.timeout(self._timeout):
                localized = await self._query(observation)
                if (
                    self._clients.get(key) is not client
                    or client.episode is not episode
                    or reference != client.reference
                    or generation != self._odometry.generation
                ):
                    return
                anchor = self._transforms.vps_sample()
                if localized is None or anchor is None:
                    self._finish_capture(key, "failed", "headset_localization_failed")
                    client.retry_at = self._clock() + 2.0
                    self._offer_tag_fallback(key)
                    return
                map_client = np.asarray(pose_to_matrix(localized.pose), dtype=np.float64)
                pose = _pose_payload(map_client)
                alignment = MapAlignment(
                    id=uuid4().hex,
                    map_code=self._map_code,
                    odom_reference_id=self._odometry.reference_id,
                    tracking_reference_id=reference,
                    travel_m=episode.travel_m,
                    ts=observation.ts_server,
                    confidence=localized.confidence,
                    position=tuple(pose["position"]),
                    orientation=tuple(pose["orientation"]),
                )
                self._issue_alignment(client, alignment)
                transform = self._map_payload()
                assert transform is not None
                self._emit(
                    key,
                    {
                        "type": "localization_result",
                        **_pose_payload(anchor.T_odom_map @ map_client),
                        "confidence": min(localized.confidence, anchor.confidence or 0.0),
                        "ts": observation.ts_server,
                        "map_alignment": alignment.wire(),
                        "map_transform": transform,
                    },
                )
                client.finish_capture()
        except QueryDeferredError as exc:
            if client.episode is episode:
                self._finish_capture(key, "deferred", exc.reason, exc.retry_after_s)
                client.retry_at = self._clock() + max(0.25, exc.retry_after_s)
                self._offer_tag_fallback(key)
        except Exception as exc:
            if self._clients.get(key) is client and client.episode is episode:
                logger.warning(
                    "headset map alignment failed", error=type(exc).__name__, exc_info=True
                )
                self._finish_capture(key, "failed", "headset_localization_failed")
                client.retry_at = self._clock() + 2.0
                self._offer_tag_fallback(key)

    async def _tag(
        self,
        key: str,
        client: MapClient,
        episode: CaptureEpisode,
        observations: tuple[Observation, ...],
    ) -> None:
        generation = self._odometry.generation
        alignment = client.alignment
        reference = client.reference
        try:
            assert self._marker is not None
            marker = self._marker.snapshot()
            async with asyncio.timeout(self._timeout):
                localized = await self._worker.run(lambda: marker.localize(observations))
            if (
                self._clients.get(key) is not client
                or client.episode is not episode
                or generation != self._odometry.generation
                or reference != client.reference
            ):
                return
            newest = max(observations, key=lambda item: item.ts_server)
            pose = self._odometry.history.at_server_ts(newest.ts_server)
            if alignment is None and client.alignment is None and self._active(client):
                if localized is not None and pose is not None:
                    # A marker yields T_odom_client directly; it needs neither a
                    # robot-camera image nor a fabricated VPS map registration.
                    client.accept_relative_alignment(
                        RelativeAlignment(
                            episode.travel_m, pose.travel_m, quaternion_yaw(pose.orientation)
                        )
                    )
                    self._emit(
                        key,
                        {
                            "type": "localization_result",
                            **_pose_payload(pose_to_matrix(localized.pose)),
                            "confidence": localized.confidence,
                            "ts": newest.ts_server,
                        },
                    )
                    client.finish_capture()
                else:
                    self._tag_unavailable(key)
                return
            if (
                alignment is None
                or client.alignment is not alignment
                or self._headset_due(client)
                or not self._active(client)
            ):
                self._finish_capture(key, "deferred", "headset_alignment_changed")
                return
            previous = self._transforms.vps_sample()
            if previous is not None and previous.ts_server >= newest.ts_server:
                self._finish_capture(key, "succeeded", "superseded")
                return
            if localized is not None and pose is not None:
                map_client = np.asarray(
                    pose_to_matrix(Pose(*alignment.position, *alignment.orientation)),
                    dtype=np.float64,
                )
                odom_client = np.asarray(pose_to_matrix(localized.pose), dtype=np.float64)
                odom_map = odom_client @ np.linalg.inv(map_client)
                corrected = LocalizedPose(
                    matrix_to_pose(np.linalg.inv(odom_map)),
                    "map",
                    min(localized.confidence, alignment.confidence),
                )
                if self._commit_robot(
                    corrected,
                    newest.ts_server,
                    pose.travel_m,
                    quaternion_yaw(pose.orientation),
                    generation,
                    fiducial=True,
                ):
                    self._finish_capture(key, "succeeded", "tag_aligned")
                    return
            self._tag_unavailable(key)
        except Exception as exc:
            if self._clients.get(key) is client and client.episode is episode:
                logger.warning(
                    "robot tag correction failed", error=type(exc).__name__, exc_info=True
                )
                self._tag_unavailable(key)
        finally:
            if self._robot_episode == (key, episode.id):
                self._robot_episode = None
            if self._tag_jobs.get(key) is asyncio.current_task():
                self._tag_jobs.pop(key, None)
