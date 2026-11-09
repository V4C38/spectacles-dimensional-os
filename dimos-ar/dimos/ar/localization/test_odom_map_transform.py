from __future__ import annotations

import pytest

from dimos.ar.localization.odom_map_transform import (
    OdomMapTransform,
    OdomMapTransformConfig,
)
from dimos.ar.localization.types import LocalizedPose
from dimos.msgs.geometry_msgs.Pose import Pose


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
