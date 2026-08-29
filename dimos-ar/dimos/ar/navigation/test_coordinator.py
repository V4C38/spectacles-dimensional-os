from __future__ import annotations

from dimos_lcm.std_msgs import Bool
import pytest

from dimos.ar.navigation.coordinator import NavGoalCoordinator
from dimos.ar.navigation.types import NavGoalRequest
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.msgs.nav_msgs.Path import Path


def _nav_goal_request(
    x: float = 5.0,
    y: float = 10.0,
    z: float = 0.33,
    orientation: tuple[float, float, float, float] = (0.0, 0.0, 0.0, 1.0),
) -> NavGoalRequest:
    return NavGoalRequest(position=(x, y, z), orientation=orientation)


def _path(
    *poses: tuple[tuple[float, float, float], tuple[float, float, float, float]],
) -> Path:
    return Path(
        ts=3.0,
        frame_id="world",
        poses=[
            PoseStamped(frame_id="world", position=list(position), orientation=list(orientation))
            for position, orientation in poses
        ],
    )


def test_submit_goal_uncorrects_xy_for_planner() -> None:
    coordinator = NavGoalCoordinator(odom_scale_correction_factor=1.25)

    published = coordinator.submit_goal(_nav_goal_request())

    assert (published.x, published.y, published.z) == pytest.approx((4.0, 8.0, 0.33))
    assert published.frame_id == "odom"
    assert coordinator.nav_state().state == "idle"


def test_path_sets_following_path_and_goal_from_dimos_path() -> None:
    coordinator = NavGoalCoordinator(odom_scale_correction_factor=1.25)

    nav_goal_frame, state_changed = coordinator.on_path(
        _path(
            ((0.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0)),
            ((2.5, 5.0, 0.0), (0.0, 0.0, 0.707, 0.707)),
        )
    )

    assert state_changed is True
    assert nav_goal_frame.path_poses[0] == pytest.approx((0.0, 0.0, 0.0, 0.0))
    assert nav_goal_frame.path_poses[1][:3] == pytest.approx((3.125, 6.25, 0.0))
    assert nav_goal_frame.path_poses[1][3] == pytest.approx(1.5707963, abs=1e-4)
    assert nav_goal_frame.pose == nav_goal_frame.path_poses[-1]
    assert coordinator.nav_state().state == "following_path"


def test_path_terminal_yaw_comes_from_last_dimos_pose() -> None:
    coordinator = NavGoalCoordinator(odom_scale_correction_factor=1.0)
    coordinator.submit_goal(_nav_goal_request(orientation=(0.0, 0.0, 0.0, 1.0)))

    nav_goal_frame, _state_changed = coordinator.on_path(
        _path(((1.0, 2.0, 0.0), (0.0, 0.0, 0.3826834, 0.9238795)))
    )

    assert nav_goal_frame.pose is not None
    assert nav_goal_frame.pose[3] == pytest.approx(0.7853982, abs=1e-4)


def test_empty_path_clears_goal_points_without_changing_nav_state() -> None:
    coordinator = NavGoalCoordinator(odom_scale_correction_factor=1.0)
    coordinator.on_path(_path(((1.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0))))

    nav_goal_frame, state_changed = coordinator.on_path(Path(frame_id="world", poses=[]))

    assert nav_goal_frame.pose is None
    assert nav_goal_frame.path_poses == []
    assert state_changed is False
    assert coordinator.nav_state().state == "following_path"


def test_goal_reached_resolves_any_navigation() -> None:
    coordinator = NavGoalCoordinator(odom_scale_correction_factor=1.0)
    coordinator.on_path(_path(((1.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0))))

    coordinator.on_goal_reached(Bool(True))

    nav = coordinator.nav_state()
    assert nav.state == "resolved"
    assert nav.outcome == "succeeded"


def test_goal_reached_without_path_still_resolves() -> None:
    coordinator = NavGoalCoordinator(odom_scale_correction_factor=1.0)

    coordinator.on_goal_reached(Bool(True))

    nav = coordinator.nav_state()
    assert nav.state == "resolved"
    assert nav.outcome == "succeeded"


def test_goal_reached_failure() -> None:
    coordinator = NavGoalCoordinator(odom_scale_correction_factor=1.0)
    coordinator.on_path(_path(((1.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0))))

    coordinator.on_goal_reached(Bool(False))

    nav = coordinator.nav_state()
    assert nav.state == "resolved"
    assert nav.outcome == "failed"


def test_estop_clears_following_path_without_resolved_outcome() -> None:
    coordinator = NavGoalCoordinator(odom_scale_correction_factor=1.0)
    coordinator.submit_goal(_nav_goal_request())
    coordinator.on_path(_path(((1.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0))))

    assert coordinator.on_estop() is True
    nav = coordinator.nav_state()
    assert nav.state == "idle"
    assert nav.outcome is None


def test_new_goal_clears_previous_outcome() -> None:
    coordinator = NavGoalCoordinator(odom_scale_correction_factor=1.0)
    coordinator.on_path(_path(((1.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0))))
    coordinator.on_goal_reached(Bool(True))

    coordinator.submit_goal(_nav_goal_request(x=3.0, y=4.0))
    coordinator.on_path(_path(((3.0, 4.0, 0.0), (0.0, 0.0, 0.0, 1.0))))

    nav = coordinator.nav_state()
    assert nav.state == "following_path"
    assert nav.outcome is None
