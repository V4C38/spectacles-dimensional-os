from __future__ import annotations

import json
import math
import struct
import time

import cv2
import numpy as np
import pytest

from dimos_xr.adapters.go2 import GO2_DEFAULT_TAG_MOUNTS
from dimos_xr.tag_tracker import (
    CAMERA_FRAME_MAGIC,
    DEFAULT_MARKER_ID,
    TagMount,
    TagTracker,
    TagTrackerConfig,
    build_camera_info,
    build_T_world_odom,
    parse_camera_frame,
    solve_yaw_translation_2d,
)
from dimos_xr.transforms import OdomSample
from scripts.generate_marker import generate_tag_raster


def _camera_frame_payload(header: dict, jpeg: bytes) -> bytes:
    header_bytes = json.dumps(header, separators=(",", ":")).encode("utf-8")
    return CAMERA_FRAME_MAGIC + struct.pack("<I", len(header_bytes)) + header_bytes + jpeg


def _synthetic_camera_info(width: int = 800, height: int = 800) -> object:
    return build_camera_info(
        width=width,
        height=height,
        k=(600.0, 0.0, width / 2, 0.0, 600.0, height / 2, 0.0, 0.0, 1.0),
        d=(),
    )


def _encode_marker_jpeg() -> bytes:
    marker = generate_tag_raster(marker_id=DEFAULT_MARKER_ID)
    ok, encoded = cv2.imencode(".jpg", marker)
    assert ok
    return encoded.tobytes()


def test_parse_camera_frame_round_trip() -> None:
    header = {
        "type": "camera_frame",
        "robot_id": "unitree_go2",
        "seq": 7,
        "ts": 12.5,
        "send_ts": 12.55,
        "cam_pos": [1.0, 2.0, 3.0],
        "cam_rot": [0.0, 0.0, 0.0, 1.0],
    }
    jpeg = b"\xff\xd8\xff\xd9"
    parsed_header, parsed_jpeg = parse_camera_frame(_camera_frame_payload(header, jpeg))
    assert parsed_header["seq"] == 7
    assert parsed_jpeg == jpeg


@pytest.mark.parametrize(
    ("payload", "match"),
    [
        (b"BAD!", "too short"),
        (CAMERA_FRAME_MAGIC + struct.pack("<I", 4) + b"{}", "truncated header"),
        (CAMERA_FRAME_MAGIC + struct.pack("<I", 5000) + b"x" * 100, "invalid header_len"),
    ],
)
def test_parse_camera_frame_rejects_invalid_frames(payload: bytes, match: str) -> None:
    with pytest.raises(ValueError, match=match):
        parse_camera_frame(payload)


def test_solve_yaw_translation_2d_identity() -> None:
    u = np.array([[0.0, 0.0], [1.0, 0.0], [0.0, 1.0]], dtype=np.float64)
    v = u.copy()
    yaw, t2 = solve_yaw_translation_2d(u, v)
    assert abs(yaw) < 1e-6
    assert np.allclose(t2, [0.0, 0.0], atol=1e-6)


def test_solve_yaw_translation_2d_recovers_yaw_and_translation() -> None:
    yaw_true = math.radians(30.0)
    t_true = np.array([1.0, -2.0], dtype=np.float64)
    c, s = math.cos(yaw_true), math.sin(yaw_true)
    R2 = np.array([[c, -s], [s, c]], dtype=np.float64)
    u = np.array([[0.0, 0.0], [1.0, 0.0], [0.0, 1.0], [2.0, 1.0]], dtype=np.float64)
    v = (R2 @ u.T).T + t_true
    yaw, t2 = solve_yaw_translation_2d(u, v)
    assert abs(yaw - yaw_true) < 1e-9
    assert np.allclose(t2, t_true, atol=1e-9)


def test_solve_yaw_translation_2d_noisy_recovery() -> None:
    rng = np.random.default_rng(0)
    yaw_true = math.radians(12.0)
    t_true = np.array([0.5, -1.2], dtype=np.float64)
    c, s = math.cos(yaw_true), math.sin(yaw_true)
    R2 = np.array([[c, -s], [s, c]], dtype=np.float64)
    u = rng.normal(size=(20, 2))
    noise = rng.normal(scale=0.02, size=(20, 2))
    v = (R2 @ u.T).T + t_true + noise
    yaw, t2 = solve_yaw_translation_2d(u, v)
    assert abs(yaw - yaw_true) < math.radians(0.5)
    assert np.linalg.norm(t2 - t_true) < 0.03


def test_tag_tracker_accepts_camera_info() -> None:
    tracker = TagTracker([TagMount(tag_id=0)])
    tracker.set_camera_info(_synthetic_camera_info())
    assert tracker.has_camera_info() is True


def test_tag_tracker_detects_generated_marker() -> None:
    tracker = TagTracker(
        [TagMount(tag_id=DEFAULT_MARKER_ID)],
        config=TagTrackerConfig(max_reprojection_error_px=8.0),
    )
    tracker.set_camera_info(_synthetic_camera_info())
    header = {
        "type": "camera_frame",
        "robot_id": "unitree_go2",
        "seq": 1,
        "ts": 10.0,
        "send_ts": 10.1,
        "cam_pos": [0.0, 1.5, 0.0],
        "cam_rot": [0.0, 0.0, 0.0, 1.0],
    }
    odom = OdomSample(position=(0.0, 0.0, 0.0), orientation=(0.0, 0.0, 0.0, 1.0))

    def lookup(_ts: float) -> OdomSample | None:
        return odom

    result = tracker.process_frame(header, _encode_marker_jpeg(), lookup, receive_mono=10.2)
    assert result.tag_detected is True
    assert DEFAULT_MARKER_ID in result.tag_ids
    assert tracker.observation_count() >= 1


def test_tag_tracker_orientation_fallback_when_stationary() -> None:
    mount = GO2_DEFAULT_TAG_MOUNTS[0]
    tracker = TagTracker(
        [mount],
        config=TagTrackerConfig(max_reprojection_error_px=8.0, min_baseline_m=0.30),
    )
    tracker.set_camera_info(_synthetic_camera_info())
    header = {
        "type": "camera_frame",
        "robot_id": "unitree_go2",
        "seq": 1,
        "ts": 10.0,
        "send_ts": 10.05,
        "cam_pos": [1.0, 1.5, -2.0],
        "cam_rot": [0.0, 0.0, 0.0, 1.0],
    }
    odom = OdomSample(position=(0.0, 0.0, 0.0), orientation=(0.0, 0.0, 0.0, 1.0))

    for seq in range(4):
        tracker.process_frame(
            {**header, "seq": seq},
            _encode_marker_jpeg(),
            lambda _ts: odom,
            receive_mono=10.1 + seq * 0.1,
        )

    solve = tracker.current_solve()
    assert solve is not None
    assert solve.method == "tag_orientation"
    assert solve.observation_count >= 1


def test_tag_tracker_rejects_unknown_tag_id() -> None:
    tracker = TagTracker([TagMount(tag_id=99)])
    tracker.set_camera_info(_synthetic_camera_info())
    header = {
        "type": "camera_frame",
        "robot_id": "unitree_go2",
        "seq": 1,
        "ts": 10.0,
        "send_ts": 10.05,
        "cam_pos": [0.0, 1.5, 0.0],
        "cam_rot": [0.0, 0.0, 0.0, 1.0],
    }
    result = tracker.process_frame(
        header,
        _encode_marker_jpeg(),
        lambda _ts: OdomSample(position=(0.0, 0.0, 0.0), orientation=(0.0, 0.0, 0.0, 1.0)),
        receive_mono=10.1,
    )
    assert result.tag_detected is False


def test_tag_tracker_window_ages_out_old_observations() -> None:
    tracker = TagTracker(
        [TagMount(tag_id=DEFAULT_MARKER_ID)],
        config=TagTrackerConfig(
            max_reprojection_error_px=8.0,
            window_max_age_s=0.05,
            window_max_obs=10,
        ),
    )
    tracker.set_camera_info(_synthetic_camera_info())
    header = {
        "type": "camera_frame",
        "robot_id": "unitree_go2",
        "seq": 1,
        "ts": 10.0,
        "send_ts": 10.05,
        "cam_pos": [0.0, 1.5, 0.0],
        "cam_rot": [0.0, 0.0, 0.0, 1.0],
    }
    tracker.process_frame(
        header,
        _encode_marker_jpeg(),
        lambda _ts: OdomSample(position=(0.0, 0.0, 0.0), orientation=(0.0, 0.0, 0.0, 1.0)),
        receive_mono=10.0,
    )
    assert tracker.observation_count() >= 1
    tracker.process_frame(
        {**header, "seq": 2},
        _encode_marker_jpeg(),
        lambda _ts: OdomSample(position=(0.0, 0.0, 0.0), orientation=(0.0, 0.0, 0.0, 1.0)),
        receive_mono=10.2,
    )
    assert tracker.observation_count() == 1


def test_build_T_world_odom_maps_odom_origin() -> None:
    T = build_T_world_odom(math.radians(90.0), (1.0, 2.0, 3.0))
    origin = T @ np.array([0.0, 0.0, 0.0, 1.0])
    assert np.allclose(origin[:3], [1.0, 2.0, 3.0], atol=1e-6)


def test_tag_tracker_without_camera_info_returns_empty() -> None:
    tracker = TagTracker([TagMount(tag_id=0)])
    header = {
        "type": "camera_frame",
        "robot_id": "unitree_go2",
        "seq": 1,
        "ts": time.monotonic(),
        "send_ts": time.monotonic(),
        "cam_pos": [0.0, 0.0, 0.0],
        "cam_rot": [0.0, 0.0, 0.0, 1.0],
    }
    result = tracker.process_frame(
        header,
        _encode_marker_jpeg(),
        lambda _ts: OdomSample(position=(0.0, 0.0, 0.0), orientation=(0.0, 0.0, 0.0, 1.0)),
    )
    assert result.tag_detected is False
    assert result.observations_added == 0
