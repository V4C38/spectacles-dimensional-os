"""Pin Go2 tag mount quaternion composition convention."""

from __future__ import annotations

from scipy.spatial.transform import Rotation

from dimos.ar.robot_profile.go2 import _GO2_TAG_PITCH_DEG, _GO2_TAG_QUAT, _GO2_TAG_YAW_DEG


def test_go2_tag_quat_matches_scipy_composition_order() -> None:
    expected = (
        Rotation.from_euler("y", _GO2_TAG_PITCH_DEG, degrees=True)
        * Rotation.from_euler("z", _GO2_TAG_YAW_DEG, degrees=True)
    ).as_quat()

    assert _GO2_TAG_QUAT == tuple(float(v) for v in expected)
