from __future__ import annotations

import pytest

from dimos.ar.localization.robot_pose_buffer import RobotPoseBuffer
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped


def _pose(
    ts: float,
    x: float = 0.0,
    y: float = 0.0,
    z: float = 0.33,
    orientation: tuple[float, float, float, float] = (0.0, 0.0, 0.0, 1.0),
) -> PoseStamped:
    return PoseStamped(
        ts=ts,
        frame_id="world",
        position=[x, y, z],
        orientation=list(orientation),
    )


def test_push_and_latest() -> None:
    buffer = RobotPoseBuffer()
    sample = buffer.push(_pose(10.0, 1.0, 2.0), ts_server=20.0)

    assert sample.position == (1.0, 2.0, 0.33)
    assert sample.ts_odom == 10.0
    assert sample.ts_server == 20.0
    assert sample.frame_id == "odom"
    assert buffer.latest() == sample


def test_at_server_ts_interpolates_position() -> None:
    buffer = RobotPoseBuffer()
    buffer.push(_pose(10.0, 0.0), ts_server=20.0)
    buffer.push(_pose(10.1, 2.0), ts_server=20.1)

    sample = buffer.at_server_ts(20.05)

    assert sample is not None
    assert sample.position[0] == pytest.approx(1.0)
    assert sample.ts_server == pytest.approx(20.05)
    assert sample.ts_odom == pytest.approx(10.05)


def test_at_server_ts_returns_none_when_gap_too_large() -> None:
    buffer = RobotPoseBuffer(max_gap_s=0.25)
    buffer.push(_pose(ts=10.0), ts_server=20.0)

    assert buffer.at_server_ts(21.0) is None


def test_at_server_ts_returns_none_when_empty() -> None:
    buffer = RobotPoseBuffer()

    assert buffer.at_server_ts(100.0) is None
