from __future__ import annotations

import json
import threading
import time
from collections import deque
from types import SimpleNamespace
from unittest.mock import MagicMock

import numpy as np
import pytest
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.msgs.nav_msgs.Path import Path
from dimos_lcm.std_msgs import Bool

from dimos_xr.error_codes import NAV_GOAL_STALLED
from dimos_xr.protocol import NavGoalMessage, encode_pose
from dimos_xr.transforms import Calibration, OdomSample, pose_to_matrix
from dimos_xr.xr_bridge_module import NAV_GOAL_PATH_TIMEOUT_S, XRBridge


def _make_bridge_stub(*, registered: bool = True) -> XRBridge:
    bridge = object.__new__(XRBridge)
    bridge._robot_id = "unitree_go2"
    bridge._calibration = Calibration()
    if registered:
        bridge._calibration.register_from_alignment(np.eye(4, dtype=np.float64))
    bridge._adapter = MagicMock()
    bridge._adapter.send_nav_goal.return_value = True
    bridge._ws_server = MagicMock()
    bridge._nav_state = "idle"
    bridge._goal_reached = False
    bridge._goal_failed = False
    bridge._nav_goal_pending = False
    bridge._nav_path_received = False
    bridge._nav_goal_dispatch_mono = None
    bridge._nav_recovery_attempts = 0
    bridge._nav_degraded = False
    bridge._nav_recovering = False
    bridge._nav_error_code = None
    bridge._nav_watchdog_stop = threading.Event()
    bridge._nav_watchdog_lock = threading.Lock()
    bridge._dropped_pose_count = 0
    bridge._last_dropped_pose_log_mono = 0.0
    bridge._odom_lock = threading.Lock()
    bridge._latest_odom: OdomSample | None = None
    bridge._odom_buffer: deque[tuple[float, OdomSample]] = deque(maxlen=120)
    bridge._last_odom_mono = None
    bridge._last_lidar_mono = None
    bridge._pose_last_emit = 0.0
    bridge._refresh_streams_active = lambda: None
    bridge.config = SimpleNamespace(pose_max_hz=0.0, stream_stale_timeout_s=10.0)
    return bridge


def _last_nav_status(bridge: XRBridge) -> dict:
    sent_payloads = [call.args[0] for call in bridge._ws_server.schedule_send.call_args_list]
    return json.loads(sent_payloads[-1])


def test_on_nav_goal_broadcasts_idle_until_path() -> None:
    bridge = _make_bridge_stub()
    msg = NavGoalMessage(
        ts=1.0,
        robot_id="unitree_go2",
        position=(1.0, 0.0, 2.0),
        orientation=(0.0, 0.0, 0.0, 1.0),
    )

    bridge._on_nav_goal(msg)

    assert bridge._nav_state == "idle"
    assert bridge._nav_goal_pending is True
    assert bridge._nav_path_received is False
    assert bridge._goal_reached is False
    assert bridge._goal_failed is False
    bridge._adapter.send_nav_goal.assert_called_once()
    nav_status = _last_nav_status(bridge)
    assert nav_status["type"] == "nav_status"
    assert nav_status["state"] == "idle"
    assert nav_status["goal_reached"] is False


@pytest.mark.asyncio
async def test_handle_xr_path_promotes_following_path() -> None:
    bridge = _make_bridge_stub()
    bridge._nav_goal_pending = True
    bridge._nav_goal_dispatch_mono = time.monotonic()

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

    await bridge.handle_xr_path(path)

    assert bridge._nav_state == "following_path"
    assert bridge._nav_path_received is True
    assert bridge._nav_goal_dispatch_mono is None


@pytest.mark.asyncio
async def test_handle_xr_path_does_not_mutate_nav_state_without_pending_goal() -> None:
    bridge = _make_bridge_stub()
    bridge._nav_state = "idle"
    bridge._nav_goal_pending = False

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

    await bridge.handle_xr_path(path)

    assert bridge._nav_state == "idle"
    assert bridge._nav_goal_pending is False
    bridge._ws_server.schedule_send.assert_called_once()
    payload = json.loads(bridge._ws_server.schedule_send.call_args.args[0])
    assert payload["type"] == "path"
    assert len(payload["waypoints"]) == 1


@pytest.mark.asyncio
async def test_late_path_after_goal_reached_does_not_revive_following_path() -> None:
    bridge = _make_bridge_stub()
    bridge._nav_goal_pending = True
    bridge._nav_state = "following_path"

    await bridge.handle_xr_goal_reached(Bool(data=True))

    assert bridge._nav_state == "idle"
    assert bridge._nav_goal_pending is False
    assert bridge._goal_reached is True

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
    await bridge.handle_xr_path(path)

    assert bridge._nav_state == "idle"
    assert bridge._nav_goal_pending is False


@pytest.mark.asyncio
async def test_handle_xr_goal_reached_failure_marks_goal_failed() -> None:
    bridge = _make_bridge_stub()
    bridge._nav_goal_pending = True
    bridge._nav_state = "following_path"

    await bridge.handle_xr_goal_reached(Bool(data=False))

    assert bridge._nav_state == "idle"
    assert bridge._goal_reached is False
    assert bridge._goal_failed is True
    assert bridge._nav_goal_pending is False


def test_nav_goal_stall_triggers_recovery() -> None:
    bridge = _make_bridge_stub()
    bridge._nav_goal_pending = True
    bridge._nav_path_received = False
    bridge._nav_goal_dispatch_mono = time.monotonic() - NAV_GOAL_PATH_TIMEOUT_S - 1.0

    bridge._handle_nav_goal_stall()

    assert bridge._nav_recovery_attempts == 1
    assert bridge._nav_recovering is True
    assert bridge._goal_failed is False
    assert bridge._nav_goal_pending is False
    nav_status = _last_nav_status(bridge)
    assert nav_status["recovering"] is True
    time.sleep(0.05)
    bridge._adapter.cancel_goal.assert_called_once()


def test_nav_goal_stall_terminal_after_max_attempts() -> None:
    bridge = _make_bridge_stub()
    bridge._nav_goal_pending = True
    bridge._nav_path_received = False
    bridge._nav_recovery_attempts = 2

    bridge._handle_nav_goal_stall()

    assert bridge._nav_degraded is True
    assert bridge._goal_failed is True
    assert bridge._nav_error_code == NAV_GOAL_STALLED.code
    nav_status = _last_nav_status(bridge)
    assert nav_status["goal_failed"] is True
    assert nav_status["error_code"] == NAV_GOAL_STALLED.code


def test_nav_goal_rejected_when_degraded() -> None:
    bridge = _make_bridge_stub()
    bridge._nav_degraded = True
    msg = NavGoalMessage(
        ts=1.0,
        robot_id="unitree_go2",
        position=(1.0, 0.0, 2.0),
        orientation=(0.0, 0.0, 0.0, 1.0),
    )

    bridge._on_nav_goal(msg)

    bridge._adapter.send_nav_goal.assert_not_called()
    nav_status = _last_nav_status(bridge)
    assert nav_status["goal_failed"] is True
    assert nav_status["error_code"] == NAV_GOAL_STALLED.code


@pytest.mark.asyncio
async def test_handle_xr_odom_skips_non_finite_pose() -> None:
    bridge = _make_bridge_stub()
    bad_matrix = pose_to_matrix((0.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0))
    bad_matrix[0, 0] = float("nan")
    bridge._calibration.register_from_alignment(bad_matrix)

    msg = PoseStamped(
        position=[0.0, 0.0, 0.0],
        orientation=[0.0, 0.0, 0.0, 1.0],
        ts=1.0,
        frame_id="odom",
    )

    await bridge.handle_xr_odom(msg)

    bridge._ws_server.schedule_send.assert_not_called()
    assert bridge._dropped_pose_count == 1


def test_encode_pose_accepts_non_finite_inputs() -> None:
    raw = json.loads(
        encode_pose(
            ts=1.0,
            position=(float("nan"), 1.0, 2.0),
            orientation=(0.0, float("inf"), 0.0, 1.0),
            robot_id="unitree_go2",
        )
    )
    assert raw["type"] == "pose"
    assert all(np.isfinite(value) for value in raw["position"])
    assert all(np.isfinite(value) for value in raw["orientation"])
