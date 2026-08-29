from __future__ import annotations

import numpy as np
import pytest

from dimos.ar.localization.types import Intrinsics
from dimos.ar.localization.undistort import undistort_to_pinhole

_GO2_INTRINSICS = Intrinsics(
    fx=797.4756164864929,
    fy=796.4872112769983,
    cx=643.5352167821186,
    cy=349.2783605343087,
    width=1280,
    height=720,
    distortion_model="equidistant",
    distortion=(
        -0.07309428880537933,
        -0.02341140740909078,
        -0.0069305931780026956,
        0.009238684474464793,
    ),
)


def test_undistort_none_passthrough() -> None:
    intrinsics = Intrinsics(
        fx=500.0,
        fy=500.0,
        cx=640.0,
        cy=360.0,
        width=1280,
        height=720,
        distortion_model="none",
        distortion=(),
    )
    image = np.zeros((720, 1280), dtype=np.uint8)

    result = undistort_to_pinhole(image, intrinsics)

    assert result.image is image
    assert result.intrinsics is intrinsics


def test_undistort_rejects_image_size_mismatch() -> None:
    intrinsics = Intrinsics(
        fx=500.0,
        fy=500.0,
        cx=640.0,
        cy=360.0,
        width=1280,
        height=720,
        distortion_model="none",
        distortion=(),
    )
    image = np.zeros((480, 640), dtype=np.uint8)

    with pytest.raises(ValueError, match="image shape must match intrinsics"):
        undistort_to_pinhole(image, intrinsics)


def test_undistort_equidistant_returns_pinhole_intrinsics() -> None:
    image = np.tile(np.linspace(0, 255, 1280, dtype=np.uint8), (720, 1))

    result = undistort_to_pinhole(image, _GO2_INTRINSICS)

    assert result.image.shape == (720, 1280)
    assert result.image.dtype == np.uint8
    assert result.intrinsics.distortion_model == "none"
    assert result.intrinsics.distortion == ()
    assert result.intrinsics.fx == _GO2_INTRINSICS.fx
    assert result.intrinsics.fy == _GO2_INTRINSICS.fy
    assert result.intrinsics.cx == _GO2_INTRINSICS.cx
    assert result.intrinsics.cy == _GO2_INTRINSICS.cy
    assert not np.array_equal(result.image, image)


def test_undistort_equidistant_requires_four_coefficients() -> None:
    intrinsics = Intrinsics(
        fx=500.0,
        fy=500.0,
        cx=640.0,
        cy=360.0,
        width=64,
        height=48,
        distortion_model="equidistant",
        distortion=(0.1, 0.2),
    )
    image = np.zeros((48, 64), dtype=np.uint8)

    with pytest.raises(ValueError, match="requires at least 4 coefficients"):
        undistort_to_pinhole(image, intrinsics)


def test_undistort_plumb_bob_returns_pinhole_intrinsics() -> None:
    intrinsics = Intrinsics(
        fx=600.0,
        fy=600.0,
        cx=320.0,
        cy=240.0,
        width=640,
        height=480,
        distortion_model="plumb_bob",
        distortion=(-0.2, 0.05, 0.0, 0.0, 0.0),
    )
    image = np.full((480, 640), 128, dtype=np.uint8)

    result = undistort_to_pinhole(image, intrinsics)

    assert result.image.shape == (480, 640)
    assert result.intrinsics.distortion_model == "none"
    assert result.intrinsics.distortion == ()


def test_undistort_plumb_bob_requires_coefficients() -> None:
    intrinsics = Intrinsics(
        fx=600.0,
        fy=600.0,
        cx=320.0,
        cy=240.0,
        width=64,
        height=48,
        distortion_model="plumb_bob",
        distortion=(),
    )
    image = np.zeros((48, 64), dtype=np.uint8)

    with pytest.raises(ValueError, match="requires at least one coefficient"):
        undistort_to_pinhole(image, intrinsics)
