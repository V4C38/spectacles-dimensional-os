"""Validated, read-only recordings without robot connections or control modules."""

from __future__ import annotations

import asyncio
import copy
from dataclasses import replace
import math
import os
from pathlib import Path
import time
from typing import Any, ClassVar

from dimos.ar.manipulation.model import ReferencePose
from dimos.ar.module import ARModule
from dimos.ar.robot.capabilities import Capability, CapabilityName
from dimos.ar.robot.odometry import RobotSourceClock
from dimos.ar.robot.profiles.profile import RobotName
from dimos.ar.websocket.protocol import encode_text
from dimos.core.core import rpc
from dimos.memory.store.sqlite import SqliteStore
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.msgs.sensor_msgs.CameraInfo import CameraInfo
from dimos.msgs.sensor_msgs.Image import Image
from dimos.msgs.sensor_msgs.JointState import JointState
from dimos.msgs.sensor_msgs.PointCloud2 import PointCloud2
from dimos.msgs.std_msgs.Float32 import Float32


def inspect_recording(
    path: str, robot: str, selected: dict[str, str] | None = None
) -> dict[str, Any]:
    source = Path(path).expanduser()
    if source.suffix != ".db" or not source.is_file():
        raise ValueError("Choose an existing .db recording")
    store = SqliteStore(path=str(source), must_exist=True)
    store.start()
    try:
        required = (
            {"joints": JointState}
            if robot == "openyam"
            else {
                "odom": PoseStamped,
                "lidar": PointCloud2,
                "color_image": Image,
            }
        )
        optional = {"gripper": Float32} if robot == "openyam" else {"camera_info": CameraInfo}
        candidates: dict[str, list[str]] = {}
        streams: dict[str, str] = {}
        selected = selected or {}
        for role, expected in {**required, **optional}.items():
            candidates[role] = []
            for name in store.list_streams():
                stream = store.stream(name)
                if not isinstance(stream.data_type, type) or not issubclass(
                    stream.data_type, expected
                ):
                    continue
                if stream.count() and isinstance(stream.first().data, expected):
                    candidates[role].append(name)
            choices = candidates[role]
            if role in selected and selected[role] not in choices:
                raise ValueError(f"Invalid {role} stream: {selected[role]}")
            if role in selected:
                streams[role] = selected[role]
            elif len(choices) == 1:
                streams[role] = choices[0]
            elif not choices and role in required:
                raise ValueError(f"Recording needs a nonempty {expected.__name__} stream ({role})")
        if robot == "openyam" and "joints" in streams:
            from dimos.robot.manipulators.openyam.config import make_openyam_model_config

            names = set(make_openyam_model_config().joint_names)
            for observation in store.stream(streams["joints"]):
                sample = observation.data
                if (
                    not isinstance(sample, JointState)
                    or len(set(sample.name)) != len(sample.name)
                    or len(sample.position) != len(sample.name)
                    or not names.issubset(sample.name)
                    or not all(math.isfinite(q) for q in sample.position)
                ):
                    raise ValueError(
                        "Every arm sample must contain all model joints with finite positions"
                    )
        if "gripper" in streams:
            for observation in store.stream(streams["gripper"]):
                sample = observation.data
                if (
                    not isinstance(sample, Float32)
                    or not math.isfinite(sample.data)
                    or not 0 <= sample.data <= 1
                ):
                    raise ValueError("Recorded gripper opening must be normalized 0-1")
        return {
            "streams": streams,
            "candidates": candidates,
            "needs_selection": any(role not in streams for role in required),
        }
    finally:
        store.stop()


class RecordedARModule(ARModule):
    """Publishes recording messages through the normal AR handlers at 1x, once."""

    _recording_source: ClassVar[bool] = True

    @rpc  # type: ignore[untyped-decorator]
    def build(self) -> None:
        super().build()
        # Playback translates producer timestamps once, before normal handlers.
        self._odometry.clock = RobotSourceClock()
        from dimos.memory.replay import resolve_db_path

        self._recording_path = os.environ.get("REPLAY_DB") or str(resolve_db_path("go2_short"))
        import json

        selected = json.loads(os.environ.get("DIMOS_AR_REPLAY_STREAMS", "{}"))
        if not os.environ.get("REPLAY_DB"):
            # The bundled Go2 dataset includes alternate embedded image streams;
            # retain its official connection's canonical stream binding.
            selected = {"odom": "odom", "lidar": "lidar", "color_image": "color_image", **selected}
        self._recording_robot = (
            "openyam" if self.config.robot == RobotName.OPENYAM else "unitree_go2"
        )
        info = inspect_recording(self._recording_path, self._recording_robot, selected)
        if info["needs_selection"]:
            raise ValueError("Choose the recording streams in the launcher")
        self._streams = info["streams"]
        unavailable = Capability(False, "Recording playback is read-only")
        self._capabilities = replace(
            self._capabilities,
            _items={
                name: unavailable
                if name in {CapabilityName.NAVIGATION, CapabilityName.AGENT, CapabilityName.ESTOP}
                else cap
                for name, cap in self._capabilities._items.items()
            },
            _navigation=dict.fromkeys(self._capabilities._navigation, unavailable),
        )
        if self._recording_robot == "openyam":
            self._capabilities._items[CapabilityName.MANIPULATION] = Capability(True, None)
        self._last_samples: dict[str, Any] = {}
        self._sample_tasks: set[asyncio.Task[None]] = set()
        self._recording_epoch = 0.0
        self._playback_start = 0.0
        self._duration = 0.0
        self._playback_state = "playing"
        self._recording_store: Any = None
        self._recording_task: asyncio.Task[None] | None = None
        self._arm_fk: Any = None
        if self._recording_robot == "openyam":
            from dimos.ar.manipulation.model import describe_model
            from dimos.control.tasks.pose_target_ik import (
                PinkPoseTargetSolver,
                PoseTargetIKTaskConfig,
            )
            from dimos.robot.manipulators.openyam.config import make_openyam_model_config

            self._arm_model = make_openyam_model_config()
            frames = tuple(g.tip_link for g in self._arm_model.planning_groups if g.tip_link)
            self._arm_fk = PinkPoseTargetSolver(
                PoseTargetIKTaskConfig(
                    joint_names=tuple(self._arm_model.joint_names),
                    robot_model=self._arm_model,
                    target_frames=frames,
                )
            )
            self._arm_descriptor = describe_model(
                self._arm_model.model.load().xml,
                "/models/openyam.glb",
                visual_profile="openyam",
                gripper_open_at_lower=["joint7", "joint8"],
            )

    def _hello_body(self, client_id: str) -> Any:
        return replace(
            super()._hello_body(client_id),
            source={
                "kind": "recording",
                "read_only": True,
                "name": Path(self._recording_path).name,
            },
        )

    def _state_snapshot(self) -> Any:
        elapsed = max(0.0, time.monotonic() - self._playback_start) if self._playback_start else 0.0
        return replace(
            super()._state_snapshot(),
            playback={
                "state": self._playback_state,
                "elapsed_s": min(elapsed, self._duration),
                "duration_s": self._duration,
            },
        )

    @rpc  # type: ignore[untyped-decorator]
    def start(self) -> None:
        super().start()
        self._loop.call_soon_threadsafe(self._start_recording)

    def _start_recording(self) -> None:
        self._recording_task = asyncio.create_task(self._play())

    async def _play(self) -> None:
        store = SqliteStore(path=self._recording_path, must_exist=True)
        store.start()
        self._recording_store = store
        replay = store.replay(speed=1.0, loop=False)
        streams = {role: replay.stream(name) for role, name in self._streams.items()}
        starts = [s.first_ts() for s in streams.values() if s.first_ts() is not None]
        ends = [s.last_ts() for s in streams.values() if s.last_ts() is not None]
        anchor = min(starts)
        self._duration = max(ends) - anchor
        self._recording_epoch = time.time() - anchor
        replay.pin_anchor(anchor)
        self._playback_start = time.monotonic()
        subscriptions = []
        for role, stream in streams.items():
            subscriptions.append(
                stream.observable().subscribe(
                    lambda sample, role=role: self._loop.call_soon_threadsafe(
                        lambda: self._schedule_sample(role, sample)
                    )
                )
            )
        try:
            while True:
                self._playback_state = (
                    "ended"
                    if time.monotonic() - self._playback_start >= self._duration
                    else "playing"
                )
                if self._playback_state == "ended":
                    await self._publish_retained()
                self._broadcast_state()
                await asyncio.sleep(0.1)
        finally:
            for subscription in subscriptions:
                subscription.dispose()
            for task in tuple(self._sample_tasks):
                task.cancel()
            await asyncio.gather(*self._sample_tasks, return_exceptions=True)
            store.stop()
            self._recording_store = None

    def _schedule_sample(self, role: str, sample: Any) -> None:
        task = asyncio.create_task(self._sample(role, sample))
        self._sample_tasks.add(task)
        def done(completed: asyncio.Task[None]) -> None:
            self._sample_tasks.discard(completed)
            if not completed.cancelled():
                completed.exception()
        task.add_done_callback(done)

    async def _publish_retained(self) -> None:
        # Retention is presentation, not a new source measurement or camera query.
        pose = self._odometry.history.latest()
        if pose is not None:
            self._state_publisher.publish_odom(pose)
        for role in ("lidar", "joints"):
            sample = self._last_samples.get(role)
            if sample is None:
                continue
            msg = copy.copy(sample)
            msg.ts = float(sample.ts) + self._recording_epoch
            if role == "joints":
                self._publish_arm(msg)
            else:
                await self.handle_lidar(msg)

    async def _sample(self, role: str, sample: Any) -> None:
        self._last_samples[role] = sample
        msg = copy.copy(sample)
        if role == "gripper":
            return
        msg.ts = float(sample.ts) + self._recording_epoch
        if role == "joints":
            self._publish_arm(msg)
        else:
            await getattr(self, f"handle_{role}")(msg)

    def _publish_arm(self, sample: JointState) -> None:
        frames = tuple(g.tip_link for g in self._arm_model.planning_groups if g.tip_link)
        poses = self._arm_fk.frame_poses(sample, frames)
        joints = dict(zip(sample.name, sample.position, strict=True))
        groups = self._arm_model.planning_groups
        self._ws_server.schedule_broadcast_text(
            encode_text(
                {
                    "type": "manipulation_state",
                    "available": True,
                    "read_only": True,
                    "simulated": True,
                    "ts": time.time(),
                    "model": self._arm_descriptor,
                    "root_pose": {"position": [0, 0, 0], "orientation": [0, 0, 0, 1]},
                    "groups": [
                        {
                            "id": g.name,
                            "joint_names": list(g.joint_names),
                            "base_frame": self._arm_model.base_link,
                            "tip_frame": g.tip_link,
                            "has_gripper": "gripper" in self._streams,
                            "following": False,
                        }
                        for g in groups
                    ],
                    "observations": {
                        g.name: {
                            "joints": joints,
                            "measured_at": sample.ts,
                            "pose": {
                                "position": [
                                    poses[g.tip_link].x,
                                    poses[g.tip_link].y,
                                    poses[g.tip_link].z,
                                ],
                                "orientation": [
                                    poses[g.tip_link].orientation.x,
                                    poses[g.tip_link].orientation.y,
                                    poses[g.tip_link].orientation.z,
                                    poses[g.tip_link].orientation.w,
                                ],
                            },
                            "gripper": self._last_samples["gripper"].data
                            if "gripper" in self._last_samples
                            else None,
                        }
                        for g in groups
                        if g.tip_link
                    },
                    "execution": "idle",
                    "following": False,
                    "stopped": False,
                    "plan": None,
                }
            )
        )

    def _on_manipulation_request(self, request: Any, client_id: str, clock_offset: float) -> None:
        self._ws_server.schedule_send_to_client(
            client_id,
            encode_text(
                {
                    "type": "manipulation_result",
                    "request_id": request.request_id,
                    "action": request.action,
                    "group_id": request.group_id,
                    "status": "rejected",
                    "code": "read_only",
                    "message": "Recording playback is read-only",
                }
            ),
        )

    @rpc  # type: ignore[untyped-decorator]
    def stop(self) -> None:
        if getattr(self, "_ar_stopping", False):
            return
        task = getattr(self, "_recording_task", None)
        if task is not None:
            self._loop.call_soon_threadsafe(task.cancel)
        super().stop()


openyam_ar_replay = RecordedARModule.blueprint(
    instance_name="ARModule", robot=RobotName.OPENYAM, stationary_base=ReferencePose()
).global_config(n_workers=1)
unitree_go2_ar_replay = RecordedARModule.blueprint(
    instance_name="ARModule", robot=RobotName.UNITREE_GO2
).global_config(n_workers=1)
