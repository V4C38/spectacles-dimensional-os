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
    ALIGN_YAW_BASELINE_B0: float = 0.15
    ALIGN_YAW_BASELINE_B1: float = 0.35
    ALIGN_SCALE_BASELINE_B0: float = 0.45
    ALIGN_SCALE_BASELINE_B1: float = 0.90
    ALIGN_LEARN_LR: float = 0.5
    ALIGN_LEARN_LR_MAX: float = 0.5
    ALIGN_CONF_DECAY: float = 0.02
    ALIGN_SCALE_JUMP_FRAC: float = 0.15
    ALIGN_SCALE_LOCK_CONF: float = 0.6
    ALIGN_SCALE_REGIME_N: int = 3
    ALIGN_SCALE_JUMP_DAMP: float = 0.15
    ALIGN_SCALE_PRIOR: float = 1.25
    ALIGN_REG_YAW_CONF: float = 0.3
    ALIGN_RESID_REF_M: float = 0.20
    ALIGN_REBASE_RESID_M: float = 0.30
    ALIGN_REBASE_FRAC: float = 0.6
    ALIGN_REBASE_DIR_STD_RAD: float = 0.5
    ALIGN_REBASE_KEEP: int = 2
    ALIGN_UI_CONFIDENT: float = 0.7


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
    cam_pos: tuple[float, float, float] | None = None,
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
        cam_pos=cam_pos,
    )


def _make_aligner(
    observations: list[TagObservation],
    *,
    append_seq: int = 1,
) -> tuple[SimilarityAligner, WorldFrameState, MagicMock]:
    state = WorldFrameState()
    registry = WorldRegistry(state, tf_publish_static=lambda _tf: None)
    tag_tracker = MagicMock()
    tag_tracker.recent_observations.return_value = observations
    tag_tracker.append_seq = append_seq
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
    return aligner, state, tag_tracker


def _commit_and_seed(
    aligner: SimilarityAligner,
    state: WorldFrameState,
    *,
    yaw_rad: float = 0.0,
    odom_scale: float = 1.25,
) -> None:
    T = build_T_world_odom(yaw_rad, (1.0, 0.0, -2.0))
    state.commit(T, method="april_tag", approximate=True, odom_scale=odom_scale)
    aligner.seed_from_commit(T, odom_scale)


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
    aligner, state, _tracker = _make_aligner(observations)
    _commit_and_seed(aligner, state, yaw_rad=0.5)

    estimate = aligner.current_estimate(now_mono=now)

    assert estimate is not None
    assert estimate.yaw_observable is False
    assert estimate.scale_observable is False
    assert estimate.approximate is True
    assert estimate.scale == pytest.approx(1.25)
    assert estimate.yaw_rad == pytest.approx(0.5)
    assert estimate.scale_held is True


def test_aligner_two_tags_make_single_frame_observable() -> None:
    now = time.monotonic()
    observations = [
        _observation((0.0, 0.0), yaw_rad=0.3, scale=1.3, translation_world=(1.0, 0.0, -1.0), mono_ts=now, tag_id=0),
        _observation((0.9, 0.0), yaw_rad=0.3, scale=1.3, translation_world=(1.0, 0.0, -1.0), mono_ts=now, tag_id=1),
        _observation((0.9, 0.2), yaw_rad=0.3, scale=1.3, translation_world=(1.0, 0.0, -1.0), mono_ts=now - 0.1, tag_id=0),
    ]
    aligner, state, _tracker = _make_aligner(observations)
    _commit_and_seed(aligner, state, yaw_rad=0.3)

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
    aligner, state, _tracker = _make_aligner(observations)
    _commit_and_seed(aligner, state, yaw_rad=0.2)

    estimate = aligner.current_estimate(now_mono=now)

    assert estimate is not None
    assert abs(estimate.translation_world[0] - translation_world[0]) < abs(
        estimate.translation_world[0] - 10.0
    )
    assert abs(estimate.translation_world[2] - translation_world[2]) < abs(
        estimate.translation_world[2] - (-10.0)
    )
    assert estimate.rejected_count >= 1


def test_aligner_rebases_preserves_scale_and_resets_yaw_confidence(caplog) -> None:
    now = time.monotonic()
    observations = [
        _observation(
            (0.0, 0.0),
            yaw_rad=0.0,
            scale=1.28,
            translation_world=(1.0, 0.0, 0.0),
            mono_ts=now - 1.0,
            quality=0.2,
        ),
        _observation(
            (1.0, 0.0),
            yaw_rad=0.0,
            scale=1.28,
            translation_world=(1.0, 0.0, 0.0),
            mono_ts=now - 0.9,
            quality=0.2,
        ),
        _observation(
            (0.0, 1.0),
            yaw_rad=0.0,
            scale=1.28,
            translation_world=(1.0, 0.0, 0.0),
            mono_ts=now - 0.8,
            quality=0.2,
        ),
        _observation(
            (1.0, 1.0),
            yaw_rad=0.0,
            scale=1.28,
            translation_world=(1.0, 0.0, 0.0),
            mono_ts=now - 0.7,
            quality=0.2,
        ),
        _observation(
            (0.0, 0.0),
            yaw_rad=0.0,
            scale=1.28,
            translation_world=(0.0, 0.0, 0.0),
            mono_ts=now - 0.05,
            quality=1.0,
        ),
        _observation(
            (1.0, 0.0),
            yaw_rad=0.0,
            scale=1.28,
            translation_world=(0.0, 0.0, 0.0),
            mono_ts=now,
            quality=1.0,
        ),
    ]
    aligner, state, tracker = _make_aligner(observations, append_seq=1)
    _commit_and_seed(aligner, state, odom_scale=1.28)
    aligner.persistent.scale_confidence = 0.9
    sample = OdomSample(
        position=(0.0, 0.0, 0.0),
        orientation=(0.0, 0.0, 0.0, 1.0),
        source_ts=1.0,
    )

    with caplog.at_level("WARNING"):
        aligner.update(resolved_odom=sample, now_mono=now)

    assert aligner.persistent.scale == pytest.approx(1.28)
    assert aligner.persistent.scale_confidence == pytest.approx(0.9)
    assert aligner.persistent.yaw_confidence == pytest.approx(0.3)
    assert tracker.append_seq == 1


def test_aligner_frozen_window_does_not_walk_scale() -> None:
    now = time.monotonic()
    observations = [
        _observation((0.0, 0.0), yaw_rad=0.2, scale=0.86, translation_world=(0.0, 0.0, 0.0), mono_ts=now),
        _observation((0.28, 0.0), yaw_rad=0.2, scale=0.86, translation_world=(0.0, 0.0, 0.0), mono_ts=now - 0.1),
        _observation((0.0, 0.28), yaw_rad=0.2, scale=0.86, translation_world=(0.0, 0.0, 0.0), mono_ts=now - 0.2),
    ]
    aligner, state, tracker = _make_aligner(observations, append_seq=1)
    _commit_and_seed(aligner, state, odom_scale=1.25)
    sample = OdomSample(
        position=(0.0, 0.0, 0.0),
        orientation=(0.0, 0.0, 0.0, 1.0),
        source_ts=1.0,
    )

    first = aligner.update(resolved_odom=sample, now_mono=now)
    assert first is not None
    scale_after_first = state.odom_scale

    for _ in range(8):
        result = aligner.update(resolved_odom=sample, now_mono=now)
        assert result is None
        assert state.odom_scale == pytest.approx(scale_after_first)

    tracker.append_seq = 2
    second = aligner.update(resolved_odom=sample, now_mono=now)
    assert second is not None


def test_aligner_scale_hysteresis_blocks_single_jump() -> None:
    now = time.monotonic()
    true_scale = 1.28
    jump_scale = 0.86
    translation = (1.0, 0.0, -2.0)

    def obs_window(scale: float, seq: int) -> list[TagObservation]:
        base = now - seq
        return [
            _observation((0.0, 0.0), yaw_rad=0.2, scale=scale, translation_world=translation, mono_ts=base),
            _observation((1.0, 0.0), yaw_rad=0.2, scale=scale, translation_world=translation, mono_ts=base - 0.1),
            _observation((0.0, 1.0), yaw_rad=0.2, scale=scale, translation_world=translation, mono_ts=base - 0.2),
            _observation((1.0, 1.0), yaw_rad=0.2, scale=scale, translation_world=translation, mono_ts=base - 0.3),
        ]

    aligner, state, tracker = _make_aligner(obs_window(true_scale, 0), append_seq=1)
    _commit_and_seed(aligner, state, odom_scale=true_scale)
    aligner.persistent.scale_confidence = 0.9
    sample = OdomSample(
        position=(0.0, 0.0, 0.0),
        orientation=(0.0, 0.0, 0.0, 1.0),
        source_ts=1.0,
    )
    aligner.update(resolved_odom=sample, now_mono=now)

    tracker.recent_observations.return_value = obs_window(jump_scale, 1)
    tracker.append_seq = 2
    aligner.update(resolved_odom=sample, now_mono=now)
    rel_move = abs(aligner.persistent.scale - true_scale) / true_scale
    assert rel_move < 0.03


def test_aligner_scale_hysteresis_allows_regime_shift_after_three_windows() -> None:
    now = time.monotonic()
    target_scale = 0.86
    translation = (1.0, 0.0, -2.0)

    def obs_window(seq: int) -> list[TagObservation]:
        base = now - seq
        return [
            _observation((0.0, 0.0), yaw_rad=0.2, scale=target_scale, translation_world=translation, mono_ts=base),
            _observation((1.0, 0.0), yaw_rad=0.2, scale=target_scale, translation_world=translation, mono_ts=base - 0.1),
            _observation((0.0, 1.0), yaw_rad=0.2, scale=target_scale, translation_world=translation, mono_ts=base - 0.2),
            _observation((1.0, 1.0), yaw_rad=0.2, scale=target_scale, translation_world=translation, mono_ts=base - 0.3),
        ]

    aligner, state, tracker = _make_aligner(obs_window(0), append_seq=1)
    _commit_and_seed(aligner, state, odom_scale=1.28)
    aligner.persistent.scale_confidence = 0.9
    sample = OdomSample(
        position=(0.0, 0.0, 0.0),
        orientation=(0.0, 0.0, 0.0, 1.0),
        source_ts=1.0,
    )

    for seq in range(2, 9):
        tracker.recent_observations.return_value = obs_window(seq)
        tracker.append_seq = seq
        aligner.update(resolved_odom=sample, now_mono=now)

    assert aligner.persistent.scale == pytest.approx(target_scale, rel=0.08)


def test_seed_from_commit_sets_persistent_state() -> None:
    aligner, state, _tracker = _make_aligner([])
    T = build_T_world_odom(0.42, (1.0, 0.0, -2.0))
    state.commit(T, method="april_tag", approximate=True, odom_scale=1.25)
    aligner.seed_from_commit(T, 1.25)

    assert aligner.persistent.scale == pytest.approx(1.25)
    assert aligner.persistent.scale_confidence == pytest.approx(0.0)
    assert aligner.persistent.yaw_rad == pytest.approx(0.42)
    assert aligner.persistent.yaw_confidence == pytest.approx(0.3)


def test_seed_from_commit_preserves_registration_keyframe_after_tracker_reset() -> None:
    now = time.monotonic()
    observations = [
        _observation(
            (0.0, 0.0),
            yaw_rad=0.2,
            scale=1.25,
            translation_world=(1.0, 0.0, -2.0),
            mono_ts=now,
        ),
    ]
    aligner, state, tracker = _make_aligner(observations)
    _commit_and_seed(aligner, state)
    tracker.recent_observations.return_value = []

    assert len(aligner._registration_observations) == 1
    assert aligner._registration_observations[0].p_odom_tag == (0.0, 0.0, 0.0)


def test_aligner_logs_out_of_band_scale_only_on_applied_updates(caplog) -> None:
    now = time.monotonic()
    observations = [
        _observation((0.0, 0.0), yaw_rad=0.2, scale=1.8, translation_world=(0.0, 0.0, 0.0), mono_ts=now),
        _observation((1.0, 0.0), yaw_rad=0.2, scale=1.8, translation_world=(0.0, 0.0, 0.0), mono_ts=now - 0.1),
        _observation((0.0, 1.0), yaw_rad=0.2, scale=1.8, translation_world=(0.0, 0.0, 0.0), mono_ts=now - 0.2),
        _observation((1.0, 1.0), yaw_rad=0.2, scale=1.8, translation_world=(0.0, 0.0, 0.0), mono_ts=now - 0.3),
    ]
    aligner, state, tracker = _make_aligner(observations, append_seq=1)
    _commit_and_seed(aligner, state, odom_scale=1.75)
    aligner.persistent.scale = 1.75
    aligner.persistent.scale_confidence = 0.5
    sample = OdomSample(
        position=(0.0, 0.0, 0.0),
        orientation=(0.0, 0.0, 0.0, 1.0),
        source_ts=1.0,
    )

    with caplog.at_level("WARNING"):
        for seq in range(1, 6):
            tracker.append_seq = seq
            aligner.update(resolved_odom=sample, now_mono=now)

    assert aligner._out_of_band_consecutive >= 5


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
    aligner, _state, _tracker = _make_aligner(observations)

    estimate = aligner.registration_estimate(max_age_s=15.0, min_observations=4)

    assert estimate is not None
    assert estimate.yaw_observable is True
    assert estimate.confidence >= 0.7
    assert estimate.yaw_rad == pytest.approx(0.4, abs=0.05)
    assert estimate.translation_world[0] == pytest.approx(1.2, abs=0.05)
    assert estimate.scale == pytest.approx(1.25)


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
    aligner, _state, _tracker = _make_aligner(observations)

    estimate = aligner.registration_estimate(max_age_s=15.0, min_observations=4)

    assert estimate is not None
    assert estimate.confidence == pytest.approx(0.0)
    assert estimate.yaw_observable is False
