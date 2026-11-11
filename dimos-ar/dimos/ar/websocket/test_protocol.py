from __future__ import annotations

from dataclasses import replace
import json
import struct

import pytest

from dimos.ar.localization.types import CapturePolicy, Intrinsics, LocalizationResult
from dimos.ar.navigation.types import NavGoalFrame, NavGoalRequest, NavJoystickRequest, NavState
from dimos.ar.robot.capabilities import NAV_GOAL, NAV_JOYSTICK, Capability, CapabilityName
from dimos.ar.robot.profiles.profile import RobotDescription
from dimos.ar.robot.profiles.unitree_go2 import UNITREE_GO2_PROFILE
from dimos.ar.sensors.lidar_settings import LidarSettings
from dimos.ar.websocket.protocol import (
    HUMAN_INPUT_MAX_CHARS,
    LIDAR_FOURCC,
    AgentState,
    ClientPose,
    EstopRequest,
    Hello,
    LidarSettingsRequest,
    LocalizationObservation,
    LocalizationObservationsRequest,
    LocalizationStartRequest,
    StateRequest,
    StateSnapshot,
    TimeSync,
    UserMessageRequest,
    decode_hello_request,
    decode_inbound,
    decode_localization_observations,
    encode_agent_message,
    encode_agent_skill,
    encode_client_pose,
    encode_hello,
    encode_lidar_binary,
    encode_localization_observations_request,
    encode_localization_result,
    encode_pose,
    encode_state,
    encode_text,
    navigation_payload,
    observation_from_localization,
)
from test_support.websocket import TYPESCRIPT_LOCA_ONE, _encode_localization_observations_frame


def _available() -> Capability:
    return Capability(available=True, reason=None)


def _sample_navigation_inputs() -> dict[str, Capability]:
    on = _available()
    return {NAV_GOAL: on, NAV_JOYSTICK: on}


def _sample_hello(client_id: str = "abc123") -> Hello:
    return Hello(
        client_id=client_id,
        time_sync=TimeSync(ts_client=1000.0, ts_server=2000.0),
        robot=RobotDescription(
            display_name=UNITREE_GO2_PROFILE.display_name,
            body_bounds_m=UNITREE_GO2_PROFILE.body_bounds_m,
            footprint_m=UNITREE_GO2_PROFILE.footprint_m,
            base_height_m=UNITREE_GO2_PROFILE.base_height_m,
        ),
        capabilities={
            CapabilityName.OBJECT_DETECTION: Capability(available=False, reason="not configured"),
            CapabilityName.MANIPULATION: Capability(available=False, reason="not configured"),
            CapabilityName.LIDAR: _available(),
            CapabilityName.NAVIGATION: _available(),
            CapabilityName.LOCALIZATION: _available(),
            CapabilityName.ESTOP: _available(),
            CapabilityName.AGENT: Capability(
                available=False, reason="current blueprint has no DimOS agent"
            ),
        },
        navigation_inputs=_sample_navigation_inputs(),
        localization={"providers": []},
        odom_reference_id="test-odom",
        bulk_url="/bulk", bulk_token="b" * 64, bulk_epoch="bulk-epoch",
        resume_token="r" * 64,
    )


def _parse_json_line(text: str) -> dict:
    return json.loads(text.strip())


def test_encode_text_ends_with_newline() -> None:
    assert encode_text({"type": "state_request"}) == '{"type":"state_request"}\n'


def test_encode_hello_advertises_interaction_protocol_version() -> None:
    msg = _parse_json_line(encode_hello(_sample_hello()))
    assert msg["type"] == "hello"
    assert msg["client_id"] == "abc123"
    assert msg["time_sync"]["ts_client"] == 1000.0
    assert msg["time_sync"]["ts_server"] == 2000.0
    assert msg["protocol_version"] == 2
    assert "alignment" not in msg
    assert msg["localization"] == {"providers": []}
    assert msg["capabilities"]["estop"]["available"] is True
    assert msg["capabilities"]["navigation"]["nav_goal"]["available"] is True
    assert msg["capabilities"]["navigation"]["nav_joystick"]["available"] is True
    assert msg["robot"]["display_name"] == "Unitree Go2"


def test_decode_hello_request() -> None:
    req = decode_hello_request(json.dumps({"type": "hello_request", "protocol_version": 2, "ts_client": 99.5}))
    assert req.ts_client == 99.5


@pytest.mark.parametrize("version", [None, 1, 3, 4, True])
def test_hello_rejects_other_protocol_versions(version) -> None:
    payload = {"type": "hello_request", "ts_client": 1.0}
    if version is not None:
        payload["protocol_version"] = version
    with pytest.raises(ValueError, match="protocol_version 2"):
        decode_hello_request(json.dumps(payload))


def test_decode_inbound_rejects_hello_request() -> None:
    with pytest.raises(ValueError, match="hello_request"):
        decode_inbound(json.dumps({"type": "hello_request", "protocol_version": 2, "ts_client": 1.0}))


def test_encode_pose() -> None:
    pose_msg = _parse_json_line(
        encode_pose(
            position=(1.0, 2.0, 3.0),
            orientation=(0.0, 0.0, 0.0, 1.0),
            ts=4.0,
        )
    )
    assert pose_msg["type"] == "pose"
    assert pose_msg["position"] == [1.0, 2.0, 3.0]


def test_time_sync_converts_ts_capture() -> None:
    sync = TimeSync(ts_client=1000.0, ts_server=2000.5)
    assert sync.to_server_ts(1001.0) == pytest.approx(2001.5)


def test_observation_from_localization_converts_ts_capture() -> None:
    sync = TimeSync(ts_client=1000.0, ts_server=2000.5)
    wire = LocalizationObservation(
        ts_capture=1001.0,
        jpeg=b"\xff\xd8\xff",
        intrinsics=Intrinsics(
            fx=100.0,
            fy=100.0,
            cx=50.0,
            cy=50.0,
            width=100,
            height=100,
            distortion_model="none",
            distortion=(),
        ),
        camera_position=(0.0, 0.0, 0.0),
        camera_orientation=(0.0, 0.0, 0.0, 1.0),
    )

    domain = observation_from_localization(wire, time_sync=sync)

    assert domain.ts_server == pytest.approx(2001.5)
    assert domain.jpeg == wire.jpeg


def test_encode_state_has_no_alignment_block() -> None:
    snapshot = StateSnapshot(
        connected_clients=2,
        lidar=LidarSettings(enabled=True, min_height_m=0.1, max_height_m=1.5, max_range_m=5.0),
        nav=NavState(state="following_path", outcome=None),
        agent=AgentState(idle=True),
    )
    msg = _parse_json_line(encode_state(snapshot))
    assert msg["type"] == "state"
    assert msg["server"]["connected_clients"] == 2
    assert msg["lidar"]["max_range_m"] == 5.0
    assert msg["nav"]["state"] == "following_path"
    assert msg["agent"]["idle"] is True
    assert "alignment" not in msg


def test_nested_navigation_payload_shape() -> None:
    payload = _parse_json_line(
        encode_text(navigation_payload(
            NavGoalFrame(
                pose=(1.0, 2.0, 0.0, 0.7854),
                path_poses=[(0.0, 0.0, 0.0, 0.0), (1.0, 2.0, 0.0, 0.7854)],
                ts=5.0,
            )
        ))
    )
    assert payload["type"] == "nav_goal"
    assert payload["pose"] == [1.0, 2.0, 0.0, 0.7854]
    assert payload["path_poses"] == [[0.0, 0.0, 0.0, 0.0], [1.0, 2.0, 0.0, 0.7854]]

    clear_payload = _parse_json_line(
        encode_text(navigation_payload(
            NavGoalFrame(
                pose=None,
                path_poses=[],
                ts=6.0,
            )
        ))
    )
    assert clear_payload["type"] == "nav_goal"
    assert clear_payload["path_poses"] == []
    assert "pose" not in clear_payload


def test_decode_inbound_nav_goal_and_estop() -> None:
    nav = decode_inbound(
        json.dumps(
            {
                "type": "nav_goal_request",
                "position": [1.0, 0.0, 0.0],
                "orientation": [0.0, 0.0, 0.0, 1.0],
            }
        )
    )
    assert isinstance(nav, NavGoalRequest)
    assert nav.position == (1.0, 0.0, 0.0)
    assert nav.orientation == (0.0, 0.0, 0.0, 1.0)

    estop = decode_inbound(json.dumps({"type": "estop_request"}))
    assert isinstance(estop, EstopRequest)


def test_decode_localization_start_request() -> None:
    start = decode_inbound(json.dumps({"type": "localization_start_request"}))
    assert isinstance(start, LocalizationStartRequest)


def test_encode_localization_observations_request_marker() -> None:
    msg = _parse_json_line(
        encode_localization_observations_request(
            LocalizationObservationsRequest(result_timeout_s=15,
                capture_policy=CapturePolicy.ROBOT_LOS_REQUIRED,
                observation_count=3,
            )
        )
    )
    assert msg["type"] == "localization_observations_request"
    assert msg["capture_policy"] == "robot_los_required"
    assert msg["observation_count"] == 3
    assert "wait_timeout_s" not in msg


def test_encode_localization_observations_request_mixed() -> None:
    msg = _parse_json_line(
        encode_localization_observations_request(
            LocalizationObservationsRequest(result_timeout_s=15,
                capture_policy=CapturePolicy.ROBOT_LOS_PREFERRED,
                observation_count=3,
                wait_timeout_s=2.0,
            )
        )
    )
    assert msg["capture_policy"] == "robot_los_preferred"
    assert msg["wait_timeout_s"] == 2.0


def test_encode_localization_observations_request_requires_timeout_for_preferred() -> None:
    with pytest.raises(ValueError, match="wait_timeout_s"):
        LocalizationObservationsRequest(result_timeout_s=15,
            capture_policy=CapturePolicy.ROBOT_LOS_PREFERRED,
            observation_count=3,
        )


def test_encode_localization_result() -> None:
    msg = _parse_json_line(
        encode_localization_result(
            LocalizationResult(
                position=(1.0, 2.0, 3.0),
                orientation=(0.0, 0.0, 0.0, 1.0),
                confidence=0.8,
                ts_server=100.0,
            )
        )
    )
    assert msg["type"] == "localization_result"
    assert msg["position"] == [1.0, 2.0, 3.0]
    assert msg["confidence"] == 0.8
    assert msg["ts"] == 100.0


def test_decode_nav_goal_request_requires_orientation() -> None:
    with pytest.raises(ValueError, match="orientation"):
        decode_inbound(json.dumps({"type": "nav_goal_request", "position": [1.0, 0.0, 0.0]}))


def test_decode_lidar_settings_request_requires_all_fields() -> None:
    with pytest.raises(ValueError, match="Missing required field"):
        decode_inbound(json.dumps({"type": "lidar_settings_request", "enabled": True}))

    msg = decode_inbound(
        json.dumps(
            {
                "type": "lidar_settings_request",
                "enabled": True,
                "min_height_m": 0.1,
                "max_height_m": 1.5,
                "max_range_m": 5.0,
            }
        )
    )
    assert isinstance(msg, LidarSettingsRequest)
    assert msg.max_range_m == 5.0


def test_decode_lidar_settings_request_rejects_inverted_band() -> None:
    with pytest.raises(ValueError, match="min_height_m"):
        decode_inbound(
            json.dumps(
                {
                    "type": "lidar_settings_request",
                    "enabled": True,
                    "min_height_m": 2.0,
                    "max_height_m": 1.0,
                    "max_range_m": 5.0,
                }
            )
        )


def test_decode_state_request() -> None:
    state = decode_inbound(json.dumps({"type": "state_request"}))
    assert isinstance(state, StateRequest)


def test_decode_unknown_type_rejected() -> None:
    with pytest.raises(ValueError, match="Unknown inbound"):
        decode_inbound(json.dumps({"type": "nope"}))


def test_decode_user_message_request() -> None:
    msg = decode_inbound(json.dumps({"type": "user_message_request", "text": "  go forward  "}))
    assert isinstance(msg, UserMessageRequest)
    assert msg.text == "go forward"


def test_decode_user_message_request_rejects_blank_and_oversize() -> None:
    with pytest.raises(ValueError, match="non-blank"):
        decode_inbound(json.dumps({"type": "user_message_request", "text": "   "}))
    with pytest.raises(ValueError, match="4000"):
        decode_inbound(
            json.dumps({"type": "user_message_request", "text": "x" * (HUMAN_INPUT_MAX_CHARS + 1)})
        )


def test_decode_client_pose() -> None:
    msg = decode_inbound(
        json.dumps(
            {
                "type": "client_pose",
                "position": [1.0, 2.0, 3.0],
                "orientation": [0.0, 0.0, 0.0, 1.0],
                "ts": 12.5,
            }
        )
    )
    assert isinstance(msg, ClientPose)
    assert msg.position == (1.0, 2.0, 3.0)
    assert msg.orientation == (0.0, 0.0, 0.0, 1.0)
    assert msg.ts == 12.5


def test_decode_client_pose_rejects_non_finite_and_zero_quat() -> None:
    base = {
        "type": "client_pose",
        "position": [1.0, 2.0, 3.0],
        "orientation": [0.0, 0.0, 0.0, 1.0],
        "ts": 12.5,
    }
    with pytest.raises(ValueError, match="finite"):
        decode_inbound(json.dumps({**base, "position": [1.0, float("nan"), 3.0]}))
    with pytest.raises(ValueError, match="finite"):
        decode_inbound(json.dumps({**base, "ts": float("inf")}))
    with pytest.raises(ValueError, match="non-zero"):
        decode_inbound(json.dumps({**base, "orientation": [0.0, 0.0, 0.0, 0.0]}))




def test_encode_client_pose() -> None:
    payload = _parse_json_line(
        encode_client_pose(
            position=(1.0, 2.0, 3.0),
            orientation=(0.0, 0.0, 0.0, 1.0),
            ts=12.5,
        )
    )
    assert payload == {
        "type": "client_pose",
        "position": [1.0, 2.0, 3.0],
        "orientation": [0.0, 0.0, 0.0, 1.0],
        "ts": 12.5,
    }
    with pytest.raises(ValueError, match="non-zero"):
        encode_client_pose(position=(0.0, 0.0, 0.0), orientation=(0.0, 0.0, 0.0, 0.0), ts=1.0)


def test_decode_nav_joystick_request() -> None:
    msg = decode_inbound(
        json.dumps(
            {
                "type": "nav_joystick_request",
                "linear": [0.4, 0.0, 0.0],
                "angular": [0.0, 0.0, 0.3],
            }
        )
    )
    assert isinstance(msg, NavJoystickRequest)
    assert msg.linear == (0.4, 0.0, 0.0)
    assert msg.angular == (0.0, 0.0, 0.3)
    assert msg.duration is None

    held = decode_inbound(
        json.dumps(
            {
                "type": "nav_joystick_request",
                "linear": [0.4, 0.0, 0.0],
                "angular": [0.0, 0.0, 0.0],
                "duration": 0.5,
            }
        )
    )
    assert isinstance(held, NavJoystickRequest)
    assert held.duration == 0.5

    zero_hold = decode_inbound(
        json.dumps(
            {
                "type": "nav_joystick_request",
                "linear": [0.4, 0.0, 0.0],
                "angular": [0.0, 0.0, 0.0],
                "duration": 0,
            }
        )
    )
    assert isinstance(zero_hold, NavJoystickRequest)
    assert zero_hold.duration is None


def test_decode_nav_joystick_request_rejects_invalid() -> None:
    base = {
        "type": "nav_joystick_request",
        "linear": [0.4, 0.0, 0.0],
        "angular": [0.0, 0.0, 0.3],
    }
    with pytest.raises(ValueError, match="linear.z"):
        decode_inbound(json.dumps({**base, "linear": [0.4, 0.0, 1.0]}))
    with pytest.raises(ValueError, match="angular"):
        decode_inbound(json.dumps({**base, "angular": [0.1, 0.0, 0.3]}))
    with pytest.raises(ValueError, match="duration"):
        decode_inbound(json.dumps({**base, "duration": 2.1}))
    with pytest.raises(ValueError, match="duration"):
        decode_inbound(json.dumps({**base, "duration": -0.1}))
    with pytest.raises(ValueError, match="finite"):
        decode_inbound(json.dumps({**base, "duration": float("nan")}))
    with pytest.raises(TypeError, match="number"):
        decode_inbound(json.dumps({**base, "duration": True}))
    with pytest.raises(TypeError, match="number"):
        decode_inbound(json.dumps({**base, "linear": [True, 0.0, 0.0]}))
    with pytest.raises(ValueError, match="finite"):
        decode_inbound(json.dumps({**base, "linear": [0.4, float("inf"), 0.0]}))


def test_encode_hello_joystick_only_parent_available() -> None:
    hello = _sample_hello()
    hello = replace(hello,
        capabilities={
            **hello.capabilities,
            CapabilityName.NAVIGATION: _available(),
        },
        navigation_inputs={
            NAV_GOAL: Capability(available=False, reason="nav_goal not available on this robot"),
            NAV_JOYSTICK: _available(),
        },
    )
    msg = _parse_json_line(encode_hello(hello))
    navigation = msg["capabilities"]["navigation"]
    assert navigation["available"] is True
    assert navigation["nav_goal"]["available"] is False
    assert navigation["nav_joystick"]["available"] is True


def test_encode_agent_message_and_agent_skill() -> None:
    agent = _parse_json_line(encode_agent_message("  Heading out.  "))
    assert agent == {"type": "agent_message", "text": "Heading out."}
    skill = _parse_json_line(
        encode_agent_skill(
            name="ar_place_marker",
            args={"id": "kitchen", "x": 1.0, "y": 0.0, "z": 0.0},
        )
    )
    assert skill == {
        "type": "agent_skill",
        "name": "ar_place_marker",
        "args": {"id": "kitchen", "x": 1.0, "y": 0.0, "z": 0.0},
    }
    remove = _parse_json_line(encode_agent_skill(name="ar_remove_marker", args={"id": "kitchen"}))
    assert remove == {
        "type": "agent_skill",
        "name": "ar_remove_marker",
        "args": {"id": "kitchen"},
    }
    with pytest.raises(ValueError, match="non-blank"):
        encode_agent_message("   ")
    with pytest.raises(ValueError, match="non-blank"):
        encode_agent_skill(name="  ", args={})


def test_encode_lidar_binary_layout() -> None:
    frame = encode_lidar_binary(ts=1.5, points=[(1.0, 2.0, 3.0)])
    fourcc, ts, count = struct.unpack_from("<IdI", frame, 0)
    assert fourcc == LIDAR_FOURCC
    assert ts == pytest.approx(1.5)
    assert count == 1
    x, y, z = struct.unpack_from("<3f", frame, 16)
    assert (x, y, z) == pytest.approx((1.0, 2.0, 3.0))


def test_decode_typescript_localization_observations_golden() -> None:
    observations = decode_localization_observations(TYPESCRIPT_LOCA_ONE)
    assert len(observations) == 1
    observation = observations[0]
    assert observation.ts_capture == pytest.approx(1.0)
    assert observation.jpeg == b"\xff\xd8\xff\xd9"
    assert observation.camera_position == pytest.approx((1.0, 2.0, 3.0))
    assert observation.camera_orientation == pytest.approx((0.0, 0.0, 0.0, 1.0))
    assert observation.intrinsics.fx == 100.0
    assert observation.intrinsics.distortion_model == "none"
    assert observation.intrinsics.distortion == ()


def test_decode_localization_observations_single_observation() -> None:
    intrinsics = json.dumps(
        {
            "fx": 100.0,
            "fy": 100.0,
            "cx": 50.0,
            "cy": 50.0,
            "width": 100,
            "height": 100,
            "distortion_model": "none",
            "distortion": [],
        },
        separators=(",", ":"),
    ).encode("utf-8")
    jpeg = b"\xff\xd8\xff\xd9"
    observations = decode_localization_observations(
        _encode_localization_observations_frame(jpeg, intrinsics)
    )
    assert len(observations) == 1
    obs: LocalizationObservation = observations[0]
    assert obs.jpeg == jpeg
    assert obs.intrinsics.fx == 100.0
    assert obs.ts_capture == pytest.approx(1.0)


@pytest.mark.parametrize("preview", [None, False, True])
def test_nav_preview_request_defaults_and_roundtrip(preview: bool | None) -> None:
    body = {"type": "nav_goal_request", "position": [1, 2, 0], "orientation": [0, 0, 0, 1]}
    if preview is not None:
        body["preview"] = preview
    request = decode_inbound(json.dumps(body))
    assert isinstance(request, NavGoalRequest)
    assert request.preview is (preview is True)
    frame = NavGoalFrame(pose=None, path_poses=[], ts=1, preview=request.preview)
    response = json.loads(encode_text(navigation_payload(frame)))
    assert response.get("preview", False) is request.preview
    assert "pose" not in response


@pytest.mark.parametrize("preview", ["true", 1, None])
def test_nav_preview_requires_boolean(preview: object) -> None:
    with pytest.raises(TypeError):
        decode_inbound(
            json.dumps(
                {
                    "type": "nav_goal_request",
                    "position": [1, 2, 0],
                    "orientation": [0, 0, 0, 1],
                    "preview": preview,
                }
            )
        )


@pytest.mark.parametrize("identity", ["", "x" * 129, 12])
def test_invalid_preview_identity(identity: object) -> None:
    with pytest.raises((TypeError, ValueError)):
        decode_inbound(
            json.dumps(
                {
                    "type": "nav_goal_request",
                    "preview": True,
                    "preview_id": identity,
                    "position": [1, 2, 0],
                    "orientation": [0, 0, 0, 1],
                }
            )
        )


def test_preview_identity_roundtrip() -> None:
    request = decode_inbound(
        json.dumps(
            {
                "type": "nav_goal_request",
                "preview": True,
                "preview_id": "aim",
                "position": [1, 2, 0],
                "orientation": [0, 0, 0, 1],
            }
        )
    )
    assert isinstance(request, NavGoalRequest)
    assert request.preview_id == "aim"
    frame = NavGoalFrame(pose=None, path_poses=[], ts=1, preview=True, preview_id="aim")
    assert json.loads(encode_text(navigation_payload(frame)))["preview_id"] == "aim"


def test_optional_server_display_metadata() -> None:
    from dataclasses import replace

    old = _sample_hello()
    assert "server_info" not in json.loads(encode_hello(old))
    info = {"robot_ip": "192.168.1.42", "dimos_version": "0.4.0", "armodule_version": "0.2.0"}
    assert json.loads(encode_hello(replace(old, server_info=info)))["server_info"] == info


def test_localization_result_timeout_is_optional_and_positive() -> None:
    request = LocalizationObservationsRequest(
        capture_policy=CapturePolicy.ANY_ANGLE, observation_count=1, result_timeout_s=15
    )
    assert json.loads(encode_localization_observations_request(request))["result_timeout_s"] == 15
    for timeout in [0, -1, float("nan"), float("inf")]:
        with pytest.raises(ValueError):
            LocalizationObservationsRequest(
                capture_policy=CapturePolicy.ANY_ANGLE,
                observation_count=1,
                result_timeout_s=timeout,
            )


def test_localization_rejects_nonfinite_capture_timestamp() -> None:
    import struct

    frame = bytearray(TYPESCRIPT_LOCA_ONE)
    struct.pack_into("<d", frame, 10, float("nan"))
    with pytest.raises(ValueError, match="ts_capture must be finite"):
        decode_localization_observations(bytes(frame))


def test_hello_always_advertises_odometry_heuristic() -> None:
    from dataclasses import replace

    hello = _sample_hello()
    assert json.loads(encode_hello(hello))["robot"]["odom_scale_correction_factor"] == 1.0
    corrected = replace(hello, robot=replace(hello.robot, odom_scale_correction_factor=1.25))
    assert json.loads(encode_hello(corrected))["robot"]["odom_scale_correction_factor"] == 1.25


def test_hello_carries_optional_odometry_reference() -> None:
    from dataclasses import replace

    hello = _sample_hello()
    payload = json.loads(encode_hello(replace(hello, odom_reference_id="room-a")))
    assert payload["odom_reference_id"] == "room-a"


@pytest.mark.parametrize("value", [True, False, "1", None, float("nan"), float("inf")])
@pytest.mark.parametrize("field", ["position", "orientation"])
def test_nav_goal_rejects_non_numeric_and_non_finite_components(value, field) -> None:
    payload = {"type": "nav_goal_request", "position": [0, 0, 0], "orientation": [0, 0, 0, 1]}
    payload[field][0] = value
    with pytest.raises((TypeError, ValueError)):
        decode_inbound(json.dumps(payload))


@pytest.mark.parametrize("offset, format_, value", [
    (30, "<f", float("nan")), (34, "<f", float("inf")),
    (42, "<4f", (0, 0, 0, 0)), (26, "<I", 1),
])
def test_binary_localization_rejects_invalid_camera_and_reserved_word(offset, format_, value):
    frame = bytearray(TYPESCRIPT_LOCA_ONE)
    struct.pack_into(format_, frame, offset, *(value if isinstance(value, tuple) else (value,)))
    with pytest.raises(ValueError):
        decode_localization_observations(bytes(frame))


def test_binary_localization_rejects_unexplained_trailing_and_record_bytes() -> None:
    with pytest.raises(ValueError, match="trailing"):
        decode_localization_observations(TYPESCRIPT_LOCA_ONE + b"x")
    frame = bytearray(TYPESCRIPT_LOCA_ONE + b"x")
    record_length = struct.unpack_from("<I", frame, 6)[0]
    struct.pack_into("<I", frame, 6, record_length + 1)
    with pytest.raises(ValueError, match="record bytes"):
        decode_localization_observations(bytes(frame))


@pytest.mark.parametrize("changes", [
    {"fx": 0}, {"fy": -1}, {"fx": True}, {"fx": "1"},
    {"width": 0}, {"height": -1}, {"width": True}, {"height": 1.5},
    {"distortion": [True]}, {"distortion": ["1"]},
])
def test_binary_localization_rejects_invalid_calibration(changes):
    intrinsics = {"fx": 100, "fy": 100, "cx": 50, "cy": 50, "width": 100, "height": 100,
                  "distortion_model": "none", "distortion": [], **changes}
    with pytest.raises((TypeError, ValueError)):
        decode_localization_observations(_encode_localization_observations_frame(b"jpeg", json.dumps(intrinsics).encode()))


def test_client_decode_error_is_a_bounded_diagnostic():
    from dimos.ar.websocket.protocol import ClientError

    body = {"type": "client_error", "message_type": "manipulation_state", "detail": "bad pose",
            "excerpt": '{"orientation":[0,0,0,0]}', "ts": 10.0, "message_ts": 9.9,
            "request_id": "plan-1", "suppressed_count": 2}
    report = decode_inbound(json.dumps(body))
    assert isinstance(report, ClientError)
    assert report.message_ts == 9.9
    assert report.suppressed_count == 2
    for key, value in (("excerpt", "x" * 513), ("detail", "x" * 1025), ("ts", True),
                       ("suppressed_count", -1), ("request_id", "")):
        with pytest.raises((ValueError, TypeError)):
            decode_inbound(json.dumps({**body, key: value}))


@pytest.mark.parametrize("payload", [
    {"type": "client_pose", "position": [10**400, 0, 0], "orientation": [0, 0, 0, 1], "ts": 1},
    {"type": "client_pose", "position": [0, 0, 0], "orientation": [0, 0, 0, 10**400], "ts": 1},
    {"type": "interaction_request", "request_id": "huge", "action": "update", "speed_scale": 10**400},
    {"type": "interaction_request", "request_id": "huge", "action": "update", "position": [10**400, 0, 0], "orientation": [0, 0, 0, 1]},
    {"type": "manipulation_request", "request_id": "huge", "group_id": "arm", "action": "evaluate", "position": [10**400, 0, 0], "orientation": [0, 0, 0, 1]},
    {"type": "localization_tracking", "tracking_reference_id": "track", "travel_m": 10**400, "active": True},
])
def test_oversized_json_integers_are_ordinary_validation_errors(payload):
    with pytest.raises(ValueError):
        decode_inbound(json.dumps(payload))
