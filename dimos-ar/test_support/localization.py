from __future__ import annotations

from collections.abc import Sequence
from types import SimpleNamespace
from weakref import WeakKeyDictionary

from dimos.ar.localization.coordinator import LocalizationCoordinator
from dimos.ar.localization.policy import LocalizationPolicy
from dimos.ar.localization.pose_buffer import PoseBuffer
from dimos.ar.localization.types import Intrinsics, LocalizedPose, Observation
from dimos.msgs.geometry_msgs.Pose import Pose
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.msgs.sensor_msgs.CameraInfo import CameraInfo


def _observation(ts_server: float = 10.0) -> Observation:
    return Observation(
        jpeg=b"jpeg",
        intrinsics=Intrinsics(
            fx=100.0,
            fy=100.0,
            cx=50.0,
            cy=50.0,
            width=100,
            height=100,
            distortion_model="none",
            distortion=(),
        ),
        camera_pose=Pose(0.0, 0.0, 0.0),
        ts_server=ts_server,
    )


class _FixedLocalizer:
    def __init__(self, result: LocalizedPose | None) -> None:
        self.result = result
        self.calls: list[list[Observation]] = []

    async def localize(self, observations: Sequence[Observation]) -> LocalizedPose | None:
        self.calls.append(list(observations))
        return self.result


def _coordinator(
    *,
    providers: list[str],
    marker: _FixedLocalizer | None = None,
) -> LocalizationCoordinator:
    class Marker:
        def snapshot(self):
            return self

        def localize(self, observations):
            marker.calls.append(list(observations))
            return marker.result

    return LocalizationCoordinator(
        marker=Marker() if marker is not None else None,
        clock=lambda: 3.0,
    )


_histories: WeakKeyDictionary[LocalizationPolicy, PoseBuffer] = WeakKeyDictionary()


def _advance(policy: LocalizationPolicy, x: float, y: float):
    if policy not in _histories:
        history = PoseBuffer()
        _histories[policy] = history
        policy._travel = lambda: history.latest().travel_m if history.latest() else 0.0
    history = _histories[policy]
    latest = history.latest()
    timestamp = latest.ts_server + 0.1 if latest else 0.0
    history.push(PoseStamped(ts=timestamp, position=[x, y, 0]))
    return policy.on_odom()


def _camera_info() -> CameraInfo:
    return CameraInfo(
        width=640,
        height=480,
        distortion_model="none",
        D=[],
        K=[600.0, 0.0, 320.0, 0.0, 600.0, 240.0, 0.0, 0.0, 1.0],
    )


def _image(ts: float = 100.0) -> SimpleNamespace:
    return SimpleNamespace(ts=ts, to_jpeg_bytes=lambda: b"jpeg-bytes")


def _intrinsics(*, width: int = 960, height: int = 720) -> Intrinsics:
    return Intrinsics(
        fx=669.53,
        fy=669.53,
        cx=width / 2.0,
        cy=height / 2.0,
        width=width,
        height=height,
        distortion_model="none",
        distortion=(),
    )
