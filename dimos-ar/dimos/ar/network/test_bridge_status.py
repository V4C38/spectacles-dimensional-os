from __future__ import annotations

import json
from unittest.mock import MagicMock

from dimos.ar.bridge.sender import BridgeSender
from dimos.ar.bridge.status_service import StatusService
from dimos.ar.network.bridge_status import BridgeStatusTracker
from dimos.ar.network.protocol import bridge_status_wire, encode_bridge_status
from dimos.ar.world_frame.state import WorldFrameState


def test_tracker_snapshot() -> None:
    tracker = BridgeStatusTracker(robot_id="unitree_go2", robot_connected=True)
    tracker.set_streams_active(True)
    snap = tracker.snapshot()
    assert snap.robot_id == "unitree_go2"
    assert snap.robot_connected is True
    assert snap.streams_active is True
    assert snap.reconnecting is False


def test_encode_bridge_status_merges_world_frame_at_encode_time() -> None:
    tracker = BridgeStatusTracker(robot_id="unitree_go2", robot_connected=True)
    world_frame = WorldFrameState()
    raw = json.loads(encode_bridge_status(tracker.snapshot(), world_frame=world_frame))
    assert raw["type"] == "bridge_status"
    assert raw["world_frame_committed"] is False
    assert raw["world_frame_method"] is None
    assert raw["world_frame_approximate"] is False


def test_encode_bridge_status_reflects_committed_world_frame() -> None:
    import numpy as np

    tracker = BridgeStatusTracker(robot_id="unitree_go2", robot_connected=True)
    world_frame = WorldFrameState()
    T = np.eye(4, dtype=np.float64)
    world_frame.commit(T, method="manual_pose", approximate=True)
    raw = json.loads(encode_bridge_status(tracker.snapshot(), world_frame=world_frame))
    assert raw["world_frame_committed"] is True
    assert raw["world_frame_method"] == "manual_pose"
    assert raw["world_frame_approximate"] is True


def test_tracker_notify_on_change() -> None:
    tracker = BridgeStatusTracker(robot_id="unitree_go2", robot_connected=True)
    calls: list[int] = []
    tracker.set_on_change(lambda: calls.append(1))
    tracker.set_streams_active(True)
    tracker.set_streams_active(True)
    tracker.set_streams_active(False)
    assert len(calls) == 2


def test_april_odom_world_frame_method_uses_wire_value() -> None:
    import numpy as np

    world_frame = WorldFrameState()
    world_frame.commit(np.eye(4), method="april_odom_baseline", approximate=False)
    tracker = BridgeStatusTracker(robot_id="unitree_go2", robot_connected=True)
    raw = json.loads(encode_bridge_status(tracker.snapshot(), world_frame=world_frame))
    assert raw["world_frame_method"] == "april_odom_baseline"


def test_merged_bridge_snapshot_matches_bridge_status_wire() -> None:
    mock_server = MagicMock()
    sender = BridgeSender()
    sender.bind(mock_server)
    world_frame = WorldFrameState()
    import numpy as np

    world_frame.commit(np.eye(4), method="april_odom_baseline", approximate=False)
    service = StatusService(
        robot_id="unitree_go2",
        sender=sender,
        world_frame=world_frame,
        stream_stale_timeout_s=1.0,
    )
    service._tracker.set_robot_connected(True)
    service._tracker.set_reconnecting(False)
    merged = service.merged_bridge_snapshot()
    expected = bridge_status_wire(service.snapshot(), world_frame=world_frame)
    assert merged == expected


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
