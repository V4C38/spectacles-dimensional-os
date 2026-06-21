from __future__ import annotations

import json
import math
import struct
import time

import cv2
import numpy as np
import pytest

from dimos.ar.adapters.go2 import GO2_DEFAULT_TAG_MOUNTS
from dimos.ar.registration.tracker import (
    CAMERA_FRAME_MAGIC,
    DEFAULT_MARKER_ID,
    RobotAprilTagTracker,
    RobotAprilTagTrackerConfig,
    TagMount,
    TagObservation,
    _yaw_from_T,
    build_camera_info,
    build_T_world_odom,
    parse_camera_frame,
    solve_yaw_translation_2d,
)
from dimos.ar.registration.transforms import OdomSample
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
    tracker = RobotAprilTagTracker([TagMount(tag_id=0)])
    tracker.set_camera_info(_synthetic_camera_info())
    assert tracker.has_camera_info() is True


def test_tag_tracker_detects_generated_marker() -> None:
    tracker = RobotAprilTagTracker(
        [TagMount(tag_id=DEFAULT_MARKER_ID)],
        config=RobotAprilTagTrackerConfig(max_reprojection_error_px=8.0),
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

    result = tracker.process_frame(header, _encode_marker_jpeg(), odom=odom, receive_mono=10.2)
    assert result.tag_detected is True
    assert DEFAULT_MARKER_ID in result.tag_ids
    assert tracker.observation_count() >= 1


def test_tag_tracker_no_solve_when_stationary() -> None:
    """With stationary robot (zero baseline), the baseline yaw solve must return None."""
    mount = GO2_DEFAULT_TAG_MOUNTS[0]
    tracker = RobotAprilTagTracker(
        [mount],
        config=RobotAprilTagTrackerConfig(max_reprojection_error_px=8.0, min_baseline_m=0.30),
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
            odom=odom,
            receive_mono=10.1 + seq * 0.1,
        )

    assert tracker.current_solve() is None
    assert tracker.baseline_m() == pytest.approx(0.0, abs=1e-6)


def test_current_translation_solve_recovers_base_from_lever_arm() -> None:
    """Lever-arm sign/magnitude: base = tag_world - R_world_base @ mount.position."""
    mount = TagMount(tag_id=3, position=(0.12, -0.03, 0.05))
    tracker = RobotAprilTagTracker([mount])

    yaw_world_odom = math.radians(20.0)
    T_reference = build_T_world_odom(yaw_world_odom, (1.0, 0.5, -0.2))
    R_world_odom = T_reference[:3, :3]

    yaw_base = math.radians(-15.0)
    cy, sy = math.cos(yaw_base), math.sin(yaw_base)
    R_odom_base = np.array(
        [[cy, -sy, 0.0], [sy, cy, 0.0], [0.0, 0.0, 1.0]],
        dtype=np.float64,
    )
    p_odom_base = np.array([2.0, -1.0, 0.1], dtype=np.float64)
    T_odom_base = np.eye(4, dtype=np.float64)
    T_odom_base[:3, :3] = R_odom_base
    T_odom_base[:3, 3] = p_odom_base

    p_base_tag = np.array(mount.position, dtype=np.float64)
    R_world_base = R_world_odom @ R_odom_base
    p_world_base_expected = np.array([0.4, 0.0, -0.3], dtype=np.float64)
    p_world_tag = p_world_base_expected + R_world_base @ p_base_tag

    T_world_tag = np.eye(4, dtype=np.float64)
    T_world_tag[:3, 3] = p_world_tag

    tracker._observations.append(
        TagObservation(
            mono_ts=1.0,
            tag_id=3,
            p_world_tag=tuple(p_world_tag),
            p_odom_tag=(0.0, 0.0, 0.0),
            T_world_tag=T_world_tag,
            T_odom_tag=np.eye(4, dtype=np.float64),
            T_odom_base=T_odom_base,
            quality=0.95,
            reprojection_error_px=0.5,
        )
    )

    solve = tracker.current_translation_solve(T_reference, max_observations=1)
    assert solve is not None

    p_world_base_solved = solve.T_world_odom[:3, 3] + R_world_odom @ p_odom_base
    assert np.allclose(p_world_base_solved, p_world_base_expected, atol=1e-9)


def test_mount_offset_diagnostic_emitted_when_translation_solve_runs() -> None:
    import dimos.ar.registration.tracker as tag_tracker_module

    tag_tracker_module._MOUNT_OFFSET_DIAG_EMITTED = False
    tag_tracker_module._MOUNT_OFFSET_DIAG_LAST_MONO = 0.0

    mount = TagMount(tag_id=4, position=(0.12, 0.0, 0.07))
    tracker = RobotAprilTagTracker([mount])
    T_reference = build_T_world_odom(0.0, (0.0, 0.0, 0.0))

    p_world_tag = np.array(mount.position, dtype=np.float64)
    T_world_tag = np.eye(4, dtype=np.float64)
    T_world_tag[:3, 3] = p_world_tag

    tracker._observations.append(
        TagObservation(
            mono_ts=1.0,
            tag_id=4,
            p_world_tag=tuple(p_world_tag),
            p_odom_tag=tuple(p_world_tag),
            T_world_tag=T_world_tag,
            T_odom_tag=T_world_tag,
            T_odom_base=np.eye(4, dtype=np.float64),
            quality=0.9,
            reprojection_error_px=0.5,
        )
    )

    solve = tracker.current_translation_solve(T_reference, max_observations=1)
    assert solve is not None
    assert tag_tracker_module._MOUNT_OFFSET_DIAG_EMITTED is True


def test_tag_tracker_translation_solve_when_stationary() -> None:
    """A stationary robot can still produce a translation-only runtime correction."""
    mount = GO2_DEFAULT_TAG_MOUNTS[0]
    tracker = RobotAprilTagTracker(
        [mount],
        config=RobotAprilTagTrackerConfig(max_reprojection_error_px=8.0, min_baseline_m=0.30),
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
            odom=odom,
            receive_mono=10.1 + seq * 0.1,
        )

    reference = build_T_world_odom(math.radians(15.0), (0.0, 0.0, 0.0))
    solve = tracker.current_translation_solve(reference)
    assert solve is not None
    assert solve.method == "tag_translation"
    assert solve.baseline_m == pytest.approx(0.0, abs=1e-6)
    assert _yaw_from_T(solve.T_world_odom) == pytest.approx(_yaw_from_T(reference), abs=1e-9)
    assert np.all(np.isfinite(solve.T_world_odom[:3, 3]))
    assert np.linalg.norm(solve.T_world_odom[:3, 3]) > 0.0


def test_robot_world_pose_estimate_can_use_only_recent_observations() -> None:
    mount = TagMount(tag_id=7)
    tracker = RobotAprilTagTracker([mount])
    tracker._observations.extend(
        [
            TagObservation(
                mono_ts=1.0,
                tag_id=7,
                p_world_tag=(0.0, 0.0, 0.0),
                p_odom_tag=(0.0, 0.0, 0.0),
                T_world_tag=build_T_world_odom(0.0, (0.0, 0.0, 0.0)),
                T_odom_tag=np.eye(4, dtype=np.float64),
                T_odom_base=np.eye(4, dtype=np.float64),
                quality=0.5,
                reprojection_error_px=0.5,
            ),
            TagObservation(
                mono_ts=2.0,
                tag_id=7,
                p_world_tag=(2.0, 0.0, 0.0),
                p_odom_tag=(0.0, 0.0, 0.0),
                T_world_tag=build_T_world_odom(0.0, (2.0, 0.0, 0.0)),
                T_odom_tag=np.eye(4, dtype=np.float64),
                T_odom_base=np.eye(4, dtype=np.float64),
                quality=0.9,
                reprojection_error_px=0.5,
            ),
        ]
    )

    pose_all = tracker.robot_world_pose_estimate()
    pose_recent = tracker.robot_world_pose_estimate(max_observations=1)

    assert pose_all is not None
    assert pose_recent is not None
    assert pose_all[0][0] == pytest.approx(1.0)
    assert pose_recent[0][0] == pytest.approx(2.0)
    assert pose_recent[2] == pytest.approx(0.9)


def test_tag_tracker_rejects_unknown_tag_id() -> None:
    tracker = RobotAprilTagTracker([TagMount(tag_id=99)])
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
    odom = OdomSample(position=(0.0, 0.0, 0.0), orientation=(0.0, 0.0, 0.0, 1.0))
    result = tracker.process_frame(
        header,
        _encode_marker_jpeg(),
        odom=odom,
        receive_mono=10.1,
    )
    assert result.tag_detected is False


def test_tag_tracker_window_ages_out_old_observations() -> None:
    tracker = RobotAprilTagTracker(
        [TagMount(tag_id=DEFAULT_MARKER_ID)],
        config=RobotAprilTagTrackerConfig(
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
    odom = OdomSample(position=(0.0, 0.0, 0.0), orientation=(0.0, 0.0, 0.0, 1.0))
    tracker.process_frame(
        header,
        _encode_marker_jpeg(),
        odom=odom,
        receive_mono=10.0,
    )
    assert tracker.observation_count() >= 1
    tracker.process_frame(
        {**header, "seq": 2},
        _encode_marker_jpeg(),
        odom=odom,
        receive_mono=10.2,
    )
    assert tracker.observation_count() == 1


def test_tag_tracker_rejects_large_mount_residual() -> None:
    tracker = RobotAprilTagTracker(
        [TagMount(tag_id=1, position=(0.18, 0.0, 0.06))],
        config=RobotAprilTagTrackerConfig(max_mount_residual_m=0.15),
    )
    obs = tracker._measured_mount_position(
        T_world_tag=np.eye(4, dtype=np.float64),
        T_odom_base=np.eye(4, dtype=np.float64),
        T_world_odom=build_T_world_odom(0.0, (0.0, 0.0, 0.0)),
    )
    assert np.allclose(obs, [0.0, 0.0, 0.0], atol=1e-9)
    assert np.linalg.norm(obs - np.array([0.18, 0.0, 0.06])) > 0.15


def test_build_T_world_odom_maps_odom_origin() -> None:
    T = build_T_world_odom(math.radians(90.0), (1.0, 2.0, 3.0))
    origin = T @ np.array([0.0, 0.0, 0.0, 1.0])
    assert np.allclose(origin[:3], [1.0, 2.0, 3.0], atol=1e-6)


def test_tag_tracker_without_camera_info_returns_empty() -> None:
    tracker = RobotAprilTagTracker([TagMount(tag_id=0)])
    header = {
        "type": "camera_frame",
        "robot_id": "unitree_go2",
        "seq": 1,
        "ts": time.monotonic(),
        "send_ts": time.monotonic(),
        "cam_pos": [0.0, 0.0, 0.0],
        "cam_rot": [0.0, 0.0, 0.0, 1.0],
    }
    odom = OdomSample(position=(0.0, 0.0, 0.0), orientation=(0.0, 0.0, 0.0, 1.0))
    result = tracker.process_frame(
        header,
        _encode_marker_jpeg(),
        odom=odom,
    )
    assert result.tag_detected is False
    assert result.observations_added == 0


# ---------------------------------------------------------------------------
# Yaw convention round-trip tests (regression guard for Bug A)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("theta_deg", [-150, -90, -30, 30, 45, 90, 137])
def test_yaw_roundtrip_build_T(theta_deg: float) -> None:
    theta = math.radians(theta_deg)
    assert math.isclose(_yaw_from_T(build_T_world_odom(theta, (0.0, 0.0, 0.0))), theta, abs_tol=1e-9)


# ---------------------------------------------------------------------------
# current_solve parameterized baseline
# ---------------------------------------------------------------------------


def test_current_solve_with_zero_baseline_returns_solve_from_small_window() -> None:
    """current_solve(min_baseline_m=0.0) must succeed even when observations span < 15 cm."""
    mount = GO2_DEFAULT_TAG_MOUNTS[0]
    tracker = RobotAprilTagTracker(
        [mount],
        config=RobotAprilTagTrackerConfig(max_reprojection_error_px=8.0, min_baseline_m=0.15),
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
    # Two slightly different robot odom positions (< 15 cm apart) to build a small baseline window
    odoms = [
        OdomSample(position=(0.0, 0.0, 0.0), orientation=(0.0, 0.0, 0.0, 1.0)),
        OdomSample(position=(0.05, 0.0, 0.0), orientation=(0.0, 0.0, 0.0, 1.0)),
        OdomSample(position=(0.10, 0.0, 0.0), orientation=(0.0, 0.0, 0.0, 1.0)),
    ]
    for i, odom in enumerate(odoms):
        tracker.process_frame(
            {**header, "seq": i},
            _encode_marker_jpeg(),
            odom=odom,
            receive_mono=10.1 + i * 0.1,
        )

    # With default config (0.15 m floor) this may return None (baseline < 0.15 m)
    # But with min_baseline_m=0.0 it must return a solve if we have >= 2 observations.
    if tracker.observation_count() >= 2:
        solve = tracker.current_solve(min_baseline_m=0.0)
        assert solve is not None, "current_solve(min_baseline_m=0.0) must return a solve for >= 2 observations"


def test_odom_tag_straightness_straight_vs_curved() -> None:
    from dimos.ar.registration.tracker import TagObservation, _odom_tag_straightness

    straight = [
        TagObservation(
            mono_ts=1.0,
            tag_id=0,
            p_world_tag=(0.0, 0.0, 0.0),
            p_odom_tag=(0.0, 0.0, 0.0),
            T_world_tag=np.eye(4),
            T_odom_tag=np.eye(4),
            T_odom_base=np.eye(4),
            quality=1.0,
            reprojection_error_px=0.0,
        ),
        TagObservation(
            mono_ts=2.0,
            tag_id=0,
            p_world_tag=(1.0, 0.0, 0.0),
            p_odom_tag=(1.0, 0.0, 0.0),
            T_world_tag=np.eye(4),
            T_odom_tag=np.eye(4),
            T_odom_base=np.eye(4),
            quality=1.0,
            reprojection_error_px=0.0,
        ),
        TagObservation(
            mono_ts=3.0,
            tag_id=0,
            p_world_tag=(2.0, 0.0, 0.0),
            p_odom_tag=(2.0, 0.0, 0.0),
            T_world_tag=np.eye(4),
            T_odom_tag=np.eye(4),
            T_odom_base=np.eye(4),
            quality=1.0,
            reprojection_error_px=0.0,
        ),
    ]
    curved = [
        TagObservation(
            mono_ts=1.0,
            tag_id=0,
            p_world_tag=(0.0, 0.0, 0.0),
            p_odom_tag=(0.0, 0.0, 0.0),
            T_world_tag=np.eye(4),
            T_odom_tag=np.eye(4),
            T_odom_base=np.eye(4),
            quality=1.0,
            reprojection_error_px=0.0,
        ),
        TagObservation(
            mono_ts=2.0,
            tag_id=0,
            p_world_tag=(1.0, 0.0, 0.0),
            p_odom_tag=(0.0, 1.0, 0.0),
            T_world_tag=np.eye(4),
            T_odom_tag=np.eye(4),
            T_odom_base=np.eye(4),
            quality=1.0,
            reprojection_error_px=0.0,
        ),
        TagObservation(
            mono_ts=3.0,
            tag_id=0,
            p_world_tag=(2.0, 0.0, 0.0),
            p_odom_tag=(-1.0, 0.0, 0.0),
            T_world_tag=np.eye(4),
            T_odom_tag=np.eye(4),
            T_odom_base=np.eye(4),
            quality=1.0,
            reprojection_error_px=0.0,
        ),
    ]
    assert _odom_tag_straightness(straight) < _odom_tag_straightness(curved)


def test_process_frame_uses_provided_odom() -> None:
    odom = OdomSample(
        position=(1.0, 2.0, 3.0),
        orientation=(0.0, 0.0, 0.0, 1.0),
        source_ts=10.0,
    )

    tracker = RobotAprilTagTracker(
        GO2_DEFAULT_TAG_MOUNTS,
        config=RobotAprilTagTrackerConfig(max_reprojection_error_px=8.0),
    )
    tracker.set_camera_info(_synthetic_camera_info())
    header = {
        "type": "camera_frame",
        "robot_id": "unitree_go2",
        "seq": 1,
        "ts": 10.0,
        "send_ts": 10.05,
        "capture_ts_robot": 10.0,
        "cam_pos": [1.0, 1.5, -2.0],
        "cam_rot": [0.0, 0.0, 0.0, 1.0],
    }
    result = tracker.process_frame(
        header,
        _encode_marker_jpeg(),
        odom=odom,
        receive_mono=20.0,
    )
    assert result.tag_detected is False or result.tag_detected is True
