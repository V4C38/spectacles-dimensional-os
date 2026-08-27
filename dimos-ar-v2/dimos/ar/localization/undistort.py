from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

import cv2
import numpy as np

from dimos.ar.localization.types import Intrinsics
from dimos.perception.fiducial.marker_pose import is_fisheye_model

if TYPE_CHECKING:
    from numpy.typing import NDArray


@dataclass(frozen=True)
class UndistortedFrame:
    image: NDArray[np.uint8]
    intrinsics: Intrinsics


def _camera_matrix(intrinsics: Intrinsics) -> NDArray[np.float64]:
    return np.array(
        [
            [intrinsics.fx, 0.0, intrinsics.cx],
            [0.0, intrinsics.fy, intrinsics.cy],
            [0.0, 0.0, 1.0],
        ],
        dtype=np.float64,
    )


def _pinhole_intrinsics(intrinsics: Intrinsics) -> Intrinsics:
    return Intrinsics(
        fx=intrinsics.fx,
        fy=intrinsics.fy,
        cx=intrinsics.cx,
        cy=intrinsics.cy,
        width=intrinsics.width,
        height=intrinsics.height,
        distortion_model="none",
        distortion=(),
    )


def undistort_to_pinhole(
    image: NDArray[np.uint8],
    intrinsics: Intrinsics,
) -> UndistortedFrame:
    """Rectify a distorted frame to pinhole pixels and matching intrinsics."""
    if image.ndim not in (2, 3):
        raise ValueError(f"image must be 2D or 3D, got shape {image.shape}")

    height, width = image.shape[:2]
    if height != intrinsics.height or width != intrinsics.width:
        raise ValueError(
            "image shape must match intrinsics width and height: "
            f"got {width}x{height}, expected {intrinsics.width}x{intrinsics.height}"
        )

    if intrinsics.distortion_model == "none":
        return UndistortedFrame(image=image, intrinsics=intrinsics)

    camera_matrix = _camera_matrix(intrinsics)
    pinhole = _pinhole_intrinsics(intrinsics)

    if is_fisheye_model(intrinsics.distortion_model):
        d_flat = np.asarray(intrinsics.distortion, dtype=np.float64).reshape(-1)
        if d_flat.size < 4:
            raise ValueError(
                "equidistant distortion requires at least 4 coefficients; "
                f"got {d_flat.size}"
            )
        dist_coeffs = d_flat[:4].reshape(4, 1)
        rectified = cv2.fisheye.undistortImage(
            image,
            camera_matrix,
            dist_coeffs,
            Knew=camera_matrix,
        )
        return UndistortedFrame(
            image=np.asarray(rectified, dtype=np.uint8),
            intrinsics=pinhole,
        )

    if intrinsics.distortion_model != "plumb_bob":
        raise ValueError(f"unsupported distortion_model: {intrinsics.distortion_model!r}")

    if not intrinsics.distortion:
        raise ValueError("plumb_bob distortion requires at least one coefficient")

    dist_coeffs = np.asarray(intrinsics.distortion, dtype=np.float64).reshape(-1, 1)
    rectified = cv2.undistort(image, camera_matrix, dist_coeffs, None, camera_matrix)
    return UndistortedFrame(
        image=np.asarray(rectified, dtype=np.uint8),
        intrinsics=pinhole,
    )
