from __future__ import annotations

import time

import numpy as np

from dimos.ar.bridge.telemetry import TelemetryPublisher
from dimos.ar.lidar.filters import LidarFilter, LidarFilterConfig
from dimos.ar.network.protocol import SetLidarModeMessage
from dimos.ar.world_frame.state import WorldFrameState
from dimos.ar.world_frame.transforms import OdomSample


class _FakePointCloud2:
    def __init__(self, points: np.ndarray, *, ts: float = 1.0) -> None:
        self.ts = ts
        self._points = points

    def voxel_downsample(self, *, voxel_size: float) -> _FakePointCloud2:
        _ = voxel_size
        return self

    def points_f32(self) -> np.ndarray:
        return self._points


class _FakeWorldFrame:
    def __init__(self) -> None:
        self.is_committed = True

    def transform_points(self, points: np.ndarray) -> np.ndarray:
        pts = np.asarray(points, dtype=np.float32)
        if pts.size == 0:
            return np.zeros((0, 3), dtype=np.float32)
        return np.column_stack([pts[:, 0], pts[:, 2], pts[:, 1]]).astype(np.float32)

    def transform_pose(
        self,
        position: tuple[float, float, float],
        orientation: tuple[float, float, float, float],
    ) -> tuple[tuple[float, float, float], tuple[float, float, float, float]]:
        return position, orientation


class _FakeOdomBuffer:
    def __init__(self, world_position: tuple[float, float, float] | None = None) -> None:
        self._world_position = world_position
        self._latest: OdomSample | None = None

    def latest_world_position(
        self,
        world_frame: _FakeWorldFrame,
    ) -> tuple[float, float, float] | None:
        _ = world_frame
        return self._world_position

    def speed_windowed(self, _now: float, _horizon_s: float) -> float | None:
        return None


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
        world_frame=_FakeWorldFrame(),  # type: ignore[arg-type]
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

    publisher.set_lidar_mode(
        mode="full",
        obstacle_min_distance_m=0.10,
        obstacle_opaque_distance_m=0.40,
        obstacle_max_distance_m=0.60,
    )
    publisher.publish_lidar(msg)
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

    publisher.set_lidar_mode(
        mode="full",
        obstacle_min_distance_m=0.10,
        obstacle_opaque_distance_m=0.40,
        obstacle_max_distance_m=0.60,
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


def test_default_lidar_mode_is_off() -> None:
    publisher, _sender = _publisher()
    assert publisher._lidar_mode == "off"


def test_apply_set_lidar_mode_fills_partial_obstacle_fields() -> None:
    publisher, _sender = _publisher()
    publisher.apply_set_lidar_mode(
        SetLidarModeMessage(
            ts=1.0,
            robot_id="unitree_go2",
            mode="obstacles",
            obstacle_min_distance_m=0.15,
            obstacle_opaque_distance_m=None,
            obstacle_max_distance_m=None,
        )
    )
    assert publisher._lidar_mode == "obstacles"
    assert publisher._obstacle_distance_config.min_distance_m == 0.15
    assert publisher._obstacle_distance_config.opaque_distance_m == 0.40
    assert publisher._obstacle_distance_config.max_distance_m == 0.60


def test_publish_pose_snapshot_bypasses_rate_limit() -> None:
    publisher, sender = _publisher()
    world_frame = publisher._world_frame
    assert isinstance(world_frame, _FakeWorldFrame)
    odom = publisher._odom
    assert isinstance(odom, _FakeOdomBuffer)
    odom._latest = OdomSample(  # type: ignore[attr-defined]
        position=(1.0, 0.0, 2.0),
        orientation=(0.0, 0.0, 0.0, 1.0),
    )
    publisher._pose_last_emit = time.monotonic()

    sent = publisher.publish_pose_snapshot(
        ts=42.0,
        sample=odom._latest,  # type: ignore[attr-defined]
        force=True,
    )

    assert sent is True
    assert len(sender.text_payloads) == 1


def test_runtime_correction_pose_not_suppressed_after_recent_stream_emit() -> None:
    publisher, sender = _publisher()
    odom = publisher._odom
    sample = OdomSample(
        position=(0.0, 0.0, 0.0),
        orientation=(0.0, 0.0, 0.0, 1.0),
    )
    odom._latest = sample  # type: ignore[attr-defined]
    publisher._pose_last_emit = time.monotonic()

    assert publisher.publish_pose_snapshot(ts=1.0, sample=sample, force=True) is True
    assert len(sender.text_payloads) == 1
