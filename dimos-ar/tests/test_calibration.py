from __future__ import annotations

import numpy as np

from dimos_ar.alignment import AprilTagAligner, RobotMarkerDetection
from dimos_ar.protocol import RegisterMessage
from dimos_ar.transforms import Calibration, OdomSample, normalize_ground_pose


def test_unregistered_is_identity() -> None:
    cal = Calibration()
    assert cal.is_registered is False
    pos, quat = cal.transform_pose((1.0, 2.0, 0.0), (0.0, 0.0, 0.0, 1.0))
    assert np.allclose(pos, (1.0, 2.0, 0.0))
    assert np.allclose(quat, (0.0, 0.0, 0.0, 1.0))


def test_registered_transforms_lidar_points() -> None:
    cal = Calibration()
    cal.register(
        RegisterMessage(
            ts=1.0,
            robot_id="go2",
            marker_id=0,
            marker_position=(0.0, 0.0, 0.0),
            marker_orientation=(0.0, 0.0, 0.0, 1.0),
        ),
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


def test_normalize_ground_pose_removes_pitch_and_roll() -> None:
    position, quat = normalize_ground_pose(
        (1.0, 0.0, 2.0),
        (0.2, 0.5, 0.1, 0.8),
    )
    assert np.allclose(position, (1.0, 0.0, 2.0))
    assert np.allclose(quat[0], 0.0, atol=1e-6)
    assert np.allclose(quat[2], 0.0, atol=1e-6)
