from __future__ import annotations

import json

from dimos_xr.network.bridge_status import BridgeStatusTracker
from dimos_xr.network.protocol import encode_bridge_status


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


def test_encode_bridge_status_always_includes_registration_method() -> None:
    tracker = BridgeStatusTracker(robot_id="unitree_go2", robot_connected=True)
    snap = tracker.snapshot()
    raw = json.loads(encode_bridge_status(snap))
    assert raw["type"] == "bridge_status"
    assert raw["robot_id"] == "unitree_go2"
    # v4 guarantee: registration_method is always present (None when unregistered)
    assert "registration_method" in raw
    assert raw["registration_method"] is None
    assert "registration_approximate" in raw
    assert raw["registration_approximate"] is False


def test_tracker_notify_on_change() -> None:
    tracker = BridgeStatusTracker(robot_id="unitree_go2", robot_connected=True)
    calls: list[int] = []
    tracker.set_on_change(lambda: calls.append(1))
    tracker.set_streams_active(True)
    tracker.set_streams_active(True)
    tracker.set_streams_active(False)
    assert len(calls) == 2


def test_tag_registration_method_uses_wire_value() -> None:
    """Committed tag alignment must produce registration_method='tag', not 'marker'."""
    tracker = BridgeStatusTracker(robot_id="unitree_go2", robot_connected=True)
    tracker.set_registered(True, method="tag", approximate=False)
    snap = tracker.snapshot()
    assert snap.registration_method == "tag"
    raw = json.loads(encode_bridge_status(snap))
    assert raw["registration_method"] == "tag"


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
