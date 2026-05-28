from __future__ import annotations

import json

from dimos_ar.bridge_status import BridgeStatusTracker, tracker_from_bootstrap
from dimos_ar.protocol import encode_bridge_status
from dimos_ar.robot_bootstrap import LiveRobot, ReplayMode


def test_tracker_live_snapshot() -> None:
    tracker = tracker_from_bootstrap(
        LiveRobot(serial="SERIAL_ABC"),
        robot_model="unitree_go2",
    )
    snap = tracker.snapshot()
    assert snap.mode == "live"
    assert snap.robot_serial == "SERIAL_ABC"
    assert snap.robot_id == "SERIAL_ABC"
    assert snap.robot_model == "unitree_go2"
    assert snap.robot_connected is True


def test_tracker_replay_snapshot() -> None:
    tracker = tracker_from_bootstrap(
        ReplayMode(reason="test"),
        robot_model="unitree_go2",
    )
    snap = tracker.snapshot()
    assert snap.mode == "replay"
    assert snap.robot_serial is None
    assert snap.robot_id == "go2"
    assert "robot_serial" not in json.loads(encode_bridge_status(snap))


def test_tracker_notify_on_change() -> None:
    tracker = BridgeStatusTracker(
        robot_id="go2",
        mode="replay",
        robot_model="unitree_go2",
        robot_serial=None,
        robot_connected=True,
    )
    calls: list[int] = []
    tracker.set_on_change(lambda: calls.append(1))
    tracker.set_streams_active(True)
    tracker.set_streams_active(True)
    tracker.set_streams_active(False)
    assert len(calls) == 2
