from __future__ import annotations

from types import SimpleNamespace

from dimos.ar.localization.types import Intrinsics, Observation
from dimos.msgs.geometry_msgs.Pose import Pose
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
