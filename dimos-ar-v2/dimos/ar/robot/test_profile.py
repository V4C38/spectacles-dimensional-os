from __future__ import annotations

import math

import numpy as np
import pytest

from dimos.ar.robot.profile import FiducialMarkerMount


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
