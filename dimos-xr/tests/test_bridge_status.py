from __future__ import annotations

import json

from dimos_xr.bridge_status import BridgeStatusTracker
from dimos_xr.protocol import encode_bridge_status


def test_tracker_snapshot() -> None:
    tracker = BridgeStatusTracker(robot_id="unitree_go2", robot_connected=True)
    tracker.set_streams_active(True)
    tracker.set_registered(True, method="manual", approximate=True)
    snap = tracker.snapshot()
    assert snap.robot_id == "unitree_go2"
    assert snap.robot_connected is True
    assert snap.streams_active is True
    assert snap.registered is True
    assert snap.registration_method == "manual"
    assert snap.registration_approximate is True


def test_encode_bridge_status_omits_registration_method_when_unset() -> None:
    tracker = BridgeStatusTracker(robot_id="unitree_go2", robot_connected=True)
    snap = tracker.snapshot()
    raw = json.loads(encode_bridge_status(snap))
    assert raw["type"] == "bridge_status"
    assert raw["robot_id"] == "unitree_go2"
    assert "registration_method" not in raw


def test_tracker_notify_on_change() -> None:
    tracker = BridgeStatusTracker(robot_id="unitree_go2", robot_connected=True)
    calls: list[int] = []
    tracker.set_on_change(lambda: calls.append(1))
    tracker.set_streams_active(True)
    tracker.set_streams_active(True)
    tracker.set_streams_active(False)
    assert len(calls) == 2


def test_tracker_connection_and_recovery_flags() -> None:
    tracker = BridgeStatusTracker(robot_id="unitree_go2", robot_connected=False)
    tracker.set_robot_connected(True)
    tracker.set_streams_active(True)
    tracker.set_reconnecting(False)
    snap = tracker.snapshot()
    assert snap.robot_connected is True
    assert snap.streams_active is True
    assert snap.reconnecting is False

    tracker.set_robot_connected(False)
    tracker.set_streams_active(False)
    tracker.set_reconnecting(True)
    snap = tracker.snapshot()
    assert snap.robot_connected is False
    assert snap.streams_active is False
    assert snap.reconnecting is True
