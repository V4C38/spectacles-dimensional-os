from __future__ import annotations

from dataclasses import dataclass
import math
import time
from unittest.mock import MagicMock

import numpy as np
import pytest

from dimos.ar.tag_tracking.solve import TagObservation, build_T_world_odom, solve_similarity_2d
from dimos.ar.world_frame.aligner import SimilarityAligner
from dimos.ar.world_frame.registry import WorldRegistry
from dimos.ar.world_frame.state import WorldFrameState
from dimos.ar.world_frame.transforms import OdomSample


@dataclass
class _Config:
    ALIGN_RECENCY_TAU_S: float = 4.0
    ALIGN_MAX_DIST_CAM_M: float = 4.0
    ALIGN_AMBIGUITY_MIN: float = 1.5
    ALIGN_AMBIGUITY_PENALTY: float = 0.3
    ALIGN_WINDOW_MAX_AGE_S: float = 8.0
    ALIGN_WINDOW_MAX_OBS: int = 24
    ALIGN_MIN_OBS: int = 3
    ALIGN_REG_MIN_OBS: int = 4
    ALIGN_REG_CONF_MIN: float = 0.7
    ALIGN_HUBER_K: float = 1.5
    ALIGN_OUTLIER_K: float = 3.0
    ALIGN_SCALE_PLAUSIBLE_MIN: float = 1.0
    ALIGN_SCALE_PLAUSIBLE_MAX: float = 1.6
    ALIGN_BASELINE_B0: float = 0.10
    ALIGN_BASELINE_B1: float = 0.40
    ALIGN_RESID_REF_M: float = 0.20
    ALIGN_REBASE_RESID_M: float = 0.30
    ALIGN_REBASE_FRAC: float = 0.6
    ALIGN_REBASE_DIR_STD_RAD: float = 0.5
    ALIGN_REBASE_KEEP: int = 2


def _world_point(
    odom_xy: tuple[float, float],
    *,
    yaw_rad: float,
    scale: float,
    translation_world: tuple[float, float, float],
) -> tuple[float, float, float]:
    x, y = odom_xy
    c, s = math.cos(yaw_rad), math.sin(yaw_rad)
    v0 = translation_world[0] + scale * (c * x - s * y)
    v1 = -translation_world[2] + scale * (s * x + c * y)
    return (v0, translation_world[1], -v1)


def _observation(
    odom_xy: tuple[float, float],
    *,
    yaw_rad: float,
    scale: float,
    translation_world: tuple[float, float, float],
    mono_ts: float,
    tag_id: int = 0,
    quality: float = 0.9,
    ambiguity_ratio: float = 1.7,
    pair_skew_s: float = 0.02,
) -> TagObservation:
    world = _world_point(
        odom_xy,
        yaw_rad=yaw_rad,
        scale=scale,
        translation_world=translation_world,
    )
    return TagObservation(
        mono_ts=mono_ts,
        tag_id=tag_id,
        p_world_tag=world,
        p_odom_tag=(odom_xy[0], odom_xy[1], 0.0),
        T_world_tag=np.eye(4, dtype=np.float64),
        T_odom_tag=np.eye(4, dtype=np.float64),
        T_odom_base=np.eye(4, dtype=np.float64),
        quality=quality,
        reprojection_error_px=0.4,
        dist_cam_m=2.0,
        ambiguity_ratio=ambiguity_ratio,
        pair_skew_s=pair_skew_s,
        capture_ts_robot=mono_ts,
    )


def _make_aligner(observations: list[TagObservation]) -> tuple[SimilarityAligner, WorldFrameState]:
    state = WorldFrameState()
    registry = WorldRegistry(state, tf_publish_static=lambda _tf: None)
    tag_tracker = MagicMock()
    tag_tracker.recent_observations.return_value = observations
    telemetry = MagicMock()
    sender = MagicMock()
    odom = MagicMock()
    odom.latest.return_value = None
    aligner = SimilarityAligner(
        registry=registry,
        telemetry=telemetry,
        sender=sender,
        odom=odom,
        tag_tracker=tag_tracker,
        config=_Config(),
        apply_floor_y_lock=lambda transform, _odom_sample: transform,
    )
    return aligner, state


def test_solve_similarity_2d_recovers_known_transform() -> None:
    yaw = math.radians(20.0)
    scale = 1.35
    translation = np.array([1.2, -0.7], dtype=np.float64)
    u = np.array([[0.0, 0.0], [1.0, 0.0], [0.0, 2.0], [1.5, 0.5]], dtype=np.float64)
    c, s = math.cos(yaw), math.sin(yaw)
    r2 = np.array([[c, -s], [s, c]], dtype=np.float64)
    v = (scale * (r2 @ u.T)).T + translation
    fit = solve_similarity_2d(u, v, np.ones(len(u), dtype=np.float64))

    assert fit.yaw == pytest.approx(yaw)
    assert fit.scale == pytest.approx(scale)
    assert fit.t2 == pytest.approx(translation)
    assert fit.resid_rms == pytest.approx(0.0)


def test_aligner_holds_yaw_and_scale_when_baseline_is_low() -> None:
    now = time.monotonic()
    observations = [
        _observation((0.00, 0.00), yaw_rad=0.5, scale=1.4, translation_world=(1.0, 0.0, -2.0), mono_ts=now),
        _observation((0.02, 0.00), yaw_rad=0.5, scale=1.4, translation_world=(1.0, 0.0, -2.0), mono_ts=now - 0.1),
        _observation((0.04, 0.00), yaw_rad=0.5, scale=1.4, translation_world=(1.0, 0.0, -2.0), mono_ts=now - 0.2),
    ]
    aligner, state = _make_aligner(observations)
    state.commit(np.eye(4, dtype=np.float64), method="april_tag", approximate=True)

    estimate = aligner.current_estimate(now_mono=now)

    assert estimate is not None
    assert estimate.yaw_observable is False
    assert estimate.scale_observable is False
    assert estimate.approximate is True
    assert estimate.scale == pytest.approx(1.15)
    assert estimate.yaw_rad == pytest.approx(0.0)


def test_aligner_two_tags_make_single_frame_observable() -> None:
    now = time.monotonic()
    observations = [
        _observation((0.0, 0.0), yaw_rad=0.3, scale=1.3, translation_world=(1.0, 0.0, -1.0), mono_ts=now, tag_id=0),
        _observation((0.6, 0.0), yaw_rad=0.3, scale=1.3, translation_world=(1.0, 0.0, -1.0), mono_ts=now, tag_id=1),
        _observation((0.6, 0.2), yaw_rad=0.3, scale=1.3, translation_world=(1.0, 0.0, -1.0), mono_ts=now - 0.1, tag_id=0),
    ]
    aligner, state = _make_aligner(observations)
    state.commit(np.eye(4, dtype=np.float64), method="april_tag", approximate=True)

    estimate = aligner.current_estimate(now_mono=now)

    assert estimate is not None
    assert estimate.yaw_observable is True
    assert estimate.scale_observable is True
    assert estimate.approximate is False


def test_aligner_irls_rejects_outlier() -> None:
    now = time.monotonic()
    translation_world = (2.0, 0.0, -0.5)
    observations = []
    for idx, point in enumerate(
        [(0.0, 0.0), (1.0, 0.0), (2.0, 0.0), (0.0, 1.0), (1.0, 1.0), (2.0, 1.0), (0.0, 2.0), (1.0, 2.0)]
    ):
        observations.append(
            _observation(
                point,
                yaw_rad=0.2,
                scale=1.25,
                translation_world=translation_world,
                mono_ts=now - 0.05 * idx,
            )
        )
    observations.append(
        _observation(
            (4.0, 4.0),
            yaw_rad=0.2,
            scale=1.25,
            translation_world=(10.0, 0.0, -10.0),
            mono_ts=now - 0.5,
        )
    )
    aligner, state = _make_aligner(observations)
    state.commit(np.eye(4, dtype=np.float64), method="april_tag", approximate=True)

    estimate = aligner.current_estimate(now_mono=now)

    assert estimate is not None
    assert abs(estimate.translation_world[0] - translation_world[0]) < abs(
        estimate.translation_world[0] - 10.0
    )
    assert abs(estimate.translation_world[2] - translation_world[2]) < abs(
        estimate.translation_world[2] - (-10.0)
    )
    assert estimate.rejected_count >= 1


def test_aligner_rebases_to_newest_observations_and_force_holds(caplog) -> None:
    now = time.monotonic()
    observations = [
        _observation(
            (0.0, 0.0),
            yaw_rad=0.0,
            scale=1.15,
            translation_world=(1.0, 0.0, 0.0),
            mono_ts=now - 1.0,
            quality=0.2,
        ),
        _observation(
            (1.0, 0.0),
            yaw_rad=0.0,
            scale=1.15,
            translation_world=(1.0, 0.0, 0.0),
            mono_ts=now - 0.9,
            quality=0.2,
        ),
        _observation(
            (0.0, 1.0),
            yaw_rad=0.0,
            scale=1.15,
            translation_world=(1.0, 0.0, 0.0),
            mono_ts=now - 0.8,
            quality=0.2,
        ),
        _observation(
            (1.0, 1.0),
            yaw_rad=0.0,
            scale=1.15,
            translation_world=(1.0, 0.0, 0.0),
            mono_ts=now - 0.7,
            quality=0.2,
        ),
        _observation(
            (0.0, 0.0),
            yaw_rad=0.0,
            scale=1.15,
            translation_world=(0.0, 0.0, 0.0),
            mono_ts=now - 0.05,
            quality=1.0,
        ),
        _observation(
            (1.0, 0.0),
            yaw_rad=0.0,
            scale=1.15,
            translation_world=(0.0, 0.0, 0.0),
            mono_ts=now,
            quality=1.0,
        ),
    ]
    aligner, state = _make_aligner(observations)
    state.commit(np.eye(4, dtype=np.float64), method="april_tag", approximate=True)

    with caplog.at_level("WARNING"):
        estimate = aligner.current_estimate(now_mono=now)

    assert estimate is not None
    assert estimate.rebase_detected is True
    assert estimate.alpha_yaw == pytest.approx(0.0)
    assert estimate.alpha_scale == pytest.approx(0.0)
    assert estimate.yaw_rad == pytest.approx(0.0)
    assert estimate.scale == pytest.approx(1.15)
    assert estimate.translation_world[0] == pytest.approx(0.0, abs=1e-6)
    assert "world_rebase_detected" in caplog.text


def test_aligner_logs_out_of_band_scale_after_five_updates(caplog) -> None:
    now = time.monotonic()
    observations = [
        _observation((0.0, 0.0), yaw_rad=0.2, scale=1.8, translation_world=(0.0, 0.0, 0.0), mono_ts=now),
        _observation((1.0, 0.0), yaw_rad=0.2, scale=1.8, translation_world=(0.0, 0.0, 0.0), mono_ts=now - 0.1),
        _observation((0.0, 1.0), yaw_rad=0.2, scale=1.8, translation_world=(0.0, 0.0, 0.0), mono_ts=now - 0.2),
    ]
    aligner, state = _make_aligner(observations)
    state.commit(np.eye(4, dtype=np.float64), method="april_tag", approximate=True)
    sample = OdomSample(
        position=(0.0, 0.0, 0.0),
        orientation=(0.0, 0.0, 0.0, 1.0),
        source_ts=1.0,
    )

    for _ in range(4):
        aligner.update(resolved_odom=sample, now_mono=now)

    with caplog.at_level("WARNING"):
        aligner.update(resolved_odom=sample, now_mono=now)

    assert "odom_scale_out_of_band" in caplog.text


def _static_registration_observations(
    *,
    yaw_rad: float,
    translation_world: tuple[float, float, float],
    cam_positions: list[tuple[float, float, float]],
) -> list[TagObservation]:
    now = time.monotonic()
    T_world_odom = build_T_world_odom(yaw_rad, translation_world)
    T_odom_tag = np.eye(4, dtype=np.float64)
    T_world_tag = T_world_odom @ T_odom_tag
    p_odom = (0.0, 0.0, 0.0)
    p_world = tuple(float(v) for v in T_world_tag[:3, 3])
    return [
        TagObservation(
            mono_ts=now - 0.1 * idx,
            tag_id=0,
            p_world_tag=p_world,
            p_odom_tag=p_odom,
            T_world_tag=np.array(T_world_tag, dtype=np.float64, copy=True),
            T_odom_tag=np.array(T_odom_tag, dtype=np.float64, copy=True),
            T_odom_base=np.eye(4, dtype=np.float64),
            quality=0.9,
            reprojection_error_px=0.4,
            dist_cam_m=2.0,
            cam_pos=cam_pos,
        )
        for idx, cam_pos in enumerate(cam_positions)
    ]


def test_registration_estimate_recovers_yaw_from_camera_motion() -> None:
    cam_positions = [
        (0.0, 0.0, 1.5),
        (0.5, 0.0, 1.5),
        (0.0, -0.5, 1.5),
        (0.45, 0.25, 1.4),
    ]
    observations = _static_registration_observations(
        yaw_rad=0.4,
        translation_world=(1.2, 0.0, -2.0),
        cam_positions=cam_positions,
    )
    aligner, _state = _make_aligner(observations)

    estimate = aligner.registration_estimate(max_age_s=15.0, min_observations=4)

    assert estimate is not None
    assert estimate.yaw_observable is True
    assert estimate.confidence >= 0.7
    assert estimate.yaw_rad == pytest.approx(0.4, abs=0.05)
    assert estimate.translation_world[0] == pytest.approx(1.2, abs=0.05)
    assert estimate.scale == pytest.approx(1.0)


def test_registration_estimate_low_view_baseline_has_zero_confidence() -> None:
    now = time.monotonic()
    observations = [
        _observation(
            (0.0, 0.0),
            yaw_rad=0.5,
            scale=1.0,
            translation_world=(1.0, 0.0, -2.0),
            mono_ts=now - 0.1 * idx,
        )
        for idx in range(4)
    ]
    aligner, _state = _make_aligner(observations)

    estimate = aligner.registration_estimate(max_age_s=15.0, min_observations=4)

    assert estimate is not None
    assert estimate.confidence == pytest.approx(0.0)
    assert estimate.yaw_observable is False
