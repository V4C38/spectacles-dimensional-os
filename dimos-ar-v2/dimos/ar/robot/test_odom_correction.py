from __future__ import annotations

import pytest

from dimos.ar.robot.odom_correction import (
    correct_odom_path,
    correct_odom_pose,
    correct_odom_xy,
    uncorrect_odom_pose,
    uncorrect_odom_xy,
)
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.msgs.nav_msgs.Path import Path


def _sample_pose(x: float = 4.0, y: float = 8.0, z: float = 0.33) -> PoseStamped:
    return PoseStamped(
        ts=12.5,
        frame_id="world",
        position=[x, y, z],
        orientation=[0.0, 0.0, 0.7071068, 0.7071068],
    )


def test_correct_odom_xy_multiplies_horizontal_components() -> None:
    assert correct_odom_xy(4.0, -2.0, factor=1.25) == (5.0, -2.5)


def test_uncorrect_odom_xy_inverts_correction() -> None:
    assert uncorrect_odom_xy(5.0, -2.5, factor=1.25) == (4.0, -2.0)


def test_correct_odom_xy_roundtrip() -> None:
    x, y = 3.2, -1.1
    assert uncorrect_odom_xy(*correct_odom_xy(x, y, factor=1.25), factor=1.25) == (x, y)


def test_correct_odom_pose_preserves_z_orientation_and_metadata() -> None:
    pose = _sample_pose()
    corrected = correct_odom_pose(pose, factor=1.25)

    assert corrected.ts == pose.ts
    assert corrected.frame_id == pose.frame_id
    assert corrected.x == pytest.approx(5.0)
    assert corrected.y == pytest.approx(10.0)
    assert corrected.z == pose.z
    assert corrected.orientation.x == pose.orientation.x
    assert corrected.orientation.y == pose.orientation.y
    assert corrected.orientation.z == pose.orientation.z
    assert corrected.orientation.w == pose.orientation.w


def test_correct_odom_pose_does_not_mutate_input() -> None:
    pose = _sample_pose()
    original = (pose.x, pose.y, pose.z)

    correct_odom_pose(pose, factor=1.25)

    assert (pose.x, pose.y, pose.z) == original


def test_correct_odom_path_corrects_every_waypoint() -> None:
    path = Path(
        ts=1.0,
        frame_id="world",
        poses=[_sample_pose(2.0, 4.0), _sample_pose(6.0, 8.0)],
    )

    corrected = correct_odom_path(path, factor=1.25)

    assert corrected.ts == path.ts
    assert corrected.frame_id == path.frame_id
    assert [(pose.x, pose.y) for pose in corrected.poses] == [(2.5, 5.0), (7.5, 10.0)]
    assert [pose.z for pose in corrected.poses] == [pose.z for pose in path.poses]


def test_uncorrect_odom_pose_leaves_z_and_orientation_unchanged() -> None:
    corrected = PoseStamped(
        ts=12.5,
        frame_id="world",
        position=[5.0, 10.0, 0.33],
        orientation=[0.0, 0.0, 0.7071068, 0.7071068],
    )
    uncorrected = uncorrect_odom_pose(corrected, factor=1.25)

    assert uncorrected.x == pytest.approx(4.0)
    assert uncorrected.y == pytest.approx(8.0)
    assert uncorrected.z == corrected.z
    assert uncorrected.orientation.x == corrected.orientation.x


def test_factor_one_is_identity() -> None:
    assert correct_odom_xy(4.0, -2.0, factor=1.0) == (4.0, -2.0)
    assert uncorrect_odom_xy(4.0, -2.0, factor=1.0) == (4.0, -2.0)


@pytest.mark.parametrize("factor", [0.0, -1.25])
def test_non_positive_factor_raises(factor: float) -> None:
    with pytest.raises(ValueError, match="positive"):
        correct_odom_xy(1.0, 2.0, factor=factor)

    with pytest.raises(ValueError, match="positive"):
        uncorrect_odom_xy(1.0, 2.0, factor=factor)
