from __future__ import annotations

import math
from types import SimpleNamespace

import cv2
import numpy as np
import pytest
from scipy.spatial.transform import Rotation

import dimos.ar.localization.fiducial_marker.localizer as fiducial_module
from dimos.ar.localization.fiducial_marker.localizer import (
    FiducialMarkerLocalizer,
    FiducialMarkerLocalizerConfig,
    compose_odom_client,
)
from dimos.ar.localization.pose_buffer import PoseBuffer
from dimos.ar.localization.types import Intrinsics, Observation
from dimos.ar.robot.profiles import FiducialMarkerMount
from dimos.ar.robot.profiles.unitree_go2 import UNITREE_GO2_PROFILE

assert UNITREE_GO2_PROFILE.fiducial_dictionary is not None
from dimos.msgs.geometry_msgs.Pose import Pose
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.utils.transform_utils import matrix_to_pose, pose_to_matrix


@pytest.mark.parametrize(
    ("pose_ts", "replay", "succeeds"),
    [(100.0, False, True), (10.0, True, True), (10.0, False, False)],
)
def test_localizes_rendered_table_marker_from_three_optical_camera_poses(
    pose_ts: float, replay: bool, succeeds: bool,
) -> None:
    """Exercise JPEG detection, PnP, optical composition, and default tilt fusion."""
    intrinsics = _intrinsics()
    k = np.array([[600, 0, 400], [0, 600, 400], [0, 0, 1]], dtype=np.float64)
    marker_size = 0.056
    half = marker_size / 2
    object_points = np.array(
        [[-half, half, 0], [half, half, 0], [half, -half, 0], [-half, -half, 0]],
        dtype=np.float64,
    )
    dictionary = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_APRILTAG_36h11)
    marker = cv2.aruco.generateImageMarker(dictionary, 0, 200)
    observations = []
    for offset in [-0.01, 0.0, 0.01]:
        # A horizontal marker, viewed from above with a slightly tilted camera.
        tilt, _ = cv2.Rodrigues(np.array([0.2, 0.0, 0.0]))
        client_camera = np.eye(4)
        client_camera[:3, :3] = tilt @ np.diag([1.0, -1.0, -1.0])
        client_camera[:3, 3] = [offset, 0.0, 0.35]
        camera_marker = np.linalg.inv(client_camera)
        rvec, _ = cv2.Rodrigues(camera_marker[:3, :3])
        corners, _ = cv2.projectPoints(object_points, rvec, camera_marker[:3, 3], k, None)
        warp = cv2.getPerspectiveTransform(
            np.array([[0, 0], [199, 0], [199, 199], [0, 199]], dtype=np.float32),
            corners.reshape(4, 2).astype(np.float32),
        )
        image = cv2.warpPerspective(marker, warp, (800, 800), borderValue=255)
        ok, jpeg = cv2.imencode(".jpg", image)
        assert ok
        observations.append(
            Observation(
                jpeg=jpeg.tobytes(),
                intrinsics=intrinsics,
                camera_pose=matrix_to_pose(client_camera),
                ts_server=100.0,
            )
        )
    pose_buffer = PoseBuffer()
    pose_buffer.push(PoseStamped(ts=pose_ts, position=[0, 0, 0]), ts_server=pose_ts)
    localizer = FiducialMarkerLocalizer(
        pose_buffer=pose_buffer,
        marker_mounts=[
            FiducialMarkerMount(
                marker_id=0,
                size_m=marker_size,
                position=(0.0, 0.0, 0.0),
                orientation=(0.0, 0.0, 0.0, 1.0),
            )
        ],
        dictionary_name="DICT_APRILTAG_36h11",
        allow_latest_robot_pose=replay,
    )

    result = localizer.snapshot().localize(observations)

    if not succeeds:
        assert result is None
        return
    assert result is not None
    assert [result.pose.x, result.pose.y, result.pose.z] == pytest.approx([0, 0, 0], abs=0.02)


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


def _stub_marker_detection(
    localizer: FiducialMarkerLocalizer,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        localizer,
        "_detector",
        SimpleNamespace(
            detectMarkers=lambda _gray: (
                [
                    np.array(
                        [[[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]]],
                        dtype=np.float32,
                    )
                ],
                np.array([[0]], dtype=np.int32),
                None,
            )
        ),
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
    localizer = FiducialMarkerLocalizer(
        pose_buffer=PoseBuffer(),
        marker_mounts=UNITREE_GO2_PROFILE.fiducial_marker_mounts,
        dictionary_name=UNITREE_GO2_PROFILE.fiducial_dictionary,
    )

    assert localizer.localize([]) is None


def test_localize_without_detected_marker_returns_none() -> None:
    localizer = FiducialMarkerLocalizer(
        pose_buffer=PoseBuffer(),
        marker_mounts=UNITREE_GO2_PROFILE.fiducial_marker_mounts,
        dictionary_name=UNITREE_GO2_PROFILE.fiducial_dictionary,
    )

    assert localizer.localize([_observation()]) is None


def test_localize_accepts_candidate_and_fuses(monkeypatch: pytest.MonkeyPatch) -> None:
    buffer = PoseBuffer()
    _seed_pose_buffer(buffer, ts_server=99.9)
    localizer = FiducialMarkerLocalizer(
        pose_buffer=buffer,
        marker_mounts=[
            FiducialMarkerMount(
                marker_id=0,
                size_m=0.056,
                position=(0.1, 0.0, 0.0),
                orientation=(0.0, 0.0, 0.0, 1.0),
            )
        ],
        dictionary_name=UNITREE_GO2_PROFILE.fiducial_dictionary,
        config=FiducialMarkerLocalizerConfig(
            max_reprojection_error_px=8.0,
            max_tilt_rad=math.pi,
        ),
    )
    _stub_marker_detection(localizer, monkeypatch)

    result = localizer.localize([_observation(ts_server=100.0)])

    assert result is not None
    assert result.frame_id == "odom"
    assert result.pose.x == pytest.approx(1.1)
    assert result.pose.y == pytest.approx(2.0)
    assert result.pose.z == pytest.approx(-1.0)
    assert 0.0 < result.confidence <= 1.0


@pytest.mark.parametrize("robot_pose_ts", [None, 99.749])
def test_localize_without_current_robot_pose_rejects_unregistered_origin(
    monkeypatch: pytest.MonkeyPatch,
    robot_pose_ts: float | None,
) -> None:
    buffer = PoseBuffer()
    if robot_pose_ts is not None:
        _seed_pose_buffer(buffer, ts_server=robot_pose_ts)
    localizer = FiducialMarkerLocalizer(
        pose_buffer=buffer,
        marker_mounts=[
            FiducialMarkerMount(
                marker_id=0,
                size_m=0.056,
                position=(0.1, 0.0, 0.0),
                orientation=(0.0, 0.0, 0.0, 1.0),
            )
        ],
        dictionary_name=UNITREE_GO2_PROFILE.fiducial_dictionary,
        config=FiducialMarkerLocalizerConfig(
            max_reprojection_error_px=8.0,
            max_tilt_rad=math.pi,
        ),
    )
    _stub_marker_detection(localizer, monkeypatch)

    result = localizer.localize([_observation(ts_server=100.0)])

    assert result is None


def test_fiducial_marker_localizer_implements_localizer() -> None:
    localizer = FiducialMarkerLocalizer(
        pose_buffer=PoseBuffer(),
        marker_mounts=UNITREE_GO2_PROFILE.fiducial_marker_mounts,
        dictionary_name=UNITREE_GO2_PROFILE.fiducial_dictionary,
    )

    assert localizer.localize([]) is None


def test_unknown_marker_id_is_ignored(monkeypatch: pytest.MonkeyPatch) -> None:
    buffer = PoseBuffer()
    _seed_pose_buffer(buffer, ts_server=100.0)
    localizer = FiducialMarkerLocalizer(
        pose_buffer=buffer,
        marker_mounts=[
            FiducialMarkerMount(
                marker_id=99,
                size_m=0.056,
                position=(0.0, 0.0, 0.0),
                orientation=(0.0, 0.0, 0.0, 1.0),
            )
        ],
        dictionary_name=UNITREE_GO2_PROFILE.fiducial_dictionary,
    )
    localizer._detector = SimpleNamespace(  # type: ignore[attr-defined]
        detectMarkers=lambda _gray: (
            [np.array([[[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]]], dtype=np.float32)],
            np.array([[0]], dtype=np.int32),
            None,
        )
    )
    assert localizer.localize([_observation()]) is None


def test_image_dimensions_must_match_intrinsics() -> None:
    localizer = FiducialMarkerLocalizer(
        pose_buffer=PoseBuffer(),
        marker_mounts=UNITREE_GO2_PROFILE.fiducial_marker_mounts,
        dictionary_name=UNITREE_GO2_PROFILE.fiducial_dictionary,
    )
    observation = _observation(
        image_width=640,
        image_height=480,
        intrinsics=_intrinsics(width=800, height=800),
    )

    with pytest.raises(ValueError, match="do not match intrinsics"):
        localizer.localize([observation])


def test_reprojection_error_above_threshold_is_rejected(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    buffer = PoseBuffer()
    _seed_pose_buffer(buffer)
    localizer = FiducialMarkerLocalizer(
        pose_buffer=buffer,
        marker_mounts=UNITREE_GO2_PROFILE.fiducial_marker_mounts,
        dictionary_name=UNITREE_GO2_PROFILE.fiducial_dictionary,
    )
    localizer._detector = SimpleNamespace(  # type: ignore[attr-defined]
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

    assert localizer.localize([_observation()]) is None


def test_confidence_uses_only_fusion_inliers(monkeypatch: pytest.MonkeyPatch) -> None:
    localizer = FiducialMarkerLocalizer(
        pose_buffer=PoseBuffer(),
        marker_mounts=UNITREE_GO2_PROFILE.fiducial_marker_mounts,
        dictionary_name=UNITREE_GO2_PROFILE.fiducial_dictionary,
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
        localizer,
        "_candidate_from_observation",
        lambda _observation, _misses: candidates.pop(0),
    )

    result = localizer.localize([_observation(), _observation(), _observation()])

    assert result is not None
    assert result.pose.x == pytest.approx(0.05)
    assert 0.0 < result.confidence <= 1.0
    all_mean_reproj = (2.4 + 2.4 + 0.0) / 3.0
    all_candidate_confidence = (
        1.0 - all_mean_reproj / FiducialMarkerLocalizerConfig().max_reprojection_error_px
    )
    assert result.confidence < all_candidate_confidence


@pytest.mark.parametrize("matching_sightings", [1, 2])
def test_batch_requires_two_agreeing_marker_sightings(
    monkeypatch: pytest.MonkeyPatch,
    matching_sightings: int,
) -> None:
    localizer = FiducialMarkerLocalizer(
        pose_buffer=PoseBuffer(),
        marker_mounts=UNITREE_GO2_PROFILE.fiducial_marker_mounts,
        dictionary_name=UNITREE_GO2_PROFILE.fiducial_dictionary,
    )
    candidates = [
        fiducial_module._FiducialCandidate(transform=np.eye(4), reprojection_error_px=0.5)
        if index < matching_sightings
        else None
        for index in range(3)
    ]
    monkeypatch.setattr(
        localizer,
        "_candidate_from_observation",
        lambda _observation, _misses: candidates.pop(0),
    )

    result = localizer.localize([_observation() for _ in range(3)])

    assert (result is not None) == (matching_sightings == 2)


def test_batch_rejects_detections_that_disagree_in_position(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    localizer = FiducialMarkerLocalizer(
        pose_buffer=PoseBuffer(),
        marker_mounts=UNITREE_GO2_PROFILE.fiducial_marker_mounts,
        dictionary_name=UNITREE_GO2_PROFILE.fiducial_dictionary,
    )
    transforms = [np.eye(4) for _ in range(3)]
    for index, transform in enumerate(transforms):
        transform[0, 3] = index * 2.0
    candidates = [
        fiducial_module._FiducialCandidate(transform=transform, reprojection_error_px=0.5)
        for transform in transforms
    ]
    monkeypatch.setattr(
        localizer,
        "_candidate_from_observation",
        lambda _observation, _misses: candidates.pop(0),
    )

    assert localizer.localize([_observation() for _ in range(3)]) is None


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
    mount = UNITREE_GO2_PROFILE.fiducial_marker_mounts[0]

    with pytest.raises(ValueError, match="duplicate fiducial marker ID 0"):
        FiducialMarkerLocalizer(
            pose_buffer=PoseBuffer(),
            marker_mounts=[mount, mount],
            dictionary_name=UNITREE_GO2_PROFILE.fiducial_dictionary,
        )


def test_empty_marker_mounts_are_rejected() -> None:
    with pytest.raises(ValueError, match="at least one mount"):
        FiducialMarkerLocalizer(
            pose_buffer=PoseBuffer(),
            marker_mounts=[],
            dictionary_name=UNITREE_GO2_PROFILE.fiducial_dictionary,
        )


def test_detector_output_length_mismatch_is_explicit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    buffer = PoseBuffer()
    _seed_pose_buffer(buffer)
    localizer = FiducialMarkerLocalizer(
        pose_buffer=buffer,
        marker_mounts=UNITREE_GO2_PROFILE.fiducial_marker_mounts,
        dictionary_name=UNITREE_GO2_PROFILE.fiducial_dictionary,
    )
    localizer._detector = SimpleNamespace(  # type: ignore[attr-defined]
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
        localizer.localize([_observation()])


@pytest.mark.parametrize("origin_shift", [(0.0, 0.0, 0.0), (4.0, -3.0, 1.5)])
@pytest.mark.parametrize("tilt_deg", [0.0, 8.0, -8.0])
def test_gravity_alignment_preserves_marker_center_independent_of_tracking_origin(
    monkeypatch: pytest.MonkeyPatch,
    origin_shift: tuple[float, float, float],
    tilt_deg: float,
) -> None:
    localizer = FiducialMarkerLocalizer(
        pose_buffer=PoseBuffer(),
        marker_mounts=UNITREE_GO2_PROFILE.fiducial_marker_mounts,
        dictionary_name=UNITREE_GO2_PROFILE.fiducial_dictionary,
    )
    mount = UNITREE_GO2_PROFILE.fiducial_marker_mounts[0]
    odom_base = np.eye(4)
    odom_base[:3, :3] = Rotation.from_euler("z", 37, degrees=True).as_matrix()
    odom_base[:3, 3] = [2.5, -3.75, 0.33]
    client_camera = np.eye(4)
    client_camera[:3, 3] = origin_shift
    camera_marker = np.eye(4)
    camera_marker[:3, :3] = (
        Rotation.from_euler("x", tilt_deg, degrees=True).as_matrix()
        @ (odom_base @ mount.T_base_marker)[:3, :3]
    )
    # PnP rotation may tilt while its measured center remains accurate.
    camera_marker[:3, 3] = [0.5, 0.2, 0.7]
    rvec, _ = cv2.Rodrigues(camera_marker[:3, :3])
    monkeypatch.setattr(
        fiducial_module,
        "estimate_marker_pose",
        lambda *_a, **_kw: (
            rvec,
            camera_marker[:3, 3].reshape(3, 1),
        ),
    )
    monkeypatch.setattr(fiducial_module, "marker_reprojection_error", lambda *_a, **_kw: 0.1)

    candidate = localizer._candidate_from_detection(
        corners=np.zeros((1, 4, 2), dtype=np.float32),
        mount=mount,
        camera_matrix=np.eye(3),
        dist_coeffs=np.zeros(5),
        intrinsics=_intrinsics(),
        T_odom_base=odom_base,
        T_client_camopt=client_camera,
    )

    assert candidate is not None
    client_marker = client_camera @ camera_marker
    predicted_marker = candidate.transform @ client_marker
    assert predicted_marker[:3, 3] == pytest.approx(
        (odom_base @ mount.T_base_marker)[:3, 3],
        abs=1e-9,
    )
    assert candidate.transform[:3, 2] == pytest.approx([0, 0, 1], abs=1e-9)


@pytest.mark.parametrize("tracking_shift", [(0.0, 0.0, 0.0), (3.0, -2.0, 1.0)])
def test_real_pnp_recovers_go2_mount_from_nonzero_robot_pose_and_tracking_origin(
    monkeypatch: pytest.MonkeyPatch,
    tracking_shift: tuple[float, float, float],
) -> None:
    buffer = PoseBuffer()
    robot = PoseStamped(
        ts=100.0,
        position=[2.5, -3.75, 0.33],
        orientation=Rotation.from_euler("z", 37, degrees=True).as_quat().tolist(),
    )
    buffer.push(robot, ts_server=100.0)
    localizer = FiducialMarkerLocalizer(
        pose_buffer=buffer,
        marker_mounts=UNITREE_GO2_PROFILE.fiducial_marker_mounts,
        dictionary_name=UNITREE_GO2_PROFILE.fiducial_dictionary,
    )
    mount = UNITREE_GO2_PROFILE.fiducial_marker_mounts[0]
    odom_marker = pose_to_matrix(robot) @ mount.T_base_marker
    expected_origin = np.eye(4)
    expected_origin[:3, :3] = Rotation.from_euler("z", -23, degrees=True).as_matrix()
    expected_origin[:3, 3] = tracking_shift
    camera_marker = np.eye(4)
    camera_marker[:3, :3] = Rotation.from_euler("xyz", [165, 12, -8], degrees=True).as_matrix()
    camera_marker[:3, 3] = [0.03, -0.02, 0.5]
    client_camera = np.linalg.inv(expected_origin) @ odom_marker @ np.linalg.inv(camera_marker)
    half = mount.size_m / 2
    obj = np.array([[-half, half, 0], [half, half, 0], [half, -half, 0], [-half, -half, 0]])
    k, d = fiducial_module._intrinsics_to_cv(_intrinsics())
    rvec, _ = cv2.Rodrigues(camera_marker[:3, :3])
    corners, _ = cv2.projectPoints(obj, rvec, camera_marker[:3, 3], k, d)
    localizer._detector = SimpleNamespace(  # type: ignore[assignment]
        detectMarkers=lambda _gray: (
            [corners.reshape(1, 4, 2).astype(np.float32)],
            np.array([[0]]),
            None,
        )
    )
    obs = Observation(
        jpeg=_jpeg(),
        intrinsics=_intrinsics(),
        camera_pose=matrix_to_pose(client_camera),
        ts_server=100.0,
    )

    result = localizer.localize([obs, obs, obs])

    assert result is not None
    assert pose_to_matrix(result.pose) == pytest.approx(expected_origin, abs=1e-4)
