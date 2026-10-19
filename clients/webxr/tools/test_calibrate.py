"""Synthetic recovery tests; these are not measured hardware calibration results."""

from copy import deepcopy
from typing import Any

import numpy as np
import pytest
from calibrate import fit, project
from scipy.spatial.transform import Rotation


def dataset() -> tuple[dict[str, Any], np.ndarray]:
    parameters = np.array(
        [700, 710, 638, 478, 0.035, -0.01, -0.025, np.pi, 0.015, -0.01]
    )
    points = [[2.0, y, z] for y in [-0.3, -0.1, 0.1, 0.3] for z in [0.2, 0.4, 0.6, 0.8]]
    observations = []
    for i in range(12):
        angle = i * 0.014
        observation = {
            "id": str(i),
            "corners3d": points,
            "viewerPose": {
                "position": [0.05 * np.sin(i), 0.5 + 0.04 * i, -0.02 * i],
                "orientation": Rotation.from_euler("xyz", [angle, -angle, angle / 2])
                .as_quat()
                .tolist(),
            },
            "expectedOrigin": {"position": [0, 0, 0], "orientation": [0, 0, 0, 1]},
        }
        observation["corners2d"] = project(parameters, observation).tolist()
        observations.append(observation)
    return {
        "id": "quest3",
        "cameraLabel": "Synthetic physical left camera",
        "stream": {
            "width": 1280,
            "height": 960,
            "frameRate": 30,
            "facingMode": "environment",
        },
        "device": {"os": "synthetic", "browser": "synthetic"},
        "training": observations[:8],
        "validation": observations[8:],
    }, parameters


def test_recovers_intrinsics_and_extrinsics_and_validates_independent_views() -> None:
    data, expected = dataset()
    profile = fit(data)
    assert profile["accepted"]
    assert profile["intrinsics"]["fx"] == pytest.approx(expected[0], abs=0.001)
    assert profile["intrinsics"]["fy"] == pytest.approx(expected[1], abs=0.001)
    assert profile["T_viewer_optical"]["position"] == pytest.approx(
        expected[4:7], abs=1e-5
    )
    assert profile["validation"]["maxReprojectionPx"] < 0.001
    assert profile["validation"]["maxOriginErrorM"] < 0.001
    assert profile["validation"]["maxHeadingErrorDeg"] < 0.001


def test_rejects_held_out_pixel_errors_and_reused_frames() -> None:
    data, _ = dataset()
    inaccurate = deepcopy(data)
    inaccurate["validation"][0]["corners2d"][0][0] += 10
    assert not fit(inaccurate)["accepted"]
    data["validation"][0]["id"] = data["training"][0]["id"]
    with pytest.raises(ValueError, match="independent"):
        fit(data)


def test_rejects_repeated_viewpoints_and_nonfinite_data() -> None:
    data, _ = dataset()
    data["training"] = [deepcopy(data["training"][0]) for _ in range(4)]
    with pytest.raises(ValueError, match="distinct"):
        fit(data)
    data, _ = dataset()
    data["validation"][0]["corners2d"][0][0] = float("nan")
    with pytest.raises(ValueError, match="invalid"):
        fit(data)
