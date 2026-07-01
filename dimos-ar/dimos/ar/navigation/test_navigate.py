from __future__ import annotations

import json
import time
from unittest.mock import MagicMock

from dimos_lcm.std_msgs import Bool
import numpy as np
import pytest

from dimos.ar.bridge.motion_router import MotionRouter
from dimos.ar.bridge.sender import BridgeSender
from dimos.ar.navigation.navigate import (
    NAV_GOAL_PATH_TIMEOUT_S,
    NAV_WATCHDOG_POLL_INTERVAL_S,
    NavigateGoalHandler,
)
from dimos.ar.network.protocol import NavGoalMessage, encode_pose
from dimos.ar.world_frame.state import WorldFrameState
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.msgs.geometry_msgs.Twist import Twist
from dimos.msgs.nav_msgs.Path import Path


def _make_sender() -> tuple[BridgeSender, MagicMock]:
    """Return a BridgeSender bound to a mock server and the mock server."""
    sender = BridgeSender()
    mock_server = MagicMock()
    sender.bind(mock_server)
    return sender, mock_server


def _make_nav(
    *,
    committed: bool = True,
) -> tuple[NavigateGoalHandler, MagicMock, list[PoseStamped], list[Bool]]:
    world_frame = WorldFrameState()
    if committed:
        world_frame.commit(np.eye(4, dtype=np.float64), method="manual_pose", approximate=False)
    published_cmd_vel: list[Twist] = []
    published_nav: list[PoseStamped] = []
    published_cancel: list[Bool] = []
    router = MotionRouter(
        publish_cmd_vel=published_cmd_vel.append,
        publish_nav_goal=published_nav.append,
        publish_cancel=published_cancel.append,
    )
    sender, mock_server = _make_sender()
    nav = NavigateGoalHandler(
        robot_id="unitree_go2",
        sender=sender,
        world_frame=world_frame,
        motion_router=router,
    )
    return nav, mock_server, published_nav, published_cancel


def _all_nav_statuses(mock_server: MagicMock) -> list[dict]:
    payloads = [call.args[0] for call in mock_server.schedule_send.call_args_list]
    return [
        json.loads(payload)
        for payload in payloads
        if json.loads(payload).get("type") == "nav_status"
    ]


def _last_nav_status(mock_server: MagicMock) -> dict:
    return _all_nav_statuses(mock_server)[-1]


# ------------------------------------------------------------------
# NavigateGoalHandler unit tests
# ------------------------------------------------------------------


def test_on_navigate_goal_broadcasts_idle_until_path() -> None:
    nav, mock_server, published_nav, _published_cancel = _make_nav()
    msg = NavGoalMessage(
        intent="navigate",
        ts=1.0,
        robot_id="unitree_go2",
        position=(1.0, 0.0, 2.0),
        orientation=(0.0, 0.0, 0.0, 1.0),
    )

    nav.on_navigate_goal(msg)

    time.sleep(0.05)
    assert nav._dimos_nav_state == "idle"
    assert nav._nav_goal_pending is True
    assert nav._nav_path_received is False
    assert nav._goal_reached is False
    assert nav._goal_failed is False
    assert nav._nav_goal_dispatch_mono is not None
    assert len(published_nav) == 1
    nav_status = _last_nav_status(mock_server)
    assert nav_status["type"] == "nav_status"
    assert nav_status["phase"] == "idle"


@pytest.mark.asyncio
async def test_handle_ar_path_promotes_navigating() -> None:
    nav, _mock_server, _published_nav, _published_cancel = _make_nav()
    nav._nav_goal_pending = True
    nav._nav_goal_dispatch_mono = time.monotonic()

    path = Path()
    path.poses = [
        PoseStamped(
            position=[1.0, 0.0, 0.0],
            orientation=[0.0, 0.0, 0.0, 1.0],
            ts=2.0,
            frame_id="odom",
        )
    ]
    path.ts = 2.0

    nav.on_path(path)

    assert nav._dimos_nav_state == "navigating"
    assert nav._nav_path_received is True
    assert nav._nav_goal_dispatch_mono is None


@pytest.mark.asyncio
async def test_handle_ar_path_does_not_mutate_nav_state_without_pending_goal() -> None:
    nav, mock_server, _published_nav, _published_cancel = _make_nav()
    nav._dimos_nav_state = "idle"
    nav._nav_goal_pending = False

    path = Path()
    path.poses = [
        PoseStamped(
            position=[1.0, 0.0, 0.0],
            orientation=[0.0, 0.0, 0.0, 1.0],
            ts=2.0,
            frame_id="odom",
        )
    ]
    path.ts = 2.0

    nav.on_path(path)

    assert nav._dimos_nav_state == "idle"
    assert nav._nav_goal_pending is False
    mock_server.schedule_send.assert_called_once()
    payload = json.loads(mock_server.schedule_send.call_args.args[0])
    assert payload["type"] == "path"
    assert len(payload["waypoints"]) == 1


@pytest.mark.asyncio
async def test_late_path_after_goal_reached_does_not_revive_navigating() -> None:
    nav, _mock_server, _published_nav, _published_cancel = _make_nav()
    nav._nav_goal_pending = True
    nav._dimos_nav_state = "navigating"

    nav.on_goal_reached(Bool(data=True))

    assert nav._dimos_nav_state == "idle"
    assert nav._nav_goal_pending is False
    assert nav._goal_reached is True

    path = Path()
    path.poses = [
        PoseStamped(
            position=[2.0, 0.0, 0.0],
            orientation=[0.0, 0.0, 0.0, 1.0],
            ts=3.0,
            frame_id="odom",
        )
    ]
    path.ts = 3.0
    nav.on_path(path)

    assert nav._dimos_nav_state == "idle"
    assert nav._nav_goal_pending is False


@pytest.mark.asyncio
async def test_handle_ar_goal_reached_failure_marks_goal_failed() -> None:
    nav, _mock_server, _published_nav, _published_cancel = _make_nav()
    nav._nav_goal_pending = True
    nav._dimos_nav_state = "navigating"

    nav.on_goal_reached(Bool(data=False))

    assert nav._dimos_nav_state == "idle"
    assert nav._goal_reached is False
    assert nav._goal_failed is True
    assert nav._nav_goal_pending is False


def test_goal_stall_no_path_emits_retryable_recovering() -> None:
    nav, mock_server, _published_nav, published_cancel = _make_nav()
    nav._nav_goal_pending = True
    nav._nav_path_received = False
    nav._nav_goal_dispatch_mono = time.monotonic() - NAV_GOAL_PATH_TIMEOUT_S - 1.0

    nav.handle_goal_stall(stall_reason="no_path")

    assert nav._dimos_nav_state == "recovery"
    assert nav._goal_failed is False
    assert nav._nav_goal_pending is False
    nav_status = _last_nav_status(mock_server)
    assert nav_status["phase"] == "recovering"
    assert nav_status["retryable"] is True
    assert nav_status["stall_reason"] == "no_path"
    time.sleep(0.05)
    assert len(published_cancel) == 1


def test_goal_stall_planner_idle_emits_retryable_recovering() -> None:
    nav, mock_server, _published_nav, published_cancel = _make_nav()
    nav._nav_goal_pending = True
    nav._nav_path_received = False

    nav.on_navigation_state("idle")

    nav_status = _last_nav_status(mock_server)
    assert nav_status["phase"] == "recovering"
    assert nav_status["retryable"] is True
    assert nav_status["stall_reason"] == "planner_idle"
    time.sleep(0.05)
    assert len(published_cancel) == 1


def test_goal_stall_does_not_send_second_nav_goal() -> None:
    nav, _mock_server, published_nav, published_cancel = _make_nav()
    nav._nav_goal_pending = True
    nav._nav_path_received = False
    nav._nav_goal_dispatch_mono = time.monotonic() - NAV_GOAL_PATH_TIMEOUT_S - 1.0

    nav.handle_goal_stall(stall_reason="no_path")

    assert published_nav == []
    time.sleep(0.05)
    assert len(published_cancel) == 1


def test_disconnect_prevents_watchdog_stall_emission() -> None:
    nav, mock_server, _published_nav, _published_cancel = _make_nav()
    nav.start()
    try:
        nav._nav_goal_pending = True
        nav._nav_path_received = False
        nav._nav_goal_dispatch_mono = time.monotonic() - NAV_GOAL_PATH_TIMEOUT_S - 1.0
        mock_server.schedule_send.reset_mock()

        nav.reset_on_disconnect()

        time.sleep(NAV_WATCHDOG_POLL_INTERVAL_S + 0.3)
        nav_statuses = _all_nav_statuses(mock_server)
        assert not any(status.get("retryable") is True for status in nav_statuses)
    finally:
        nav.stop()


def test_on_navigate_goal_sets_dispatch_mono_on_direct_publish() -> None:
    """dispatch_mono tracks direct stream publish acceptance."""
    nav, _mock_server, published_nav, _published_cancel = _make_nav()
    msg = NavGoalMessage(
        intent="navigate",
        ts=1.0,
        robot_id="unitree_go2",
        position=(1.0, 0.0, 2.0),
        orientation=(0.0, 0.0, 0.0, 1.0),
    )

    nav.on_navigate_goal(msg)
    assert nav._nav_goal_dispatch_mono is not None
    assert len(published_nav) == 1


def test_on_navigate_goal_direct_publish_returns_quickly() -> None:
    """Direct stream publish keeps the WebSocket handler quick."""
    nav, _mock_server, published_nav, _published_cancel = _make_nav()
    msg = NavGoalMessage(
        intent="navigate",
        ts=1.0,
        robot_id="unitree_go2",
        position=(1.0, 0.0, 2.0),
        orientation=(0.0, 0.0, 0.0, 1.0),
    )

    start = time.monotonic()
    nav.on_navigate_goal(msg)
    elapsed = time.monotonic() - start

    assert elapsed < 0.1
    assert len(published_nav) == 1


def test_emergency_stop_then_goal_succeeds() -> None:
    """After emergency stop, a new goal is accepted and published."""
    nav, _mock_server, published_nav, published_cancel = _make_nav()
    nav._nav_goal_pending = True
    nav._dimos_nav_state = "navigating"
    nav._nav_path_received = True

    nav.on_emergency_stop()
    time.sleep(0.05)

    assert nav._nav_goal_pending is False
    assert nav._dimos_nav_state == "idle"

    msg = NavGoalMessage(
        intent="navigate",
        ts=2.0,
        robot_id="unitree_go2",
        position=(2.0, 0.0, 3.0),
        orientation=(0.0, 0.0, 0.0, 1.0),
    )
    nav.on_navigate_goal(msg)
    time.sleep(0.05)

    assert len(published_cancel) == 1
    assert len(published_nav) == 1
    assert nav._nav_goal_pending is True
    assert nav._nav_path_received is False


def test_cancel_goal_timeout_does_not_mark_goal_failed() -> None:
    nav, mock_server, _published_nav, published_cancel = _make_nav()
    nav.on_cancel_nav_goal(ts=3.0)

    assert nav._goal_failed is False
    assert nav._nav_error_code is None
    assert len(published_cancel) == 1
    nav_status = _last_nav_status(mock_server)
    assert nav_status["phase"] == "idle"
    assert nav_status.get("error_code") is None


def test_send_nav_goal_accepts_direct_publish() -> None:
    nav, _mock_server, published_nav, _published_cancel = _make_nav()
    msg = NavGoalMessage(
        intent="navigate",
        ts=1.0,
        robot_id="unitree_go2",
        position=(1.0, 0.0, 2.0),
        orientation=(0.0, 0.0, 0.0, 1.0),
    )
    nav.on_navigate_goal(msg)
    assert nav._goal_failed is False
    assert nav._nav_goal_pending is True
    assert len(published_nav) == 1
    assert nav._goal_failed is False


def test_concurrent_nav_goals_dispatch_both() -> None:
    """Direct router dispatches each goal; Lens throttling owns coalescing."""
    nav, _mock_server, published_nav, _published_cancel = _make_nav()
    first_goal = NavGoalMessage(
        intent="navigate",
        ts=1.0,
        robot_id="unitree_go2",
        position=(1.0, 0.0, 2.0),
        orientation=(0.0, 0.0, 0.0, 1.0),
    )
    second_goal = NavGoalMessage(
        intent="navigate",
        ts=2.0,
        robot_id="unitree_go2",
        position=(2.0, 0.0, 3.0),
        orientation=(0.0, 0.0, 0.0, 1.0),
    )
    nav.on_navigate_goal(first_goal)
    nav.on_navigate_goal(second_goal)

    assert len(published_nav) == 2
    assert published_nav[-1].position[0] == 2.0
    assert nav._goal_failed is False


def test_on_navigation_state_idle_while_live_emits_recovery() -> None:
    nav, mock_server, _published_nav, _published_cancel = _make_nav()
    nav._nav_goal_pending = True
    nav._nav_path_received = True
    nav._dimos_nav_state = "navigating"
    nav._goal_reached = False
    nav._goal_failed = False

    nav.on_navigation_state("idle")

    assert nav._dimos_nav_state == "recovery"
    nav_status = _last_nav_status(mock_server)
    assert nav_status["phase"] == "recovering"


def test_on_navigation_state_initial_rotation_maps_to_navigating() -> None:
    from dimos.ar.navigation.nav_state import normalize_nav_state

    assert normalize_nav_state("initial_rotation") == "navigating"
    assert normalize_nav_state("final_rotation") == "navigating"
    assert normalize_nav_state("path_following") == "navigating"
    assert normalize_nav_state("arrived") == "idle"


# ------------------------------------------------------------------
# encode_pose protocol (unchanged — lives in network.protocol)
# ------------------------------------------------------------------


def test_encode_pose_accepts_non_finite_inputs() -> None:
    raw = json.loads(
        encode_pose(
            ts=1.0,
            position=(float("nan"), 1.0, 2.0),
            orientation=(0.0, float("inf"), 0.0, 1.0),
        )
    )
    assert raw["type"] == "pose"
    assert all(np.isfinite(value) for value in raw["position"])
    assert all(np.isfinite(value) for value in raw["orientation"])
