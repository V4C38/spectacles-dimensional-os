from __future__ import annotations

import json

import numpy as np
import pytest

from dimos_xr.adapters.base import CapabilityState, RobotHandshake
from dimos_xr.adapters.g1 import g1_handshake
from dimos_xr.bridge_status import BridgeStatusSnapshot
from dimos_xr.protocol import (
    DEFAULT_CAPABILITIES,
    AlignManualPoseMessage,
    AlignMarkerMessage,
    AlignStartMessage,
    AlignStopMessage,
    CancelGoalMessage,
    EmergencyStopMessage,
    GetStatusMessage,
    NavGoalMessage,
    PlanPathMessage,
    decode_inbound,
    encode_align_status,
    encode_bridge_status,
    encode_hello,
    encode_lidar,
    encode_nav_status,
    encode_path,
    encode_path_preview,
    encode_pose,
)


def _sample_handshake() -> RobotHandshake:
    capability_states = {
        capability: CapabilityState(capability != "emergency_stop", "disabled")
        if capability == "emergency_stop"
        else CapabilityState(True)
        for capability in DEFAULT_CAPABILITIES
    }
    return RobotHandshake(
        robot_id="unitree_go2",
        robot_model="unitree_go2",
        display_name="Unitree Go2",
        capabilities=DEFAULT_CAPABILITIES,
        capability_states=capability_states,
        body_bounds_m=(0.7, 0.5, 0.55),
        footprint_m=(0.7, 0.5),
        visual_origin_frame="base_link",
        base_height_m=0.33,
        default_render_offset_m=(0.0, 0.0, 0.0),
    )


def test_encode_hello() -> None:
    msg = json.loads(encode_hello(_sample_handshake()))
    assert msg["type"] == "hello"
    assert msg["protocol_version"] == 2
    assert msg["robot"]["robot_id"] == "unitree_go2"
    assert msg["capabilities"] == DEFAULT_CAPABILITIES
    assert msg["disabled_capabilities"] == ["emergency_stop"]
    assert msg["capability_states"]["emergency_stop"]["available"] is False


def test_encode_hello_g1_manual_alignment_only() -> None:
    handshake = g1_handshake(
        "unitree_g1",
        nav_available=True,
        path_available=True,
        plan_preview_available=True,
        cancel_goal_available=False,
        emergency_stop_available=True,
        marker_align_available=False,
    )
    msg = json.loads(encode_hello(handshake))
    assert msg["robot"]["robot_model"] == "unitree_g1"
    assert msg["capability_states"]["align"]["available"] is False
    assert msg["capability_states"]["align_manual"]["available"] is True
    assert msg["capability_states"]["cancel_goal"]["available"] is False
    assert "align" in msg["disabled_capabilities"]
    assert msg["robot"]["alignment_profile"]["marker_alignment"] == "manual_only"


def test_robot_id_mismatch_rejected() -> None:
    raw = json.dumps({"type": "cancel_goal", "ts": 1.0, "robot_id": "other"})
    with pytest.raises(ValueError, match="Unknown robot_id"):
        decode_inbound(raw, expected_robot_id="unitree_go2")


def test_nav_goal_decode() -> None:
    raw = json.dumps(
        {
            "type": "nav_goal",
            "ts": 2.0,
            "robot_id": "unitree_go2",
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
            "robot_id": "unitree_go2",
            "position": [1.0, 0.0, 0.0],
            "orientation": [0.0, 0.0, 0.70710678, 0.70710678],
        }
    )
    msg = decode_inbound(raw)
    assert isinstance(msg, NavGoalMessage)
    assert msg.position == (1.0, 0.0, 0.0)
    assert msg.orientation == (0.0, 0.0, 0.70710678, 0.70710678)


def test_plan_path_decode() -> None:
    raw = json.dumps(
        {
            "type": "plan_path",
            "ts": 2.5,
            "robot_id": "unitree_go2",
            "position": [2.0, 0.0, 1.0],
            "orientation": [0.0, 0.0, 0.0, 1.0],
        }
    )
    msg = decode_inbound(raw)
    assert isinstance(msg, PlanPathMessage)
    assert msg.position == (2.0, 0.0, 1.0)
    assert msg.orientation == (0.0, 0.0, 0.0, 1.0)


def test_cancel_goal_decode() -> None:
    raw = json.dumps({"type": "cancel_goal", "ts": 3.0, "robot_id": "unitree_go2"})
    msg = decode_inbound(raw)
    assert isinstance(msg, CancelGoalMessage)


def test_emergency_stop_decode() -> None:
    raw = json.dumps({"type": "emergency_stop", "ts": 3.0, "robot_id": "unitree_go2"})
    msg = decode_inbound(raw)
    assert isinstance(msg, EmergencyStopMessage)


def test_unknown_type_rejected() -> None:
    with pytest.raises(ValueError, match="Unknown inbound"):
        decode_inbound(json.dumps({"type": "nope", "ts": 1.0, "robot_id": "unitree_go2"}))


def test_malformed_json_rejected() -> None:
    with pytest.raises(json.JSONDecodeError):
        decode_inbound("not json")


def test_encode_lidar_compact_json() -> None:
    points = np.array([[1.0, 2.0, 3.0]], dtype=np.float32)
    raw = encode_lidar(ts=1.0, points=points, robot_id="unitree_go2")
    assert " " not in raw
    msg = json.loads(raw)
    assert msg["type"] == "lidar"
    assert msg["robot_id"] == "unitree_go2"


def test_align_messages_decode() -> None:
    start = decode_inbound(
        json.dumps({"type": "align_start", "ts": 1.0, "robot_id": "unitree_go2"})
    )
    assert isinstance(start, AlignStartMessage)
    stop = decode_inbound(
        json.dumps({"type": "align_stop", "ts": 2.0, "robot_id": "unitree_go2"})
    )
    assert isinstance(stop, AlignStopMessage)
    marker = decode_inbound(
        json.dumps(
            {
                "type": "align_marker",
                "ts": 3.0,
                "robot_id": "unitree_go2",
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
                "robot_id": "unitree_go2",
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
            robot_id="unitree_go2",
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


def test_encode_bridge_status() -> None:
    snap = BridgeStatusSnapshot(
        robot_id="unitree_go2",
        robot_connected=True,
        streams_active=True,
        registered=False,
        reconnecting=False,
        registration_method=None,
        registration_approximate=False,
    )
    raw = json.loads(encode_bridge_status(snap, ts=1.0))
    assert raw["type"] == "bridge_status"
    assert raw["robot_id"] == "unitree_go2"
    assert raw["robot_connected"] is True
    assert "registration_method" not in raw


def test_get_status_decode() -> None:
    raw = json.dumps({"type": "get_status", "ts": 2.0, "robot_id": "unitree_go2"})
    msg = decode_inbound(raw, expected_robot_id="unitree_go2")
    assert isinstance(msg, GetStatusMessage)


def test_encode_path_and_nav_status() -> None:
    path = json.loads(
        encode_path(ts=2.0, waypoints=[(1.0, 2.0, 3.0)], robot_id="unitree_go2")
    )
    assert path["type"] == "path"
    assert path["waypoints"] == [[1.0, 2.0, 3.0]]

    preview = json.loads(
        encode_path_preview(
            ts=2.5,
            waypoints=[(4.0, 5.0, 6.0)],
            robot_id="unitree_go2",
            target=(7.0, 8.0, 9.0),
        )
    )
    assert preview["type"] == "path_preview"
    assert preview["waypoints"] == [[4.0, 5.0, 6.0]]
    assert preview["target"] == [7.0, 8.0, 9.0]

    status = json.loads(
        encode_nav_status(
            ts=3.0,
            state="following_path",
            goal_reached=False,
            robot_id="unitree_go2",
        )
    )
    assert status["type"] == "nav_status"
    assert status["state"] == "following_path"
    assert status["goal_reached"] is False

    recovering = json.loads(
        encode_nav_status(
            ts=3.5,
            state="idle",
            goal_reached=False,
            recovering=True,
            robot_id="unitree_go2",
        )
    )
    assert recovering["recovering"] is True

    failed = json.loads(
        encode_nav_status(
            ts=4.0,
            state="idle",
            goal_reached=False,
            goal_failed=True,
            error_code=505,
            robot_id="unitree_go2",
        )
    )
    assert failed["goal_failed"] is True
    assert failed["error_code"] == 505


def test_encode_pose() -> None:
    pose = json.loads(
        encode_pose(
            ts=1.0,
            position=(0.0, 0.0, 0.0),
            orientation=(0.0, 0.0, 0.0, 1.0),
            robot_id="unitree_go2",
        )
    )
    assert pose["orientation"] == [0.0, 0.0, 0.0, 1.0]


def test_encode_pose_rounds_high_precision_values() -> None:
    pose = json.loads(
        encode_pose(
            ts=1.23456789,
            position=(1.23456789, 2.34567891, 3.45678912),
            orientation=(0.111111115, 0.222222225, 0.333333335, 0.999999995),
            robot_id="unitree_go2",
        )
    )
    assert pose["ts"] == 1.235
    assert pose["position"] == [1.2346, 2.3457, 3.4568]
    assert pose["orientation"] == [0.1111, 0.2222, 0.3333, 1.0]


def test_encode_path_rounds_waypoints() -> None:
    path = json.loads(
        encode_path(
            ts=2.123456,
            waypoints=[(1.23456, 2.34567, 3.45678)],
            robot_id="unitree_go2",
        )
    )
    assert path["ts"] == 2.123
    assert path["waypoints"] == [[1.235, 2.346, 3.457]]

    preview = json.loads(
        encode_path_preview(
            ts=2.5,
            waypoints=[(4.0, 5.0, 6.0)],
            robot_id="unitree_go2",
            target=(7.123456, 8.234567, 9.345678),
        )
    )
    assert preview["target"] == [7.123, 8.235, 9.346]
