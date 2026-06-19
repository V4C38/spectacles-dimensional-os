from __future__ import annotations

import numpy as np

from dimos.ar.bridge.telemetry import TelemetryPublisher
from dimos.ar.tracking.filters import LidarFilter, LidarFilterConfig


class _FakePointCloud2:
    def __init__(self, points: np.ndarray, *, ts: float = 1.0) -> None:
        self.ts = ts
        self._points = points

    def voxel_downsample(self, *, voxel_size: float) -> _FakePointCloud2:
        _ = voxel_size
        return self

    def points_f32(self) -> np.ndarray:
        return self._points


class _FakeCalibration:
    def __init__(self) -> None:
        self.is_registered = True

    def transform_points(self, points: np.ndarray) -> np.ndarray:
        pts = np.asarray(points, dtype=np.float32)
        if pts.size == 0:
            return np.zeros((0, 3), dtype=np.float32)
        return np.column_stack([pts[:, 0], pts[:, 2], pts[:, 1]]).astype(np.float32)


class _FakeOdomBuffer:
    def __init__(self, world_position: tuple[float, float, float] | None = None) -> None:
        self._world_position = world_position

    def latest_world_position(
        self,
        calibration: _FakeCalibration,
    ) -> tuple[float, float, float] | None:
        _ = calibration
        return self._world_position


class _RecordingSender:
    def __init__(self) -> None:
        self.binary_payloads: list[bytes] = []
        self.text_payloads: list[str] = []

    def send_binary(self, payload: bytes) -> None:
        self.binary_payloads.append(payload)

    def send(self, payload: str) -> None:
        self.text_payloads.append(payload)


def _publisher(
    *,
    world_position: tuple[float, float, float] | None = None,
    target_points: int = 1000,
    obstacle_target_points: int = 200,
) -> tuple[TelemetryPublisher, _RecordingSender]:
    sender = _RecordingSender()
    publisher = TelemetryPublisher(
        robot_id="unitree_go2",
        sender=sender,  # type: ignore[arg-type]
        calibration=_FakeCalibration(),  # type: ignore[arg-type]
        odom=_FakeOdomBuffer(world_position),  # type: ignore[arg-type]
        lidar_filter=LidarFilter(
            LidarFilterConfig(
                max_range_m=None,
                min_height_m=-1.0,
                max_height_m=2.0,
                target_points=target_points,
                max_hz=0.0,
            )
        ),
        target_points=target_points,
        obstacle_target_points=obstacle_target_points,
        lidar_voxel_size_m=0.05,
        pose_max_hz=30.0,
        lidar_binary=True,
    )
    return publisher, sender


def test_publish_lidar_obstacle_mode_reduces_binary_payload() -> None:
    publisher, sender = _publisher()
    msg = _FakePointCloud2(
        np.array(
            [
                [0.05, 0.0, 0.5],
                [0.20, 0.0, 0.5],
                [0.50, 0.0, 0.5],
                [0.80, 0.0, 0.5],
            ],
            dtype=np.float32,
        )
    )

    publisher.publish_lidar(msg)  # full mode by default
    assert len(sender.binary_payloads) == 1
    full_size = len(sender.binary_payloads[-1])

    publisher.set_lidar_mode(
        mode="obstacles",
        obstacle_min_distance_m=0.10,
        obstacle_opaque_distance_m=0.40,
        obstacle_max_distance_m=0.60,
    )
    publisher.publish_lidar(msg)
    assert len(sender.binary_payloads) == 2
    obstacle_size = len(sender.binary_payloads[-1])

    assert obstacle_size < full_size


def test_publish_lidar_off_mode_suppresses_transmission() -> None:
    publisher, sender = _publisher()
    msg = _FakePointCloud2(np.array([[0.20, 0.0, 0.5]], dtype=np.float32))

    publisher.set_lidar_mode(
        mode="off",
        obstacle_min_distance_m=0.10,
        obstacle_opaque_distance_m=0.40,
        obstacle_max_distance_m=0.60,
    )
    publisher.publish_lidar(msg)

    assert sender.binary_payloads == []


def test_publish_lidar_obstacle_mode_uses_robot_world_position() -> None:
    publisher, sender = _publisher(world_position=(2.0, 0.5, 0.0))
    msg = _FakePointCloud2(
        np.array(
            [
                [0.20, 0.0, 0.50],  # far from robot after world transform
                [2.25, 0.0, 0.50],  # within obstacle annulus around robot
            ],
            dtype=np.float32,
        )
    )

    publisher.set_lidar_mode(
        mode="obstacles",
        obstacle_min_distance_m=0.10,
        obstacle_opaque_distance_m=0.40,
        obstacle_max_distance_m=0.60,
    )
    publisher.publish_lidar(msg)

    assert len(sender.binary_payloads) == 1
    # Header is 5 bytes; one point adds 6 bytes in Float16 lidar frames.
    assert len(sender.binary_payloads[0]) == 11


def test_publish_lidar_full_mode_caps_binary_payload_at_1000_points() -> None:
    publisher, sender = _publisher(target_points=1000, obstacle_target_points=200)
    msg = _FakePointCloud2(
        np.column_stack(
            [
                np.linspace(0.0, 4.0, 1100, dtype=np.float32),
                np.zeros(1100, dtype=np.float32),
                np.full(1100, 0.5, dtype=np.float32),
            ]
        ).astype(np.float32)
    )

    publisher.publish_lidar(msg)

    assert len(sender.binary_payloads) == 1
    assert len(sender.binary_payloads[0]) == 5 + (1000 * 6)


def test_publish_lidar_obstacle_mode_caps_binary_payload_at_200_points() -> None:
    publisher, sender = _publisher(target_points=1000, obstacle_target_points=200)
    msg = _FakePointCloud2(
        np.column_stack(
            [
                np.linspace(0.11, 0.59, 500, dtype=np.float32),
                np.zeros(500, dtype=np.float32),
                np.full(500, 0.5, dtype=np.float32),
            ]
        ).astype(np.float32)
    )

    publisher.set_lidar_mode(
        mode="obstacles",
        obstacle_min_distance_m=0.10,
        obstacle_opaque_distance_m=0.40,
        obstacle_max_distance_m=0.60,
    )
    publisher.publish_lidar(msg)

    assert len(sender.binary_payloads) == 1
    assert len(sender.binary_payloads[0]) == 5 + (200 * 6)
