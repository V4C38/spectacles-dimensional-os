from __future__ import annotations

import numpy as np

from dimos_ar.protocol import RegisterMessage
from dimos_ar.transforms import (
    Calibration,
    OdomSample,
    matrix_to_pose,
    pose_to_matrix,
)


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


def test_calibration_identity_before_register() -> None:
    cal = Calibration()
    pts = np.array([[1.0, 0.0, 0.0]], dtype=np.float32)
    out = cal.transform_points(pts)
    assert np.allclose(out, pts)


def test_calibration_register_and_transform() -> None:
    cal = Calibration()
    reg = RegisterMessage(
        ts=1.0,
        robot_id="go2",
        marker_id=0,
        marker_position=(2.0, 0.0, 0.0),
        marker_orientation=(0.0, 0.0, 0.0, 1.0),
    )
    odom = OdomSample(position=(0.0, 0.0, 0.0), orientation=(0.0, 0.0, 0.0, 1.0))
    cal.register(reg, odom)
    assert cal.is_registered
    pos, _ = cal.transform_pose((0.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0))
    assert np.allclose(pos, (2.0, 0.0, 0.0), atol=1e-5)


def test_inverse_transform_point() -> None:
    cal = Calibration()
    reg = RegisterMessage(
        ts=1.0,
        robot_id="go2",
        marker_id=0,
        marker_position=(1.0, 0.0, 0.0),
        marker_orientation=(0.0, 0.0, 0.0, 1.0),
    )
    odom = OdomSample(position=(0.0, 0.0, 0.0), orientation=(0.0, 0.0, 0.0, 1.0))
    cal.register(reg, odom)
    odom_pt = cal.inverse_transform_point((1.0, 0.0, 0.0))
    assert np.allclose(odom_pt, (0.0, 0.0, 0.0), atol=1e-5)


def test_inverse_transform_pose() -> None:
    cal = Calibration()
    reg = RegisterMessage(
        ts=1.0,
        robot_id="go2",
        marker_id=0,
        marker_position=(0.0, 0.0, 0.0),
        marker_orientation=(0.0, 0.0, 0.0, 1.0),
    )
    odom = OdomSample(position=(1.0, 0.0, 0.0), orientation=(0.0, 0.0, 0.0, 1.0))
    cal.register(reg, odom)
    pos, quat = cal.inverse_transform_pose((0.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0))
    assert np.allclose(pos, (1.0, 0.0, 0.0), atol=1e-5)
    assert np.allclose(quat, (0.0, 0.0, 0.0, 1.0), atol=1e-5)
