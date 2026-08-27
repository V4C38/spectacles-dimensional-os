from __future__ import annotations

import json
import struct

import pytest

from dimos.ar.localization.types import Intrinsics
from dimos.ar.websocket.protocol import (
    LIDAR_FOURCC,
    LOCALIZATION_REQUEST_FOURCC,
    Capability,
    EstopRequest,
    Hello,
    LidarSettings,
    LocalizeObservation,
    NavGoalFrame,
    NavGoalRequest,
    NavState,
    RobotDescription,
    StateRequest,
    StateSnapshot,
    TimeSync,
    decode_hello_request,
    decode_inbound,
    decode_localization_request,
    encode_hello,
    encode_lidar_binary,
    encode_nav_goal,
    encode_pose,
    encode_state,
    encode_text,
    observation_from_localize,
)


def _sample_hello(client_id: str = "abc123") -> Hello:
    return Hello(
        client_id=client_id,
        time_sync=TimeSync(ts_client=1000.0, ts_server=2000.0),
        robot=RobotDescription(
            display_name="Unitree Go2",
            body_bounds_m=(0.7, 0.5, 0.55),
            footprint_m=(0.7, 0.5),
            base_height_m=0.33,
        ),
        capabilities={
            "lidar": Capability(available=True, reason=None),
            "navigation": Capability(available=True, reason=None),
            "estop": Capability(available=True, reason=None),
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


def test_time_sync_converts_capture_ts() -> None:
    sync = TimeSync(ts_client=1000.0, ts_server=2000.5)
    assert sync.to_server_ts(1001.0) == pytest.approx(2001.5)


def test_observation_from_localize_converts_capture_ts() -> None:
    sync = TimeSync(ts_client=1000.0, ts_server=2000.5)
    wire = LocalizeObservation(
        capture_ts=1001.0,
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

    domain = observation_from_localize(wire, time_sync=sync)

    assert domain.ts_server == pytest.approx(2001.5)
    assert domain.jpeg == wire.jpeg


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


def test_encode_state_round_trip_fields() -> None:
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


def test_decode_nav_goal_request_requires_orientation() -> None:
    with pytest.raises(ValueError, match="orientation"):
        decode_inbound(
            json.dumps({"type": "nav_goal_request", "position": [1.0, 0.0, 0.0]})
        )


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
    assert isinstance(msg, LidarSettings)
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


def _encode_localization_request_frame(jpeg: bytes, intrinsics_json: bytes) -> bytes:
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
    return struct.pack("<IH", LOCALIZATION_REQUEST_FOURCC, 1) + record


def test_decode_localization_request_single_observation() -> None:
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
    observations = decode_localization_request(
        _encode_localization_request_frame(jpeg, intrinsics)
    )
    assert len(observations) == 1
    obs: LocalizeObservation = observations[0]
    assert obs.jpeg == jpeg
    assert obs.intrinsics.fx == 100.0
    assert obs.capture_ts == pytest.approx(1.0)
