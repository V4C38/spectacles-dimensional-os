from __future__ import annotations

import numpy as np

from dimos.ar.world_frame.state import WorldFrameState
from dimos.ar.world_frame.transforms import matrix_to_pose, pose_to_matrix


def _assert_pose_matrix_roundtrip(
    position: tuple[float, float, float],
    orientation: tuple[float, float, float, float],
) -> None:
    T = pose_to_matrix(position, orientation)
    pos2, quat2 = matrix_to_pose(T)
    T2 = pose_to_matrix(pos2, quat2)
    assert np.allclose(T, T2, atol=1e-4)


def test_pose_matrix_roundtrip() -> None:
    _assert_pose_matrix_roundtrip((1.0, 2.0, 0.5), (0.0, 0.0, 0.70710678, 0.70710678))


def test_pose_to_matrix_normalizes_non_unit_quaternion() -> None:
    T = pose_to_matrix((0.0, 0.0, 0.0), (0.2, 0.4, 0.6, 0.8))
    rotation = T[:3, :3]
    assert np.allclose(rotation @ rotation.T, np.eye(3), atol=1e-5)
    _, quat = matrix_to_pose(T)
    assert all(np.isfinite(value) for value in quat)


def test_world_frame_identity_before_commit() -> None:
    state = WorldFrameState()
    pts = np.array([[1.0, 0.0, 0.0]], dtype=np.float32)
    out = state.transform_points(pts)
    assert np.allclose(out, pts)


def test_world_frame_commit_and_transform() -> None:
    state = WorldFrameState()
    state.commit(
        pose_to_matrix((2.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0)),
        method="manual_pose",
        approximate=False,
    )
    assert state.is_committed
    pos, _ = state.transform_pose((0.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0))
    assert np.allclose(pos, (2.0, 0.0, 0.0), atol=1e-5)


def test_inverse_transform_point() -> None:
    state = WorldFrameState()
    state.commit(
        pose_to_matrix((1.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0)),
        method="manual_pose",
        approximate=False,
    )
    state.set_odom_scale(1.0)
    odom_pt = state.inverse_transform_point((1.0, 0.0, 0.0))
    assert np.allclose(odom_pt, (0.0, 0.0, 0.0), atol=1e-5)


def test_inverse_transform_pose() -> None:
    state = WorldFrameState()
    T_world_marker = pose_to_matrix((0.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0))
    T_odom_robot = pose_to_matrix((1.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0))
    state.commit(
        T_world_marker @ np.linalg.inv(T_odom_robot),
        method="april_tag",
        approximate=False,
    )
    state.set_odom_anchor_xy(1.0, 0.0)
    pos, quat = state.inverse_transform_pose((0.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0))
    assert np.allclose(pos, (1.0, 0.0, 0.0), atol=1e-5)
    _, expected_quat = matrix_to_pose(state._get_T_inv())
    assert np.allclose(quat, expected_quat, atol=1e-5)
