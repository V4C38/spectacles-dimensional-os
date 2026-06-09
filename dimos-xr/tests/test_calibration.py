from __future__ import annotations

import math

import numpy as np

from dimos_xr.alignment import (
    DEFAULT_GO2_FRONT_CAMERA_INFO,
    DEFAULT_GO2_FRONT_CAMERA_INFO_SOURCE,
    AprilTagAligner,
    RobotMarkerDetection,
    build_camera_info,
)
from dimos_xr.bridge_module import (
    ALIGNMENT_CLUSTER_MIN_SAMPLES,
    AlignmentCandidate,
    XRBridge,
    score_alignment_cluster,
)
from dimos_xr.transforms import (
    Calibration,
    OdomSample,
    gravity_level_transform,
    normalize_ground_pose,
    pose_to_matrix,
)


def test_unregistered_is_identity() -> None:
    cal = Calibration()
    assert cal.is_registered is False
    pos, quat = cal.transform_pose((1.0, 2.0, 0.0), (0.0, 0.0, 0.0, 1.0))
    assert np.allclose(pos, (1.0, 2.0, 0.0))
    assert np.allclose(quat, (0.0, 0.0, 0.0, 1.0))


def test_registered_transforms_lidar_points() -> None:
    cal = Calibration()
    cal.register_marker_pose(
        (0.0, 0.0, 0.0),
        (0.0, 0.0, 0.0, 1.0),
        OdomSample(position=(1.0, 0.0, 0.0), orientation=(0.0, 0.0, 0.0, 1.0)),
    )
    pts = np.array([[0.0, 0.0, 0.0]], dtype=np.float32)
    world = cal.transform_points(pts)
    assert np.allclose(world[0], (-1.0, 0.0, 0.0), atol=1e-5)


def test_register_from_alignment() -> None:
    cal = Calibration()
    T = np.eye(4, dtype=np.float64)
    T[0, 3] = 5.0
    cal.register_from_alignment(T)
    assert cal.is_registered is True
    pos, _ = cal.transform_pose((0.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0))
    assert np.allclose(pos[0], 5.0, atol=1e-5)


def test_apriltag_alignment_recovers_world_from_odom() -> None:
    aligner = AprilTagAligner(
        camera_position=(0.0, 0.0, 0.0),
        camera_orientation=(0.0, 0.0, 0.0, 1.0),
    )
    T_camera_marker = np.eye(4, dtype=np.float64)
    T_camera_marker[0, 3] = 1.0
    with aligner._lock:
        aligner._latest_detection = RobotMarkerDetection(
            detect_ts=10.0,
            T_camera_marker=T_camera_marker,
            reprojection_error_px=1.0,
        )

    result = aligner.try_align(
        marker_position=(3.0, 0.0, 0.0),
        marker_orientation=(0.0, 0.0, 0.0, 1.0),
        odom=OdomSample(
            position=(0.0, 0.0, 0.0),
            orientation=(0.0, 0.0, 0.0, 1.0),
        ),
        received_ts=10.0,
    )

    assert result is not None
    assert np.allclose(result.T_world_odom[:3, 3], (2.0, 0.0, 0.0), atol=1e-5)


def test_apriltag_alignment_rejects_stale_marker_pair() -> None:
    aligner = AprilTagAligner(timestamp_tolerance_s=0.5)
    with aligner._lock:
        aligner._latest_detection = RobotMarkerDetection(
            detect_ts=10.0,
            T_camera_marker=np.eye(4, dtype=np.float64),
            reprojection_error_px=1.0,
        )

    result = aligner.try_align(
        marker_position=(0.0, 0.0, 0.0),
        marker_orientation=(0.0, 0.0, 0.0, 1.0),
        odom=OdomSample(
            position=(0.0, 0.0, 0.0),
            orientation=(0.0, 0.0, 0.0, 1.0),
        ),
        received_ts=11.0,
    )

    assert result is None


def test_apriltag_alignment_preserves_raw_marker_orientation_until_commit() -> None:
    aligner = AprilTagAligner(
        camera_position=(0.0, 0.0, 0.0),
        camera_orientation=(0.0, 0.0, 0.0, 1.0),
    )
    with aligner._lock:
        aligner._latest_detection = RobotMarkerDetection(
            detect_ts=10.0,
            T_camera_marker=np.eye(4, dtype=np.float64),
            reprojection_error_px=1.0,
        )

    marker_position = (3.0, 0.0, 0.0)
    marker_orientation = (0.2, 0.5, 0.1, 0.8)
    result = aligner.try_align(
        marker_position=marker_position,
        marker_orientation=marker_orientation,
        odom=OdomSample(
            position=(0.0, 0.0, 0.0),
            orientation=(0.0, 0.0, 0.0, 1.0),
        ),
        received_ts=10.0,
    )

    assert result is not None
    expected = pose_to_matrix(marker_position, marker_orientation)
    assert np.allclose(result.T_world_odom, expected, atol=1e-5)


def test_bridge_retries_alignment_with_current_time(monkeypatch) -> None:
    bridge = object.__new__(XRBridge)
    bridge._alignment_mode = "marker"
    bridge._last_align_marker = object()
    bridge._last_align_marker_mono = 10.0
    bridge._aligner = type("AlignerStub", (), {"robot_marker_detected": True})()
    bridge._spectacles_marker_detected = lambda: True
    bridge._get_latest_odom = lambda: OdomSample(
        position=(0.0, 0.0, 0.0),
        orientation=(0.0, 0.0, 0.0, 1.0),
    )

    captured: dict[str, float | object] = {}

    def capture_candidate(msg, odom, *, received_ts=None):
        captured["msg"] = msg
        captured["received_ts"] = received_ts
        captured["odom"] = odom
        return None

    bridge._process_alignment_candidate = capture_candidate
    monkeypatch.setattr("dimos_xr.bridge_module.time.monotonic", lambda: 10.35)

    bridge._try_align_from_last_marker()

    assert captured["msg"] is bridge._last_align_marker
    assert captured["received_ts"] == 10.35


def test_normalize_ground_pose_removes_pitch_and_roll() -> None:
    input_quat = (0.2, 0.5, 0.1, 0.8)
    position, quat = normalize_ground_pose(
        (1.0, 0.0, 2.0),
        input_quat,
    )
    input_forward = pose_to_matrix((0.0, 0.0, 0.0), input_quat)[:3, 0]
    expected_planar = np.array([input_forward[0], input_forward[2]], dtype=np.float64)
    expected_planar /= np.linalg.norm(expected_planar)
    output_forward = pose_to_matrix((0.0, 0.0, 0.0), quat)[:3, 0]

    assert np.allclose(position, (1.0, 0.0, 2.0))
    assert np.allclose(quat[0], 0.0, atol=1e-6)
    assert np.allclose(quat[2], 0.0, atol=1e-6)
    assert np.allclose(output_forward[1], 0.0, atol=1e-6)
    assert np.allclose(
        np.array([output_forward[0], output_forward[2]], dtype=np.float64),
        expected_planar,
        atol=1e-6,
    )


def test_apriltag_prefers_calibrated_go2_profile_over_placeholder_live_camera_info() -> None:
    aligner = AprilTagAligner()
    aligner.set_camera_info(
        build_camera_info(
            width=1280,
            height=720,
            k=(
                819.553492,
                0.0,
                625.284099,
                0.0,
                820.646595,
                336.808987,
                0.0,
                0.0,
                1.0,
            ),
            d=(),
        )
    )

    resolved = aligner.resolve_camera_info(1280, 720)

    assert resolved is not None
    info, source = resolved
    assert source == DEFAULT_GO2_FRONT_CAMERA_INFO_SOURCE
    assert np.allclose(info.K, DEFAULT_GO2_FRONT_CAMERA_INFO.K)
    assert np.allclose(info.D, DEFAULT_GO2_FRONT_CAMERA_INFO.D)


def test_apriltag_keeps_matching_live_camera_info_when_it_is_already_calibrated() -> None:
    aligner = AprilTagAligner()
    aligner.set_camera_info(DEFAULT_GO2_FRONT_CAMERA_INFO)

    resolved = aligner.resolve_camera_info(1280, 720)

    assert resolved is not None
    info, source = resolved
    assert source == "live"
    assert np.allclose(info.K, DEFAULT_GO2_FRONT_CAMERA_INFO.K)
    assert np.allclose(info.D, DEFAULT_GO2_FRONT_CAMERA_INFO.D)


def test_apriltag_rejects_camera_info_resolution_mismatch_without_matching_fallback() -> None:
    aligner = AprilTagAligner(fallback_camera_info=None)
    aligner.set_camera_info(DEFAULT_GO2_FRONT_CAMERA_INFO)

    resolved = aligner.resolve_camera_info(640, 480)

    assert resolved is None


def _yaw_quaternion(yaw_rad: float) -> tuple[float, float, float, float]:
    half_yaw = yaw_rad * 0.5
    return (0.0, math.sin(half_yaw), 0.0, math.cos(half_yaw))


def _alignment_candidate(
    x: float,
    z: float,
    yaw_deg: float,
    *,
    sample_quality: float = 0.9,
) -> AlignmentCandidate:
    T_world_odom = pose_to_matrix((x, 0.0, z), _yaw_quaternion(math.radians(yaw_deg)))
    return AlignmentCandidate(
        T_world_odom=T_world_odom,
        quality=sample_quality,
        sample_quality=sample_quality,
        method="marker",
        approximate=False,
    )


def test_alignment_cluster_score_promotes_stable_candidate_groups() -> None:
    recent = [
        _alignment_candidate(1.00, 2.00, 10.0),
        _alignment_candidate(1.02, 2.01, 11.0),
        _alignment_candidate(0.99, 1.98, 9.5),
        _alignment_candidate(1.01, 2.00, 10.5),
        _alignment_candidate(1.50, 2.60, 40.0),
    ]

    confidence, cluster_size, mean_translation_error, mean_yaw_error = score_alignment_cluster(
        recent[0], recent
    )

    assert cluster_size == 4
    assert cluster_size < ALIGNMENT_CLUSTER_MIN_SAMPLES
    assert confidence > 0.5
    assert mean_translation_error < 0.03
    assert mean_yaw_error < math.radians(2.0)


def test_alignment_cluster_score_penalizes_drifted_outlier_candidates() -> None:
    stable_recent = [
        _alignment_candidate(1.00, 2.00, 10.0),
        _alignment_candidate(1.02, 2.01, 11.0),
        _alignment_candidate(0.99, 1.98, 9.5),
        _alignment_candidate(1.01, 2.00, 10.5),
    ]
    drifted = _alignment_candidate(1.45, 2.55, 42.0)

    confidence, cluster_size, _, _ = score_alignment_cluster(
        drifted, stable_recent + [drifted]
    )

    assert cluster_size == 1
    assert confidence < 0.3


def test_gravity_level_transform_flattens_floor() -> None:
    """Test that gravity_level_transform ensures odom +Z maps to world +Y."""
    # Create a tilted transform (pitch 30 degrees about X, yaw 45 degrees about Y)
    pitch = math.radians(30)
    yaw = math.radians(45)
    
    # Rotation matrix: R = R_y(yaw) @ R_x(pitch)
    c_pitch, s_pitch = math.cos(pitch), math.sin(pitch)
    c_yaw, s_yaw = math.cos(yaw), math.sin(yaw)
    R_pitch = np.array([
        [1, 0, 0],
        [0, c_pitch, -s_pitch],
        [0, s_pitch, c_pitch]
    ], dtype=np.float64)
    R_yaw = np.array([
        [c_yaw, 0, s_yaw],
        [0, 1, 0],
        [-s_yaw, 0, c_yaw]
    ], dtype=np.float64)
    R = R_yaw @ R_pitch
    
    T = np.eye(4, dtype=np.float64)
    T[:3, :3] = R
    T[:3, 3] = [2.0, 1.5, 3.0]  # arbitrary translation
    
    T_flat = gravity_level_transform(T)
    
    # Check that odom +Z (third column) maps to world +Y
    up_axis = T_flat[:3, 2]
    expected_up = np.array([0.0, 1.0, 0.0])
    assert np.allclose(up_axis, expected_up, atol=1e-6), \
        f"Expected up axis {expected_up}, got {up_axis}"
    
    # Check that translation is preserved
    assert np.allclose(T_flat[:3, 3], [2.0, 1.5, 3.0], atol=1e-6)
    
    # Check that rotation matrix is orthonormal
    assert np.allclose(T_flat[:3, :3] @ T_flat[:3, :3].T, np.eye(3), atol=1e-6)
    assert np.allclose(np.linalg.det(T_flat[:3, :3]), 1.0, atol=1e-6)


def test_calibration_commit_creates_planar_floor() -> None:
    """Test that register_from_alignment produces a floor-flat calibration."""
    cal = Calibration()
    
    # Create a tilted T_world_odom (simulating PnP + odometry tilt)
    pitch = math.radians(15)  # 15 degrees pitch
    roll = math.radians(10)   # 10 degrees roll
    yaw = math.radians(60)    # 60 degrees yaw
    
    # Build rotation with pitch, roll, yaw
    c_pitch, s_pitch = math.cos(pitch), math.sin(pitch)
    c_roll, s_roll = math.cos(roll), math.sin(roll)
    c_yaw, s_yaw = math.cos(yaw), math.sin(yaw)
    
    R_pitch = np.array([[1, 0, 0], [0, c_pitch, -s_pitch], [0, s_pitch, c_pitch]])
    R_roll = np.array([[c_roll, -s_roll, 0], [s_roll, c_roll, 0], [0, 0, 1]])
    R_yaw = np.array([[c_yaw, -s_yaw, 0], [s_yaw, c_yaw, 0], [0, 0, 1]])
    R = R_yaw @ R_roll @ R_pitch
    
    T_tilted = np.eye(4, dtype=np.float64)
    T_tilted[:3, :3] = R
    T_tilted[:3, 3] = [1.0, 0.5, 2.0]
    
    cal.register_from_alignment(T_tilted)
    
    # After commit, odom +Z should map to world +Y
    odom_up = np.array([0.0, 0.0, 1.0, 0.0], dtype=np.float64)  # odom +Z in homogeneous coords
    T_stored = cal._get_T()
    world_up = (T_stored @ odom_up)[:3]
    
    expected_world_up = np.array([0.0, 1.0, 0.0])
    assert np.allclose(world_up, expected_world_up, atol=1e-5), \
        f"Expected odom +Z to map to world +Y {expected_world_up}, got {world_up}"
    
    # Transform a level odom pose -> should produce level world pose
    level_odom_pos = (0.0, 0.0, 0.0)
    level_odom_quat = (0.0, 0.0, 0.0, 1.0)  # identity rotation
    world_pos, world_quat = cal.transform_pose(level_odom_pos, level_odom_quat)
    
    # World pose Y component should be exactly the calibration's world +Y (up) component
    world_R = pose_to_matrix((0.0, 0.0, 0.0), world_quat)[:3, :3]
    world_z_axis = world_R[:, 2]  # third column
    
    assert np.allclose(world_z_axis, expected_world_up, atol=1e-5), \
        f"Level odom pose should produce world +Z = world +Y, got {world_z_axis}"
