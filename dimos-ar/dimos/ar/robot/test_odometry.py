from __future__ import annotations

from unittest.mock import Mock

import pytest

from dimos.ar import timing_diagnostics
from dimos.ar.robot.odometry import RobotOdometry, RobotSourceChangedError
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped


def _pose(ts: float, x: float = 0, *, frame: str = "world") -> PoseStamped:
    return PoseStamped(ts=ts, frame_id=frame, position=[x, 0, 0.33], orientation=[0, 0, 0, 1])


def test_timing_includes_rejected_stale_odom(monkeypatch: pytest.MonkeyPatch) -> None:
    now = [100.0]
    monkeypatch.setattr(timing_diagnostics.time, "monotonic", lambda: now[0])
    logger = Mock()
    monkeypatch.setattr(timing_diagnostics, "logger", logger)
    odometry = RobotOdometry()
    assert odometry.accept(_pose(100), received_at=100) is not None
    now[0] += 30
    assert odometry.accept(_pose(127), received_at=130) is None
    fields = logger.info.call_args.kwargs
    assert fields["received"] == 2
    assert fields["stale"] == 1
    assert fields["source_age_max_ms"] == 3000
    assert fields["arrival_gap_max_ms"] == 30000
    assert odometry.latest().sample.ts_server == 100


def test_admission_rejects_duplicate_and_small_backward_updates_without_mutation() -> None:
    odometry = RobotOdometry()
    first = odometry.accept(_pose(100), received_at=100)
    assert first is not None
    assert odometry.accept(_pose(100, 10), received_at=100) is None
    assert odometry.accept(_pose(99.9, 20), received_at=100) is None
    assert odometry.latest() is first
    assert odometry.travel() == 0
    next_pose = odometry.accept(_pose(100.1, 1), received_at=100.1)
    assert next_pose.position == (1, 0, 0.33)
    assert next_pose.sample.position == (1, 0, 0.33)
    assert odometry.travel() == 1


@pytest.mark.parametrize("timestamp,frame", [(98, "world"), (0, "world"), (100.1, "replacement")])
def test_source_retirement_changes_epoch_and_clears_all_accepted_state(timestamp, frame) -> None:
    odometry = RobotOdometry()
    odometry.accept(_pose(100), received_at=100)
    reference = odometry.reference_id
    with pytest.raises(RobotSourceChangedError):
        odometry.accept(_pose(timestamp, 1, frame=frame), received_at=100)
    odometry.retire()
    assert odometry.generation == 1 and odometry.reference_id != reference
    assert odometry.history.latest() is None
    assert odometry.latest() is None and odometry.native_position() is None
    assert odometry.travel() == 0


def test_replay_retains_one_epoch_and_snapshots_do_not_share_mutable_messages() -> None:
    odometry = RobotOdometry(recording=True)
    incoming = _pose(5, 2)
    first = odometry.accept(incoming, received_at=100)
    assert first.sample.ts_server == 100
    incoming.position.x = 999
    assert first.position[0] == 2
    assert first.sample.position[0] == 2
    second = odometry.accept(_pose(6, 3), received_at=101.5)
    assert second.sample.ts_server == 101
    assert second.sample.position[0] == 3
    assert odometry.travel() == 1


def test_admission_preserves_native_metres_and_heading_from_nonzero_origin() -> None:
    odometry = RobotOdometry()
    half = 2**-0.5
    first = PoseStamped(
        ts=100,
        frame_id="world",
        position=[10, -4, 0.33],
        orientation=[0, 0, half, half],
    )
    second = PoseStamped(
        ts=100.1,
        frame_id="world",
        position=[10, -3, 0.33],
        orientation=[0, 0, half, half],
    )
    assert odometry.accept(first, received_at=100) is not None
    accepted = odometry.accept(second, received_at=100.1)
    assert accepted is not None
    assert accepted.position == (10, -3, 0.33)
    assert accepted.sample.position == accepted.position
    assert accepted.sample.orientation == pytest.approx((0, 0, half, half))
    assert accepted.sample.frame_id == "odom"
    assert accepted.frame_id == "world"
    assert odometry.travel() == 1
    # Source messages remain native observations, independently owned by their producer.
    assert first.x == 10 and first.y == -4
    assert second.x == 10 and second.y == -3
