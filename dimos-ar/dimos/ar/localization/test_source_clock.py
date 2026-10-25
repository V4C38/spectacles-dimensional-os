from __future__ import annotations

import pytest

from dimos.ar.localization.source_clock import RobotSourceClock


def test_live_source_keeps_producer_time_despite_delivery_delay() -> None:
    clock = RobotSourceClock()
    assert clock.odometry_time(100, received_at=100.2) == 100
    assert clock.to_server(100.1) == 100.1
    # An unknown live boot-time clock is not silently treated as server time.
    assert clock.odometry_time(1, received_at=100) == 1


def test_replay_has_one_shared_epoch_for_odom_and_camera() -> None:
    clock = RobotSourceClock(recording=True)
    assert clock.to_server(10) is None
    assert clock.odometry_time(10, received_at=100) == 100
    assert clock.to_server(10.1) == pytest.approx(100.1)
    assert clock.odometry_time(10.2, received_at=100.5) == pytest.approx(100.2)
    assert clock.to_server(10.25) == pytest.approx(100.25)


@pytest.mark.parametrize("value", [float("nan"), float("inf")])
def test_nonfinite_source_clock_is_rejected(value: float) -> None:
    clock = RobotSourceClock(recording=True)
    assert clock.odometry_time(value, received_at=100) is None
    assert clock.odometry_time(10, received_at=value) is None
    assert clock.to_server(10) is None
