from __future__ import annotations

import math
from types import SimpleNamespace

import numpy as np
import pytest

import dimos.ar.localization.fiducial_marker.localizer as fiducial_module
from dimos.ar.localization.fiducial_marker.localizer import (
    FiducialMarkerLocalizer,
    FiducialMarkerLocalizerConfig,
    compose_odom_client,
)
from dimos.ar.localization.pose_buffer import PoseBuffer
from dimos.ar.localization.types import Intrinsics, Observation
from dimos.ar.robot.go2 import GO2_FIDUCIAL_DICTIONARY, GO2_FIDUCIAL_MARKER_MOUNTS
from dimos.ar.robot.profile import FiducialMarkerMount
from dimos.msgs.geometry_msgs.Pose import Pose
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped


def _intrinsics(*, width: int = 800, height: int = 800) -> Intrinsics:
    return Intrinsics(
        fx=600.0,
        fy=600.0,
        cx=width / 2.0,
        cy=height / 2.0,
        width=width,
        height=height,
        distortion_model="none",
        distortion=(),
    )


def _jpeg(*, width: int = 800, height: int = 800) -> bytes:
    ok, encoded = fiducial_module.cv2.imencode(
        ".jpg",
        np.zeros((height, width), dtype=np.uint8),
    )
    assert ok
    return encoded.tobytes()


def _observation(
    *,
    ts_server: float = 100.0,
    image_width: int = 800,
    image_height: int = 800,
    intrinsics: Intrinsics | None = None,
) -> Observation:
    return Observation(
        jpeg=_jpeg(width=image_width, height=image_height),
        intrinsics=intrinsics or _intrinsics(width=image_width, height=image_height),
        camera_pose=Pose(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0),
        ts_server=ts_server,
    )


def _seed_pose_buffer(buffer: PoseBuffer, *, ts_server: float = 100.0) -> None:
    buffer.push(
        PoseStamped(
            ts=ts_server,
            frame_id="odom",
            position=[1.0, 2.0, 0.0],
            orientation=[0.0, 0.0, 0.0, 1.0],
        ),
        ts_server=ts_server,
    )


def test_compose_odom_client_inverts_client_marker_chain() -> None:
    T_odom_base = np.eye(4)
    T_base_marker = np.eye(4)
    T_base_marker[0, 3] = 1.0
    T_client_camopt = np.eye(4)
    T_camopt_marker = np.eye(4)
    T_camopt_marker[2, 3] = 2.0

    composed = compose_odom_client(T_odom_base, T_base_marker, T_client_camopt, T_camopt_marker)

    T_odom_marker = T_odom_base @ T_base_marker
    T_client_marker = T_client_camopt @ T_camopt_marker
    assert composed == pytest.approx(T_odom_marker @ np.linalg.inv(T_client_marker))


def test_localize_empty_observations_returns_none() -> None:
    provider = FiducialMarkerLocalizer(
        pose_buffer=PoseBuffer(),
        marker_mounts=GO2_FIDUCIAL_MARKER_MOUNTS,
        dictionary_name=GO2_FIDUCIAL_DICTIONARY,
    )

    assert provider.localize([]) is None


def test_localize_without_robot_pose_returns_none() -> None:
    provider = FiducialMarkerLocalizer(
        pose_buffer=PoseBuffer(),
        marker_mounts=GO2_FIDUCIAL_MARKER_MOUNTS,
        dictionary_name=GO2_FIDUCIAL_DICTIONARY,
    )

    assert provider.localize([_observation()]) is None


def test_localize_accepts_candidate_and_fuses(monkeypatch: pytest.MonkeyPatch) -> None:
    buffer = PoseBuffer()
    _seed_pose_buffer(buffer, ts_server=100.0)
    provider = FiducialMarkerLocalizer(
        pose_buffer=buffer,
        marker_mounts=[
            FiducialMarkerMount(
                marker_id=0,
                size_m=0.056,
                position=(0.1, 0.0, 0.0),
                orientation=(0.0, 0.0, 0.0, 1.0),
            )
        ],
        dictionary_name=GO2_FIDUCIAL_DICTIONARY,
        config=FiducialMarkerLocalizerConfig(
            max_reprojection_error_px=8.0,
            max_tilt_rad=math.pi,
        ),
    )
    provider._detector = SimpleNamespace(  # type: ignore[attr-defined]
        detectMarkers=lambda _gray: (
            [np.array([[[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]]], dtype=np.float32)],
            np.array([[0]], dtype=np.int32),
            None,
        )
    )

    monkeypatch.setattr(
        fiducial_module,
        "estimate_marker_pose",
        lambda *_args, **_kwargs: (
            np.zeros((3, 1), dtype=np.float64),
            np.array([[0.0], [0.0], [1.0]], dtype=np.float64),
        ),
    )
    monkeypatch.setattr(
        fiducial_module,
        "marker_reprojection_error",
        lambda *_args, **_kwargs: 0.5,
    )

    result = provider.localize([_observation(ts_server=100.0)])

    assert result is not None
    assert result.frame_id == "odom"
    assert result.pose.x == pytest.approx(1.1)
    assert result.pose.y == pytest.approx(2.0)
    assert result.pose.z == pytest.approx(-1.0)
    assert result.confidence == pytest.approx(0.9375)


def test_fiducial_marker_localizer_implements_localizer() -> None:
    localizer = FiducialMarkerLocalizer(
        pose_buffer=PoseBuffer(),
        marker_mounts=GO2_FIDUCIAL_MARKER_MOUNTS,
        dictionary_name=GO2_FIDUCIAL_DICTIONARY,
    )

    assert localizer.localize([]) is None


def test_unknown_marker_id_is_ignored(monkeypatch: pytest.MonkeyPatch) -> None:
    buffer = PoseBuffer()
    _seed_pose_buffer(buffer, ts_server=100.0)
    provider = FiducialMarkerLocalizer(
        pose_buffer=buffer,
        marker_mounts=[
            FiducialMarkerMount(
                marker_id=99,
                size_m=0.056,
                position=(0.0, 0.0, 0.0),
                orientation=(0.0, 0.0, 0.0, 1.0),
            )
        ],
        dictionary_name=GO2_FIDUCIAL_DICTIONARY,
    )
    provider._detector = SimpleNamespace(  # type: ignore[attr-defined]
        detectMarkers=lambda _gray: (
            [np.array([[[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]]], dtype=np.float32)],
            np.array([[0]], dtype=np.int32),
            None,
        )
    )
    assert provider.localize([_observation()]) is None


def test_image_dimensions_must_match_intrinsics() -> None:
    provider = FiducialMarkerLocalizer(
        pose_buffer=PoseBuffer(),
        marker_mounts=GO2_FIDUCIAL_MARKER_MOUNTS,
        dictionary_name=GO2_FIDUCIAL_DICTIONARY,
    )
    observation = _observation(
        image_width=640,
        image_height=480,
        intrinsics=_intrinsics(width=800, height=800),
    )

    with pytest.raises(ValueError, match="do not match intrinsics"):
        provider.localize([observation])


def test_reprojection_error_above_threshold_is_rejected(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    buffer = PoseBuffer()
    _seed_pose_buffer(buffer)
    provider = FiducialMarkerLocalizer(
        pose_buffer=buffer,
        marker_mounts=GO2_FIDUCIAL_MARKER_MOUNTS,
        dictionary_name=GO2_FIDUCIAL_DICTIONARY,
    )
    provider._detector = SimpleNamespace(  # type: ignore[attr-defined]
        detectMarkers=lambda _gray: (
            [np.zeros((1, 4, 2), dtype=np.float32)],
            np.array([[0]], dtype=np.int32),
            None,
        )
    )
    monkeypatch.setattr(
        fiducial_module,
        "estimate_marker_pose",
        lambda *_args, **_kwargs: (
            np.zeros((3, 1), dtype=np.float64),
            np.array([[0.0], [0.0], [1.0]], dtype=np.float64),
        ),
    )
    monkeypatch.setattr(
        fiducial_module,
        "marker_reprojection_error",
        lambda *_args, **_kwargs: 3.01,
    )

    assert provider.localize([_observation()]) is None


def test_confidence_uses_only_fusion_inliers(monkeypatch: pytest.MonkeyPatch) -> None:
    provider = FiducialMarkerLocalizer(
        pose_buffer=PoseBuffer(),
        marker_mounts=GO2_FIDUCIAL_MARKER_MOUNTS,
        dictionary_name=GO2_FIDUCIAL_DICTIONARY,
        config=FiducialMarkerLocalizerConfig(max_tilt_rad=math.pi),
    )
    transforms = [np.eye(4) for _ in range(3)]
    transforms[1][0, 3] = 0.1
    transforms[2][0, 3] = 5.0
    candidates = [
        fiducial_module._FiducialCandidate(transform=transforms[0], reprojection_error_px=2.4),
        fiducial_module._FiducialCandidate(transform=transforms[1], reprojection_error_px=2.4),
        fiducial_module._FiducialCandidate(transform=transforms[2], reprojection_error_px=0.0),
    ]
    monkeypatch.setattr(
        provider,
        "_candidate_from_observation",
        lambda _observation: candidates.pop(0),
    )

    result = provider.localize([_observation(), _observation(), _observation()])

    assert result is not None
    assert result.pose.x == pytest.approx(0.05)
    assert result.confidence == pytest.approx(0.2)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("max_reprojection_error_px", 0.0),
        ("max_reprojection_error_px", math.inf),
        ("max_tilt_rad", -0.01),
        ("max_tilt_rad", math.inf),
        ("max_position_residual_m", 0.0),
        ("max_yaw_residual_rad", -0.01),
    ],
)
def test_invalid_localizer_config_is_rejected(field: str, value: float) -> None:
    with pytest.raises(ValueError):
        FiducialMarkerLocalizerConfig(**{field: value})


def test_duplicate_marker_ids_are_rejected() -> None:
    mount = GO2_FIDUCIAL_MARKER_MOUNTS[0]

    with pytest.raises(ValueError, match="duplicate fiducial marker ID 0"):
        FiducialMarkerLocalizer(
            pose_buffer=PoseBuffer(),
            marker_mounts=[mount, mount],
            dictionary_name=GO2_FIDUCIAL_DICTIONARY,
        )


def test_empty_marker_mounts_are_rejected() -> None:
    with pytest.raises(ValueError, match="at least one mount"):
        FiducialMarkerLocalizer(
            pose_buffer=PoseBuffer(),
            marker_mounts=[],
            dictionary_name=GO2_FIDUCIAL_DICTIONARY,
        )


def test_detector_output_length_mismatch_is_explicit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    buffer = PoseBuffer()
    _seed_pose_buffer(buffer)
    provider = FiducialMarkerLocalizer(
        pose_buffer=buffer,
        marker_mounts=GO2_FIDUCIAL_MARKER_MOUNTS,
        dictionary_name=GO2_FIDUCIAL_DICTIONARY,
    )
    provider._detector = SimpleNamespace(  # type: ignore[attr-defined]
        detectMarkers=lambda _gray: (
            [np.zeros((1, 4, 2), dtype=np.float32)],
            np.array([[0], [0]], dtype=np.int32),
            None,
        )
    )
    monkeypatch.setattr(
        fiducial_module,
        "estimate_marker_pose",
        lambda *_args, **_kwargs: None,
    )

    with pytest.raises(ValueError, match="zip\\(\\) argument 2 is longer"):
        provider.localize([_observation()])
