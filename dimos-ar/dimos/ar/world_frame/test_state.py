from __future__ import annotations

import math

import numpy as np
import pytest

from dimos.ar.tag_tracking.solve import (
    R_ALIGN,
    TagMount,
)
from dimos.ar.tag_tracking.tracker import RobotAprilTagTracker
from dimos.ar.world_frame.state import ODOM_SCALE_INITIAL, WorldFrameState
from dimos.ar.world_frame.transforms import (
    gravity_level_transform,
    normalize_ground_pose,
    pose_to_matrix,
)


def test_uncommitted_is_identity() -> None:
    state = WorldFrameState()
    assert state.is_committed is False
    pos, quat = state.transform_pose((1.0, 2.0, 0.0), (0.0, 0.0, 0.0, 1.0))
    assert np.allclose(pos, (1.0, 2.0, 0.0))
    assert np.allclose(quat, (0.0, 0.0, 0.0, 1.0))


def test_committed_transforms_lidar_points() -> None:
    state = WorldFrameState()
    # marker at origin, robot odom at (1,0,0) → T_world_odom = T(-1,0,0)
    T_world_marker = pose_to_matrix((0.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0))
    T_odom_robot = pose_to_matrix((1.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0))
    state.commit(
        T_world_marker @ np.linalg.inv(T_odom_robot),
        method="april_tag",
        approximate=False,
    )
    pts = np.array([[0.0, 0.0, 0.0]], dtype=np.float32)
    world = state.transform_points(pts)
    assert np.allclose(world[0], (-1.0, 0.0, 0.0), atol=1e-5)


def test_commit_world_odom() -> None:
    state = WorldFrameState()
    T = np.eye(4, dtype=np.float64)
    T[0, 3] = 5.0
    state.commit(T, method="manual_pose", approximate=False)
    assert state.is_committed is True
    pos, _ = state.transform_pose((0.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0))
    assert np.allclose(pos[0], 5.0, atol=1e-5)


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
    pitch = math.radians(30)
    yaw = math.radians(45)

    c_pitch, s_pitch = math.cos(pitch), math.sin(pitch)
    c_yaw, s_yaw = math.cos(yaw), math.sin(yaw)
    R_pitch = np.array([[1, 0, 0], [0, c_pitch, -s_pitch], [0, s_pitch, c_pitch]], dtype=np.float64)
    R_yaw = np.array([[c_yaw, 0, s_yaw], [0, 1, 0], [-s_yaw, 0, c_yaw]], dtype=np.float64)
    R = R_yaw @ R_pitch

    T = np.eye(4, dtype=np.float64)
    T[:3, :3] = R
    T[:3, 3] = [2.0, 1.5, 3.0]

    T_flat = gravity_level_transform(T)

    up_axis = T_flat[:3, 2]
    expected_up = np.array([0.0, 1.0, 0.0])
    assert np.allclose(up_axis, expected_up, atol=1e-6), (
        f"Expected up axis {expected_up}, got {up_axis}"
    )

    assert np.allclose(T_flat[:3, 3], [2.0, 1.5, 3.0], atol=1e-6)
    assert np.allclose(T_flat[:3, :3] @ T_flat[:3, :3].T, np.eye(3), atol=1e-6)
    assert np.allclose(np.linalg.det(T_flat[:3, :3]), 1.0, atol=1e-6)


def test_commit_creates_planar_floor() -> None:
    """Test that commit produces a floor-flat world frame."""
    state = WorldFrameState()

    pitch = math.radians(15)
    roll = math.radians(10)
    yaw = math.radians(60)

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

    state.commit(T_tilted, method="april_tag", approximate=False)

    odom_up = np.array([0.0, 0.0, 1.0, 0.0], dtype=np.float64)
    T_stored = state._get_T()
    world_up = (T_stored @ odom_up)[:3]

    expected_world_up = np.array([0.0, 1.0, 0.0])
    assert np.allclose(world_up, expected_world_up, atol=1e-5), (
        f"Expected odom +Z to map to world +Y {expected_world_up}, got {world_up}"
    )

    level_odom_pos = (0.0, 0.0, 0.0)
    level_odom_quat = (0.0, 0.0, 0.0, 1.0)
    _world_pos, world_quat = state.transform_pose(level_odom_pos, level_odom_quat)

    world_R = pose_to_matrix((0.0, 0.0, 0.0), world_quat)[:3, :3]
    world_z_axis = world_R[:, 2]

    assert np.allclose(world_z_axis, expected_world_up, atol=1e-5), (
        f"Level odom pose should produce world +Z = world +Y, got {world_z_axis}"
    )


def test_manual_alignment_world_pose_matches_placement() -> None:
    """Regression test for the manual-alignment frame-inconsistency bug."""
    marker_position = (3.0, 0.0, -2.0)
    marker_yaw_rad = math.radians(45.0)

    half_yaw = marker_yaw_rad * 0.5
    norm_orientation = (0.0, math.sin(half_yaw), 0.0, math.cos(half_yaw))

    T_world_base = pose_to_matrix(marker_position, norm_orientation)
    T_world_base[:3, :3] = T_world_base[:3, :3] @ R_ALIGN

    odom_position = (1.0, 0.0, 1.1)
    odom_orientation = (0.0, 0.0, 0.0, 1.0)
    T_odom_base = pose_to_matrix(odom_position, odom_orientation)

    T_world_odom = T_world_base @ np.linalg.inv(T_odom_base)

    state = WorldFrameState()
    state.commit(T_world_odom, method="manual_pose", approximate=False)
    state.set_odom_anchor_xy(odom_position[0], odom_position[1])

    world_pos, _ = state.transform_pose(odom_position, odom_orientation)

    assert np.allclose(world_pos, marker_position, atol=1e-3), (
        f"Manual world-frame commit position {world_pos} does not match "
        f"marker placement {marker_position} — R_ALIGN basis change missing?"
    )


def test_rotate_vector_applies_rotation_only() -> None:
    state = WorldFrameState()
    yaw = math.radians(90.0)
    half = yaw * 0.5
    T = pose_to_matrix((5.0, 0.0, 0.0), (0.0, math.sin(half), 0.0, math.cos(half)))
    state.commit(T, method="manual_pose", approximate=False)

    rotated = state.rotate_vector((1.0, 0.0, 0.0))
    assert np.allclose(rotated[0], 0.0, atol=1e-5)
    assert np.allclose(rotated[2], -1.0, atol=1e-5)


def test_odom_scale_default_is_identity_behavior() -> None:
    state = WorldFrameState()
    T = np.eye(4, dtype=np.float64)
    T[0, 3] = 2.0
    T[2, 3] = -1.0
    state.commit(T, method="manual_pose", approximate=False)
    assert state.odom_scale == pytest.approx(ODOM_SCALE_INITIAL)

    pos_before = (1.0, 0.5, 0.2)
    ori = (0.0, 0.0, 0.0, 1.0)
    world_pos, world_ori = state.transform_pose(pos_before, ori)
    odom_back, ori_back = state.inverse_transform_pose(world_pos, world_ori)
    assert np.allclose(odom_back, pos_before, atol=1e-9)
    assert np.allclose(ori_back, ori, atol=1e-9)

    pts = np.array([[1.0, 0.0, 0.0]], dtype=np.float32)
    assert np.allclose(
        state.transform_points(pts)[0],
        (2.0 + ODOM_SCALE_INITIAL, 0.0, -1.0),
        atol=1e-5,
    )


def test_odom_scale_round_trip_at_116() -> None:
    state = WorldFrameState()
    state.commit(np.eye(4, dtype=np.float64), method="manual_pose", approximate=False)
    state.set_odom_scale(1.16)

    pos = (1.0, 0.5, 0.2)
    ori = (0.0, 0.0, 0.0, 1.0)
    world_pos, world_ori = state.transform_pose(pos, ori)
    odom_back, ori_back = state.inverse_transform_pose(world_pos, world_ori)
    assert np.allclose(odom_back, pos, atol=1e-9)
    assert np.allclose(ori_back, ori, atol=1e-9)

    world_point = state.transform_pose((0.3, 0.4, 0.0), ori)[0]
    odom_point = state.inverse_transform_point(world_point)
    assert np.allclose(odom_point, (0.3, 0.4, 0.0), atol=1e-9)


def test_odom_scale_inverse_transform_nav_goal() -> None:
    state = WorldFrameState()
    state.commit(np.eye(4, dtype=np.float64), method="manual_pose", approximate=False)
    state.set_odom_scale(1.16)

    odom_goal = state.inverse_transform_point((2.0, 0.0, 0.0))
    assert odom_goal[0] == pytest.approx(2.0 / 1.16, abs=1e-9)
    assert odom_goal[1] == pytest.approx(0.0, abs=1e-9)


def test_odom_scale_transform_points_scales_displacement() -> None:
    state = WorldFrameState()
    state.commit(np.eye(4, dtype=np.float64), method="manual_pose", approximate=False)
    state.set_odom_scale(1.16)

    pts = np.array([[1.0, 0.0, 0.0]], dtype=np.float32)
    world = state.transform_points(pts)
    assert world[0, 0] == pytest.approx(1.16, abs=1e-5)


def test_set_odom_scale_hard_rails_and_deadband() -> None:
    state = WorldFrameState()

    assert state.set_odom_scale(1.4) is True
    assert state.odom_scale == pytest.approx(1.4)

    assert state.set_odom_scale(1.16) is True
    assert state.odom_scale == pytest.approx(1.16)
    assert state.set_odom_scale(1.16 + 5e-7) is False
    assert state.odom_scale == pytest.approx(1.16)
    assert state.set_odom_scale(2.1) is False
    assert state.odom_scale == pytest.approx(1.16)


def test_commit_and_clear_reset_odom_scale_and_fire_on_change() -> None:
    state = WorldFrameState()
    calls: list[int] = []
    state.set_on_change(lambda: calls.append(1))

    T = np.eye(4, dtype=np.float64)
    state.commit(T, method="manual_pose", approximate=False)
    state.set_odom_scale(1.16)
    state.set_odom_anchor_xy(5.0, 2.0)
    calls.clear()

    state.commit(T, method="manual_pose", approximate=False)
    assert state.odom_scale == pytest.approx(ODOM_SCALE_INITIAL)
    assert state.odom_anchor_xy == (0.0, 0.0)
    assert len(calls) == 1

    state.set_odom_scale(1.12)
    state.set_odom_anchor_xy(3.0, 1.0)
    calls.clear()
    state.clear()
    assert state.odom_scale == pytest.approx(1.0)
    assert state.odom_anchor_xy == (0.0, 0.0)
    assert len(calls) == 1


def test_commit_accepts_explicit_odom_scale() -> None:
    state = WorldFrameState()
    state.commit(
        np.eye(4, dtype=np.float64),
        method="april_tag",
        approximate=False,
        odom_scale=1.24,
    )

    assert state.odom_scale == pytest.approx(1.24)


def test_odom_scale_anchor_zero_jump_at_registration() -> None:
    """Changing odom_scale must not move the registration odom pose in world."""
    state = WorldFrameState()
    odom_reg = (5.0, 0.0, 0.0)
    world_reg = (1.0, 0.0, -2.0)
    ori = (0.0, 0.0, 0.0, 1.0)
    T_world_odom = pose_to_matrix(world_reg, ori) @ np.linalg.inv(
        pose_to_matrix(odom_reg, ori)
    )
    state.commit(T_world_odom, method="april_tag", approximate=False)
    state.set_odom_anchor_xy(odom_reg[0], odom_reg[1])

    world_before, _ = state.transform_pose(odom_reg, ori)
    assert np.allclose(world_before, world_reg, atol=1e-9)

    state.set_odom_scale(1.16)
    world_after, _ = state.transform_pose(odom_reg, ori)
    assert np.allclose(world_after, world_reg, atol=1e-9)


def test_odom_scale_anchor_point_invariant_and_scales_displacement() -> None:
    state = WorldFrameState()
    state.commit(np.eye(4, dtype=np.float64), method="manual_pose", approximate=False)
    state.set_odom_anchor_xy(5.0, 0.0)
    state.set_odom_scale(1.16)

    anchor_world, _ = state.transform_pose((5.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0))
    state.set_odom_scale(1.25)
    anchor_world_rescaled, _ = state.transform_pose((5.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0))
    assert np.allclose(anchor_world, anchor_world_rescaled, atol=1e-9)

    displaced_world, _ = state.transform_pose((6.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0))
    assert displaced_world[0] == pytest.approx(5.0 + 1.25 * 1.0, abs=1e-5)


def test_odom_scale_inverse_transform_nav_goal_with_anchor() -> None:
    state = WorldFrameState()
    state.commit(np.eye(4, dtype=np.float64), method="manual_pose", approximate=False)
    state.set_odom_anchor_xy(5.0, 0.0)
    state.set_odom_scale(1.16)

    odom_goal = state.inverse_transform_point((6.16, 0.0, 0.0))
    assert odom_goal[0] == pytest.approx(6.0, abs=1e-9)
    assert odom_goal[1] == pytest.approx(0.0, abs=1e-9)
