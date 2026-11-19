"""One localization lifecycle for marker, VPS and native-map measurements.

The module loop owns all state. Providers return reference alignments, not camera
poses; camera/extrinsic composition stays in the existing numerical localizers.
"""

from __future__ import annotations

import asyncio
from collections import OrderedDict
from collections.abc import Callable, Sequence
from dataclasses import dataclass, replace
import math
import time
from typing import Any, Literal
from uuid import uuid4

import numpy as np

from dimos.ar.async_execution import BoundedWorker
from dimos.ar.localization.transforms import normalize_pose_estimate
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
from dimos.ar.spatial import FrameSnapshot, Matrix, frozen_matrix
from dimos.ar.websocket.protocol import (
    LocalizationCaptureProgress,
    LocalizationTracking,
    TimeSync,
    encode_text,
)
from dimos.utils.logging_config import setup_logger
from dimos.utils.transform_utils import matrix_to_pose, pose_to_matrix

logger = setup_logger()
Source = Literal["tag", "vps"]


def pose_payload(matrix: Matrix) -> dict[str, Any]:
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


@dataclass(frozen=True)
class Alignment:
    id: str
    shared_frame_id: str
    odom_reference_id: str
    tracking_reference_id: str
    T_map_tracking: Matrix
    source: Source
    travel_m: float
    robot_travel_m: float
    robot_heading: float
    ts: float
    confidence: float

    def wire(self) -> dict[str, Any]:
        return {
            "type": "localization_result",
            "alignment_id": self.id,
            "shared_frame_id": self.shared_frame_id,
            "odom_reference_id": self.odom_reference_id,
            "tracking_reference_id": self.tracking_reference_id,
            **pose_payload(self.T_map_tracking),
            "ts": self.ts,
            "confidence": self.confidence,
        }


@dataclass
class CaptureEpisode:
    id: str
    purpose: Literal["robot", "headset"]
    deadline: float
    phase: str = "requested"
    capture_ts: float | None = None
    travel_m: float = 0.0
    gate_deadline: float | None = None
    frames: FrameSnapshot | None = None


@dataclass
class Client:
    reference: str = ""
    active: bool = False
    seen_at: float = 0.0
    travel_m: float = 0.0
    alignment: Alignment | None = None
    pending_alignment: tuple[str, float] | None = None
    episode: CaptureEpisode | None = None
    retry_at: float = 0.0
    manual: bool = True
    waiting_for_pose: bool = False


class LocalizationCoordinator:
    def __init__(
        self,
        *,
        odometry: RobotOdometry,
        robot_images: RobotObservationBuffer,
        marker: SnapshotLocalizer | None,
        vps: AsyncLocalizer | None,
        worker: BoundedWorker,
        admission: VpsAdmission,
        map_code: str | None,
        send: Callable[[str, str], None],
        travel_threshold_m: float,
        heading_threshold_deg: float,
        marker_preference_s: float,
        headset_travel_threshold_m: float,
        timeout_s: float,
        clock: Callable[[], float] = time.monotonic,
        wall_clock: Callable[[], float] = time.time,
        allow_latest_robot_pose: bool = False,
        on_frame_change: Callable[[FrameSnapshot, Matrix | None], None] | None = None,
    ) -> None:
        self._odometry, self._robot_images = odometry, robot_images
        self._marker, self._vps = marker, vps
        self._worker, self._admission, self._map_code = worker, admission, map_code
        self._send, self._on_frame_change = send, on_frame_change
        self._clock, self._wall_clock = clock, wall_clock
        self._allow_latest_robot_pose = allow_latest_robot_pose
        self._distance, self._angle = travel_threshold_m, math.radians(heading_threshold_deg)
        self._preference, self._headset_distance = marker_preference_s, headset_travel_threshold_m
        self._timeout = timeout_s
        self._frames = FrameSnapshot.initial(odometry.reference_id)
        self._vps_adopted = False
        self._clients: OrderedDict[str, Client] = OrderedDict()
        self._issued: OrderedDict[str, Alignment] = OrderedDict()
        self._jobs: set[asyncio.Task[None]] = set()
        self._cloud_task: asyncio.Task[None] | None = None
        self._poll_task: asyncio.Task[None] | None = None
        self._robot_travel: float | None = None
        self._robot_heading: float | None = None
        self._robot_retry = 0.0
        self._robot_ts = -math.inf
        self._native_ts = -math.inf
        self._closed = False

    @property
    def frames(self) -> FrameSnapshot:
        return self._frames

    @property
    def context(self) -> dict[str, Any]:
        context: dict[str, Any] = {
            "shared_frame_id": self._frames.shared_frame_id,
            "odom_reference_id": self._frames.odom_reference_id,
            "revision": self._frames.revision,
        }
        if self._map_code is not None:
            context["map_code"] = self._map_code
        return context

    def _emit(self, key: str, body: dict[str, Any]) -> None:
        self._send(key, encode_text(body))

    def _publish_frames(self, snapshot: FrameSnapshot, rebase: Matrix | None = None) -> None:
        previous = self._frames
        self._frames = snapshot
        if rebase is not None:
            for identity, alignment in tuple(self._issued.items()):
                self._issued[identity] = replace(
                    alignment,
                    shared_frame_id=snapshot.shared_frame_id,
                    T_map_tracking=frozen_matrix(rebase @ alignment.T_map_tracking),
                )
            for client in self._clients.values():
                if client.alignment is not None:
                    client.alignment = self._issued[client.alignment.id]
        if self._on_frame_change is not None:
            self._on_frame_change(snapshot, rebase)
        payload: dict[str, Any] = {"type": "localization_context", **self.context}
        if rebase is not None:
            payload["rebase"] = {
                "previous_shared_frame_id": previous.shared_frame_id,
                **pose_payload(rebase),
            }
        for key in self._clients:
            self._emit(key, payload)

    def on_native_reference(
        self, T_native_odom: Matrix, *, ts_server: float, native_map_id: str
    ) -> bool:
        if not math.isfinite(ts_server) or ts_server <= self._native_ts:
            return False
        candidate = normalize_pose_estimate(
            np.array(frozen_matrix(T_native_odom), copy=True), max_tilt_rad=math.radians(5)
        )
        if candidate is None:
            return False
        native = frozen_matrix(candidate)
        before = self._frames
        if before.native_map_id not in (None, native_map_id):
            raise ValueError("native map changed; restart the odometry session")
        upper = (
            frozen_matrix(before.T_map_odom @ np.linalg.inv(native))
            if before.T_native_odom is None
            else before.T_map_native
        )
        self._native_ts = ts_server
        if before.T_native_odom is not None and np.allclose(before.T_native_odom, native):
            return False
        self._publish_frames(
            replace(
                before,
                revision=before.revision + 1,
                T_native_odom=native,
                T_map_native=upper,
                native_map_id=native_map_id,
                T_map_odom=frozen_matrix(upper @ native),
                ts=ts_server,
            )
        )
        return True

    def start(self) -> None:
        if not self._closed and self._poll_task is None:
            self._poll_task = asyncio.create_task(self._poll())

    async def close(self) -> None:
        self._closed = True
        tasks = tuple(self._jobs) + (() if self._poll_task is None else (self._poll_task,))
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        if self._vps is not None:
            await self._vps.close()

    def reset(self) -> None:
        for task in tuple(self._jobs):
            task.cancel()
        self._clients.clear()
        self._issued.clear()
        self._frames = FrameSnapshot.initial(self._odometry.reference_id)
        self._vps_adopted = False
        self._robot_travel = self._robot_heading = None
        self._robot_ts = self._native_ts = -math.inf
        self._robot_retry = 0.0

    def connect(self, client_id: str) -> None:
        self._clients[client_id] = Client()
        self._emit(client_id, {"type": "localization_context", **self.context})

    def disconnect(self, client_id: str) -> None:
        self._clients.pop(client_id, None)

    def manual(self, client_id: str) -> None:
        client = self._clients.get(client_id)
        if client is not None and client.episode is None:
            client.manual = True
            client.retry_at = 0.0
            self._robot_retry = 0.0

    def on_goal_reached(self, *, succeeded: bool) -> None:
        if succeeded:
            self._tick()

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
                client.alignment = client.pending_alignment = client.episode = None
                client.manual = True
            elif message.travel_m < client.travel_m:
                return
            client.reference, client.active = message.tracking_reference_id, message.active
            client.seen_at, client.travel_m = now, message.travel_m
            if message.alignment_id is not None:
                alignment = self._issued.get(message.alignment_id)
                if (
                    alignment is not None
                    and alignment.tracking_reference_id == client.reference
                    and alignment.odom_reference_id == self._odometry.reference_id
                    and alignment.shared_frame_id == self._frames.shared_frame_id
                    and message.travel_m >= alignment.travel_m
                ):
                    client.alignment = alignment
                    if (
                        client.pending_alignment is None
                        or client.pending_alignment[0] == alignment.id
                    ):
                        client.pending_alignment = None
                        client.manual = False
                else:
                    client.alignment = None
                    self._emit(
                        client_id, {"type": "localization_context", **self.context, "reset": True}
                    )
            return
        episode = client.episode
        if episode is None or episode.id != message.episode_id:
            return
        if message.phase == "unavailable":
            self._finish(client_id, "deferred", "capture_unavailable")
            client.retry_at = now + 2
            return
        if message.phase == "waiting" and episode.phase in ("requested", "capturing"):
            episode.deadline = episode.gate_deadline or now + max(0.25, self._preference)
        if message.phase == "capturing" and episode.phase in ("requested", "waiting"):
            episode.deadline = now + self._timeout
        episode.phase, episode.travel_m = message.phase, message.travel_m
        if message.capture_ts is not None:
            episode.capture_ts = sync.to_server_ts(message.capture_ts)
            episode.frames = self._frames
            episode.deadline = now + self._timeout

    def observations(self, observations: Sequence[Observation], client_id: str) -> None:
        client = self._clients.get(client_id)
        episode = client.episode if client is not None else None
        if client is None or episode is None or episode.phase != "submitted" or not observations:
            return
        newest = max(observations, key=lambda item: item.ts_server)
        if episode.capture_ts is None or abs(newest.ts_server - episode.capture_ts) > 1e-6:
            return
        if not -0.25 <= self._wall_clock() - newest.ts_server <= 2.0:
            self._finish(client_id, "deferred", "fresh_capture_required")
            client.retry_at = self._clock() + 0.25
            return
        episode.phase = "processing"
        if episode.purpose == "robot":
            self._spawn(self._tag(client_id, client, episode, tuple(observations)))
        elif self._cloud_task is None or self._cloud_task.done():
            self._cloud_task = self._spawn(self._headset(client_id, client, episode, newest))
        else:
            self._finish(client_id, "deferred", "query_busy")
            client.retry_at = self._clock() + 0.25

    def _spawn(self, awaitable: Any) -> asyncio.Task[None]:
        task = asyncio.create_task(awaitable)
        self._jobs.add(task)
        task.add_done_callback(self._done)
        return task

    def _done(self, task: asyncio.Task[None]) -> None:
        self._jobs.discard(task)
        if not task.cancelled() and task.exception() is not None:
            logger.error("localization task failed", error=type(task.exception()).__name__)

    def _active(self, client: Client) -> bool:
        return client.active and self._clock() - client.seen_at <= 2.5

    def _headset_due(self, client: Client) -> bool:
        if client.pending_alignment is not None:
            if self._clock() < client.pending_alignment[1]:
                return False
            client.pending_alignment = None
        alignment = client.alignment
        if client.manual or alignment is None:
            return True
        if client.travel_m - alignment.travel_m >= self._headset_distance:
            return True
        if alignment.source == "tag":
            latest = self._odometry.history.latest()
            return self._odometry.travel() - alignment.robot_travel_m >= self._distance or (
                latest is not None
                and abs(
                    math.remainder(
                        quaternion_yaw(latest.orientation) - alignment.robot_heading, 2 * math.pi
                    )
                )
                >= self._angle
            )
        return False

    def _robot_due(self) -> bool:
        latest = self._odometry.history.latest()
        return latest is not None and (
            self._robot_travel is None
            or self._robot_heading is None
            or self._odometry.travel() - self._robot_travel >= self._distance
            or abs(
                math.remainder(
                    quaternion_yaw(latest.orientation) - self._robot_heading, 2 * math.pi
                )
            )
            >= self._angle
        )

    async def _poll(self) -> None:
        while True:
            self._tick()
            await asyncio.sleep(0.1)

    def _tick(self) -> None:
        now = self._clock()
        active = [(key, client) for key, client in self._clients.items() if self._active(client)]
        for key, client in active:
            if client.episode is not None and now >= client.episode.deadline:
                self._finish(key, "failed", "capture_timeout")
                client.retry_at = now + 2
        available = (
            self._odometry.history.at_server_ts(
                self._wall_clock(), fallback_to_latest=self._allow_latest_robot_pose
            )
            is not None
        )
        for key, client in active:
            if client.waiting_for_pose == available:
                client.waiting_for_pose = not available
                self._emit(
                    key,
                    {
                        "type": "localization_status",
                        **self.context,
                        "scope": "robot",
                        "status": "deferred",
                        "reason": "robot_pose_available" if available else "robot_pose_unavailable",
                    },
                )
        for key, client in active:
            if (
                client.episode is None
                and now >= client.retry_at
                and not self._vps_adopted
                and self._vps is not None
                and client.alignment is not None
                and self._admission.delay() == 0
                and (self._cloud_task is None or self._cloud_task.done())
            ):
                self._request(key, client, "headset")
            elif client.episode is None and now >= client.retry_at and self._headset_due(client):
                if self._marker is not None:
                    self._request(key, client, "robot")
                elif self._vps is not None and self._vps_adopted and self._admission.delay() == 0:
                    self._request(key, client, "headset")
        if available and active and self._robot_due() and self._marker is not None:
            eligible = next(
                (
                    (key, client)
                    for key, client in active
                    if client.episode is None
                    and client.alignment is not None
                    and client.alignment.source == "vps"
                    and client.travel_m - client.alignment.travel_m < self._headset_distance
                    and now >= client.retry_at
                ),
                None,
            )
            if eligible is not None:
                self._request(*eligible, "robot")
                return
        if available and active:
            self._launch_robot()

    def _request(
        self, key: str, client: Client, purpose: Literal["robot", "headset"]
    ) -> CaptureEpisode:
        deadline = self._clock() + (
            max(0.25, self._preference) if purpose == "robot" else self._timeout
        )
        episode = CaptureEpisode(
            uuid4().hex, purpose, deadline, gate_deadline=deadline if purpose == "robot" else None
        )
        client.episode = episode
        self._clients.move_to_end(key)
        payload: dict[str, Any] = {
            "type": "localization_observations_request",
            "episode_id": episode.id,
            "purpose": purpose,
            "result_timeout_s": self._timeout + 3,
            "capture_policy": "robot_los_preferred" if purpose == "robot" else "any_angle",
            "observation_count": 3 if purpose == "robot" else 1,
        }
        if purpose == "robot":
            payload["wait_timeout_s"] = self._preference
        self._emit(key, payload)
        return episode

    def _finish(self, key: str, status: str, reason: str) -> None:
        client = self._clients.get(key)
        if client is None or client.episode is None:
            return
        episode = client.episode
        self._emit(
            key,
            {
                "type": "localization_status",
                **self.context,
                "scope": episode.purpose,
                "episode_id": episode.id,
                "status": status,
                "reason": reason,
                **({"ts": episode.capture_ts} if episode.capture_ts is not None else {}),
            },
        )
        client.episode = None

    def _current(
        self,
        key: str,
        client: Client,
        episode: CaptureEpisode,
        generation: int,
        reference: str,
        frame_id: str,
    ) -> bool:
        return (
            self._clients.get(key) is client
            and client.episode is episode
            and generation == self._odometry.generation
            and reference == client.reference
            and frame_id == self._frames.shared_frame_id
            and self._active(client)
        )

    def _issue(
        self,
        key: str,
        client: Client,
        episode: CaptureEpisode,
        transform: Matrix,
        source: Source,
        confidence: float,
        ts: float,
    ) -> None:
        pose = self._odometry.history.at_server_ts(
            ts, fallback_to_latest=self._allow_latest_robot_pose
        )
        if pose is None:
            self._finish(key, "deferred", "capture_pose_unavailable")
            client.retry_at = self._clock() + 2
            return
        alignment = Alignment(
            uuid4().hex,
            self._frames.shared_frame_id,
            self._odometry.reference_id,
            client.reference,
            frozen_matrix(transform),
            source,
            episode.travel_m,
            pose.travel_m,
            quaternion_yaw(pose.orientation),
            ts,
            confidence,
        )
        self._issued[alignment.id] = alignment
        protected = {c.alignment.id for c in self._clients.values() if c.alignment is not None}
        protected.update(
            c.pending_alignment[0]
            for c in self._clients.values()
            if c.pending_alignment is not None
        )
        protected.add(alignment.id)
        while len(self._issued) > 256 + len(protected):
            identity = next(k for k in self._issued if k not in protected)
            del self._issued[identity]
        client.pending_alignment = (alignment.id, self._clock() + 3)
        client.manual = False
        self._emit(key, alignment.wire())
        client.episode = None

    async def _query(self, observation: Observation) -> LocalizedPose | None:
        assert self._vps is not None
        token = self._admission.capture_ts.set(observation.ts_server)
        try:
            return await self._vps.localize([observation])
        finally:
            self._admission.capture_ts.reset(token)

    def _launch_robot(self) -> None:
        if (
            self._vps is None
            or not self._robot_due()
            or self._clock() < self._robot_retry
            or self._admission.delay() > 0
            or (self._cloud_task is not None and not self._cloud_task.done())
            or any(
                c.episode is not None and c.episode.purpose == "headset"
                for c in self._clients.values()
            )
        ):
            return
        self._cloud_task = self._spawn(self._robot())

    def _commit_robot(
        self,
        localized: LocalizedPose,
        *,
        ts: float,
        travel: float,
        heading: float,
        snapshot: FrameSnapshot,
    ) -> bool:
        if (
            snapshot.odom_reference_id != self._frames.odom_reference_id
            or localized.frame_id != "map"
            or not 0.5 <= localized.confidence <= 1
            or ts <= self._robot_ts
            or not math.isfinite(ts)
        ):
            return False
        T_vps_odom = frozen_matrix(np.asarray(pose_to_matrix(localized.pose), dtype=np.float64))
        before = self._frames
        rebase = None
        if not self._vps_adopted:
            rebase = frozen_matrix(T_vps_odom @ np.linalg.inv(snapshot.T_map_odom))
            T_map_odom = frozen_matrix(rebase @ before.T_map_odom)
            upper = (
                frozen_matrix(T_map_odom @ np.linalg.inv(before.T_native_odom))
                if (before.T_native_odom is not None)
                else T_map_odom
            )
            identity = f"vps:{self._map_code}"
        else:
            if snapshot.native_map_id != before.native_map_id:
                return False
            upper = (
                frozen_matrix(T_vps_odom @ np.linalg.inv(snapshot.T_native_odom))
                if (snapshot.T_native_odom is not None)
                else T_vps_odom
            )
            T_map_odom = (
                frozen_matrix(upper @ before.T_native_odom)
                if (before.T_native_odom is not None)
                else upper
            )
            identity = before.shared_frame_id
        self._robot_ts = ts
        self._robot_travel, self._robot_heading = travel, heading
        self._vps_adopted = True
        self._publish_frames(
            replace(
                before,
                shared_frame_id=identity,
                revision=before.revision + 1,
                T_map_odom=T_map_odom,
                T_map_native=upper,
                ts=ts,
                confidence=localized.confidence,
            ),
            rebase,
        )
        return True

    async def _robot(self) -> None:
        generation = self._odometry.generation
        try:
            sample = self._robot_images.newest(now_server=self._wall_clock())
            if sample is None or sample.source_generation != generation:
                self._robot_retry = self._clock() + 2
                return
            snapshot = sample.frames or self._frames
            pose = self._odometry.history.at_image_ts(sample.observation.ts_server)
            if pose is None:
                self._robot_retry = self._clock() + 2
                return
            async with asyncio.timeout(self._timeout):
                localized = await self._query(sample.observation)
            if generation != self._odometry.generation:
                return
            if localized is None or not self._commit_robot(
                localized,
                ts=sample.observation.ts_server,
                travel=sample.travel_m,
                heading=quaternion_yaw(pose.orientation),
                snapshot=snapshot,
            ):
                self._robot_retry = self._clock() + 2
        except QueryDeferredError as exc:
            self._robot_retry = self._clock() + max(0.25, min(2, exc.retry_after_s))
        except Exception as exc:
            logger.warning("robot localization failed", error=type(exc).__name__, exc_info=True)
            self._robot_retry = self._clock() + 2

    async def _headset(
        self, key: str, client: Client, episode: CaptureEpisode, observation: Observation
    ) -> None:
        generation, snapshot, reference = (
            self._odometry.generation,
            episode.frames or self._frames,
            client.reference,
        )
        try:
            async with asyncio.timeout(self._timeout):
                localized = await self._query(observation)
            if not self._current(
                key, client, episode, generation, reference, snapshot.shared_frame_id
            ):
                if client.episode is episode:
                    client.episode = None
                return
            if localized is None or localized.frame_id != "map":
                self._finish(key, "failed", "headset_localization_failed")
                client.retry_at = self._clock() + 2
                return
            if not self._vps_adopted:
                baseline = client.alignment
                if baseline is None:
                    self._finish(key, "deferred", "map_anchor_unavailable")
                    return
                vps_tracking = np.asarray(pose_to_matrix(localized.pose), dtype=np.float64)
                rebase = vps_tracking @ np.linalg.inv(baseline.T_map_tracking)
                pose = self._odometry.history.at_server_ts(
                    observation.ts_server, fallback_to_latest=self._allow_latest_robot_pose
                )
                if pose is None or not self._commit_robot(
                    LocalizedPose(
                        matrix_to_pose(rebase @ snapshot.T_map_odom),
                        "map",
                        min(localized.confidence, baseline.confidence),
                    ),
                    ts=observation.ts_server,
                    travel=pose.travel_m,
                    heading=quaternion_yaw(pose.orientation),
                    snapshot=snapshot,
                ):
                    self._finish(key, "deferred", "map_anchor_unavailable")
                    return
            self._issue(
                key,
                client,
                episode,
                np.asarray(pose_to_matrix(localized.pose), dtype=np.float64),
                "vps",
                localized.confidence,
                observation.ts_server,
            )
        except Exception as exc:
            logger.warning("headset localization failed", error=type(exc).__name__, exc_info=True)
            if client.episode is episode:
                self._finish(key, "failed", "headset_localization_failed")
                client.retry_at = self._clock() + 2

    async def _tag(
        self,
        key: str,
        client: Client,
        episode: CaptureEpisode,
        observations: tuple[Observation, ...],
    ) -> None:
        generation, snapshot, reference = (
            self._odometry.generation,
            episode.frames or self._frames,
            client.reference,
        )
        baseline = client.alignment
        try:
            assert self._marker is not None
            marker = self._marker.snapshot()
            async with asyncio.timeout(self._timeout):
                localized = await self._worker.run(lambda: marker.localize(observations))
            if not self._current(
                key, client, episode, generation, reference, snapshot.shared_frame_id
            ):
                if client.episode is episode:
                    client.episode = None
                return
            if localized is None:
                self._finish(key, "deferred", "tag_unavailable")
                client.retry_at = self._clock() + 2
                if self._vps is not None and self._vps_adopted and self._admission.delay() == 0:
                    self._request(key, client, "headset")
                return
            if localized.frame_id != "odom":
                raise ValueError("marker reference must be odom")
            ts = max(item.ts_server for item in observations)
            odom_tracking = np.asarray(pose_to_matrix(localized.pose), dtype=np.float64)
            if (
                baseline is not None
                and baseline.source == "vps"
                and client.alignment is baseline
                and client.travel_m - baseline.travel_m < self._headset_distance
            ):
                # An independently VPS-aligned headset may correct the robot edge.
                map_odom = baseline.T_map_tracking @ np.linalg.inv(odom_tracking)
                native = snapshot.T_native_odom
                upper = (
                    frozen_matrix(map_odom @ np.linalg.inv(native))
                    if native is not None
                    else frozen_matrix(map_odom)
                )
                before = self._frames
                if ts > self._robot_ts and before.native_map_id == snapshot.native_map_id:
                    self._robot_ts = ts
                    pose = self._odometry.history.at_server_ts(
                        ts, fallback_to_latest=self._allow_latest_robot_pose
                    )
                    if pose is not None:
                        self._robot_travel = pose.travel_m
                        self._robot_heading = quaternion_yaw(pose.orientation)
                    composed = (
                        upper @ before.T_native_odom if before.T_native_odom is not None else upper
                    )
                    self._publish_frames(
                        replace(
                            before,
                            revision=before.revision + 1,
                            T_map_native=upper,
                            T_map_odom=frozen_matrix(composed),
                            ts=ts,
                            confidence=min(baseline.confidence, localized.confidence),
                        )
                    )
                self._finish(key, "succeeded", "tag_aligned")
                client.manual = False
            else:
                self._issue(
                    key,
                    client,
                    episode,
                    self._frames.T_map_odom @ odom_tracking,
                    "tag",
                    localized.confidence,
                    ts,
                )
        except Exception as exc:
            logger.warning("tag localization failed", error=type(exc).__name__, exc_info=True)
            if client.episode is episode:
                self._finish(key, "failed", "tag_localization_failed")
                client.retry_at = self._clock() + 2
