from __future__ import annotations

import time

import pytest

from dimos.ar.bridge.odom_buffer import OdomBuffer
from dimos.ar.registration.transforms import OdomSample


def _push(buffer: OdomBuffer, mono: float, x: float, *, source_ts: float | None = None) -> None:
    with buffer._lock:  # type: ignore[attr-defined]
        sample = OdomSample(
            position=(x, 0.0, 0.0),
            orientation=(0.0, 0.0, 0.0, 1.0),
            source_ts=source_ts if source_ts is not None else mono,
        )
        buffer._buffer.append((mono, sample))  # type: ignore[attr-defined]
        buffer._source_buffer.append((sample.source_ts, sample))  # type: ignore[attr-defined]
        buffer._latest = sample  # type: ignore[attr-defined]


def test_at_interpolated_by_source() -> None:
    buffer = OdomBuffer()
    _push(buffer, 100.0, 0.0, source_ts=1000.0)
    _push(buffer, 100.1, 1.0, source_ts=1000.2)

    sample = buffer.at_interpolated_by_source(1000.1)
    assert sample is not None
    assert sample.position[0] == pytest.approx(0.5, abs=1e-6)


def test_update_odometry_extracts_twist_speed() -> None:
    from dimos.msgs.geometry_msgs.Pose import Pose
    from dimos.msgs.geometry_msgs.Quaternion import Quaternion
    from dimos.msgs.geometry_msgs.Twist import Twist
    from dimos.msgs.geometry_msgs.Vector3 import Vector3
    from dimos.msgs.nav_msgs.Odometry import Odometry

    buffer = OdomBuffer()
    msg = Odometry(
        ts=42.0,
        pose=Pose(Vector3(0.0, 0.0, 0.0), Quaternion(0.0, 0.0, 0.0, 1.0)),
        twist=Twist(linear=Vector3(3.0, 4.0, 0.0), angular=Vector3(0.0, 0.0, 0.0)),
    )
    sample = buffer.update(msg)
    assert sample.source_ts == pytest.approx(42.0)
    assert sample.measured_speed_mps == pytest.approx(5.0)


def test_speed_windowed_averages_over_horizon() -> None:
    buffer = OdomBuffer()
    t0 = time.monotonic()
    _push(buffer, t0, 0.0)
    _push(buffer, t0 + 0.4, 0.4)

    speed = buffer.speed_windowed(t0 + 0.4, 0.4)
    assert speed is not None
    assert speed == pytest.approx(1.0, abs=1e-6)


def test_speed_windowed_smoothes_flapping_two_sample_speed() -> None:
    buffer = OdomBuffer()
    t0 = time.monotonic()
    _push(buffer, t0, 0.0)
    _push(buffer, t0 + 0.1, 0.05)
    _push(buffer, t0 + 0.4, 0.40)

    windowed = buffer.speed_windowed(t0 + 0.4, 0.4)
    instant = buffer.speed_at(t0 + 0.15)
    assert windowed is not None
    assert instant is not None
    assert windowed < instant
