from __future__ import annotations

from types import SimpleNamespace

import numpy as np
import pytest

from dimos.ar.localization.odom_map import (
    OdomMap,
    OdomMapConfig,
    compose_odom_from_map,
    intrinsics_from_camera_info,
    observation_from_robot_frame,
)
from dimos.ar.localization.pose_buffer import PoseBuffer
from dimos.ar.localization.types import LocalizedPose
from dimos.msgs.geometry_msgs.Pose import Pose
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.msgs.geometry_msgs.Quaternion import Quaternion
from dimos.msgs.geometry_msgs.Transform import Transform
from dimos.msgs.geometry_msgs.Vector3 import Vector3
from dimos.msgs.sensor_msgs.CameraInfo import CameraInfo


def _push_pose(
    buffer: PoseBuffer,
    *,
    ts_server: float,
    position: tuple[float, float, float] = (0.0, 0.0, 0.0),
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


def test_compose_odom_from_map_multiplies_transform_and_client() -> None:
    T_odom_map = np.eye(4)
    T_odom_map[0, 3] = 10.0
    T_map_client = np.eye(4)
    T_map_client[1, 3] = 2.0

    composed = compose_odom_from_map(T_odom_map, T_map_client)

    assert composed == pytest.approx(T_odom_map @ T_map_client)


def test_update_from_vps_stores_inverse_of_map_odom_pose() -> None:
    odom_map = OdomMap()
    localization = LocalizedPose(
        pose=Pose(4.0, 2.0, 0.0, 0.0, 0.0, 0.0, 1.0),
        frame_id="map",
        confidence=0.9,
    )

    assert odom_map.update_from_vps(localization, ts_server=100.0) is True
    sample = odom_map.current()

    assert sample is not None
    assert sample.source == "vps"
    assert sample.confidence == pytest.approx(0.9)
    assert sample.ts_server == pytest.approx(100.0)
    T_odom_map = odom_map.T_odom_map()
    assert T_odom_map is not None
    assert T_odom_map[0, 3] == pytest.approx(-4.0)
    assert T_odom_map[1, 3] == pytest.approx(-2.0)


def test_update_from_vps_rejects_low_confidence() -> None:
    odom_map = OdomMap()
    localization = LocalizedPose(
        pose=Pose(1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0),
        frame_id="map",
        confidence=0.4,
    )

    assert odom_map.update_from_vps(localization, ts_server=100.0) is False
    assert odom_map.current() is None


def test_update_from_relocalization_accepts_world_parent() -> None:
    odom_map = OdomMap()
    transform = Transform(
        translation=Vector3(5.0, 0.0, 0.0),
        rotation=Quaternion(0.0, 0.0, 0.0, 1.0),
        frame_id="world",
        child_frame_id="map",
        ts=42.0,
    )

    assert odom_map.update_from_relocalization(transform) is True
    sample = odom_map.current()

    assert sample is not None
    assert sample.source == "relocalization"
    assert sample.ts_server == pytest.approx(42.0)
    T_odom_map = odom_map.T_odom_map()
    assert T_odom_map is not None
    assert T_odom_map[0, 3] == pytest.approx(5.0)


def test_localization_in_odom_passthrough_for_odom_frame() -> None:
    odom_map = OdomMap()
    localization = LocalizedPose(
        pose=Pose(1.0, 2.0, 3.0, 0.0, 0.0, 0.0, 1.0),
        frame_id="odom",
        confidence=0.8,
    )

    result = odom_map.localization_in_odom(localization)

    assert result == localization


def test_localization_in_odom_composes_map_answer() -> None:
    odom_map = OdomMap()
    odom_map.update_from_vps(
        LocalizedPose(
            pose=Pose(10.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0),
            frame_id="map",
            confidence=0.9,
        ),
        ts_server=100.0,
    )

    result = odom_map.localization_in_odom(
        LocalizedPose(
            pose=Pose(1.0, 2.0, 0.0, 0.0, 0.0, 0.0, 1.0),
            frame_id="map",
            confidence=0.7,
        )
    )

    assert result is not None
    assert result.frame_id == "odom"
    assert result.pose.x == pytest.approx(-9.0)
    assert result.pose.y == pytest.approx(2.0)
    assert result.confidence == pytest.approx(0.7)


def test_localization_in_odom_returns_none_without_sample() -> None:
    odom_map = OdomMap()

    result = odom_map.localization_in_odom(
        LocalizedPose(
            pose=Pose(1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0),
            frame_id="map",
            confidence=0.9,
        )
    )

    assert result is None


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
    T_base_camopt = np.eye(4)
    T_base_camopt[0, 3] = 0.3
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
        T_base_camopt=T_base_camopt,
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
            T_base_camopt=np.eye(4),
        )
        is None
    )


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("min_vps_confidence", -0.1),
        ("min_vps_confidence", 1.1),
    ],
)
def test_invalid_odom_map_config_is_rejected(field: str, value: float) -> None:
    with pytest.raises(ValueError):
        OdomMapConfig(**{field: value})
