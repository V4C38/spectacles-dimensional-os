from __future__ import annotations

from dataclasses import replace
import math
from typing import cast

import numpy as np
import pytest

from dimos.ar.robot.capabilities import CapabilityName
from dimos.ar.robot.profiles import FiducialMarkerMount, RobotName, RobotProfile, get_profile
from dimos.ar.robot.profiles.unitree_go2 import UNITREE_GO2_PROFILE


def test_fiducial_marker_mount_builds_base_transform() -> None:
    mount = FiducialMarkerMount(
        marker_id=7,
        size_m=0.1,
        position=(1.0, 2.0, 3.0),
        orientation=(0.0, 0.0, 0.0, 1.0),
    )

    assert mount.T_base_marker[:3, 3] == pytest.approx([1.0, 2.0, 3.0])
    np.testing.assert_allclose(mount.T_base_marker[:3, :3], np.eye(3))


@pytest.mark.parametrize(
    "kwargs",
    [
        {"marker_id": -1},
        {"size_m": 0.0},
        {"size_m": math.inf},
        {"position": (math.nan, 0.0, 0.0)},
        {"orientation": (0.0, 0.0, 0.0, 0.0)},
        {"orientation": (0.0, 0.0, math.inf, 1.0)},
    ],
)
def test_invalid_fiducial_marker_mount_is_rejected(kwargs: dict[str, object]) -> None:
    values: dict[str, object] = {
        "marker_id": 0,
        "size_m": 0.1,
        "position": (0.0, 0.0, 0.0),
        "orientation": (0.0, 0.0, 0.0, 1.0),
    }
    values.update(kwargs)

    with pytest.raises(ValueError):
        FiducialMarkerMount(**values)  # type: ignore[arg-type]


def _profile(**overrides: object) -> RobotProfile:
    values: dict[str, object] = {
        "display_name": "Test",
        "body_bounds_m": (1.0, 1.0, 1.0),
        "footprint_m": (1.0, 1.0),
        "base_height_m": 0.3,
        "odom_scale_correction_factor": 1.0,
        "fiducial_dictionary": None,
        "fiducial_marker_mounts": (),
        "T_base_camera_optical": None,
        "supported_capabilities": frozenset(),
    }
    values.update(overrides)
    return RobotProfile(**values)  # type: ignore[arg-type]


def test_robot_profile_rejects_non_positive_scale_factor() -> None:
    with pytest.raises(ValueError, match="odom_scale_correction_factor"):
        _profile(odom_scale_correction_factor=0.0)
    with pytest.raises(ValueError, match="odom_scale_correction_factor"):
        _profile(odom_scale_correction_factor=-1.25)


def test_robot_profile_rejects_mounts_without_dictionary() -> None:
    mount = FiducialMarkerMount(
        marker_id=0,
        size_m=0.1,
        position=(0.0, 0.0, 0.0),
        orientation=(0.0, 0.0, 0.0, 1.0),
    )
    with pytest.raises(ValueError, match="fiducial_dictionary"):
        _profile(fiducial_marker_mounts=(mount,))


def test_robot_profile_rejects_dictionary_without_mounts() -> None:
    with pytest.raises(ValueError, match="fiducial_marker_mounts"):
        _profile(fiducial_dictionary="DICT_APRILTAG_36h11")


def test_robot_profile_rejects_empty_display_name() -> None:
    with pytest.raises(ValueError, match="display_name"):
        _profile(display_name="  ")


def test_robot_profile_rejects_invalid_geometry() -> None:
    with pytest.raises(ValueError, match="body_bounds_m"):
        _profile(body_bounds_m=(0.0, 1.0, 1.0))
    with pytest.raises(ValueError, match="footprint_m"):
        _profile(footprint_m=(math.nan, 1.0))
    with pytest.raises(ValueError, match="base_height_m"):
        _profile(base_height_m=-0.1)


def test_robot_profile_rejects_navigation_without_estop() -> None:
    with pytest.raises(ValueError, match="navigation requires estop"):
        _profile(supported_capabilities=frozenset({CapabilityName.NAVIGATION}))


def test_robot_profile_rejects_localization_in_supported() -> None:
    with pytest.raises(ValueError, match="localization"):
        _profile(supported_capabilities=frozenset({CapabilityName.LOCALIZATION}))


def test_robot_profile_rejects_duplicate_marker_ids() -> None:
    mount = FiducialMarkerMount(
        marker_id=0,
        size_m=0.1,
        position=(0.0, 0.0, 0.0),
        orientation=(0.0, 0.0, 0.0, 1.0),
    )
    with pytest.raises(ValueError, match="unique"):
        _profile(
            fiducial_dictionary="DICT_APRILTAG_36h11",
            fiducial_marker_mounts=(mount, replace(mount, position=(0.1, 0.0, 0.0))),
        )


def test_robot_profile_copies_camera_transform() -> None:
    matrix = np.eye(4, dtype=np.float64)
    matrix[0, 3] = 0.3
    profile = _profile(T_base_camera_optical=matrix)
    assert profile.T_base_camera_optical is not None
    matrix[0, 3] = 9.0
    assert profile.T_base_camera_optical[0, 3] == pytest.approx(0.3)
    with pytest.raises(ValueError):
        profile.T_base_camera_optical[0, 3] = 1.0


def test_robot_profile_rejects_malformed_camera_transform() -> None:
    with pytest.raises(ValueError, match="4x4"):
        _profile(T_base_camera_optical=np.eye(3))
    skewed = np.eye(4)
    skewed[0, 0] = 2.0
    with pytest.raises(ValueError, match="orthonormal"):
        _profile(T_base_camera_optical=skewed)


def test_get_profile_unitree_go2() -> None:
    assert get_profile(RobotName.UNITREE_GO2) is UNITREE_GO2_PROFILE


def test_get_profile_unknown_name_raises() -> None:
    with pytest.raises(ValueError, match="unknown robot"):
        get_profile(cast("RobotName", "anvil_openyam"))
