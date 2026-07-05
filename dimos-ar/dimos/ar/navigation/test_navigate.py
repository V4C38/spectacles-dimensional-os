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
from dimos.msgs.geometry_msgs.PointStamped import PointStamped
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
    published_point_nav: list[PointStamped] = []
    published_cancel: list[Bool] = []
    router = MotionRouter(
        publish_cmd_vel=published_cmd_vel.append,
        publish_nav_goal=published_nav.append,
        publish_nav_point_goal=published_point_nav.append,
        publish_stop_movement=published_cancel.append,
        publish_cancel_goal=published_cancel.append,
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
    nav, _mock_server, _published_nav, published_cancel = _make_nav()
    nav._nav_goal_pending = True
    nav._dimos_nav_state = "navigating"

    nav.on_goal_reached(Bool(data=False))

    assert nav._dimos_nav_state == "idle"
    assert nav._goal_reached is False
    assert nav._goal_failed is True
    assert nav._nav_goal_pending is False
    assert len(published_cancel) == 2


def test_goal_stall_no_path_emits_retryable_recovering() -> None:
    nav, mock_server, _published_nav, published_cancel = _make_nav()
    nav._nav_goal_pending = True
    nav._nav_path_received = False
    nav._nav_goal_dispatch_mono = time.monotonic() - NAV_GOAL_PATH_TIMEOUT_S - 1.0

    nav.handle_goal_stall(stall_reason="no_path")

    assert nav._dimos_nav_state == "recovering"
    assert nav._goal_failed is False
    assert nav._nav_goal_pending is False
    nav_status = _last_nav_status(mock_server)
    assert nav_status["phase"] == "recovering"
    assert nav_status["retryable"] is True
    assert nav_status["stall_reason"] == "no_path"
    time.sleep(0.05)
    assert len(published_cancel) == 2


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
    assert len(published_cancel) == 2


def test_goal_stall_does_not_send_second_nav_goal() -> None:
    nav, _mock_server, published_nav, published_cancel = _make_nav()
    nav._nav_goal_pending = True
    nav._nav_path_received = False
    nav._nav_goal_dispatch_mono = time.monotonic() - NAV_GOAL_PATH_TIMEOUT_S - 1.0

    nav.handle_goal_stall(stall_reason="no_path")

    assert published_nav == []
    time.sleep(0.05)
    assert len(published_cancel) == 2


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

    assert len(published_cancel) == 2
    assert len(published_nav) == 1
    assert nav._nav_goal_pending is True
    assert nav._nav_path_received is False


def test_cancel_goal_timeout_does_not_mark_goal_failed() -> None:
    nav, mock_server, _published_nav, published_cancel = _make_nav()
    nav.on_cancel_nav_goal(ts=3.0)

    assert nav._goal_failed is False
    assert nav._nav_error_code is None
    assert len(published_cancel) == 2
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

    assert nav._dimos_nav_state == "recovering"
    nav_status = _last_nav_status(mock_server)
    assert nav_status["phase"] == "recovering"


def test_on_navigation_state_initial_rotation_maps_to_navigating() -> None:
    from dimos.ar.navigation.nav_state import normalize_nav_state

    assert normalize_nav_state("initial_rotation") == "navigating"
    assert normalize_nav_state("final_rotation") == "navigating"
    assert normalize_nav_state("path_following") == "navigating"
    assert normalize_nav_state("arrived") == "idle"


# ------------------------------------------------------------------
# Wire sequence pins (Phase 0 regression net)
# ------------------------------------------------------------------


def _all_wire_messages(mock_server: MagicMock) -> list[dict]:
    payloads = [call.args[0] for call in mock_server.schedule_send.call_args_list]
    return [json.loads(payload) for payload in payloads]


def _wire_sequence(mock_server: MagicMock) -> list[tuple[str, str | None]]:
    """Return (type, phase) pairs for nav_status; other types have phase=None."""
    return [
        (msg["type"], msg.get("phase") if msg["type"] == "nav_status" else None)
        for msg in _all_wire_messages(mock_server)
    ]


def _make_goal_msg(
    *,
    ts: float = 1.0,
    position: tuple[float, float, float] = (1.0, 0.0, 2.0),
) -> NavGoalMessage:
    return NavGoalMessage(
        intent="navigate",
        ts=ts,
        robot_id="unitree_go2",
        position=position,
        orientation=(0.0, 0.0, 0.0, 1.0),
    )


def _make_path(*, ts: float = 2.0) -> Path:
    path = Path()
    path.poses = [
        PoseStamped(
            position=[1.0, 0.0, 0.0],
            orientation=[0.0, 0.0, 0.0, 1.0],
            ts=ts,
            frame_id="odom",
        )
    ]
    path.ts = ts
    return path


def test_wire_sequence_goal_path_reached() -> None:
    """goal → path → reached emits idle → navigating → succeeded."""
    nav, mock_server, _published_nav, _published_cancel = _make_nav()
    nav.on_navigate_goal(_make_goal_msg())
    time.sleep(0.05)
    nav.on_path(_make_path())
    nav.on_goal_reached(Bool(data=True))

    statuses = _all_nav_statuses(mock_server)
    phases = [s["phase"] for s in statuses]
    assert "idle" in phases
    assert "navigating" in phases
    assert phases[-1] == "succeeded"
    wire = _wire_sequence(mock_server)
    assert any(t == "path" for t, _ in wire)


def test_wire_sequence_goal_stall() -> None:
    """goal with no path → watchdog stall emits recovering."""
    nav, mock_server, _published_nav, _published_cancel = _make_nav()
    nav.on_navigate_goal(_make_goal_msg())
    time.sleep(0.05)
    nav._nav_goal_dispatch_mono = time.monotonic() - NAV_GOAL_PATH_TIMEOUT_S - 1.0
    nav.handle_goal_stall(stall_reason="no_path")

    statuses = _all_nav_statuses(mock_server)
    assert any(s["phase"] == "recovering" for s in statuses)
    assert statuses[-1]["retryable"] is True
    assert statuses[-1]["stall_reason"] == "no_path"


def test_wire_sequence_cancel() -> None:
    """cancel during navigation emits idle, not failed."""
    nav, mock_server, _published_nav, _published_cancel = _make_nav()
    nav._nav_goal_pending = True
    nav._dimos_nav_state = "navigating"
    nav._nav_path_received = True

    nav.on_cancel_nav_goal(ts=3.0)
    time.sleep(0.05)

    statuses = _all_nav_statuses(mock_server)
    assert statuses[-1]["phase"] == "idle"
    assert nav._goal_failed is False
    wire = _wire_sequence(mock_server)
    assert any(t == "path" for t, _ in wire)


def test_wire_sequence_estop() -> None:
    """e-stop during navigation emits idle, not failed."""
    nav, mock_server, _published_nav, _published_cancel = _make_nav()
    nav._nav_goal_pending = True
    nav._dimos_nav_state = "navigating"
    nav._nav_path_received = True

    nav.on_emergency_stop(ts=4.0)
    time.sleep(0.05)

    statuses = _all_nav_statuses(mock_server)
    assert statuses[-1]["phase"] == "idle"
    assert nav._goal_failed is False


def test_wire_sequence_goal_failed() -> None:
    """goal reached false while pending emits failed."""
    nav, mock_server, _published_nav, published_cancel = _make_nav()
    nav._nav_goal_pending = True
    nav._dimos_nav_state = "navigating"
    nav._nav_path_received = True

    nav.on_goal_reached(Bool(data=False))

    statuses = _all_nav_statuses(mock_server)
    assert statuses[-1]["phase"] == "failed"
    assert len(published_cancel) == 2


def test_goal_update_while_navigating_suppresses_idle_flap() -> None:
    """Second goal while navigating must not broadcast idle nav_status."""
    nav, mock_server, _published_nav, _published_cancel = _make_nav()
    nav.on_navigate_goal(_make_goal_msg(ts=1.0))
    time.sleep(0.05)
    nav.on_path(_make_path(ts=2.0))
    mock_server.schedule_send.reset_mock()

    nav.on_navigate_goal(_make_goal_msg(ts=3.0, position=(2.0, 0.0, 3.0)))
    time.sleep(0.05)

    statuses = _all_nav_statuses(mock_server)
    assert not any(s["phase"] == "idle" for s in statuses)
    assert nav._dimos_nav_state == "navigating"
    assert nav._nav_goal_pending is True


def test_joystick_preemption_emits_idle_not_failed() -> None:
    """Joystick interrupt notifies nav handler; upstream cancel must not mark failed."""
    nav, mock_server, published_nav, published_cancel = _make_nav()
    nav.on_navigate_goal(_make_goal_msg())
    time.sleep(0.05)
    nav.on_path(_make_path())
    mock_server.schedule_send.reset_mock()

    router = nav._motion_router
    router._on_nav_preempted = nav.on_preempted
    router.send_joystick_command(0.0, 0.3, 0.0)
    time.sleep(0.05)

    nav.on_goal_reached(Bool(data=False))

    statuses = _all_nav_statuses(mock_server)
    assert nav._goal_failed is False
    assert statuses[-1]["phase"] == "idle"


def test_watchdog_fires_on_mid_session_path_silence() -> None:
    """Watchdog stalls when path stops updating mid-navigation."""
    nav, mock_server, _published_nav, _published_cancel = _make_nav()
    nav.on_navigate_goal(_make_goal_msg())
    time.sleep(0.05)
    nav.on_path(_make_path())
    nav._nav_goal_dispatch_mono = time.monotonic() - NAV_GOAL_PATH_TIMEOUT_S - 1.0
    nav._last_path_mono = time.monotonic() - NAV_GOAL_PATH_TIMEOUT_S - 1.0
    mock_server.schedule_send.reset_mock()

    nav.handle_goal_stall(stall_reason="no_path")

    statuses = _all_nav_statuses(mock_server)
    assert statuses[-1]["phase"] == "recovering"
    assert statuses[-1]["stall_reason"] == "no_path"


def test_agent_submit_goal_emits_agent_source() -> None:
    """Agent ingress uses source=agent on nav_goal_update."""
    nav, mock_server, published_nav, _published_cancel = _make_nav()
    nav.submit_goal(
        position=(1.0, 0.0, 2.0),
        orientation=(0.0, 0.0, 0.0, 1.0),
        ts=1.0,
        source="agent",
    )
    time.sleep(0.05)
    wire = _all_wire_messages(mock_server)
    updates = [m for m in wire if m["type"] == "nav_goal_update"]
    assert len(updates) >= 1
    assert updates[0]["source"] == "agent"
    assert updates[0]["active"] is True
    assert len(published_nav) == 1


def test_agent_submit_rejected_before_world_frame_committed() -> None:
    nav, mock_server, published_nav, _published_cancel = _make_nav(committed=False)
    nav.submit_goal(
        position=(1.0, 0.0, 2.0),
        orientation=None,
        ts=1.0,
        source="agent",
    )
    time.sleep(0.05)
    assert published_nav == []
    wire = _all_wire_messages(mock_server)
    assert not any(m["type"] == "nav_goal_update" for m in wire)


def test_submit_goal_rejected_when_robot_not_connected() -> None:
    nav, mock_server, published_nav, _published_cancel = _make_nav()
    nav._robot_connected = lambda: False
    nav.submit_goal(
        position=(1.0, 0.0, 2.0),
        orientation=(0.0, 0.0, 0.0, 1.0),
        ts=1.0,
        source="xr",
    )
    time.sleep(0.05)
    assert published_nav == []
    nav_status = _last_nav_status(mock_server)
    assert nav_status["phase"] == "failed"
    assert nav_status["error_code"] == 503
    assert nav._session is None


def test_world_frame_correction_redispatches_active_goal() -> None:
    nav, mock_server, published_nav, _published_cancel = _make_nav()
    nav.on_navigate_goal(_make_goal_msg())
    assert len(published_nav) == 1
    status_count = len(_all_nav_statuses(mock_server))

    T = np.eye(4, dtype=np.float64)
    T[0, 3] = 1.0
    nav._world_frame.apply_transform(T)
    nav.on_world_frame_corrected()

    assert len(published_nav) == 2
    assert len(_all_nav_statuses(mock_server)) == status_count
    assert nav._session is not None
    assert nav._session.odom_position is not None


def test_world_frame_correction_skips_redispatch_below_threshold() -> None:
    nav, _mock_server, published_nav, _published_cancel = _make_nav()
    nav.on_navigate_goal(_make_goal_msg())
    assert len(published_nav) == 1
    nav.on_world_frame_corrected()
    assert len(published_nav) == 1


def test_world_frame_correction_noop_without_session() -> None:
    nav, _mock_server, published_nav, _published_cancel = _make_nav()
    nav.on_world_frame_corrected()
    assert published_nav == []


def test_goal_reached_logs_arrival_shortfall(caplog: pytest.LogCaptureFixture) -> None:
    from dimos.ar.world_frame.transforms import OdomSample

    nav, _mock_server, published_nav, _published_cancel = _make_nav()
    nav._odom_latest = lambda: OdomSample(
        position=(1.5, 0.0, 2.5),
        orientation=(0.0, 0.0, 0.0, 1.0),
    )
    nav.on_navigate_goal(_make_goal_msg(position=(1.0, 0.0, 2.0)))
    assert len(published_nav) == 1
    nav.on_path(_make_path())
    caplog.clear()
    nav.on_goal_reached(Bool(data=True))
    assert any("arrival_shortfall_m" in record.message for record in caplog.records)


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
