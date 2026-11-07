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
from typing import Any
from uuid import uuid4

import numpy as np

from dimos.ar.localization.coordinator import AsyncLocalizer
from dimos.ar.localization.odom_map_transform import OdomMapTransform
from dimos.ar.localization.types import LocalizedPose, Observation, SnapshotLocalizer
from dimos.ar.localization.vps.admission import QueryDeferredError, VpsAdmission
from dimos.ar.localization.vps.robot_observation_buffer import RobotObservationBuffer
from dimos.ar.localization.worker import LocalizationWorker
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


@dataclass
class CaptureEpisode:
    id: str
    purpose: str
    deadline: float
    phase: str = "requested"
    capture_ts: float | None = None
    travel_m: float = 0.0


@dataclass
class MapClient:
    reference: str = ""
    active: bool = False
    seen_at: float = 0.0
    travel_m: float = 0.0
    alignment: dict[str, Any] | None = None
    episode: CaptureEpisode | None = None
    retry_at: float = 0.0
    manual: bool = True
    force: bool = False
    awaiting_alignment: str | None = None
    acceptance_deadline: float = 0.0


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


def _yaw(orientation: Sequence[float]) -> float:
    x, y, z, w = orientation
    return math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z))


class MapLocalization:
    def __init__(
        self,
        *,
        odometry: RobotOdometry,
        transforms: OdomMapTransform,
        robot_images: RobotObservationBuffer,
        marker: SnapshotLocalizer | None,
        vps: AsyncLocalizer,
        worker: LocalizationWorker,
        admission: VpsAdmission,
        map_code: str,
        send: Callable[[str, str], None],
        travel_threshold_m: float,
        heading_threshold_deg: float,
        marker_preference_s: float,
        headset_travel_threshold_m: float,
        timeout_s: float,
    ) -> None:
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
        self._issued: OrderedDict[str, dict[str, Any]] = OrderedDict()
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
            client.manual = True
            client.force = True
            client.awaiting_alignment = None
            client.retry_at = 0.0

    def progress(
        self,
        message: LocalizationTracking | LocalizationCaptureProgress,
        client_id: str,
        sync: TimeSync,
    ) -> None:
        client = self._clients.get(client_id)
        if client is None:
            return
        now = time.monotonic()
        if isinstance(message, LocalizationTracking):
            if client.reference and client.reference != message.tracking_reference_id:
                client.alignment = None
                client.episode = None
                client.awaiting_alignment = None
                client.manual = True
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
                if alignment is not None and (
                    alignment["tracking_reference_id"] == client.reference
                    and alignment["odom_reference_id"] == self._odometry.reference_id
                    and alignment["map_code"] == self._map_code
                    and message.travel_m >= alignment["travel_m"]
                ):
                    client.alignment = alignment
                    if client.awaiting_alignment == message.alignment_id:
                        client.awaiting_alignment = None
                        client.manual = False
                        client.force = False
                    elif client.awaiting_alignment is None:
                        client.manual = False
                else:
                    client.alignment = None
                    self._emit(
                        client_id,
                        {"type": "localization_context", **self._context(), "reset": True},
                    )
            elif client.awaiting_alignment is None:
                client.alignment = None
            return
        episode = client.episode
        if episode is None or episode.id != message.episode_id:
            return
        if message.phase == "unavailable":
            if episode.purpose == "robot":
                self._finish_capture(client_id, "deferred", "tag_unavailable")
                self._robot_episode = None
                self._robot_retry = now
                self._prefer_robot = True
                self._launch_robot()
            else:
                self._finish_capture(client_id, "failed", "capture_unavailable")
                client.retry_at = now + 2.0
            return
        if message.phase == "waiting" and episode.phase in ("requested", "capturing"):
            episode.deadline = now + max(0.25, self._preference)
        if message.phase == "capturing" and episode.phase in ("requested", "waiting"):
            episode.deadline = now + self._timeout
        episode.phase = message.phase
        episode.travel_m = message.travel_m
        if message.capture_ts is not None:
            episode.capture_ts = sync.to_server_ts(message.capture_ts)
            episode.deadline = now + self._timeout

    def observations(self, observations: Sequence[Observation], client_id: str) -> None:
        client = self._clients.get(client_id)
        episode = client.episode if client is not None else None
        if client is None or episode is None or episode.phase != "submitted" or not observations:
            return
        newest = max(observations, key=lambda item: item.ts_server)
        if episode.capture_ts is None or abs(newest.ts_server - episode.capture_ts) > 0.000001:
            return
        if not -0.25 <= time.time() - newest.ts_server <= 2.0:
            self._finish_capture(client_id, "deferred", "fresh_capture_required")
            client.retry_at = time.monotonic() + 0.25
            return
        episode.phase = "processing"
        if episode.purpose == "robot":
            task = self._spawn(self._tag(client_id, client, episode, tuple(observations)))
            self._tag_jobs[client_id] = task
        elif self._cloud_task is None or self._cloud_task.done():
            self._cloud_task = self._spawn(self._headset(client_id, client, episode, newest))
        else:
            self._finish_capture(client_id, "deferred", "query_busy")
            client.retry_at = time.monotonic() + 0.25

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
        return client.active and time.monotonic() - client.seen_at <= 2.5

    def _headset_due(self, client: MapClient) -> bool:
        if client.awaiting_alignment is not None:
            if time.monotonic() < client.acceptance_deadline:
                return False
            client.awaiting_alignment = None
        return (
            client.force
            or client.manual
            or client.alignment is None
            or (client.travel_m - float(client.alignment["travel_m"]) >= self._headset_distance)
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
                or abs(math.remainder(_yaw(latest.orientation) - self._robot_heading, 2 * math.pi))
                >= self._angle
            )
        )

    async def _poll(self) -> None:
        while True:
            self._tick()
            await asyncio.sleep(0.1)

    def _tick(self) -> None:
        now = time.monotonic()
        for client_id, client in tuple(self._clients.items()):
            episode = client.episode
            if episode is not None and now >= episode.deadline:
                if episode.purpose == "robot":
                    self._finish_capture(client_id, "deferred", "tag_unavailable")
                    self._robot_episode = None
                    self._launch_robot()
                else:
                    self._finish_capture(client_id, "failed", "capture_timeout")
                    client.retry_at = now + 2.0
        if self._cloud_task is not None and not self._cloud_task.done():
            return
        active = [(key, value) for key, value in self._clients.items() if self._active(value)]
        if not active:
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
        robot_due = self._robot_due() and self._robot_episode is None and now >= self._robot_retry
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

    def _request(self, client_id: str, client: MapClient, purpose: str) -> CaptureEpisode:
        episode = CaptureEpisode(
            uuid4().hex,
            purpose,
            time.monotonic()
            + (max(0.25, self._preference) if purpose == "robot" else self._timeout),
        )
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
        client.episode = None

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
            self._robot_retry = time.monotonic() + min(2.0, delay)
            return
        self._cloud_task = self._spawn(self._robot())

    async def _robot(self) -> None:
        generation = self._odometry.generation
        try:
            async with asyncio.timeout(self._timeout):
                sample = self._robot_images.newest(now_server=time.time())
                if sample is None or sample.source_generation != generation:
                    self._robot_status("failed", "robot_capture_unavailable")
                    self._robot_retry = time.monotonic() + 2.0
                    return
                pose = self._odometry.history.at_image_ts(sample.observation.ts_server)
                if pose is None:
                    self._robot_status("failed", "robot_pose_unavailable")
                    self._robot_retry = time.monotonic() + 2.0
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
                    _yaw(pose.orientation),
                    generation,
                ):
                    self._robot_status("failed", "robot_localization_failed")
                    self._robot_retry = time.monotonic() + 2.0
        except QueryDeferredError as exc:
            self._robot_retry = time.monotonic() + max(0.25, min(2.0, exc.retry_after_s))
        except Exception as exc:
            if generation == self._odometry.generation:
                logger.warning("robot map correction failed", error=type(exc).__name__, exc_info=True)
                self._robot_status("failed", "robot_localization_failed")
                self._robot_retry = time.monotonic() + 2.0

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
                    client.retry_at = time.monotonic() + 2.0
                    return
                map_client = np.asarray(pose_to_matrix(localized.pose), dtype=np.float64)
                alignment = {
                    "id": uuid4().hex,
                    **self._context(),
                    "tracking_reference_id": reference,
                    "travel_m": episode.travel_m,
                    "ts": observation.ts_server,
                    "confidence": localized.confidence,
                    **_pose_payload(map_client),
                }
                self._issued[alignment["id"]] = alignment
                protected = {
                    value.alignment["id"]
                    for value in self._clients.values()
                    if value.alignment is not None
                }
                protected.update(
                    value.awaiting_alignment
                    for value in self._clients.values()
                    if value.awaiting_alignment is not None
                )
                protected.add(alignment["id"])
                while len(self._issued) > 256 + len(protected):
                    oldest = next(
                        (identity for identity in self._issued if identity not in protected), None
                    )
                    if oldest is None:
                        break
                    del self._issued[oldest]
                client.awaiting_alignment = alignment["id"]
                client.acceptance_deadline = time.monotonic() + 3.0
                client.manual = False
                transform = self._map_payload()
                assert transform is not None
                self._emit(
                    key,
                    {
                        "type": "localization_result",
                        **_pose_payload(anchor.T_odom_map @ map_client),
                        "confidence": min(localized.confidence, anchor.confidence or 0.0),
                        "ts": observation.ts_server,
                        "map_alignment": alignment,
                        "map_transform": transform,
                    },
                )
                client.episode = None
        except QueryDeferredError as exc:
            if client.episode is episode:
                self._finish_capture(key, "deferred", exc.reason, exc.retry_after_s)
                client.retry_at = time.monotonic() + max(0.25, exc.retry_after_s)
        except Exception as exc:
            if self._clients.get(key) is client and client.episode is episode:
                logger.warning("headset map alignment failed", error=type(exc).__name__, exc_info=True)
                self._finish_capture(key, "failed", "headset_localization_failed")
                client.retry_at = time.monotonic() + 2.0

    async def _tag(
        self,
        key: str,
        client: MapClient,
        episode: CaptureEpisode,
        observations: tuple[Observation, ...],
    ) -> None:
        generation = self._odometry.generation
        alignment = client.alignment
        try:
            assert self._marker is not None
            marker = self._marker.snapshot()
            async with asyncio.timeout(self._timeout):
                localized = await self._worker.run(lambda: marker.localize(observations))
            if (
                self._clients.get(key) is not client
                or client.episode is not episode
                or generation != self._odometry.generation
            ):
                return
            if (
                alignment is None
                or client.alignment is not alignment
                or self._headset_due(client)
                or not self._active(client)
            ):
                self._finish_capture(key, "deferred", "headset_alignment_changed")
                return
            newest = max(observations, key=lambda item: item.ts_server)
            previous = self._transforms.vps_sample()
            if previous is not None and previous.ts_server >= newest.ts_server:
                self._finish_capture(key, "succeeded", "superseded")
                return
            pose = self._odometry.history.at_server_ts(newest.ts_server)
            if localized is not None and pose is not None:
                map_client = np.asarray(
                    pose_to_matrix(Pose(*alignment["position"], *alignment["orientation"])),
                    dtype=np.float64,
                )
                odom_client = np.asarray(pose_to_matrix(localized.pose), dtype=np.float64)
                odom_map = odom_client @ np.linalg.inv(map_client)
                corrected = LocalizedPose(
                    matrix_to_pose(np.linalg.inv(odom_map)),
                    "map",
                    min(localized.confidence, float(alignment["confidence"])),
                )
                if self._commit_robot(
                    corrected,
                    newest.ts_server,
                    pose.travel_m,
                    _yaw(pose.orientation),
                    generation,
                    fiducial=True,
                ):
                    self._finish_capture(key, "succeeded", "tag_aligned")
                    return
            self._finish_capture(key, "deferred", "tag_unavailable")
            self._launch_robot()
        except Exception as exc:
            if self._clients.get(key) is client and client.episode is episode:
                logger.warning("robot tag correction failed", error=type(exc).__name__, exc_info=True)
                self._finish_capture(key, "deferred", "tag_unavailable")
                self._launch_robot()
        finally:
            if self._robot_episode == (key, episode.id):
                self._robot_episode = None
            if self._tag_jobs.get(key) is asyncio.current_task():
                self._tag_jobs.pop(key, None)
