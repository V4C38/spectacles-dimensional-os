from __future__ import annotations

import json

import numpy as np
import pytest

from dimos_ar.bridge_status import BridgeStatusSnapshot
from dimos_ar.protocol import (
    DEFAULT_CAPABILITIES,
    AlignMarkerMessage,
    AlignManualPoseMessage,
    AlignStartMessage,
    AlignStopMessage,
    CancelGoalMessage,
    EmergencyStopMessage,
    GetStatusMessage,
    NavGoalMessage,
    RegisterMessage,
    decode_inbound,
    encode_align_status,
    encode_bridge_status,
    encode_hello,
    encode_lidar,
    encode_nav_status,
    encode_path,
    encode_pose,
    encode_registered,
)


def test_encode_hello_default() -> None:
    msg = json.loads(encode_hello())
    assert msg["type"] == "hello"
    assert msg["protocol_version"] == 1
    assert msg["robots"] == ["go2"]
    assert msg["capabilities"] == DEFAULT_CAPABILITIES


def test_encode_hello_custom_robot() -> None:
    msg = json.loads(encode_hello(robot_id="robot_a"))
    assert msg["robots"] == ["robot_a"]


def test_register_round_trip() -> None:
    raw = json.dumps(
        {
            "type": "register",
            "ts": 1.5,
            "robot_id": "go2",
            "marker_id": 0,
            "marker_position": [1.0, 2.0, 3.0],
            "marker_orientation": [0.0, 0.0, 0.0, 1.0],
        }
    )
    msg = decode_inbound(raw, expected_robot_id="go2")
    assert isinstance(msg, RegisterMessage)
    assert msg.marker_id == 0
    assert msg.marker_position == (1.0, 2.0, 3.0)


def test_register_marker_id_from_float() -> None:
    raw = json.dumps(
        {
            "type": "register",
            "ts": 1.0,
            "robot_id": "go2",
            "marker_id": 2.0,
            "marker_position": [0.0, 0.0, 0.0],
            "marker_orientation": [0.0, 0.0, 0.0, 1.0],
        }
    )
    msg = decode_inbound(raw)
    assert isinstance(msg, RegisterMessage)
    assert msg.marker_id == 2


def test_register_marker_id_non_integer_float_rejected() -> None:
    raw = json.dumps(
        {
            "type": "register",
            "ts": 1.0,
            "robot_id": "go2",
            "marker_id": 1.5,
            "marker_position": [0.0, 0.0, 0.0],
            "marker_orientation": [0.0, 0.0, 0.0, 1.0],
        }
    )
    with pytest.raises(ValueError, match="whole number"):
        decode_inbound(raw)


def test_robot_id_mismatch_rejected() -> None:
    raw = json.dumps(
        {
            "type": "cancel_goal",
            "ts": 1.0,
            "robot_id": "other",
        }
    )
    with pytest.raises(ValueError, match="Unknown robot_id"):
        decode_inbound(raw, expected_robot_id="go2")


def test_nav_goal_decode() -> None:
    raw = json.dumps(
        {
            "type": "nav_goal",
            "ts": 2.0,
            "robot_id": "go2",
            "position": [1.0, 0.0, 0.0],
        }
    )
    msg = decode_inbound(raw)
    assert isinstance(msg, NavGoalMessage)
    assert msg.position == (1.0, 0.0, 0.0)
    assert msg.orientation is None


def test_nav_goal_decode_with_orientation() -> None:
    raw = json.dumps(
        {
            "type": "nav_goal",
            "ts": 2.0,
            "robot_id": "go2",
            "position": [1.0, 0.0, 0.0],
            "orientation": [0.0, 0.0, 0.70710678, 0.70710678],
        }
    )
    msg = decode_inbound(raw)
    assert isinstance(msg, NavGoalMessage)
    assert msg.position == (1.0, 0.0, 0.0)
    assert msg.orientation == (0.0, 0.0, 0.70710678, 0.70710678)


def test_cancel_goal_decode() -> None:
    raw = json.dumps({"type": "cancel_goal", "ts": 3.0, "robot_id": "go2"})
    msg = decode_inbound(raw)
    assert isinstance(msg, CancelGoalMessage)


def test_emergency_stop_decode() -> None:
    raw = json.dumps({"type": "emergency_stop", "ts": 3.0, "robot_id": "go2"})
    msg = decode_inbound(raw)
    assert isinstance(msg, EmergencyStopMessage)


def test_unknown_type_rejected() -> None:
    with pytest.raises(ValueError, match="Unknown inbound"):
        decode_inbound(json.dumps({"type": "nope", "ts": 1.0, "robot_id": "go2"}))


def test_malformed_json_rejected() -> None:
    with pytest.raises(json.JSONDecodeError):
        decode_inbound("not json")


def test_encode_lidar_compact_json() -> None:
    points = np.array([[1.0, 2.0, 3.0]], dtype=np.float32)
    raw = encode_lidar(ts=1.0, points=points, robot_id="go2")
    assert " " not in raw
    msg = json.loads(raw)
    assert msg["type"] == "lidar"
    assert msg["robot_id"] == "go2"


def test_align_messages_decode() -> None:
    start = decode_inbound(
        json.dumps({"type": "align_start", "ts": 1.0, "robot_id": "go2"})
    )
    assert isinstance(start, AlignStartMessage)
    stop = decode_inbound(
        json.dumps({"type": "align_stop", "ts": 2.0, "robot_id": "go2"})
    )
    assert isinstance(stop, AlignStopMessage)
    marker = decode_inbound(
        json.dumps(
            {
                "type": "align_marker",
                "ts": 3.0,
                "robot_id": "go2",
                "marker_position": [0.0, 1.0, 0.0],
                "marker_orientation": [0.0, 0.0, 0.0, 1.0],
            }
        )
    )
    assert isinstance(marker, AlignMarkerMessage)
    assert marker.marker_position == (0.0, 1.0, 0.0)
    manual_pose = decode_inbound(
        json.dumps(
            {
                "type": "align_manual_pose",
                "ts": 4.0,
                "robot_id": "go2",
                "position": [1.0, 0.0, 2.0],
                "orientation": [0.0, 0.0, 0.0, 1.0],
            }
        )
    )
    assert isinstance(manual_pose, AlignManualPoseMessage)
    assert manual_pose.position == (1.0, 0.0, 2.0)


def test_encode_align_status() -> None:
    raw = json.loads(
        encode_align_status(
            state="aligned",
            robot_marker_detected=True,
            quality=0.9,
            method="manual",
            message="ok",
        )
    )
    assert raw["type"] == "align_status"
    assert raw["state"] == "aligned"
    assert raw["quality"] == 0.9
    assert raw["method"] == "manual"
    assert "approximate" not in raw


def test_encode_bridge_status_live() -> None:
    snap = BridgeStatusSnapshot(
        robot_id="SERIAL_X",
        mode="live",
        robot_connected=True,
        robot_model="unitree_go2",
        robot_serial="SERIAL_X",
        streams_active=True,
        registered=False,
        reconnecting=False,
        registration_method=None,
        registration_approximate=False,
    )
    raw = json.loads(encode_bridge_status(snap, ts=1.0))
    assert raw["type"] == "bridge_status"
    assert raw["mode"] == "live"
    assert raw["robot_serial"] == "SERIAL_X"
    assert raw["robot_model"] == "unitree_go2"
    assert "registration_method" not in raw


def test_get_status_decode() -> None:
    raw = json.dumps({"type": "get_status", "ts": 2.0, "robot_id": "go2"})
    msg = decode_inbound(raw, expected_robot_id="go2")
    assert isinstance(msg, GetStatusMessage)


def test_encode_path_and_nav_status() -> None:
    path = json.loads(
        encode_path(ts=2.0, waypoints=[(1.0, 2.0, 3.0)], robot_id="go2")
    )
    assert path["type"] == "path"
    assert path["waypoints"] == [[1.0, 2.0, 3.0]]

    status = json.loads(
        encode_nav_status(ts=3.0, state="following_path", goal_reached=False)
    )
    assert status["type"] == "nav_status"
    assert status["state"] == "following_path"
    assert status["goal_reached"] is False


def test_encode_registered_and_pose() -> None:
    reg = json.loads(encode_registered(registered=True, ts=5.0, robot_id="go2"))
    assert reg["registered"] is True
    pose = json.loads(
        encode_pose(
            ts=1.0,
            position=(0.0, 0.0, 0.0),
            orientation=(0.0, 0.0, 0.0, 1.0),
            robot_id="go2",
        )
    )
    assert pose["orientation"] == [0.0, 0.0, 0.0, 1.0]
