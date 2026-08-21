from __future__ import annotations

import json
import struct

import numpy as np
import pytest

from dimos.ar.robot.go2 import ODOM_CORRECTION_FACTOR
from dimos.ar.robot.state_publisher import RobotStatePublisher
from dimos.ar.websocket.protocol import LIDAR_FOURCC, LidarData
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.msgs.nav_msgs.Path import Path


class _RecordingBroadcast:
    def __init__(self) -> None:
        self.text_payloads: list[str] = []
        self.binary_payloads: list[bytes] = []

    def schedule_broadcast_text(self, text: str) -> None:
        self.text_payloads.append(text)

    def schedule_broadcast_binary(self, data: bytes) -> None:
        self.binary_payloads.append(data)


class _FakePointCloud2:
    def __init__(self, points: np.ndarray, *, ts: float = 1.0) -> None:
        self._points = points
        self.ts = ts

    def voxel_downsample(self, *, voxel_size: float) -> _FakePointCloud2:
        _ = voxel_size
        return self

    def points_f32(self) -> np.ndarray:
        return self._points


def _pose(x: float = 4.0, y: float = 8.0, z: float = 0.33) -> PoseStamped:
    return PoseStamped(
        ts=12.5,
        frame_id="world",
        position=[x, y, z],
        orientation=[0.0, 0.0, 0.7071068, 0.7071068],
    )


def test_publish_odom_applies_odom_correction() -> None:
    sink = _RecordingBroadcast()
    publisher = RobotStatePublisher(
        sink,
        pose_max_hz=0.0,
        odom_correction_factor=1.25,
    )

    publisher.publish_odom(_pose())

    assert len(sink.text_payloads) == 1
    payload = json.loads(sink.text_payloads[0])
    assert payload["type"] == "pose"
    assert payload["position"] == pytest.approx([5.0, 10.0, 0.33])
    assert payload["ts"] == 12.5


def test_publish_odom_rate_limits() -> None:
    sink = _RecordingBroadcast()
    publisher = RobotStatePublisher(sink, pose_max_hz=10.0)

    publisher.publish_odom(_pose())
    publisher.publish_odom(_pose(x=1.0, y=2.0))

    assert len(sink.text_payloads) == 1


def test_publish_path_scales_waypoints() -> None:
    sink = _RecordingBroadcast()
    publisher = RobotStatePublisher(
        sink,
        odom_correction_factor=1.25,
    )
    path = Path(
        ts=3.0,
        frame_id="world",
        poses=[_pose(2.0, 4.0), _pose(6.0, 8.0)],
    )

    publisher.publish_path(path)

    payload = json.loads(sink.text_payloads[0])
    assert payload["type"] == "path"
    assert len(payload["points"]) == 2
    assert payload["points"][0] == pytest.approx([2.5, 5.0, 0.33])
    assert payload["points"][1] == pytest.approx([7.5, 10.0, 0.33])


def test_publish_lidar_disabled_skips_binary() -> None:
    sink = _RecordingBroadcast()
    publisher = RobotStatePublisher(
        sink,
        lidar=LidarData(enabled=False, min_height_m=0.1, max_height_m=1.5, max_range_m=5.0),
        lidar_max_hz=0.0,
    )
    points = np.array([[0.5, 0.0, 0.5]], dtype=np.float32)

    publisher.publish_odom(_pose())
    publisher.publish_lidar(_FakePointCloud2(points))  # type: ignore[arg-type]

    assert sink.binary_payloads == []


def test_publish_lidar_enabled_uses_raw_robot_position() -> None:
    sink = _RecordingBroadcast()
    publisher = RobotStatePublisher(
        sink,
        lidar=LidarData(enabled=True, min_height_m=0.1, max_height_m=1.5, max_range_m=15.0),
        lidar_max_hz=0.0,
        lidar_target_points=1,
        odom_correction_factor=ODOM_CORRECTION_FACTOR,
    )
    points = np.array([[8.2, 0.0, 0.5], [10.2, 0.0, 0.5]], dtype=np.float32)

    publisher.publish_odom(_pose(x=8.0, y=0.0))
    publisher.publish_lidar(_FakePointCloud2(points, ts=2.0))  # type: ignore[arg-type]

    assert len(sink.binary_payloads) == 1
    payload = sink.binary_payloads[0]
    fourcc, ts, count = struct.unpack_from("<IdI", payload, 0)
    assert fourcc == LIDAR_FOURCC
    assert ts == pytest.approx(2.0)
    assert count == 1
    x, y, z = struct.unpack_from("<3f", payload, 16)
    assert (x, y, z) == pytest.approx((8.2, 0.0, 0.5))


def test_set_lidar_updates_filter_settings() -> None:
    sink = _RecordingBroadcast()
    publisher = RobotStatePublisher(sink)
    updated = LidarData(enabled=True, min_height_m=0.2, max_height_m=1.2, max_range_m=4.0)

    publisher.set_lidar(updated)

    assert publisher.lidar == updated
