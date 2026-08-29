from __future__ import annotations

from types import SimpleNamespace

import numpy as np
import pytest

from dimos.ar.localization.pose_buffer import PoseBuffer
from dimos.ar.localization.vps.robot_observation_buffer import (
    RobotObservationBuffer,
    intrinsics_from_camera_info,
    observation_from_robot_frame,
)
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.msgs.sensor_msgs.CameraInfo import CameraInfo


def _camera_info() -> CameraInfo:
    return CameraInfo(
        width=640,
        height=480,
        distortion_model="none",
        D=[],
        K=[600.0, 0.0, 320.0, 0.0, 600.0, 240.0, 0.0, 0.0, 1.0],
    )


def _push_pose(
    buffer: PoseBuffer, *, ts_server: float, position: tuple[float, float, float]
) -> None:
    buffer.push(
        PoseStamped(
            ts=ts_server,
            frame_id="world",
            position=list(position),
            orientation=[0.0, 0.0, 0.0, 1.0],
        ),
        ts_server=ts_server,
    )


def _image(ts: float = 100.0) -> SimpleNamespace:
    return SimpleNamespace(ts=ts, to_jpeg_bytes=lambda: b"jpeg-bytes")


def _buffer() -> tuple[RobotObservationBuffer, PoseBuffer]:
    pose_buffer = PoseBuffer()
    robot_buffer = RobotObservationBuffer(
        pose_buffer=pose_buffer,
        T_base_camera_optical=np.eye(4),
    )
    robot_buffer.set_camera_info(_camera_info())
    return robot_buffer, pose_buffer


def test_push_image_without_camera_extrinsic_is_noop() -> None:
    pose_buffer = PoseBuffer()
    robot_buffer = RobotObservationBuffer(
        pose_buffer=pose_buffer,
        T_base_camera_optical=None,
    )
    robot_buffer.set_camera_info(_camera_info())
    _push_pose(pose_buffer, ts_server=100.0, position=(1.0, 0.0, 0.0))
    robot_buffer.push_image(_image(), ts_server=100.0, speed_mps=0.0, travel_m=0.0)  # type: ignore[arg-type]

    assert robot_buffer.newest() is None


def test_push_image_while_stationary() -> None:
    robot_buffer, pose_buffer = _buffer()
    _push_pose(pose_buffer, ts_server=100.0, position=(1.0, 0.0, 0.0))
    robot_buffer.push_image(_image(), ts_server=100.0, speed_mps=0.0, travel_m=0.0)  # type: ignore[arg-type]

    sample = robot_buffer.newest()
    assert sample is not None
    assert sample.observation.jpeg == b"jpeg-bytes"
    assert sample.travel_m == pytest.approx(0.0)


def test_skips_frames_while_moving() -> None:
    robot_buffer, pose_buffer = _buffer()
    _push_pose(pose_buffer, ts_server=100.0, position=(1.0, 0.0, 0.0))
    robot_buffer.push_image(_image(), ts_server=100.0, speed_mps=0.2, travel_m=0.0)  # type: ignore[arg-type]

    assert robot_buffer.newest() is None


def test_retains_frames_after_movement_starts() -> None:
    robot_buffer, pose_buffer = _buffer()
    _push_pose(pose_buffer, ts_server=100.0, position=(0.0, 0.0, 0.0))
    robot_buffer.push_image(_image(), ts_server=100.0, speed_mps=0.0, travel_m=0.0)  # type: ignore[arg-type]
    robot_buffer.expire(travel_m=0.2)

    sample = robot_buffer.newest()
    assert sample is not None
    assert sample.travel_m == pytest.approx(0.0)


def test_drops_frames_after_travel_threshold() -> None:
    robot_buffer, pose_buffer = _buffer()
    _push_pose(pose_buffer, ts_server=100.0, position=(0.0, 0.0, 0.0))
    robot_buffer.push_image(_image(), ts_server=100.0, speed_mps=0.0, travel_m=0.0)  # type: ignore[arg-type]
    robot_buffer.expire(travel_m=1.01)

    assert robot_buffer.newest() is None


def test_keeps_three_recent_samples() -> None:
    robot_buffer, pose_buffer = _buffer()
    for index in range(5):
        ts = 100.0 + index
        _push_pose(pose_buffer, ts_server=ts, position=(0.0, 0.0, 0.0))
        robot_buffer.push_image(
            _image(ts),  # type: ignore[arg-type]
            ts_server=ts,
            speed_mps=0.0,
            travel_m=float(index) * 0.01,
        )

    newest = robot_buffer.newest()
    assert newest is not None
    assert newest.observation.ts_server == pytest.approx(104.0)
    assert len(robot_buffer._samples) == 3


def test_intrinsics_from_camera_info_maps_equidistant() -> None:
    camera_info = CameraInfo(
        width=1280,
        height=720,
        distortion_model="equidistant",
        D=[-0.07, -0.02, -0.01, 0.01],
        K=[800.0, 0.0, 640.0, 0.0, 800.0, 360.0, 0.0, 0.0, 1.0],
    )

    intrinsics = intrinsics_from_camera_info(camera_info)

    assert intrinsics.width == 1280
    assert intrinsics.height == 720
    assert intrinsics.fx == pytest.approx(800.0)
    assert intrinsics.distortion_model == "equidistant"
    assert intrinsics.distortion == pytest.approx((-0.07, -0.02, -0.01, 0.01))


def test_observation_from_robot_frame_pairs_pose_and_image() -> None:
    buffer = PoseBuffer()
    _push_pose(buffer, ts_server=100.0, position=(1.0, 2.0, 0.0))
    T_base_camera_optical = np.eye(4)
    T_base_camera_optical[0, 3] = 0.3
    image = SimpleNamespace(ts=100.0, to_jpeg_bytes=lambda: b"jpeg-bytes")
    camera_info = CameraInfo(
        width=640,
        height=480,
        distortion_model="none",
        D=[],
        K=[600.0, 0.0, 320.0, 0.0, 600.0, 240.0, 0.0, 0.0, 1.0],
    )

    observation = observation_from_robot_frame(
        image=image,  # type: ignore[arg-type]
        camera_info=camera_info,
        pose_buffer=buffer,
        T_base_camera_optical=T_base_camera_optical,
    )

    assert observation is not None
    assert observation.jpeg == b"jpeg-bytes"
    assert observation.ts_server == pytest.approx(100.0)
    assert observation.camera_pose.x == pytest.approx(1.3)
    assert observation.camera_pose.y == pytest.approx(2.0)


def test_observation_from_robot_frame_requires_pose_buffer_hit() -> None:
    buffer = PoseBuffer()
    image = SimpleNamespace(ts=100.0, to_jpeg_bytes=lambda: b"jpeg-bytes")
    camera_info = CameraInfo(
        width=640,
        height=480,
        distortion_model="none",
        D=[],
        K=[600.0, 0.0, 320.0, 0.0, 600.0, 240.0, 0.0, 0.0, 1.0],
    )

    assert (
        observation_from_robot_frame(
            image=image,  # type: ignore[arg-type]
            camera_info=camera_info,
            pose_buffer=buffer,
            T_base_camera_optical=np.eye(4),
        )
        is None
    )
