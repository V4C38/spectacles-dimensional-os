from __future__ import annotations

import json

import numpy as np
import pytest

from dimos.ar.adapters.base import CapabilityState, RobotHandshake
from dimos.ar.adapters.g1 import g1_handshake
from dimos.ar.network.bridge_status import BridgeStatusSnapshot
from dimos.ar.network.protocol import (
    DEFAULT_CAPABILITIES,
    AlignManualPoseMessage,
    AlignStartMessage,
    AlignStopMessage,
    CameraInfoMessage,
    CancelGoalMessage,
    EmergencyStopMessage,
    GetStatusMessage,
    NavGoalMessage,
    PlanPathMessage,
    SetLidarModeMessage,
    decode_inbound,
    encode_align_status,
    encode_bridge_status,
    encode_camera_frame_ack,
    encode_hello,
    encode_lidar,
    encode_nav_status,
    encode_path,
    encode_path_preview,
    encode_pong,
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
    assert msg["protocol_version"] == 4
    assert msg["robot"]["robot_id"] == "unitree_go2"
    assert isinstance(msg["capabilities"], dict)
    assert msg["capabilities"]["lidar"]["available"] is True
    assert msg["capabilities"]["emergency_stop"]["available"] is False
    assert "disabled_capabilities" not in msg
    assert "capability_states" not in msg


def test_encode_hello_g1_tag_alignment_profile() -> None:
    handshake = g1_handshake(
        "unitree_g1",
        nav_available=True,
        path_available=True,
        plan_preview_available=True,
        cancel_goal_available=False,
        emergency_stop_available=True,
        marker_align_available=True,
    )
    msg = json.loads(encode_hello(handshake))
    assert msg["robot"]["robot_model"] == "unitree_g1"
    assert msg["capabilities"]["align"]["available"] is True
    assert msg["capabilities"]["align_manual"]["available"] is True
    assert msg["robot"]["alignment_profile"]["method"] == "tag"
    assert msg["robot"]["alignment_profile"]["tag_total_size_m"] == 0.07


def test_encode_hello_g1_tag_alignment_disabled() -> None:
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
    assert msg["capabilities"]["align"]["available"] is False


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


def test_align_marker_message_rejected() -> None:
    with pytest.raises(ValueError, match="Unknown inbound message type"):
        decode_inbound(
            json.dumps(
                {
                    "type": "align_marker",
                    "ts": 1.0,
                    "robot_id": "unitree_go2",
                    "marker_position": [0.0, 1.0, 0.0],
                    "marker_orientation": [0.0, 0.0, 0.0, 1.0],
                }
            )
        )


def test_camera_info_rejects_missing_intrinsics() -> None:
    with pytest.raises(ValueError, match="Missing or invalid field"):
        decode_inbound(
            json.dumps(
                {
                    "type": "camera_info",
                    "ts": 1.0,
                    "robot_id": "unitree_go2",
                    "width": 3200,
                    "height": 2400,
                    "camera_model": "pinhole",
                    "device_model": "spectacles",
                }
            )
        )


def test_encode_lidar_compact_json() -> None:
    points = np.array([[1.0, 2.0, 3.0]], dtype=np.float32)
    raw = encode_lidar(ts=1.0, points=points, robot_id="unitree_go2")
    assert " " not in raw
    msg = json.loads(raw)
    assert msg["type"] == "lidar"
    assert msg["robot_id"] == "unitree_go2"


def test_align_messages_decode() -> None:
    start = decode_inbound(
        json.dumps(
            {"type": "align_start", "ts": 1.0, "robot_id": "unitree_go2", "method": "tag"}
        )
    )
    assert isinstance(start, AlignStartMessage)
    assert start.method == "tag"
    start_manual = decode_inbound(
        json.dumps(
            {"type": "align_start", "ts": 1.0, "robot_id": "unitree_go2", "method": "manual"}
        )
    )
    assert isinstance(start_manual, AlignStartMessage)
    assert start_manual.method == "manual"
    stop = decode_inbound(json.dumps({"type": "align_stop", "ts": 2.0, "robot_id": "unitree_go2"}))
    assert isinstance(stop, AlignStopMessage)
    camera_info = decode_inbound(
        json.dumps(
            {
                "type": "camera_info",
                "ts": 3.0,
                "robot_id": "unitree_go2",
                "width": 3200,
                "height": 2400,
                "fx": 1800.0,
                "fy": 1800.0,
                "cx": 1600.0,
                "cy": 1200.0,
                "distortion": [],
                "camera_model": "perspective",
                "device_model": "spectacles",
            }
        )
    )
    assert isinstance(camera_info, CameraInfoMessage)
    assert camera_info.width == 3200
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


def test_align_start_missing_method_rejected() -> None:
    with pytest.raises(ValueError, match="Missing required field"):
        decode_inbound(
            json.dumps({"type": "align_start", "ts": 1.0, "robot_id": "unitree_go2"})
        )


def test_align_start_invalid_method_rejected() -> None:
    with pytest.raises(ValueError, match="must be 'tag' or 'manual'"):
        decode_inbound(
            json.dumps(
                {"type": "align_start", "ts": 1.0, "robot_id": "unitree_go2", "method": "bad"}
            )
        )


def test_encode_align_status() -> None:
    raw = json.loads(
        encode_align_status(
            robot_id="unitree_go2",
            method="tag",
            state="detecting",
            progress=60,
            message="Tracking tag — hold steady (3/5)",
            tag_visible=True,
        )
    )
    assert raw["type"] == "align_status"
    assert raw["method"] == "tag"
    assert raw["state"] == "detecting"
    assert raw["progress"] == 60
    assert raw["tag_visible"] is True
    assert "tag_detected" not in raw
    assert "observation_count" not in raw
    assert "quality" not in raw
    assert "baseline_m" not in raw
    assert "baseline_target_m" not in raw


def test_encode_align_status_step_fields() -> None:
    """Step index/count appear only when passed; assist_stage and robot_world_pose included."""
    raw = json.loads(
        encode_align_status(
            robot_id="unitree_go2",
            method="tag",
            state="detecting",
            progress=40,
            message="Collecting",
            assist_stage="collect",
            robot_world_pose={"position": [1.0, 0.0, -2.0], "orientation": [0.0, 0.0, 0.0, 1.0]},
            step_index=2,
            step_count=2,
        )
    )
    assert raw["assist_stage"] == "collect"
    assert raw["step_index"] == 2
    assert raw["step_count"] == 2
    assert raw["robot_world_pose"]["position"] == [1.0, 0.0, -2.0]
    assert "baseline_m" not in raw
    assert "baseline_target_m" not in raw


def test_encode_align_status_no_step_fields_when_not_assist() -> None:
    """Without step_index/step_count, fields must be absent."""
    raw = json.loads(
        encode_align_status(
            robot_id="unitree_go2",
            method="tag",
            state="detecting",
            progress=0,
        )
    )
    assert "step_index" not in raw
    assert "step_count" not in raw
    assert "assist_stage" not in raw
    assert "sampling" not in raw
    assert "robot_world_pose" not in raw


def test_encode_align_status_sampling_field() -> None:
    raw = json.loads(
        encode_align_status(
            robot_id="unitree_go2",
            method="tag",
            state="detecting",
            progress=33,
            assist_stage="move",
            sampling=True,
        )
    )
    assert raw["assist_stage"] == "move"
    assert raw["sampling"] is True


def test_encode_align_status_manual() -> None:
    raw = json.loads(
        encode_align_status(
            robot_id="unitree_go2",
            method="manual",
            state="ready",
            progress=100,
            message="Candidate ready",
        )
    )
    assert raw["method"] == "manual"
    assert raw["state"] == "ready"
    assert raw["progress"] == 100
    assert "tag_visible" not in raw


def test_encode_camera_frame_ack() -> None:
    raw = json.loads(
        encode_camera_frame_ack(
            robot_id="unitree_go2",
            seq=9,
        )
    )
    assert raw["type"] == "camera_frame_ack"
    assert raw["seq"] == 9
    assert "tag_detected" not in raw
    assert "tag_ids" not in raw
    assert "quality" not in raw


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
    assert "registration_method" in raw
    assert raw["registration_method"] is None
    assert raw["registration_approximate"] is False


def test_encode_bridge_status_with_method() -> None:
    snap = BridgeStatusSnapshot(
        robot_id="unitree_go2",
        robot_connected=True,
        streams_active=True,
        registered=True,
        reconnecting=False,
        registration_method="tag",
        registration_approximate=False,
    )
    raw = json.loads(encode_bridge_status(snap, ts=1.0))
    assert raw["registration_method"] == "tag"
    assert raw["registration_approximate"] is False


def test_get_status_decode() -> None:
    raw = json.dumps({"type": "get_status", "ts": 2.0, "robot_id": "unitree_go2"})
    msg = decode_inbound(raw, expected_robot_id="unitree_go2")
    assert isinstance(msg, GetStatusMessage)


def test_set_lidar_mode_decode() -> None:
    raw = json.dumps(
        {
            "type": "set_lidar_mode",
            "ts": 2.0,
            "robot_id": "unitree_go2",
            "mode": "obstacles",
            "obstacle_min_distance_m": 0.1,
            "obstacle_opaque_distance_m": 0.4,
            "obstacle_max_distance_m": 0.6,
        }
    )
    msg = decode_inbound(raw, expected_robot_id="unitree_go2")
    assert isinstance(msg, SetLidarModeMessage)
    assert msg.mode == "obstacles"
    assert msg.obstacle_min_distance_m == pytest.approx(0.1)
    assert msg.obstacle_opaque_distance_m == pytest.approx(0.4)
    assert msg.obstacle_max_distance_m == pytest.approx(0.6)


def test_set_lidar_mode_rejects_invalid_threshold_order() -> None:
    with pytest.raises(
        ValueError,
        match="obstacle_opaque_distance_m must be >= obstacle_min_distance_m",
    ):
        decode_inbound(
            json.dumps(
                {
                    "type": "set_lidar_mode",
                    "ts": 2.0,
                    "robot_id": "unitree_go2",
                    "mode": "obstacles",
                    "obstacle_min_distance_m": 0.4,
                    "obstacle_opaque_distance_m": 0.2,
                    "obstacle_max_distance_m": 0.6,
                }
            ),
            expected_robot_id="unitree_go2",
        )


def test_encode_path_and_nav_status() -> None:
    path = json.loads(encode_path(ts=2.0, waypoints=[(1.0, 2.0, 3.0)], robot_id="unitree_go2"))
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


def test_encode_pose_includes_optional_speed_mps() -> None:
    pose = json.loads(
        encode_pose(
            ts=1.0,
            position=(0.0, 0.0, 0.0),
            orientation=(0.0, 0.0, 0.0, 1.0),
            robot_id="unitree_go2",
            speed_mps=0.42,
        )
    )
    assert pose["speed_mps"] == 0.42


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


def test_decode_ping() -> None:
    msg = decode_inbound(
        '{"type":"ping","ts":1.0,"robot_id":"unitree_go2","client_ts":99.5}',
        expected_robot_id="unitree_go2",
    )
    from dimos.ar.network.protocol import PingMessage

    assert isinstance(msg, PingMessage)
    assert msg.client_ts == pytest.approx(99.5)


def test_encode_pong() -> None:
    payload = json.loads(
        encode_pong(
            robot_id="unitree_go2",
            client_ts=99.5,
            bridge_ts=100.0,
        )
    )
    assert payload["type"] == "pong"
    assert payload["client_ts"] == pytest.approx(99.5)
    assert payload["bridge_ts"] == pytest.approx(100.0)


def test_normalize_nav_state_active_planner_substates() -> None:
    from dimos.ar.network.data_plane import normalize_nav_state

    assert normalize_nav_state("initial_rotation") == "following_path"
    assert normalize_nav_state("final_rotation") == "following_path"
    assert normalize_nav_state("path_following") == "following_path"
    assert normalize_nav_state("arrived") == "idle"
    assert normalize_nav_state("stopped") == "idle"
    assert normalize_nav_state("recovery_mode") == "recovery"
