from __future__ import annotations

import numpy as np
import pytest

from dimos.ar.localization.odom_map_transform import (
    OdomMapTransform,
    OdomMapTransformConfig,
    compose_odom_from_map,
)
from dimos.ar.localization.types import LocalizedPose
from dimos.msgs.geometry_msgs.Pose import Pose
from dimos.msgs.geometry_msgs.Quaternion import Quaternion
from dimos.msgs.geometry_msgs.Transform import Transform
from dimos.msgs.geometry_msgs.Vector3 import Vector3


def _relocalization_transform(*, frame_id: str = "odom") -> Transform:
    return Transform(
        translation=Vector3(5.0, 0.0, 0.0),
        rotation=Quaternion(0.0, 0.0, 0.0, 1.0),
        frame_id=frame_id,
        child_frame_id="map",
        ts=42.0,
    )


def test_compose_odom_from_map_multiplies_transform_and_client() -> None:
    T_odom_map = np.eye(4)
    T_odom_map[0, 3] = 10.0
    T_map_client = np.eye(4)
    T_map_client[1, 3] = 2.0

    composed = compose_odom_from_map(T_odom_map, T_map_client)

    assert composed == pytest.approx(T_odom_map @ T_map_client)


def test_update_from_vps_stores_inverse_of_map_odom_pose() -> None:
    odom_map_transform = OdomMapTransform()
    localization = LocalizedPose(
        pose=Pose(4.0, 2.0, 0.0, 0.0, 0.0, 0.0, 1.0),
        frame_id="map",
        confidence=0.9,
    )

    assert odom_map_transform.update_from_vps(localization, ts_server=100.0, travel_m=0.0) is True
    sample = odom_map_transform.vps_sample()

    assert sample is not None
    assert sample.confidence == pytest.approx(0.9)
    assert sample.ts_server == pytest.approx(100.0)
    assert sample.T_odom_map[0, 3] == pytest.approx(-4.0)
    assert sample.T_odom_map[1, 3] == pytest.approx(-2.0)


def test_update_from_vps_rejects_low_confidence() -> None:
    odom_map_transform = OdomMapTransform()
    localization = LocalizedPose(
        pose=Pose(1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0),
        frame_id="map",
        confidence=0.4,
    )

    assert odom_map_transform.update_from_vps(localization, ts_server=100.0, travel_m=0.0) is False
    assert odom_map_transform.vps_sample() is None


def test_update_from_relocalization_accepts_odom_parent() -> None:
    odom_map_transform = OdomMapTransform()

    assert (
        odom_map_transform.update_from_relocalization(
            _relocalization_transform(), ts_server=100.0
        )
        is True
    )
    sample = odom_map_transform.relocalization_sample()

    assert sample is not None
    assert sample.confidence is None
    assert sample.ts_server == pytest.approx(100.0)
    assert sample.T_odom_map[0, 3] == pytest.approx(5.0)
    assert odom_map_transform.vps_sample() is None


def test_update_from_relocalization_rejects_world_parent() -> None:
    odom_map_transform = OdomMapTransform()

    assert (
        odom_map_transform.update_from_relocalization(
            _relocalization_transform(frame_id="world"), ts_server=100.0
        )
        is False
    )
    assert odom_map_transform.relocalization_sample() is None


def test_localization_in_odom_passthrough_for_odom_frame() -> None:
    odom_map_transform = OdomMapTransform()
    localization = LocalizedPose(
        pose=Pose(1.0, 2.0, 3.0, 0.0, 0.0, 0.0, 1.0),
        frame_id="odom",
        confidence=0.8,
    )

    result = odom_map_transform.localization_in_odom(localization)

    assert result == localization


def test_localization_in_odom_composes_map_answer() -> None:
    odom_map_transform = OdomMapTransform()
    odom_map_transform.update_from_vps(
        LocalizedPose(
            pose=Pose(10.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0),
            frame_id="map",
            confidence=0.9,
        ),
        ts_server=100.0,
        travel_m=0.0,
    )

    result = odom_map_transform.localization_in_odom(
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


def test_localization_in_odom_returns_none_without_vps_sample() -> None:
    odom_map_transform = OdomMapTransform()

    result = odom_map_transform.localization_in_odom(
        LocalizedPose(
            pose=Pose(1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0),
            frame_id="map",
            confidence=0.9,
        )
    )

    assert result is None


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("min_vps_confidence", -0.1),
        ("min_vps_confidence", 1.1),
    ],
)
def test_invalid_odom_map_transform_config_is_rejected(field: str, value: float) -> None:
    with pytest.raises(ValueError):
        OdomMapTransformConfig(**{field: value})


def test_vps_anchor_reusable_within_travel() -> None:
    odom_map_transform = OdomMapTransform()
    odom_map_transform.update_from_vps(
        LocalizedPose(
            pose=Pose(4.0, 2.0, 0.0, 0.0, 0.0, 0.0, 1.0),
            frame_id="map",
            confidence=0.9,
        ),
        ts_server=100.0,
        travel_m=2.0,
        map_code="office",
    )
    sample = odom_map_transform.vps_sample()
    assert sample is not None
    assert sample.travel_m == pytest.approx(2.0)
    assert sample.map_code == "office"
    assert odom_map_transform.is_vps_reusable(current_travel_m=3.0) is True


def test_vps_anchor_stale_after_travel() -> None:
    odom_map_transform = OdomMapTransform()
    odom_map_transform.update_from_vps(
        LocalizedPose(
            pose=Pose(1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0),
            frame_id="map",
            confidence=0.9,
        ),
        ts_server=100.0,
        travel_m=1.0,
    )
    assert odom_map_transform.is_vps_reusable(current_travel_m=2.01) is False


def test_localization_in_odom_ignores_relocalization_sample() -> None:
    odom_map_transform = OdomMapTransform()
    odom_map_transform.update_from_relocalization(_relocalization_transform(), ts_server=100.0)

    result = odom_map_transform.localization_in_odom(
        LocalizedPose(
            pose=Pose(1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0),
            frame_id="map",
            confidence=0.9,
        )
    )

    assert result is None
    assert odom_map_transform.is_vps_reusable(current_travel_m=0.0) is False


def test_vps_sample_survives_relocalization_update() -> None:
    odom_map_transform = OdomMapTransform()
    odom_map_transform.update_from_vps(
        LocalizedPose(
            pose=Pose(10.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0),
            frame_id="map",
            confidence=0.9,
        ),
        ts_server=100.0,
        travel_m=0.0,
    )
    vps_before = odom_map_transform.vps_sample()
    assert vps_before is not None

    assert (
        odom_map_transform.update_from_relocalization(_relocalization_transform(), ts_server=200.0)
        is True
    )

    vps_after = odom_map_transform.vps_sample()
    assert vps_after is vps_before
    assert odom_map_transform.is_vps_reusable(current_travel_m=0.5) is True
    result = odom_map_transform.localization_in_odom(
        LocalizedPose(
            pose=Pose(1.0, 2.0, 0.0, 0.0, 0.0, 0.0, 1.0),
            frame_id="map",
            confidence=0.7,
        )
    )
    assert result is not None
    assert result.pose.x == pytest.approx(-9.0)
    assert result.pose.y == pytest.approx(2.0)
    reloc = odom_map_transform.relocalization_sample()
    assert reloc is not None
    assert reloc.ts_server == pytest.approx(200.0)
    assert reloc.T_odom_map[0, 3] == pytest.approx(5.0)
