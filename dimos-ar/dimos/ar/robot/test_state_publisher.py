from __future__ import annotations

import json
import struct

import numpy as np
import pytest

from dimos.ar.robot.state_publisher import RobotStatePublisher
from dimos.ar.sensors.lidar_settings import LidarSettings
from dimos.ar.websocket.protocol import LIDAR_FOURCC
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped


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


def _publisher(sink: _RecordingBroadcast, **kwargs: object) -> RobotStatePublisher:
    kwargs.setdefault("odom_scale_correction_factor", 1.25)
    return RobotStatePublisher(sink, **kwargs)  # type: ignore[arg-type]


def test_publish_odom_applies_odom_correction() -> None:
    sink = _RecordingBroadcast()
    publisher = _publisher(
        sink,
        pose_max_hz=0.0,
        odom_scale_correction_factor=1.25,
    )

    publisher.publish_odom(_pose())

    assert len(sink.text_payloads) == 1
    payload = json.loads(sink.text_payloads[0])
    assert payload["type"] == "pose"
    assert payload["position"] == pytest.approx([5.0, 10.0, 0.33])
    assert payload["ts"] == 12.5


def test_publish_odom_rate_limits() -> None:
    sink = _RecordingBroadcast()
    publisher = _publisher(sink, pose_max_hz=10.0)

    publisher.publish_odom(_pose())
    publisher.publish_odom(_pose(x=1.0, y=2.0))

    assert len(sink.text_payloads) == 1


def test_publish_lidar_disabled_skips_binary() -> None:
    sink = _RecordingBroadcast()
    publisher = _publisher(sink, lidar_max_hz=0.0)
    lidar = LidarSettings(enabled=False, min_height_m=0.1, max_height_m=1.5, max_range_m=5.0)
    points = np.array([[0.5, 0.0, 0.5]], dtype=np.float32)

    publisher.publish_odom(_pose())
    publisher.publish_lidar(_FakePointCloud2(points), lidar=lidar)  # type: ignore[arg-type]

    assert sink.binary_payloads == []


def test_publish_lidar_filters_native_range_then_corrects_wire_coordinates() -> None:
    sink = _RecordingBroadcast()
    publisher = _publisher(
        sink,
        lidar_max_hz=0.0,
        lidar_target_points=1,
        odom_scale_correction_factor=1.25,
    )
    lidar = LidarSettings(enabled=True, min_height_m=0.1, max_height_m=1.5, max_range_m=15.0)
    points = np.array([[8.2, 0.0, 0.5], [10.2, 0.0, 0.5]], dtype=np.float32)

    publisher.publish_odom(_pose(x=8.0, y=0.0))
    publisher.publish_lidar(_FakePointCloud2(points, ts=2.0), lidar=lidar)  # type: ignore[arg-type]

    assert len(sink.binary_payloads) == 1
    payload = sink.binary_payloads[0]
    fourcc, ts, count = struct.unpack_from("<IdI", payload, 0)
    assert fourcc == LIDAR_FOURCC
    assert ts == pytest.approx(2.0)
    assert count == 1
    x, y, z = struct.unpack_from("<3f", payload, 16)
    assert (x, y, z) == pytest.approx((10.25, 0.0, 0.5))


def test_publish_lidar_skips_until_odom_is_known() -> None:
    sink = _RecordingBroadcast()
    publisher = _publisher(sink, lidar_max_hz=0.0)
    lidar = LidarSettings(enabled=True, min_height_m=0.1, max_height_m=1.5, max_range_m=5.0)
    points = np.array([[0.5, 0.0, 0.5]], dtype=np.float32)

    publisher.publish_lidar(_FakePointCloud2(points), lidar=lidar)  # type: ignore[arg-type]

    assert sink.binary_payloads == []


def test_publish_lidar_range_is_around_robot_not_origin() -> None:
    sink = _RecordingBroadcast()
    publisher = _publisher(
        sink,
        lidar_max_hz=0.0,
        lidar_target_points=10,
    )
    lidar = LidarSettings(enabled=True, min_height_m=0.1, max_height_m=1.5, max_range_m=5.0)
    points = np.array([[0.5, 0.0, 0.5], [10.5, 0.0, 0.5]], dtype=np.float32)

    publisher.publish_odom(_pose(x=10.0, y=0.0))
    publisher.publish_lidar(_FakePointCloud2(points, ts=2.0), lidar=lidar)  # type: ignore[arg-type]

    assert len(sink.binary_payloads) == 1
    payload = sink.binary_payloads[0]
    _fourcc, _ts, count = struct.unpack_from("<IdI", payload, 0)
    assert count == 1
    x, y, z = struct.unpack_from("<3f", payload, 16)
    assert (x, y, z) == pytest.approx((13.125, 0.0, 0.5))


def test_publish_lidar_uses_passed_settings_per_call() -> None:
    sink = _RecordingBroadcast()
    publisher = _publisher(sink, lidar_max_hz=0.0, lidar_target_points=10)
    disabled = LidarSettings(enabled=False, min_height_m=0.1, max_height_m=1.5, max_range_m=5.0)
    enabled = LidarSettings(enabled=True, min_height_m=0.1, max_height_m=1.5, max_range_m=5.0)
    points = np.array([[0.5, 0.0, 0.5]], dtype=np.float32)

    publisher.publish_odom(_pose())
    publisher.publish_lidar(_FakePointCloud2(points, ts=2.0), lidar=disabled)  # type: ignore[arg-type]
    assert sink.binary_payloads == []

    publisher.publish_lidar(_FakePointCloud2(points, ts=3.0), lidar=enabled)  # type: ignore[arg-type]
    assert len(sink.binary_payloads) == 1


def test_repeated_voxel_geometry_is_independent_of_robot_movement() -> None:
    sink = _RecordingBroadcast()
    publisher = _publisher(sink, pose_max_hz=0, lidar_max_hz=0, lidar_target_points=10)
    lidar = LidarSettings(enabled=True, min_height_m=0.1, max_height_m=1.5, max_range_m=5)
    points = np.array([[5.0, 0, 0.5]], dtype=np.float32)
    for robot_x in [4.0, 4.918]:
        publisher.publish_odom(_pose(x=robot_x, y=0))
        publisher.publish_lidar(_FakePointCloud2(points, ts=2), lidar=lidar)
    assert sink.binary_payloads[0] == sink.binary_payloads[1]
    assert struct.unpack_from("<3f", sink.binary_payloads[0], 16) == (6.25, 0, 0.5)
    assert np.array_equal(points, [[5.0, 0, 0.5]])


def test_range_filter_stays_in_native_metres_when_display_is_scaled() -> None:
    sink = _RecordingBroadcast()
    publisher = _publisher(sink, pose_max_hz=0, lidar_max_hz=0, lidar_target_points=10)
    lidar = LidarSettings(enabled=True, min_height_m=0.1, max_height_m=1.5, max_range_m=0.5)
    publisher.publish_odom(_pose(x=4, y=0))
    publisher.publish_lidar(
        _FakePointCloud2(np.array([[4.4, 0, 0.5], [4.6, 0, 0.5]], dtype=np.float32)), lidar=lidar
    )
    assert struct.unpack_from("<IdI", sink.binary_payloads[0], 0)[2] == 1
    assert struct.unpack_from("<3f", sink.binary_payloads[0], 16) == pytest.approx([5.5, 0, 0.5])


def test_native_navigation_and_lidar_share_one_corrected_wire_frame() -> None:
    import time

    from dimos.ar.navigation.coordinator import NavGoalCoordinator
    from dimos.ar.navigation.types import NavGoalRequest
    from dimos.msgs.nav_msgs.Path import Path

    sink = _RecordingBroadcast()
    publisher = _publisher(sink, pose_max_hz=0, lidar_max_hz=0, lidar_target_points=10)
    navigation = NavGoalCoordinator(odom_scale_correction_factor=1.25)
    wire_goal = NavGoalRequest((5.25, -2.625, 0), (0, 0, 0, 1))
    native_goal = navigation.submit_goal(wire_goal)
    assert (native_goal.x, native_goal.y) == pytest.approx((4.2, -2.1))
    native_body = _pose(x=4, y=-2)
    publisher.publish_odom(native_body)
    cloud = np.array([[4.2, -2.1, 0.5]], dtype=np.float32)
    publisher.publish_lidar(_FakePointCloud2(cloud), lidar=LidarSettings(True, 0.1, 1.5, 5))
    route, _ = navigation.on_path(Path(ts=time.time() + 1, poses=[native_body, native_goal]))
    cloud_xy = struct.unpack_from("<3f", sink.binary_payloads[0], 16)[:2]
    assert cloud_xy == pytest.approx(route.pose[:2])
    assert route.pose[:2] == pytest.approx(wire_goal.position[:2])
    assert json.loads(sink.text_payloads[0])["position"] == [5, -2.5, 0.33]
