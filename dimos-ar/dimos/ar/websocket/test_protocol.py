from __future__ import annotations

import json
import struct

import pytest

from dimos.ar.localization.types import CapturePolicy, Intrinsics, LocalizationResult
from dimos.ar.navigation.types import NavGoalFrame, NavGoalRequest, NavState
from dimos.ar.robot.capabilities import Capability, CapabilityName
from dimos.ar.robot.profiles import RobotDescription
from dimos.ar.robot.profiles.unitree_go2 import UNITREE_GO2_PROFILE
from dimos.ar.sensors.lidar_settings import LidarSettings
from dimos.ar.websocket.protocol import (
    LIDAR_FOURCC,
    LOCALIZATION_OBSERVATIONS_FOURCC,
    EstopRequest,
    Hello,
    LidarSettingsRequest,
    LocalizationObservation,
    LocalizationObservationsRequest,
    LocalizationStartRequest,
    StateRequest,
    StateSnapshot,
    TimeSync,
    decode_hello_request,
    decode_inbound,
    decode_localization_observations,
    encode_hello,
    encode_lidar_binary,
    encode_localization_observations_request,
    encode_localization_result,
    encode_nav_goal,
    encode_pose,
    encode_state,
    encode_text,
    observation_from_localization,
)


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
            CapabilityName.LIDAR: Capability(available=True, reason=None),
            CapabilityName.NAVIGATION: Capability(available=True, reason=None),
            CapabilityName.LOCALIZATION: Capability(available=True, reason=None),
            CapabilityName.ESTOP: Capability(available=True, reason=None),
        },
    )


def _parse_json_line(text: str) -> dict:
    return json.loads(text.strip())


def test_encode_text_ends_with_newline() -> None:
    assert encode_text({"type": "state_request"}) == '{"type":"state_request"}\n'


def test_encode_hello_has_no_protocol_version() -> None:
    msg = _parse_json_line(encode_hello(_sample_hello()))
    assert msg["type"] == "hello"
    assert msg["client_id"] == "abc123"
    assert msg["time_sync"]["ts_client"] == 1000.0
    assert msg["time_sync"]["ts_server"] == 2000.0
    assert "protocol_version" not in msg
    assert "alignment" not in msg
    assert msg["capabilities"]["estop"]["available"] is True
    assert msg["robot"]["display_name"] == "Unitree Go2"


def test_decode_hello_request() -> None:
    req = decode_hello_request(json.dumps({"type": "hello_request", "ts_client": 99.5}))
    assert req.ts_client == 99.5


def test_decode_inbound_rejects_hello_request() -> None:
    with pytest.raises(ValueError, match="hello_request"):
        decode_inbound(json.dumps({"type": "hello_request", "ts_client": 1.0}))


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
    )
    msg = _parse_json_line(encode_state(snapshot))
    assert msg["type"] == "state"
    assert msg["server"]["connected_clients"] == 2
    assert msg["lidar"]["max_range_m"] == 5.0
    assert msg["nav"]["state"] == "following_path"
    assert "alignment" not in msg


def test_encode_nav_goal_shape() -> None:
    payload = _parse_json_line(
        encode_nav_goal(
            NavGoalFrame(
                pose=(1.0, 2.0, 0.0, 0.7854),
                path_poses=[(0.0, 0.0, 0.0, 0.0), (1.0, 2.0, 0.0, 0.7854)],
                ts=5.0,
            )
        )
    )
    assert payload["type"] == "nav_goal"
    assert payload["pose"] == [1.0, 2.0, 0.0, 0.7854]
    assert payload["path_poses"] == [[0.0, 0.0, 0.0, 0.0], [1.0, 2.0, 0.0, 0.7854]]

    clear_payload = _parse_json_line(
        encode_nav_goal(
            NavGoalFrame(
                pose=None,
                path_poses=[],
                ts=6.0,
            )
        )
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
            LocalizationObservationsRequest(
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
            LocalizationObservationsRequest(
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
        LocalizationObservationsRequest(
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


def test_encode_lidar_binary_layout() -> None:
    frame = encode_lidar_binary(ts=1.5, points=[(1.0, 2.0, 3.0)])
    fourcc, ts, count = struct.unpack_from("<IdI", frame, 0)
    assert fourcc == LIDAR_FOURCC
    assert ts == pytest.approx(1.5)
    assert count == 1
    x, y, z = struct.unpack_from("<3f", frame, 16)
    assert (x, y, z) == pytest.approx((1.0, 2.0, 3.0))


def _encode_localization_observations_frame(jpeg: bytes, intrinsics_json: bytes) -> bytes:
    ts_capture = 1.0
    camera_position = struct.pack("<3f", 0.0, 0.0, 0.0)
    camera_orientation = struct.pack("<4f", 0.0, 0.0, 0.0, 1.0)
    record_body = (
        struct.pack("<dII", ts_capture, len(jpeg), len(intrinsics_json))
        + struct.pack("<I", 0)
        + camera_position
        + camera_orientation
        + jpeg
        + intrinsics_json
    )
    record = struct.pack("<I", len(record_body)) + record_body
    return struct.pack("<IH", LOCALIZATION_OBSERVATIONS_FOURCC, 1) + record


TYPESCRIPT_LOCA_ONE = bytes.fromhex(
    "41434f4c01009a000000000000000000f03f0400000066000000000000000000803f"
    "00000040000040400000000000000000000000000000803fffd8ffd97b226678223a"
    "3130302c226679223a3130302c226378223a35302c226379223a35302c2277696474"
    "68223a3130302c22686569676874223a3130302c22646973746f7274696f6e5f6d6f"
    "64656c223a226e6f6e65222c22646973746f7274696f6e223a5b5d7d"
)


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
