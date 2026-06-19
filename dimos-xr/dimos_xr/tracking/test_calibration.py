from __future__ import annotations

import math

import numpy as np

from dimos_xr.tracking.robot_tag_tracker import (
    R_ALIGN,
    TagMount,
    RobotAprilTagTracker,
    build_T_world_odom,
    solve_yaw_translation_2d,
)
from dimos_xr.tracking.transforms import (
    Calibration,
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
    # marker at origin, robot odom at (1,0,0) → T_world_odom = T(-1,0,0)
    T_world_marker = pose_to_matrix((0.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0))
    T_odom_robot = pose_to_matrix((1.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0))
    cal.register_from_alignment(T_world_marker @ np.linalg.inv(T_odom_robot))
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


def test_solve_yaw_translation_2d_recovers_planar_shift() -> None:
    u = np.array([[0.0, 0.0], [1.0, 0.0]], dtype=np.float64)
    v = np.array([[2.0, 3.0], [3.0, 3.0]], dtype=np.float64)
    yaw, t2 = solve_yaw_translation_2d(u, v)
    T = build_T_world_odom(yaw, (float(t2[0]), 0.0, -float(t2[1])))
    world = (T @ np.array([0.0, 0.0, 0.0, 1.0]))[:3]
    assert np.allclose(world[0], 2.0, atol=1e-5)
    assert np.allclose(world[2], -3.0, atol=1e-5)


def test_tag_tracker_starts_inactive_without_camera_info() -> None:
    tracker = RobotAprilTagTracker([TagMount(tag_id=0)])
    assert tracker.active is False
    assert tracker.has_camera_info() is False


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


def test_gravity_level_transform_flattens_floor() -> None:
    """Test that gravity_level_transform ensures odom +Z maps to world +Y."""
    # Create a tilted transform (pitch 30 degrees about X, yaw 45 degrees about Y)
    pitch = math.radians(30)
    yaw = math.radians(45)

    # Rotation matrix: R = R_y(yaw) @ R_x(pitch)
    c_pitch, s_pitch = math.cos(pitch), math.sin(pitch)
    c_yaw, s_yaw = math.cos(yaw), math.sin(yaw)
    R_pitch = np.array([[1, 0, 0], [0, c_pitch, -s_pitch], [0, s_pitch, c_pitch]], dtype=np.float64)
    R_yaw = np.array([[c_yaw, 0, s_yaw], [0, 1, 0], [-s_yaw, 0, c_yaw]], dtype=np.float64)
    R = R_yaw @ R_pitch

    T = np.eye(4, dtype=np.float64)
    T[:3, :3] = R
    T[:3, 3] = [2.0, 1.5, 3.0]  # arbitrary translation

    T_flat = gravity_level_transform(T)

    # Check that odom +Z (third column) maps to world +Y
    up_axis = T_flat[:3, 2]
    expected_up = np.array([0.0, 1.0, 0.0])
    assert np.allclose(up_axis, expected_up, atol=1e-6), (
        f"Expected up axis {expected_up}, got {up_axis}"
    )

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
    roll = math.radians(10)  # 10 degrees roll
    yaw = math.radians(60)  # 60 degrees yaw

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
    assert np.allclose(world_up, expected_world_up, atol=1e-5), (
        f"Expected odom +Z to map to world +Y {expected_world_up}, got {world_up}"
    )

    # Transform a level odom pose -> should produce level world pose
    level_odom_pos = (0.0, 0.0, 0.0)
    level_odom_quat = (0.0, 0.0, 0.0, 1.0)  # identity rotation
    _world_pos, world_quat = cal.transform_pose(level_odom_pos, level_odom_quat)

    # World pose Y component should be exactly the calibration's world +Y (up) component
    world_R = pose_to_matrix((0.0, 0.0, 0.0), world_quat)[:3, :3]
    world_z_axis = world_R[:, 2]  # third column

    assert np.allclose(world_z_axis, expected_world_up, atol=1e-5), (
        f"Level odom pose should produce world +Z = world +Y, got {world_z_axis}"
    )


def test_manual_alignment_world_pose_matches_placement() -> None:
    """Regression test for the manual-alignment frame-inconsistency bug.

    Before the fix, _process_manual_candidate built T_world_base using only
    R_y(yaw) (from normalize_ground_pose) without the odom(Z-up)->world(Y-up)
    basis change R_ALIGN.  gravity_level_transform then re-leveled the rotation
    while preserving the (wrong) translation, producing an offset of ~|t_ob|.

    This test simulates the same arithmetic with |t_ob| ~ 1.5 m and asserts that
    the committed world position matches the marker placement to within 1 mm.
    """
    marker_position = (3.0, 0.0, -2.0)   # world-frame placement (Y-up)
    marker_yaw_rad = math.radians(45.0)

    # Replicate normalize_ground_pose output: pure yaw about world +Y
    half_yaw = marker_yaw_rad * 0.5
    norm_orientation = (0.0, math.sin(half_yaw), 0.0, math.cos(half_yaw))

    # Build T_world_base WITH the fix (R_ALIGN applied)
    T_world_base = pose_to_matrix(marker_position, norm_orientation)
    T_world_base[:3, :3] = T_world_base[:3, :3] @ R_ALIGN

    # Robot odom pose with non-trivial translation (~1.5 m from odom origin)
    odom_position = (1.0, 0.0, 1.1)
    odom_orientation = (0.0, 0.0, 0.0, 1.0)
    T_odom_base = pose_to_matrix(odom_position, odom_orientation)

    T_world_odom = T_world_base @ np.linalg.inv(T_odom_base)

    cal = Calibration()
    cal.register_from_alignment(T_world_odom)

    # Transform the commit-time odom pose back through the calibration.
    # The returned world position must equal the marker placement.
    world_pos, _ = cal.transform_pose(odom_position, odom_orientation)

    assert np.allclose(world_pos, marker_position, atol=1e-3), (
        f"Manual calibration world position {world_pos} does not match "
        f"marker placement {marker_position} — R_ALIGN basis change missing?"
    )
