from __future__ import annotations

import pytest

from dimos.ar.robot.odometry import RobotOdometry, RobotSourceChangedError
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped


def _pose(ts: float, x: float = 0, *, frame: str = "world") -> PoseStamped:
    return PoseStamped(ts=ts, frame_id=frame, position=[x, 0, 0.33], orientation=[0, 0, 0, 1])


def test_admission_rejects_duplicate_and_small_backward_updates_without_mutation() -> None:
    odometry = RobotOdometry(factor=1.25)
    first = odometry.accept(_pose(100), received_at=100)
    assert first is not None
    assert odometry.accept(_pose(100, 10), received_at=100) is None
    assert odometry.accept(_pose(99.9, 20), received_at=100) is None
    assert odometry.latest() is first
    assert odometry.travel() == 0
    next_pose = odometry.accept(_pose(100.1, 1), received_at=100.1)
    assert next_pose.position == (1, 0, 0.33)
    assert next_pose.corrected.position == (1.25, 0, 0.33)
    assert odometry.travel() == 1.25


@pytest.mark.parametrize("timestamp,frame", [(98, "world"), (0, "world"), (100.1, "replacement")])
def test_source_retirement_changes_epoch_and_clears_all_accepted_state(timestamp, frame) -> None:
    odometry = RobotOdometry(factor=1)
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
    odometry = RobotOdometry(factor=1.25, recording=True)
    incoming = _pose(5, 2)
    first = odometry.accept(incoming, received_at=100)
    assert first.corrected.ts_server == 100
    incoming.position.x = 999
    assert first.position[0] == 2
    native = first.native_pose()
    native.position.x = 777
    assert first.native_pose().x == 2
    second = odometry.accept(_pose(6, 3), received_at=101.5)
    assert second.corrected.ts_server == 101
    assert second.corrected.position[0] == 3.75
    assert odometry.travel() == 1.25
