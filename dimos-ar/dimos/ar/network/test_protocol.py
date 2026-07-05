from __future__ import annotations

import json
import struct

import numpy as np
import pytest

from dimos.ar.network.bridge_status import BridgeStatusSnapshot
from dimos.ar.network.protocol import (
    DEFAULT_CAPABILITIES,
    PROTOCOL_VERSION,
    CameraInfoMessage,
    CancelNavGoalMessage,
    EmergencyStopMessage,
    GetStatusMessage,
    JoystickCommandMessage,
    NavGoalMessage,
    PingMessage,
    RegistrationCommandMessage,
    RegistrationPoseMessage,
    RegistrationStatusPayload,
    SetLidarModeMessage,
    decode_inbound,
    encode_bridge_status,
    encode_camera_frame_ack,
    encode_hello,
    encode_lidar_binary,
    encode_nav_status,
    encode_path,
    encode_pong,
    encode_pose,
    encode_registration_status,
    encode_runtime_snapshot,
    nav_phase_payload,
)
from dimos.ar.registration.types import CaptureHint, MotionHint, RegistrationMode, RegistrationPhase
from dimos.ar.robot_profile.base import CapabilityState, RobotHandshake
from dimos.ar.robot_profile.g1 import g1_handshake
from dimos.ar.world_frame.state import WorldFrameState


def _sample_handshake() -> RobotHandshake:
    capability_states = {
        capability: CapabilityState(capability != "emergency_stop", "disabled")
        if capability == "emergency_stop"
        else CapabilityState(True)
        for capability in DEFAULT_CAPABILITIES
    }
    return RobotHandshake(
        robot_id="unitree_go2",
        display_name="Unitree Go2",
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
    assert msg["protocol_version"] == PROTOCOL_VERSION
    assert msg["robot"]["robot_id"] == "unitree_go2"
    assert "robot_model" not in msg["robot"]
    assert isinstance(msg["capabilities"], dict)
    assert msg["capabilities"]["lidar"]["available"] is True
    assert msg["capabilities"]["emergency_stop"]["available"] is False
    assert "disabled_capabilities" not in msg
    assert "capability_states" not in msg


def test_encode_hello_g1_tag_tracking_profile() -> None:
    handshake = g1_handshake(
        "unitree_g1",
        nav_available=True,
        path_available=True,
        plan_preview_available=True,
        cancel_goal_available=False,
        emergency_stop_available=True,
        tag_mount_available=True,
        baseline_motion_available=True,
    )
    msg = json.loads(encode_hello(handshake))
    assert msg["robot"]["robot_id"] == "unitree_g1"
    assert "robot_model" not in msg["robot"]
    assert msg["capabilities"]["registration_april_odom_baseline"]["available"] is True
    assert msg["capabilities"]["registration_manual_pose"]["available"] is True
    assert msg["robot"]["tag_tracking_profile"]["tag_total_size_m"] == 0.07
    assert isinstance(msg["robot"]["tag_tracking_profile"]["tag_ids"], list)


def test_encode_hello_g1_tag_registration_disabled() -> None:
    handshake = g1_handshake(
        "unitree_g1",
        nav_available=True,
        path_available=True,
        plan_preview_available=True,
        cancel_goal_available=False,
        emergency_stop_available=True,
        tag_mount_available=False,
    )
    msg = json.loads(encode_hello(handshake))
    assert msg["capabilities"]["registration_manual_pose"]["available"] is False


def test_robot_id_mismatch_rejected() -> None:
    raw = json.dumps({"type": "cancel_nav_goal", "ts": 1.0, "robot_id": "other"})
    with pytest.raises(ValueError, match="Unknown robot_id"):
        decode_inbound(raw, expected_robot_id="unitree_go2")


def test_nav_goal_decode_navigate() -> None:
    raw = json.dumps(
        {
            "type": "nav_goal",
            "intent": "navigate",
            "ts": 2.0,
            "robot_id": "unitree_go2",
            "position": [1.0, 0.0, 0.0],
        }
    )
    msg = decode_inbound(raw)
    assert isinstance(msg, NavGoalMessage)
    assert msg.intent == "navigate"
    assert msg.position == (1.0, 0.0, 0.0)
    assert msg.orientation is None


def test_nav_goal_decode_with_orientation() -> None:
    raw = json.dumps(
        {
            "type": "nav_goal",
            "intent": "navigate",
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


def test_nav_goal_decode_preview() -> None:
    raw = json.dumps(
        {
            "type": "nav_goal",
            "intent": "preview",
            "ts": 2.5,
            "robot_id": "unitree_go2",
            "position": [2.0, 0.0, 1.0],
            "orientation": [0.0, 0.0, 0.0, 1.0],
        }
    )
    msg = decode_inbound(raw)
    assert isinstance(msg, NavGoalMessage)
    assert msg.intent == "preview"
    assert msg.position == (2.0, 0.0, 1.0)


def test_cancel_nav_goal_decode() -> None:
    raw = json.dumps({"type": "cancel_nav_goal", "ts": 3.0, "robot_id": "unitree_go2"})
    msg = decode_inbound(raw)
    assert isinstance(msg, CancelNavGoalMessage)


def test_emergency_stop_decode() -> None:
    raw = json.dumps({"type": "emergency_stop", "ts": 3.0, "robot_id": "unitree_go2"})
    msg = decode_inbound(raw)
    assert isinstance(msg, EmergencyStopMessage)


def test_joystick_command_decode() -> None:
    raw = json.dumps(
        {
            "type": "joystick_command",
            "ts": 3.0,
            "robot_id": "unitree_go2",
            "vx": 0.0,
            "vy": 0.2,
            "wz": -0.1,
        }
    )
    msg = decode_inbound(raw)
    assert isinstance(msg, JoystickCommandMessage)
    assert msg.vx == 0.0
    assert msg.vy == pytest.approx(0.2)
    assert msg.wz == pytest.approx(-0.1)


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


def test_encode_lidar_binary() -> None:
    points = np.array([[1.0, 2.0, 3.0]], dtype=np.float32)
    raw = encode_lidar_binary(ts=1.0, points=points)
    assert raw[0] == 0x01
    ts = struct.unpack("<f", raw[1:5])[0]
    assert ts == pytest.approx(1.0)
    assert len(raw) == 5 + 3 * 2


def test_registration_command_messages_decode() -> None:
    start = decode_inbound(
        json.dumps(
            {
                "type": "registration_command",
                "command": "start",
                "ts": 1.0,
                "robot_id": "unitree_go2",
                "mode": "april_odom_baseline",
            }
        )
    )
    assert isinstance(start, RegistrationCommandMessage)
    assert start.command == "start"
    assert start.mode == "april_odom_baseline"
    start_manual = decode_inbound(
        json.dumps(
            {
                "type": "registration_command",
                "command": "start",
                "ts": 1.0,
                "robot_id": "unitree_go2",
                "mode": "manual_pose",
            }
        )
    )
    assert isinstance(start_manual, RegistrationCommandMessage)
    assert start_manual.mode == "manual_pose"
    authorize = decode_inbound(
        json.dumps(
            {
                "type": "registration_command",
                "command": "authorize_motion",
                "ts": 1.5,
                "robot_id": "unitree_go2",
            }
        )
    )
    assert isinstance(authorize, RegistrationCommandMessage)
    assert authorize.command == "authorize_motion"
    stop = decode_inbound(
        json.dumps(
            {
                "type": "registration_command",
                "command": "stop",
                "ts": 2.0,
                "robot_id": "unitree_go2",
            }
        )
    )
    assert isinstance(stop, RegistrationCommandMessage)
    assert stop.command == "stop"
    commit = decode_inbound(
        json.dumps(
            {
                "type": "registration_command",
                "command": "commit",
                "ts": 2.5,
                "robot_id": "unitree_go2",
            }
        )
    )
    assert isinstance(commit, RegistrationCommandMessage)
    assert commit.command == "commit"
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
                "type": "registration_pose",
                "ts": 4.0,
                "robot_id": "unitree_go2",
                "position": [1.0, 0.0, 2.0],
                "orientation": [0.0, 0.0, 0.0, 1.0],
            }
        )
    )
    assert isinstance(manual_pose, RegistrationPoseMessage)
    assert manual_pose.position == (1.0, 0.0, 2.0)


def test_registration_command_start_missing_mode_rejected() -> None:
    with pytest.raises(ValueError, match="Missing required field"):
        decode_inbound(
            json.dumps(
                {
                    "type": "registration_command",
                    "command": "start",
                    "ts": 1.0,
                    "robot_id": "unitree_go2",
                }
            )
        )


def test_registration_command_start_invalid_mode_rejected() -> None:
    with pytest.raises(ValueError, match="april_odom_baseline"):
        decode_inbound(
            json.dumps(
                {
                    "type": "registration_command",
                    "command": "start",
                    "ts": 1.0,
                    "robot_id": "unitree_go2",
                    "mode": "bad",
                }
            )
        )


def test_encode_registration_status() -> None:
    raw = json.loads(
        encode_registration_status(
            ts=1.0,
            status=RegistrationStatusPayload(
                mode=RegistrationMode.APRIL_ODOM_BASELINE,
                phase=RegistrationPhase.SCANNING,
                capture=CaptureHint.STEADY,
                message="Look at the AprilTag on your robot",
                tag_visible=True,
            ),
        )
    )
    assert raw["type"] == "registration_status"
    assert raw["mode"] == "april_odom_baseline"
    assert raw["phase"] == "scanning"
    assert raw["capture"] == "steady"
    assert raw["tag_visible"] is True
    assert "progress" not in raw


def test_encode_registration_status_motion_fields() -> None:
    raw = json.loads(
        encode_registration_status(
            ts=1.0,
            status=RegistrationStatusPayload(
                mode=RegistrationMode.APRIL_ODOM_BASELINE,
                phase=RegistrationPhase.MOVING,
                capture=CaptureHint.HOLD,
                message="Robot moving — waypoint 2/3",
                motion=MotionHint(
                    frame="robot",
                    axis="lateral",
                    direction="left",
                    distance_m=0.2,
                    waypoint_index=2,
                    waypoint_total=3,
                ),
            ),
        )
    )
    assert raw["motion"]["waypoint_index"] == 2
    assert raw["motion"]["direction"] == "left"


def test_encode_registration_status_manual() -> None:
    raw = json.loads(
        encode_registration_status(
            ts=1.0,
            status=RegistrationStatusPayload(
                mode=RegistrationMode.MANUAL_POSE,
                phase=RegistrationPhase.AWAITING_COMMIT,
                capture=CaptureHint.OFF,
                message="Manual robot pose ready — review and commit",
            ),
        )
    )
    assert raw["mode"] == "manual_pose"
    assert raw["phase"] == "awaiting_commit"
    assert "tag_visible" not in raw


def test_encode_camera_frame_ack() -> None:
    raw = json.loads(
        encode_camera_frame_ack(
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
        reconnecting=False,
    )
    world_frame = WorldFrameState()
    raw = json.loads(encode_bridge_status(snap, world_frame=world_frame, ts=1.0))
    assert raw["type"] == "bridge_status"
    assert "robot_id" not in raw
    assert "streams_active" not in raw
    assert raw["robot_connected"] is True
    assert raw["world_frame_method"] is None
    assert raw["world_frame_approximate"] is False
    assert raw["world_frame_committed"] is False


def test_encode_bridge_status_with_method() -> None:
    import numpy as np

    snap = BridgeStatusSnapshot(
        robot_id="unitree_go2",
        robot_connected=True,
        streams_active=True,
        reconnecting=False,
    )
    world_frame = WorldFrameState()
    world_frame.commit(np.eye(4), method="april_odom_baseline", approximate=False)
    raw = json.loads(encode_bridge_status(snap, world_frame=world_frame, ts=1.0))
    assert raw["world_frame_method"] == "april_odom_baseline"
    assert raw["world_frame_approximate"] is False
    assert raw["world_frame_committed"] is True


def test_encode_runtime_snapshot() -> None:
    bridge = {
        "robot_connected": True,
        "reconnecting": False,
        "world_frame_committed": True,
        "world_frame_method": "manual_pose",
        "world_frame_approximate": False,
    }
    raw = json.loads(
        encode_runtime_snapshot(
            robot_id="unitree_go2",
            bridge=bridge,
            nav={"phase": "navigating"},
            path={"kind": "active", "waypoints": [[1.0, 2.0, 3.0]]},
            ts=5.0,
        )
    )
    assert raw["type"] == "runtime_snapshot"
    assert raw["robot_id"] == "unitree_go2"
    assert raw["nav"]["phase"] == "navigating"
    assert raw["path"]["kind"] == "active"
    assert "streams_active" not in raw["bridge"]


def test_encode_nav_goal_update() -> None:
    from dimos.ar.network.protocol import encode_nav_goal_update

    raw = json.loads(
        encode_nav_goal_update(
            ts=1.0,
            source="xr",
            position=(1.0, 0.0, 2.0),
            orientation=(0.0, 0.0, 0.0, 1.0),
            active=True,
        )
    )
    assert raw["type"] == "nav_goal_update"
    assert raw["source"] == "xr"
    assert raw["active"] is True
    assert raw["position"] == [1.0, 0.0, 2.0]


def test_encode_runtime_snapshot_goal() -> None:
    raw = json.loads(
        encode_runtime_snapshot(
            robot_id="unitree_go2",
            bridge={"robot_connected": True, "world_frame_committed": True, "reconnecting": False},
            nav={"phase": "navigating"},
            goal={
                "source": "agent",
                "position": [1.0, 0.0, 2.0],
                "active": True,
            },
            ts=5.0,
        )
    )
    assert raw["goal"]["source"] == "agent"
    assert raw["goal"]["active"] is True


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
    path = json.loads(encode_path(ts=2.0, waypoints=[(1.0, 2.0, 3.0)], kind="active"))
    assert path["type"] == "path"
    assert path["kind"] == "active"
    assert path["waypoints"] == [[1.0, 2.0, 3.0]]
    assert "robot_id" not in path

    preview = json.loads(
        encode_path(
            ts=2.5,
            waypoints=[(4.0, 5.0, 6.0)],
            kind="preview",
            target=(7.0, 8.0, 9.0),
        )
    )
    assert preview["type"] == "path"
    assert preview["kind"] == "preview"
    assert preview["waypoints"] == [[4.0, 5.0, 6.0]]
    assert preview["target"] == [7.0, 8.0, 9.0]

    status = json.loads(encode_nav_status(ts=3.0, phase="navigating"))
    assert status["type"] == "nav_status"
    assert status["phase"] == "navigating"
    assert "state" not in status

    recovering = json.loads(encode_nav_status(ts=3.5, phase="recovering"))
    assert recovering["phase"] == "recovering"

    failed = json.loads(encode_nav_status(ts=4.0, phase="failed", error_code=505))
    assert failed["phase"] == "failed"
    assert failed["error_code"] == 505


def test_nav_phase_payload_mapping() -> None:
    assert nav_phase_payload(
        goal_reached=False,
        goal_failed=False,
        nav_state="navigating",
        nav_goal_pending=True,
    ) == {"phase": "navigating"}
    assert nav_phase_payload(
        goal_reached=True,
        goal_failed=False,
        nav_state="idle",
        nav_goal_pending=False,
    ) == {"phase": "succeeded"}
    assert nav_phase_payload(
        goal_reached=False,
        goal_failed=False,
        nav_state="recovering",
        nav_goal_pending=False,
    ) == {"phase": "recovering"}


def test_encode_pose() -> None:
    pose = json.loads(
        encode_pose(
            ts=1.0,
            position=(0.0, 0.0, 0.0),
            orientation=(0.0, 0.0, 0.0, 1.0),
        )
    )
    assert pose["orientation"] == [0.0, 0.0, 0.0, 1.0]
    assert "robot_id" not in pose


def test_encode_pose_includes_optional_speed_mps() -> None:
    pose = json.loads(
        encode_pose(
            ts=1.0,
            position=(0.0, 0.0, 0.0),
            orientation=(0.0, 0.0, 0.0, 1.0),
            speed_mps=0.42,
        )
    )
    assert pose["speed_mps"] == 0.42


def test_encode_pose_includes_optional_kinematics() -> None:
    pose = json.loads(
        encode_pose(
            ts=1.0,
            position=(0.0, 0.0, 0.0),
            orientation=(0.0, 0.0, 0.0, 1.0),
            velocity_mps=(0.5, 0.0, -0.1),
            yaw_rate_rad_s=0.35,
        )
    )
    assert pose["velocity_mps"] == [0.5, 0.0, -0.1]
    assert pose["yaw_rate_rad_s"] == 0.35


def test_encode_pose_rounds_high_precision_values() -> None:
    pose = json.loads(
        encode_pose(
            ts=1.23456789,
            position=(1.23456789, 2.34567891, 3.45678912),
            orientation=(0.111111115, 0.222222225, 0.333333335, 0.999999995),
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
            kind="active",
        )
    )
    assert path["ts"] == 2.123
    assert path["waypoints"] == [[1.235, 2.346, 3.457]]

    preview = json.loads(
        encode_path(
            ts=2.5,
            waypoints=[(4.0, 5.0, 6.0)],
            kind="preview",
            target=(7.123456, 8.234567, 9.345678),
        )
    )
    assert preview["target"] == [7.123, 8.235, 9.346]


def test_decode_ping() -> None:
    msg = decode_inbound(
        '{"type":"ping","ts":1.0,"robot_id":"unitree_go2","client_ts":99.5}',
        expected_robot_id="unitree_go2",
    )
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
    from dimos.ar.navigation.nav_state import normalize_nav_state

    assert normalize_nav_state("initial_rotation") == "navigating"
    assert normalize_nav_state("final_rotation") == "navigating"
    assert normalize_nav_state("path_following") == "navigating"
    assert normalize_nav_state("arrived") == "idle"
    assert normalize_nav_state("stopped") == "idle"
    assert normalize_nav_state("recovery_mode") == "recovering"
