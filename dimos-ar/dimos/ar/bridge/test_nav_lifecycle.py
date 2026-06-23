from __future__ import annotations

import json
import time
from unittest.mock import MagicMock

from dimos_lcm.std_msgs import Bool
import numpy as np
import pytest

from dimos.ar.bridge.navigation import (
    NAV_GOAL_PATH_TIMEOUT_S,
    NAV_GOAL_PUBLISH_TIMEOUT_S,
    NavController,
)
from dimos.ar.bridge.odom_buffer import OdomBuffer
from dimos.ar.bridge.sender import BridgeSender
from dimos.ar.network.error_codes import NAV_GOAL_STALLED
from dimos.ar.network.protocol import GoalMessage, encode_pose
from dimos.ar.registration.transforms import Calibration, pose_to_matrix
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.msgs.nav_msgs.Path import Path


def _make_sender() -> tuple[BridgeSender, MagicMock]:
    """Return a BridgeSender bound to a mock server and the mock server."""
    sender = BridgeSender()
    mock_server = MagicMock()
    sender.bind(mock_server)
    return sender, mock_server


def _make_nav(*, registered: bool = True) -> tuple[NavController, MagicMock]:
    calibration = Calibration()
    if registered:
        calibration.register_world_odom(np.eye(4, dtype=np.float64))
    adapter = MagicMock()
    adapter.send_nav_goal.return_value = True
    sender, mock_server = _make_sender()
    nav = NavController(
        robot_id="unitree_go2",
        sender=sender,
        calibration=calibration,
        adapter=adapter,
    )
    return nav, mock_server


def _last_nav_status(mock_server: MagicMock) -> dict:
    sent_payloads = [call.args[0] for call in mock_server.schedule_send.call_args_list]
    return json.loads(sent_payloads[-1])


# ------------------------------------------------------------------
# NavController unit tests
# ------------------------------------------------------------------


def test_on_navigate_goal_broadcasts_idle_until_path() -> None:
    nav, mock_server = _make_nav()
    msg = GoalMessage(
        intent="navigate",
        ts=1.0,
        robot_id="unitree_go2",
        position=(1.0, 0.0, 2.0),
        orientation=(0.0, 0.0, 0.0, 1.0),
    )

    nav.on_navigate_goal(msg)

    time.sleep(0.05)
    assert nav._nav_state == "idle"
    assert nav._nav_goal_pending is True
    assert nav._nav_path_received is False
    assert nav._goal_reached is False
    assert nav._goal_failed is False
    nav._adapter.send_nav_goal.assert_called_once()
    nav_status = _last_nav_status(mock_server)
    assert nav_status["type"] == "nav_status"
    assert nav_status["phase"] == "idle"
    assert nav_status["phase"] == "idle"


@pytest.mark.asyncio
async def test_handle_ar_path_promotes_navigating() -> None:
    nav, _mock_server = _make_nav()
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

    assert nav._nav_state == "navigating"
    assert nav._nav_path_received is True
    assert nav._nav_goal_dispatch_mono is None


@pytest.mark.asyncio
async def test_handle_ar_path_does_not_mutate_nav_state_without_pending_goal() -> None:
    nav, mock_server = _make_nav()
    nav._nav_state = "idle"
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

    assert nav._nav_state == "idle"
    assert nav._nav_goal_pending is False
    mock_server.schedule_send.assert_called_once()
    payload = json.loads(mock_server.schedule_send.call_args.args[0])
    assert payload["type"] == "path"
    assert len(payload["waypoints"]) == 1


@pytest.mark.asyncio
async def test_late_path_after_goal_reached_does_not_revive_navigating() -> None:
    nav, _mock_server = _make_nav()
    nav._nav_goal_pending = True
    nav._nav_state = "navigating"

    nav.on_goal_reached(Bool(data=True))

    assert nav._nav_state == "idle"
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

    assert nav._nav_state == "idle"
    assert nav._nav_goal_pending is False


@pytest.mark.asyncio
async def test_handle_ar_goal_reached_failure_marks_goal_failed() -> None:
    nav, _mock_server = _make_nav()
    nav._nav_goal_pending = True
    nav._nav_state = "navigating"

    nav.on_goal_reached(Bool(data=False))

    assert nav._nav_state == "idle"
    assert nav._goal_reached is False
    assert nav._goal_failed is True
    assert nav._nav_goal_pending is False


def test_goal_stall_triggers_recovery() -> None:
    nav, mock_server = _make_nav()
    nav._nav_goal_pending = True
    nav._nav_path_received = False
    nav._nav_goal_dispatch_mono = time.monotonic() - NAV_GOAL_PATH_TIMEOUT_S - 1.0

    nav.handle_goal_stall()

    assert nav._nav_recovery_attempts == 1
    assert nav._nav_recovering is True
    assert nav._goal_failed is False
    assert nav._nav_goal_pending is False
    nav_status = _last_nav_status(mock_server)
    assert nav_status["phase"] == "recovering"
    time.sleep(0.05)
    nav._adapter.cancel_goal.assert_called_once()


def test_goal_stall_terminal_after_max_attempts() -> None:
    nav, mock_server = _make_nav()
    nav._nav_goal_pending = True
    nav._nav_path_received = False
    nav._nav_recovery_attempts = 2

    nav.handle_goal_stall()

    assert nav._nav_degraded is True
    assert nav._goal_failed is True
    assert nav._nav_error_code == NAV_GOAL_STALLED.code
    nav_status = _last_nav_status(mock_server)
    assert nav_status["phase"] == "failed"
    assert nav_status["error_code"] == NAV_GOAL_STALLED.code


def test_navigate_goal_clears_degraded_session() -> None:
    """A new navigate goal clears session degradation so the user can retry."""
    nav, _mock_server = _make_nav()
    nav._nav_degraded = True
    msg = GoalMessage(
        intent="navigate",
        ts=1.0,
        robot_id="unitree_go2",
        position=(1.0, 0.0, 2.0),
        orientation=(0.0, 0.0, 0.0, 1.0),
    )

    nav.on_navigate_goal(msg)
    time.sleep(0.05)

    nav._adapter.send_nav_goal.assert_called_once()
    assert nav._nav_degraded is False


def test_on_navigate_goal_returns_before_adapter_publish() -> None:
    """Adapter publish runs off-thread so the WebSocket handler is not blocked."""
    nav, _mock_server = _make_nav()

    def slow_goal(_goal: PoseStamped) -> bool:
        time.sleep(0.2)
        return True

    nav._adapter.send_nav_goal.side_effect = slow_goal
    msg = GoalMessage(
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
    time.sleep(0.25)
    nav._adapter.send_nav_goal.assert_called_once()


def test_emergency_stop_then_goal_succeeds() -> None:
    """After emergency stop, a new goal is accepted and published."""
    nav, _mock_server = _make_nav()
    nav._nav_goal_pending = True
    nav._nav_state = "navigating"
    nav._nav_path_received = True

    nav.on_emergency_stop()
    time.sleep(0.05)

    assert nav._nav_goal_pending is False
    assert nav._nav_state == "idle"

    msg = GoalMessage(
        intent="navigate",
        ts=2.0,
        robot_id="unitree_go2",
        position=(2.0, 0.0, 3.0),
        orientation=(0.0, 0.0, 0.0, 1.0),
    )
    nav.on_navigate_goal(msg)
    time.sleep(0.05)

    nav._adapter.send_nav_goal.assert_called_once()
    assert nav._nav_goal_pending is True
    assert nav._nav_path_received is False


def test_cancel_goal_timeout_does_not_degrade_navigation() -> None:
    nav, mock_server = _make_nav()

    def slow_cancel() -> bool:
        time.sleep(1.2)
        return True

    nav._adapter.cancel_goal.side_effect = slow_cancel
    nav.on_cancel_goal(ts=3.0)
    time.sleep(1.05)

    assert nav._nav_degraded is False
    assert nav._goal_failed is False
    assert nav._nav_error_code is None
    nav_status = _last_nav_status(mock_server)
    assert nav_status["phase"] == "idle"
    assert nav_status.get("error_code") is None


def test_slow_send_nav_goal_fails_transiently_and_accepts_later_goal() -> None:
    nav, _mock_server = _make_nav()
    publish_calls = 0

    def slow_first_goal(_goal: PoseStamped) -> bool:
        nonlocal publish_calls
        publish_calls += 1
        if publish_calls == 1:
            time.sleep(NAV_GOAL_PUBLISH_TIMEOUT_S + 0.5)
        return True

    nav._adapter.send_nav_goal.side_effect = slow_first_goal
    first_goal = GoalMessage(
        intent="navigate",
        ts=1.0,
        robot_id="unitree_go2",
        position=(1.0, 0.0, 2.0),
        orientation=(0.0, 0.0, 0.0, 1.0),
    )
    nav.on_navigate_goal(first_goal)
    time.sleep(NAV_GOAL_PUBLISH_TIMEOUT_S + 0.7)

    assert nav._goal_failed is True
    assert nav._nav_degraded is False

    nav._adapter.send_nav_goal.side_effect = None
    nav._adapter.send_nav_goal.return_value = True
    second_goal = GoalMessage(
        intent="navigate",
        ts=2.0,
        robot_id="unitree_go2",
        position=(2.0, 0.0, 3.0),
        orientation=(0.0, 0.0, 0.0, 1.0),
    )
    nav.on_navigate_goal(second_goal)
    time.sleep(0.05)

    assert nav._adapter.send_nav_goal.call_count == 2
    assert nav._nav_goal_pending is True
    assert nav._goal_failed is False


def test_on_navigation_state_idle_while_live_emits_recovery() -> None:
    nav, mock_server = _make_nav()
    nav._nav_goal_pending = True
    nav._nav_path_received = True
    nav._nav_state = "navigating"
    nav._goal_reached = False
    nav._goal_failed = False

    nav.on_navigation_state("idle")

    assert nav._nav_state == "recovery"
    assert nav._nav_recovering is True
    nav_status = _last_nav_status(mock_server)
    assert nav_status["phase"] == "recovering"
    assert nav_status["phase"] == "recovering"


def test_on_navigation_state_initial_rotation_maps_to_navigating() -> None:
    from dimos.ar.network.data_plane import normalize_nav_state

    assert normalize_nav_state("initial_rotation") == "navigating"
    assert normalize_nav_state("final_rotation") == "navigating"
    assert normalize_nav_state("path_following") == "navigating"
    assert normalize_nav_state("arrived") == "idle"


# ------------------------------------------------------------------
# TelemetryPublisher — non-finite pose drop
# ------------------------------------------------------------------


@pytest.mark.asyncio
async def test_publish_pose_skips_non_finite_transform() -> None:
    """TelemetryPublisher.publish_pose drops frames when the calibration produces NaN."""
    from dimos.ar.bridge.telemetry import TelemetryPublisher
    from dimos.ar.tracking.filters import LidarFilter

    calibration = Calibration()
    bad_matrix = pose_to_matrix((0.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0))
    bad_matrix[0, 0] = float("nan")
    calibration.register_world_odom(bad_matrix)

    odom = OdomBuffer()
    sender, mock_server = _make_sender()
    telemetry = TelemetryPublisher(
        robot_id="unitree_go2",
        sender=sender,
        calibration=calibration,
        odom=odom,
        lidar_filter=LidarFilter(),
        target_points=1000,
        obstacle_target_points=200,
        lidar_voxel_size_m=0.05,
        pose_max_hz=0.0,
    )

    msg = PoseStamped(
        position=[0.0, 0.0, 0.0],
        orientation=[0.0, 0.0, 0.0, 1.0],
        ts=1.0,
        frame_id="odom",
    )
    telemetry.publish_pose(msg)

    mock_server.schedule_send.assert_not_called()
    assert telemetry._dropped_pose_count == 1


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
