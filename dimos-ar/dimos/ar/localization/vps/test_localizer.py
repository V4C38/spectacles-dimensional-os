from __future__ import annotations

from dataclasses import dataclass
import math

import numpy as np
import pytest

from dimos.ar.localization.types import Intrinsics, Observation
from dimos.ar.localization.undistort import UndistortedFrame
import dimos.ar.localization.vps.localizer as vps_module
from dimos.ar.localization.vps.localizer import (
    VpsLocalizer,
    VpsLocalizerConfig,
    VpsQueryResult,
    compose_map_client,
)
from dimos.msgs.geometry_msgs.Pose import Pose


def _intrinsics(*, width: int = 1280, height: int = 720) -> Intrinsics:
    return Intrinsics(
        fx=800.0,
        fy=800.0,
        cx=width / 2.0,
        cy=height / 2.0,
        width=width,
        height=height,
        distortion_model="none",
        distortion=(),
    )


def _jpeg(*, width: int = 1280, height: int = 720) -> bytes:
    ok, encoded = vps_module.cv2.imencode(
        ".jpg",
        np.zeros((height, width, 3), dtype=np.uint8),
    )
    assert ok
    return encoded.tobytes()


def _observation(
    *,
    ts_server: float = 100.0,
    image_width: int = 1280,
    image_height: int = 720,
    intrinsics: Intrinsics | None = None,
) -> Observation:
    return Observation(
        jpeg=_jpeg(width=image_width, height=image_height),
        intrinsics=intrinsics or _intrinsics(width=image_width, height=image_height),
        camera_pose=Pose(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0),
        ts_server=ts_server,
    )


@dataclass
class _FakeVpsClient:
    results: list[VpsQueryResult | None]
    calls: list[tuple[bytes, Intrinsics]]

    def query(self, *, jpeg: bytes, intrinsics: Intrinsics) -> VpsQueryResult | None:
        self.calls.append((jpeg, intrinsics))
        if not self.results:
            return None
        return self.results.pop(0)


def test_compose_map_client_inverts_client_camera_chain() -> None:
    T_map_camopt = np.eye(4)
    T_map_camopt[0, 3] = 3.0
    T_client_camopt = np.eye(4)
    T_client_camopt[2, 3] = 1.0

    composed = compose_map_client(T_map_camopt, T_client_camopt)

    assert composed == pytest.approx(T_map_camopt @ np.linalg.inv(T_client_camopt))


def test_localize_empty_observations_returns_none() -> None:
    localizer = VpsLocalizer(client=_FakeVpsClient(results=[], calls=[]))

    assert localizer.localize([]) is None


def test_localize_accepts_query_and_fuses() -> None:
    client = _FakeVpsClient(
        results=[
            VpsQueryResult(
                camera_pose=Pose(4.0, 2.0, 0.0, 0.0, 0.0, 0.0, 1.0),
                confidence=0.9,
            )
        ],
        calls=[],
    )
    localizer = VpsLocalizer(
        client=client,
        config=VpsLocalizerConfig(max_tilt_rad=math.pi),
    )

    result = localizer.localize([_observation()])

    assert result is not None
    assert result.frame_id == "map"
    assert result.pose.x == pytest.approx(4.0)
    assert result.pose.y == pytest.approx(2.0)
    assert result.pose.z == pytest.approx(0.0)
    assert result.confidence == pytest.approx(0.9)
    assert len(client.calls) == 1


def test_localize_rejects_low_query_confidence() -> None:
    client = _FakeVpsClient(
        results=[
            VpsQueryResult(
                camera_pose=Pose(1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0),
                confidence=0.4,
            )
        ],
        calls=[],
    )
    localizer = VpsLocalizer(client=client)

    assert localizer.localize([_observation()]) is None


def test_confidence_uses_only_fusion_inliers() -> None:
    client = _FakeVpsClient(
        results=[
            VpsQueryResult(camera_pose=Pose(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0), confidence=0.6),
            VpsQueryResult(camera_pose=Pose(0.1, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0), confidence=0.6),
            VpsQueryResult(camera_pose=Pose(5.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0), confidence=1.0),
        ],
        calls=[],
    )
    localizer = VpsLocalizer(
        client=client,
        config=VpsLocalizerConfig(max_tilt_rad=math.pi),
    )

    result = localizer.localize([_observation(), _observation(), _observation()])

    assert result is not None
    assert result.pose.x == pytest.approx(0.05)
    assert result.confidence == pytest.approx(0.6)
    excluded_mean_confidence = (0.6 + 0.6 + 1.0) / 3.0
    assert result.confidence != pytest.approx(1.0 - excluded_mean_confidence)


def test_image_dimensions_must_match_intrinsics() -> None:
    localizer = VpsLocalizer(client=_FakeVpsClient(results=[], calls=[]))
    observation = _observation(
        image_width=640,
        image_height=480,
        intrinsics=_intrinsics(width=1280, height=720),
    )

    with pytest.raises(ValueError, match="do not match intrinsics"):
        localizer.localize([observation])


def test_downscales_oversized_images_before_query() -> None:
    client = _FakeVpsClient(
        results=[
            VpsQueryResult(
                camera_pose=Pose(1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0),
                confidence=0.9,
            )
        ],
        calls=[],
    )
    localizer = VpsLocalizer(
        client=client,
        config=VpsLocalizerConfig(max_image_longest_side=640),
    )

    assert localizer.localize([_observation(image_width=1280, image_height=720)]) is not None
    assert len(client.calls) == 1
    _, intrinsics = client.calls[0]
    assert intrinsics.width <= 640
    assert intrinsics.height <= 640
    assert intrinsics.distortion_model == "none"


def test_undistorts_before_query(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    def _capture_undistort(image: np.ndarray, intrinsics: Intrinsics) -> UndistortedFrame:
        captured["shape"] = image.shape
        captured["model"] = intrinsics.distortion_model
        return UndistortedFrame(image=image, intrinsics=intrinsics)

    monkeypatch.setattr(vps_module, "undistort_to_pinhole", _capture_undistort)
    client = _FakeVpsClient(
        results=[
            VpsQueryResult(
                camera_pose=Pose(1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0),
                confidence=0.9,
            )
        ],
        calls=[],
    )
    localizer = VpsLocalizer(client=client)
    distorted = Intrinsics(
        fx=800.0,
        fy=800.0,
        cx=640.0,
        cy=360.0,
        width=1280,
        height=720,
        distortion_model="equidistant",
        distortion=(-0.07, -0.02, -0.01, 0.01),
    )

    localizer.localize([_observation(intrinsics=distorted)])

    assert captured["shape"] == (720, 1280, 3)
    assert captured["model"] == "equidistant"


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("max_tilt_rad", -0.01),
        ("max_position_residual_m", 0.0),
        ("max_yaw_residual_rad", -0.01),
        ("min_query_confidence", 1.1),
        ("max_image_longest_side", 0),
    ],
)
def test_invalid_localizer_config_is_rejected(field: str, value: float) -> None:
    with pytest.raises(ValueError):
        VpsLocalizerConfig(**{field: value})
