from __future__ import annotations

import time

import pytest

from dimos_xr.bridge.odom_buffer import OdomBuffer
from dimos_xr.tracking.transforms import OdomSample


def _push(buffer: OdomBuffer, mono: float, x: float) -> None:
    with buffer._lock:  # type: ignore[attr-defined]
        sample = OdomSample(position=(x, 0.0, 0.0), orientation=(0.0, 0.0, 0.0, 1.0))
        buffer._buffer.append((mono, sample))  # type: ignore[attr-defined]
        buffer._latest = sample  # type: ignore[attr-defined]


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
