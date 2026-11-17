from __future__ import annotations

from dataclasses import replace
from itertools import count
import math
import time

import numpy as np
import pytest

from dimos.ar.navigation.control import NavGoalCoordinator
from dimos.ar.navigation.types import NavGoalRequest
from dimos.ar.spatial import FrameSnapshot
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.msgs.nav_msgs.Path import Path


def _frames() -> FrameSnapshot:
    return FrameSnapshot.initial("odom")


def _map_transform() -> np.ndarray:
    # A ninety-degree yaw and a nonzero translation expose order/direction errors.
    return np.array([[0, -1, 0, 10], [1, 0, 0, -3], [0, 0, 1, 2], [0, 0, 0, 1]], dtype=float)


@pytest.fixture(autouse=True)
def advancing_clock(monkeypatch: pytest.MonkeyPatch) -> None:
    # A goal and its first path can otherwise share the same clock microsecond.
    # These tests model a freshly produced planner frame after the submission.
    ticks = count(1_000_000, 0.001)
    monkeypatch.setattr(time, "time", lambda: next(ticks))


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
        ts=time.time(),
        frame_id="world",
        poses=[
            PoseStamped(frame_id="world", position=list(position), orientation=list(orientation))
            for position, orientation in poses
        ],
    )


def test_submit_goal_preserves_native_metres_with_identity_map() -> None:
    coordinator = NavGoalCoordinator(frames=_frames)

    published = coordinator.submit_goal(_nav_goal_request())

    assert (published.x, published.y, published.z) == pytest.approx((5.0, 10.0, 0.33))
    assert published.frame_id == "odom"
    assert coordinator.nav_state().state == "idle"


def test_path_sets_following_path_and_goal_from_dimos_path() -> None:
    coordinator = NavGoalCoordinator(frames=_frames)

    nav_goal_frame, state_changed = coordinator.on_path(
        _path(
            ((0.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0)),
            ((2.5, 5.0, 0.0), (0.0, 0.0, 0.707, 0.707)),
        )
    )

    assert state_changed is True
    assert nav_goal_frame.path_poses[0] == pytest.approx((0.0, 0.0, 0.0, 0.0))
    assert nav_goal_frame.path_poses[1][:3] == pytest.approx((2.5, 5.0, 0.0))
    assert nav_goal_frame.path_poses[1][3] == pytest.approx(1.5707963, abs=1e-4)
    assert nav_goal_frame.pose == nav_goal_frame.path_poses[-1]
    assert coordinator.nav_state().state == "following_path"


def test_path_terminal_yaw_comes_from_last_dimos_pose() -> None:
    coordinator = NavGoalCoordinator(frames=_frames)
    coordinator.submit_goal(_nav_goal_request(orientation=(0.0, 0.0, 0.0, 1.0)))

    nav_goal_frame, _state_changed = coordinator.on_path(
        _path(((1.0, 2.0, 0.0), (0.0, 0.0, 0.3826834, 0.9238795)))
    )

    assert nav_goal_frame.pose is not None
    assert nav_goal_frame.pose[3] == pytest.approx(0.7853982, abs=1e-4)


def test_empty_path_clears_goal_points_without_changing_nav_state() -> None:
    coordinator = NavGoalCoordinator(frames=_frames)
    coordinator.on_path(_path(((1.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0))))

    nav_goal_frame, state_changed = coordinator.on_path(Path(frame_id="world", poses=[]))

    assert nav_goal_frame.pose is None
    assert nav_goal_frame.path_poses == []
    assert state_changed is False
    assert coordinator.nav_state().state == "following_path"


def test_goal_reached_resolves_any_navigation() -> None:
    coordinator = NavGoalCoordinator(frames=_frames)
    coordinator.on_path(_path(((1.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0))))

    coordinator.on_native_status(1.0, "accepted")
    coordinator.on_native_status(1.0, "succeeded")

    nav = coordinator.nav_state()
    assert nav.state == "resolved"
    assert nav.outcome == "succeeded"


def test_goal_reached_without_path_still_resolves() -> None:
    coordinator = NavGoalCoordinator(frames=_frames)

    coordinator.on_native_status(1.0, "accepted")
    coordinator.on_native_status(1.0, "succeeded")

    nav = coordinator.nav_state()
    assert nav.state == "resolved"
    assert nav.outcome == "succeeded"


def test_goal_reached_failure() -> None:
    coordinator = NavGoalCoordinator(frames=_frames)
    coordinator.on_path(_path(((1.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0))))

    coordinator.on_native_status(1.0, "accepted")
    coordinator.on_native_status(1.0, "failed")

    nav = coordinator.nav_state()
    assert nav.state == "resolved"
    assert nav.outcome == "failed"


def test_estop_clears_following_path_without_resolved_outcome() -> None:
    coordinator = NavGoalCoordinator(frames=_frames)
    coordinator.submit_goal(_nav_goal_request())
    coordinator.on_path(_path(((1.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0))))

    assert coordinator.on_estop() is True
    nav = coordinator.nav_state()
    assert nav.state == "idle"
    assert nav.outcome is None


def test_new_goal_clears_previous_outcome() -> None:
    coordinator = NavGoalCoordinator(frames=_frames)
    coordinator.on_path(_path(((1.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0))))
    coordinator.on_native_status(1.0, "accepted")
    coordinator.on_native_status(1.0, "succeeded")

    coordinator.submit_goal(_nav_goal_request(x=3.0, y=4.0))
    coordinator.on_path(_path(((3.0, 4.0, 0.0), (0.0, 0.0, 0.0, 1.0))))

    nav = coordinator.nav_state()
    assert nav.state == "following_path"
    assert nav.outcome is None


@pytest.mark.parametrize("success", [True, False])
def test_late_path_cannot_resurrect_terminal_navigation(success: bool) -> None:
    coordinator = NavGoalCoordinator(frames=_frames)
    path = _path(((1.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0)))
    coordinator.on_path(path)
    coordinator.on_native_status(1.0, "accepted")
    coordinator.on_native_status(1.0, "succeeded" if success else "failed")
    frame, changed = coordinator.on_path(path)
    assert frame is None
    assert changed is False
    assert coordinator.nav_state().state == "resolved"
    coordinator.submit_goal(_nav_goal_request(x=1.0, y=0.0))
    assert coordinator.on_path(path) == (None, False)
    fresh = _path(((1.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0)))
    assert coordinator.on_path(fresh)[0] is not None
    assert coordinator.nav_state().state == "following_path"


def test_late_path_after_estop_is_ignored() -> None:
    coordinator = NavGoalCoordinator(frames=_frames)
    path = _path(((1.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0)))
    coordinator.on_path(path)
    coordinator.on_estop()
    assert coordinator.on_path(path) == (None, False)
    assert coordinator.nav_state().state == "idle"


@pytest.mark.parametrize("success", [True, False])
def test_old_goal_terminal_cannot_retire_new_ar_goal(success):
    coordinator = NavGoalCoordinator(frames=_frames)
    old = coordinator.submit_goal(_nav_goal_request(x=1))
    coordinator.on_native_status(old.ts, "accepted")
    current = coordinator.submit_goal(_nav_goal_request(x=2))
    assert not coordinator.on_native_status(old.ts, "succeeded" if success else "failed")
    coordinator.on_native_status(current.ts, "accepted")
    coordinator.on_path(_path(((2, 0, 0), (0, 0, 0, 1))))
    assert not coordinator.on_native_status(old.ts, "accepted")
    assert coordinator.nav_state().state == "following_path"
    assert coordinator.on_native_status(current.ts, "succeeded" if success else "failed")
    assert coordinator.nav_state().outcome == ("succeeded" if success else "failed")
    assert not coordinator.on_native_status(current.ts, "succeeded")


def test_correlated_native_status_after_stop_cannot_resurrect_goal():
    coordinator = NavGoalCoordinator(frames=_frames)
    goal = coordinator.submit_goal(_nav_goal_request())
    coordinator.on_native_status(goal.ts, "accepted")
    coordinator.on_estop()
    assert not coordinator.on_native_status(goal.ts, "accepted")
    assert not coordinator.on_native_status(goal.ts, "succeeded")
    assert coordinator.nav_state().state == "idle"


def test_goal_inverse_and_path_forward_use_the_same_map_transform() -> None:
    snapshot = replace(_frames(), T_map_odom=_map_transform())
    coordinator = NavGoalCoordinator(frames=lambda: snapshot)
    half = math.sqrt(0.5)
    goal = coordinator.submit_goal(
        _nav_goal_request(x=8, y=1, z=2.33, orientation=(0, 0, half, half))
    )
    assert (goal.x, goal.y, goal.z, goal.yaw) == pytest.approx((4, 2, 0.33, 0))
    frame, _changed = coordinator.on_path(
        _path(((4, 2, 0.33), (0, 0, 0, 1)))
    )
    assert frame is not None
    assert frame.pose == pytest.approx((8, 1, 2.33, math.pi / 2))


def test_map_adoption_keeps_admitted_native_goal_and_feedback_identity() -> None:
    snapshot = _frames()
    coordinator = NavGoalCoordinator(frames=lambda: snapshot)
    goal = coordinator.submit_goal(_nav_goal_request(x=4, y=2))
    stamp = goal.ts
    coordinator.on_native_status(stamp, "accepted")
    original, _changed = coordinator.on_path(_path(((4, 2, 0.33), (0, 0, 0, 1))))
    snapshot = replace(snapshot, shared_frame_id="vps", revision=1, T_map_odom=_map_transform())
    frame = coordinator.refresh_projection()
    assert original is not None and frame is not None
    assert frame.ts == original.ts
    assert frame.shared_frame_id == "vps"
    assert (goal.x, goal.y, goal.z, goal.ts) == pytest.approx((4, 2, 0.33, stamp))
    assert frame is not None
    assert frame.pose == pytest.approx((8, 1, 2.33, math.pi / 2))
    assert coordinator.on_native_status(stamp, "succeeded")
    assert coordinator.nav_state().outcome == "succeeded"


def test_ordinary_correction_refreshes_path_without_new_native_packet() -> None:
    snapshot = _frames()
    coordinator = NavGoalCoordinator(frames=lambda: snapshot)
    original, _changed = coordinator.on_path(_path(((1, 2, 0), (0, 0, 0, 1))))
    assert original is not None
    snapshot = replace(snapshot, revision=1, T_map_odom=_map_transform())
    refreshed = coordinator.refresh_projection()
    assert refreshed is not None
    assert refreshed.shared_frame_id == original.shared_frame_id
    assert refreshed.ts == original.ts
    assert refreshed.pose == pytest.approx((8, -2, 2, math.pi / 2))
    assert coordinator.nav_state().state == "following_path"
    coordinator.on_estop()
    assert coordinator.refresh_projection() is None


def test_map_correction_refreshes_admitted_goal_before_first_path() -> None:
    snapshot = _frames()
    coordinator = NavGoalCoordinator(frames=lambda: snapshot)
    goal = coordinator.submit_goal(_nav_goal_request(x=4, y=2))
    snapshot = replace(snapshot, revision=1, T_map_odom=_map_transform())
    refreshed = coordinator.refresh_projection()
    assert refreshed is not None
    assert refreshed.ts == goal.ts
    assert refreshed.pose == pytest.approx((8, 1, 2.33, math.pi / 2))
    assert refreshed.path_poses == []
    assert coordinator.nav_state().state == "idle"
    coordinator.on_native_status(goal.ts, "failed")
    assert coordinator.refresh_projection() is None
