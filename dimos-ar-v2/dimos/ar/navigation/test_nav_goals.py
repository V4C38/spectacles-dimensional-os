from __future__ import annotations

from dimos_lcm.std_msgs import Bool
import pytest

from dimos.ar.navigation.nav_goals import NavGoalCoordinator
from dimos.ar.websocket.protocol import NavGoal


def _nav_goal(
    x: float = 5.0,
    y: float = 10.0,
    z: float = 0.33,
    orientation: tuple[float, float, float, float] = (0.0, 0.0, 0.0, 1.0),
) -> NavGoal:
    return NavGoal(position=(x, y, z), orientation=orientation)


def test_submit_client_goal_uncorrects_xy_for_planner() -> None:
    goals = NavGoalCoordinator(odom_correction_factor=1.25)

    published = goals.submit_client_goal(_nav_goal())

    assert (published.x, published.y, published.z) == pytest.approx((4.0, 8.0, 0.33))
    assert published.frame_id == "world"
    nav = goals.nav_state()
    assert nav.state == "following_path"
    assert nav.outcome is None


def test_goal_reached_resolves_client_session() -> None:
    goals = NavGoalCoordinator(odom_correction_factor=1.25)
    goals.submit_client_goal(_nav_goal())

    assert goals.on_goal_reached(Bool(True)) is True
    nav = goals.nav_state()
    assert nav.state == "resolved"
    assert nav.outcome == "succeeded"

    assert goals.on_goal_reached(Bool(True)) is False


def test_goal_reached_ignored_without_client_session() -> None:
    goals = NavGoalCoordinator(odom_correction_factor=1.25)

    assert goals.on_goal_reached(Bool(True)) is False
    assert goals.nav_state().state == "idle"


def test_goal_reached_failure() -> None:
    goals = NavGoalCoordinator(odom_correction_factor=1.25)
    goals.submit_client_goal(_nav_goal())

    assert goals.on_goal_reached(Bool(False)) is True
    nav = goals.nav_state()
    assert nav.state == "resolved"
    assert nav.outcome == "failed"


def test_estop_clears_following_path_without_resolved_outcome() -> None:
    goals = NavGoalCoordinator(odom_correction_factor=1.25)
    goals.submit_client_goal(_nav_goal())

    assert goals.on_estop() is True
    nav = goals.nav_state()
    assert nav.state == "idle"
    assert nav.outcome is None


def test_new_client_goal_clears_previous_outcome() -> None:
    goals = NavGoalCoordinator(odom_correction_factor=1.25)
    goals.submit_client_goal(_nav_goal(x=1.0, y=2.0))
    goals.on_goal_reached(Bool(True))

    goals.submit_client_goal(_nav_goal(x=3.0, y=4.0))
    nav = goals.nav_state()
    assert nav.state == "following_path"
    assert nav.outcome is None
