from __future__ import annotations

import json
import struct

import pytest

from dimos.ar.websocket.protocol import (
    LIDAR_FOURCC,
    LOCALIZE_FOURCC,
    Capability,
    Estop,
    GetStateRequest,
    Hello,
    LidarSettings,
    LocalizeObservation,
    NavGoal,
    NavState,
    RobotDescription,
    StateSnapshot,
    TimeSyncRequest,
    decode_inbound,
    decode_localize,
    encode_hello,
    encode_lidar_binary,
    encode_pose,
    encode_state,
    encode_text,
    encode_time,
)


def _sample_hello(client_id: str = "abc123") -> Hello:
    return Hello(
        client_id=client_id,
        robot=RobotDescription(
            display_name="Unitree Go2",
            body_bounds_m=(0.7, 0.5, 0.55),
            footprint_m=(0.7, 0.5),
            base_height_m=0.33,
        ),
        requires_robot_in_view=False,
        capabilities={
            "lidar": Capability(available=True, reason=None),
            "navigation": Capability(available=True, reason=None),
            "estop": Capability(available=True, reason=None),
        },
    )


def _parse_json_line(text: str) -> dict:
    return json.loads(text.strip())


def test_encode_text_ends_with_newline() -> None:
    assert encode_text({"type": "get_state"}) == '{"type":"get_state"}\n'


def test_encode_hello_has_no_protocol_version() -> None:
    msg = _parse_json_line(encode_hello(_sample_hello()))
    assert msg["type"] == "hello"
    assert msg["client_id"] == "abc123"
    assert "protocol_version" not in msg
    assert msg["robot"]["display_name"] == "Unitree Go2"


def test_encode_state_round_trip_fields() -> None:
    snapshot = StateSnapshot(
        connected_clients=2,
        lidar=LidarSettings(enabled=True, min_height_m=0.1, max_height_m=1.5, max_range_m=5.0),
        nav=NavState(state="following_path", outcome=None),
        alignment_stale=False,
    )
    msg = _parse_json_line(encode_state(snapshot))
    assert msg["type"] == "state"
    assert msg["server"]["connected_clients"] == 2
    assert msg["lidar"]["max_range_m"] == 5.0
    assert msg["nav"]["state"] == "following_path"


def test_encode_time_and_pose() -> None:
    time_msg = _parse_json_line(
        encode_time(client_send_ts=1.0, server_recv_ts=2.0, server_send_ts=3.0)
    )
    assert time_msg["type"] == "time"
    assert time_msg["server_recv_ts"] == 2.0

    pose_msg = _parse_json_line(
        encode_pose(
            position=(1.0, 2.0, 3.0),
            orientation=(0.0, 0.0, 0.0, 1.0),
            ts=4.0,
        )
    )
    assert pose_msg["type"] == "pose"
    assert pose_msg["position"] == [1.0, 2.0, 3.0]


def test_decode_nav_goal_and_estop() -> None:
    nav = decode_inbound(
        json.dumps(
            {
                "type": "nav_goal",
                "position": [1.0, 0.0, 0.0],
                "orientation": [0.0, 0.0, 0.0, 1.0],
            }
        )
    )
    assert isinstance(nav, NavGoal)
    assert nav.position == (1.0, 0.0, 0.0)
    assert nav.orientation == (0.0, 0.0, 0.0, 1.0)

    estop = decode_inbound(json.dumps({"type": "estop"}))
    assert isinstance(estop, Estop)


def test_decode_nav_goal_requires_orientation() -> None:
    with pytest.raises(ValueError, match="orientation"):
        decode_inbound(json.dumps({"type": "nav_goal", "position": [1.0, 0.0, 0.0]}))


def test_decode_set_lidar_requires_all_fields() -> None:
    with pytest.raises(ValueError, match="Missing required field"):
        decode_inbound(json.dumps({"type": "set_lidar", "enabled": True}))

    msg = decode_inbound(
        json.dumps(
            {
                "type": "set_lidar",
                "enabled": True,
                "min_height_m": 0.1,
                "max_height_m": 1.5,
                "max_range_m": 5.0,
            }
        )
    )
    assert isinstance(msg, LidarSettings)
    assert msg.max_range_m == 5.0


def test_decode_set_lidar_rejects_inverted_band() -> None:
    with pytest.raises(ValueError, match="min_height_m"):
        decode_inbound(
            json.dumps(
                {
                    "type": "set_lidar",
                    "enabled": True,
                    "min_height_m": 2.0,
                    "max_height_m": 1.0,
                    "max_range_m": 5.0,
                }
            )
        )


def test_decode_time_sync_and_get_state() -> None:
    sync = decode_inbound(json.dumps({"type": "time_sync", "client_send_ts": 99.5}))
    assert isinstance(sync, TimeSyncRequest)
    assert sync.client_send_ts == 99.5

    state = decode_inbound(json.dumps({"type": "get_state"}))
    assert isinstance(state, GetStateRequest)


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


def _encode_localize_frame(jpeg: bytes, intrinsics_json: bytes) -> bytes:
    capture_ts = 1.0
    camera_position = struct.pack("<3f", 0.0, 0.0, 0.0)
    camera_orientation = struct.pack("<4f", 0.0, 0.0, 0.0, 1.0)
    record_body = (
        struct.pack("<dII", capture_ts, len(jpeg), len(intrinsics_json))
        + struct.pack("<I", 0)
        + camera_position
        + camera_orientation
        + jpeg
        + intrinsics_json
    )
    record = struct.pack("<I", len(record_body)) + record_body
    return struct.pack("<IH", LOCALIZE_FOURCC, 1) + record


def test_decode_localize_single_observation() -> None:
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
    observations = decode_localize(_encode_localize_frame(jpeg, intrinsics))
    assert len(observations) == 1
    obs: LocalizeObservation = observations[0]
    assert obs.jpeg == jpeg
    assert obs.intrinsics.fx == 100.0
    assert obs.capture_ts == pytest.approx(1.0)
