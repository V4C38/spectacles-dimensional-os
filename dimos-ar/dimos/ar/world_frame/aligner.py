"""SimilarityAligner — one owner for runtime yaw, scale, and planar translation."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass
import math
import time
from typing import TYPE_CHECKING, Protocol

import numpy as np

from dimos.ar.tag_tracking.solve import (
    SimilaritySolve,
    TagObservation,
    _ground_baseline_m,
    _view_baseline_m,
    aggregate_registration_pose,
    build_T_world_odom,
    solve_similarity_2d,
)
from dimos.ar.tag_tracking.tracker import RobotAprilTagTracker
from dimos.ar.world_frame.transforms import OdomSample, yaw_from_T
from dimos.ar.world_frame.wire import encode_world_frame_correction
from dimos.utils.logging_config import setup_logger
from dimos.utils.transform_utils import normalize_angle

if TYPE_CHECKING:
    from numpy.typing import NDArray

    from dimos.ar.bridge.odom_buffer import OdomBuffer
    from dimos.ar.bridge.sender import BridgeSender
    from dimos.ar.bridge.telemetry import TelemetryPublisher
    from dimos.ar.world_frame.registry import WorldRegistry

logger = setup_logger()

MIN_REPORTED_CORRECTION_TRANS_M: float = 0.05
MIN_REPORTED_CORRECTION_YAW_DEG: float = 1.0


class _AlignerConfig(Protocol):
    ALIGN_RECENCY_TAU_S: float
    ALIGN_MAX_DIST_CAM_M: float
    ALIGN_AMBIGUITY_MIN: float
    ALIGN_AMBIGUITY_PENALTY: float
    ALIGN_WINDOW_MAX_AGE_S: float
    ALIGN_WINDOW_MAX_OBS: int
    ALIGN_MIN_OBS: int
    ALIGN_REG_MIN_OBS: int
    ALIGN_REG_CONF_MIN: float
    ALIGN_HUBER_K: float
    ALIGN_OUTLIER_K: float
    ALIGN_SCALE_PLAUSIBLE_MIN: float
    ALIGN_SCALE_PLAUSIBLE_MAX: float
    ALIGN_YAW_BASELINE_B0: float
    ALIGN_YAW_BASELINE_B1: float
    ALIGN_SCALE_BASELINE_B0: float
    ALIGN_SCALE_BASELINE_B1: float
    ALIGN_LEARN_LR: float
    ALIGN_LEARN_LR_MAX: float
    ALIGN_CONF_DECAY: float
    ALIGN_SCALE_JUMP_FRAC: float
    ALIGN_SCALE_LOCK_CONF: float
    ALIGN_SCALE_REGIME_N: int
    ALIGN_SCALE_JUMP_DAMP: float
    ALIGN_SCALE_PRIOR: float
    ALIGN_REG_YAW_CONF: float
    ALIGN_RESID_REF_M: float
    ALIGN_REBASE_RESID_M: float
    ALIGN_REBASE_FRAC: float
    ALIGN_REBASE_DIR_STD_RAD: float
    ALIGN_REBASE_KEEP: int
    ALIGN_UI_CONFIDENT: float


@dataclass
class _PersistentSimilarity:
    scale: float
    yaw_rad: float
    scale_confidence: float = 0.0
    yaw_confidence: float = 0.0
    scale_regime_agree: int = 0
    scale_jump_direction: int | None = None


@dataclass(frozen=True)
class AlignmentEstimate:
    method: str
    scale: float
    yaw_rad: float
    translation_world: tuple[float, float, float]
    confidence: float
    yaw_observable: bool
    scale_observable: bool
    residual_rms_m: float
    baseline_m: float
    observation_count: int
    rejected_count: int
    alpha_yaw: float
    alpha_scale: float
    quality_term: float
    mean_ambiguity_ratio: float
    max_pair_skew_s: float
    approximate: bool
    rebase_detected: bool = False
    scale_confidence: float = 0.0
    yaw_confidence: float = 0.0
    scale_held: bool = True
    yaw_held: bool = True


@dataclass(frozen=True)
class _PreparedWindow:
    observations: list[TagObservation]
    u: NDArray[np.float64]
    v: NDArray[np.float64]
    weights: NDArray[np.float64]
    mean_u: NDArray[np.float64]
    mean_v: NDArray[np.float64]
    quality_term: float
    mean_world_y: float
    mean_odom_z: float
    mean_ambiguity_ratio: float
    max_pair_skew_s: float
    baseline_m: float
    view_baseline_m: float
    yaw_baseline_m: float

    @property
    def observation_count(self) -> int:
        return len(self.observations)


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _smoothstep(value: float, low: float, high: float) -> float:
    if high <= low:
        return 1.0 if value >= high else 0.0
    t = _clamp((value - low) / (high - low), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def _per_frame_mount_separation(observations: list[TagObservation]) -> float:
    """Max world-frame distance between tag mounts seen in the same frame."""
    by_ts: dict[float, list[TagObservation]] = defaultdict(list)
    for obs in observations:
        by_ts[obs.mono_ts].append(obs)
    max_sep = 0.0
    for frame_obs in by_ts.values():
        if len(frame_obs) < 2:
            continue
        positions = [np.asarray(obs.p_world_tag, dtype=np.float64) for obs in frame_obs]
        for i in range(len(positions)):
            for j in range(i + 1, len(positions)):
                d = float(np.linalg.norm(positions[i] - positions[j]))
                max_sep = max(max_sep, d)
    return max_sep


class SimilarityAligner:
    def __init__(
        self,
        *,
        registry: WorldRegistry,
        telemetry: TelemetryPublisher,
        sender: BridgeSender,
        odom: OdomBuffer,
        tag_tracker: RobotAprilTagTracker,
        config: _AlignerConfig,
        apply_floor_y_lock: Callable[[NDArray[np.float64], OdomSample | None], NDArray[np.float64]],
        on_correction_committed: Callable[[], None] | None = None,
    ) -> None:
        self._registry = registry
        self._state = registry.state
        self._telemetry = telemetry
        self._sender = sender
        self._odom = odom
        self._tag_tracker = tag_tracker
        self._config = config
        self._apply_floor_y_lock = apply_floor_y_lock
        self._on_correction_committed = on_correction_committed
        self._last_estimate: AlignmentEstimate | None = None
        self._out_of_band_consecutive = 0
        self._last_applied_seq: int = -1
        self._held_logged = False
        self._skip_log_reason: str | None = None
        self._persistent = _PersistentSimilarity(
            scale=self._config.ALIGN_SCALE_PRIOR,
            yaw_rad=0.0,
        )

    @property
    def last_estimate(self) -> AlignmentEstimate | None:
        return self._last_estimate

    @property
    def persistent(self) -> _PersistentSimilarity:
        return self._persistent

    def seed_from_commit(
        self,
        T_committed: NDArray[np.float64],
        odom_scale: float,
    ) -> None:
        """Seed persistent estimator from a registration commit."""
        self._persistent.scale = float(odom_scale)
        self._persistent.yaw_rad = normalize_angle(yaw_from_T(T_committed))
        self._persistent.scale_confidence = 0.0
        self._persistent.yaw_confidence = self._config.ALIGN_REG_YAW_CONF
        self._persistent.scale_regime_agree = 0
        self._persistent.scale_jump_direction = None
        self._last_applied_seq = -1
        self._held_logged = False
        self._skip_log_reason = None

    def current_estimate(
        self,
        *,
        now_mono: float | None = None,
        min_observations: int | None = None,
        emit_skip_log: bool = False,
    ) -> AlignmentEstimate | None:
        now = time.monotonic() if now_mono is None else now_mono
        prepared = self._prepare_window(now_mono=now)
        min_obs = (
            self._config.ALIGN_MIN_OBS if min_observations is None else int(min_observations)
        )
        if prepared is None or prepared.observation_count < min_obs:
            if emit_skip_log:
                self._emit_skip_log(
                    skip_reason="insufficient_obs",
                    observation_count=0 if prepared is None else prepared.observation_count,
                )
            return None
        fit, rejected_mask = self._robust_fit(prepared)
        if fit is None:
            return None
        return self._build_estimate(
            prepared,
            fit,
            rejected_mask,
            apply_learning=False,
            rebase_detected=False,
        )

    def registration_estimate(
        self,
        *,
        now_mono: float | None = None,
        max_age_s: float,
        min_observations: int,
    ) -> AlignmentEstimate | None:
        """Static-registration estimate using camera motion when the robot is still."""
        now = time.monotonic() if now_mono is None else now_mono
        prepared = self._prepare_window(now_mono=now, max_age_s=max_age_s)
        min_obs = int(min_observations)
        if prepared is None or prepared.observation_count < min_obs:
            return None

        odom_baseline = prepared.baseline_m
        view_baseline = prepared.view_baseline_m
        use_static_pose = odom_baseline < self._config.ALIGN_YAW_BASELINE_B0

        if use_static_pose:
            try:
                aggregate = aggregate_registration_pose(
                    prepared.observations,
                    prepared.weights,
                )
            except ValueError:
                return None
            alpha_yaw = _smoothstep(
                view_baseline,
                self._config.ALIGN_YAW_BASELINE_B0,
                self._config.ALIGN_YAW_BASELINE_B1,
            )
            alpha_scale = _smoothstep(
                odom_baseline,
                self._config.ALIGN_SCALE_BASELINE_B0,
                self._config.ALIGN_SCALE_BASELINE_B1,
            )
            yaw_out = normalize_angle(aggregate.yaw_rad)
            scale_out = self._config.ALIGN_SCALE_PRIOR
            resid_rms = aggregate.resid_rms_m
            rejected_count = 0
            confidence = _clamp(
                alpha_yaw
                * prepared.quality_term
                * (
                    1.0
                    - min(resid_rms, self._config.ALIGN_RESID_REF_M)
                    / self._config.ALIGN_RESID_REF_M
                ),
                0.0,
                1.0,
            )
            estimate = AlignmentEstimate(
                method="similarity",
                scale=scale_out,
                yaw_rad=yaw_out,
                translation_world=aggregate.translation_world,
                confidence=confidence,
                yaw_observable=alpha_yaw >= 0.5,
                scale_observable=alpha_scale >= 0.5,
                residual_rms_m=resid_rms,
                baseline_m=view_baseline,
                observation_count=prepared.observation_count,
                rejected_count=rejected_count,
                alpha_yaw=alpha_yaw,
                alpha_scale=alpha_scale,
                quality_term=prepared.quality_term,
                mean_ambiguity_ratio=prepared.mean_ambiguity_ratio,
                max_pair_skew_s=prepared.max_pair_skew_s,
                approximate=not (alpha_yaw >= 0.5 and alpha_scale >= 0.5),
                scale_confidence=0.0,
                yaw_confidence=self._config.ALIGN_REG_YAW_CONF if alpha_yaw >= 0.5 else 0.0,
                scale_held=alpha_scale < 0.5,
                yaw_held=alpha_yaw < 0.5,
            )
            self._last_estimate = estimate
            return estimate

        fit, rejected_mask = self._robust_fit(prepared)
        if fit is None:
            return None

        observability_baseline = max(odom_baseline, view_baseline)
        alpha_yaw = _smoothstep(
            observability_baseline,
            self._config.ALIGN_YAW_BASELINE_B0,
            self._config.ALIGN_YAW_BASELINE_B1,
        )
        alpha_scale = _smoothstep(
            odom_baseline,
            self._config.ALIGN_SCALE_BASELINE_B0,
            self._config.ALIGN_SCALE_BASELINE_B1,
        )
        yaw_out = normalize_angle(fit.yaw)
        scale_out = fit.scale
        c, s = math.cos(yaw_out), math.sin(yaw_out)
        r2 = np.array([[c, -s], [s, c]], dtype=np.float64)
        t2_out = prepared.mean_v - scale_out * (r2 @ prepared.mean_u)
        confidence = _clamp(
            min(alpha_yaw, alpha_scale)
            * prepared.quality_term
            * (
                1.0
                - min(fit.resid_rms, self._config.ALIGN_RESID_REF_M)
                / self._config.ALIGN_RESID_REF_M
            ),
            0.0,
            1.0,
        )
        estimate = AlignmentEstimate(
            method="similarity",
            scale=scale_out,
            yaw_rad=yaw_out,
            translation_world=(
                float(t2_out[0]),
                prepared.mean_world_y - prepared.mean_odom_z,
                -float(t2_out[1]),
            ),
            confidence=confidence,
            yaw_observable=alpha_yaw >= 0.5,
            scale_observable=alpha_scale >= 0.5,
            residual_rms_m=fit.resid_rms,
            baseline_m=observability_baseline,
            observation_count=prepared.observation_count,
            rejected_count=int(np.count_nonzero(rejected_mask)),
            alpha_yaw=alpha_yaw,
            alpha_scale=alpha_scale,
            quality_term=prepared.quality_term,
            mean_ambiguity_ratio=prepared.mean_ambiguity_ratio,
            max_pair_skew_s=prepared.max_pair_skew_s,
            approximate=not (alpha_yaw >= 0.5 and alpha_scale >= 0.5),
            scale_confidence=alpha_scale,
            yaw_confidence=alpha_yaw,
            scale_held=alpha_scale < 0.5,
            yaw_held=alpha_yaw < 0.5,
        )
        self._last_estimate = estimate
        return estimate

    def update(
        self,
        *,
        resolved_odom: OdomSample | None,
        now_mono: float | None = None,
    ) -> AlignmentEstimate | None:
        if not self._state.is_committed:
            return None

        seq = self._tag_tracker.append_seq
        if seq == self._last_applied_seq:
            if not self._held_logged:
                logger.info("alignment_held", append_seq=seq)
                self._held_logged = True
            return None
        self._held_logged = False

        now = time.monotonic() if now_mono is None else now_mono
        prepared = self._prepare_window(now_mono=now)
        if prepared is None or prepared.observation_count < self._config.ALIGN_MIN_OBS:
            self._emit_skip_log(
                skip_reason="insufficient_obs",
                observation_count=0 if prepared is None else prepared.observation_count,
            )
            return None

        fit, rejected_mask = self._robust_fit(prepared)
        if fit is None:
            return None

        rebase_detected = False
        if self._should_rebase(prepared, fit):
            rebase_detected = True
            preserved_scale = self._persistent.scale
            keep = min(self._config.ALIGN_REBASE_KEEP, prepared.observation_count)
            logger.warning(
                "world_rebase_detected",
                observation_count=prepared.observation_count,
                residual_threshold_m=self._config.ALIGN_REBASE_RESID_M,
                keep_observations=keep,
                dropped_observations=max(prepared.observation_count - keep, 0),
                scale_preserved=round(preserved_scale, 4),
            )
            prepared = self._keep_newest(prepared, keep)
            fit, rejected_mask = self._robust_fit(prepared)
            if fit is None:
                return None
            self._persistent.yaw_rad = normalize_angle(fit.yaw)
            self._persistent.yaw_confidence = self._config.ALIGN_REG_YAW_CONF

        estimate = self._build_estimate(
            prepared,
            fit,
            rejected_mask,
            apply_learning=not rebase_detected,
            rebase_detected=rebase_detected,
        )
        if estimate is None:
            return None

        self._handle_scale_band(estimate.scale)
        requested_scale = float(estimate.scale)
        if not self._state.set_odom_scale(requested_scale):
            if abs(requested_scale - self._state.odom_scale) > 1e-6:
                return None

        current_transform = self._state.current_transform()
        if current_transform is None:
            return None
        base_before = self._robot_base_world_position(resolved_odom)
        t_target = np.array(
            build_T_world_odom(estimate.yaw_rad, estimate.translation_world),
            dtype=np.float64,
            copy=True,
        )
        t_target = self._apply_floor_y_lock(t_target, resolved_odom)
        trans_delta = float(np.linalg.norm(t_target[:3, 3] - current_transform[:3, 3]))
        yaw_delta = abs(normalize_angle(yaw_from_T(t_target) - yaw_from_T(current_transform)))
        yaw_delta_deg = math.degrees(yaw_delta)

        self._registry.apply_runtime_transform(t_target, update_refiner_baseline=True)
        if self._state.method == "april_tag":
            self._state.set_approximate(estimate.approximate)

        self._last_applied_seq = seq

        if (
            trans_delta >= MIN_REPORTED_CORRECTION_TRANS_M
            or yaw_delta_deg >= MIN_REPORTED_CORRECTION_YAW_DEG
        ):
            self._sender.send(
                encode_world_frame_correction(
                    ts=time.time(),
                    trans_delta_m=trans_delta,
                    yaw_delta_deg=yaw_delta_deg,
                    yaw_corrected=estimate.yaw_observable,
                    solve_quality=estimate.quality_term,
                    solve_method=estimate.method,
                    alignment_confidence=estimate.confidence,
                    yaw_observable=estimate.yaw_observable,
                    scale_observable=estimate.scale_observable,
                    scale_confidence=estimate.scale_confidence,
                    yaw_confidence=estimate.yaw_confidence,
                    scale_held=estimate.scale_held,
                    yaw_held=estimate.yaw_held,
                )
            )

        self._emit_alignment_update(estimate)
        self._publish_pose_snapshot(resolved_odom)
        if self._on_correction_committed is not None:
            self._on_correction_committed()
        base_after = self._robot_base_world_position(resolved_odom)
        marker_jump_m = (
            float(np.linalg.norm(base_after - base_before))
            if base_before is not None and base_after is not None
            else None
        )
        logger.info(
            "Runtime correction applied",
            solve_method=estimate.method,
            solve_quality=round(estimate.quality_term, 3),
            observation_count=estimate.observation_count,
            baseline_m=round(estimate.baseline_m, 3),
            trans_delta_m=round(trans_delta, 3),
            yaw_delta_deg=round(yaw_delta_deg, 2),
            marker_jump_m=round(marker_jump_m, 3) if marker_jump_m is not None else None,
        )
        return estimate

    def _build_estimate(
        self,
        prepared: _PreparedWindow,
        fit: SimilaritySolve,
        rejected_mask: NDArray[np.bool_],
        *,
        apply_learning: bool,
        rebase_detected: bool,
    ) -> AlignmentEstimate | None:
        alpha_yaw = _smoothstep(
            prepared.yaw_baseline_m,
            self._config.ALIGN_YAW_BASELINE_B0,
            self._config.ALIGN_YAW_BASELINE_B1,
        )
        alpha_scale = _smoothstep(
            prepared.baseline_m,
            self._config.ALIGN_SCALE_BASELINE_B0,
            self._config.ALIGN_SCALE_BASELINE_B1,
        )

        if apply_learning:
            self._learn_persistent(
                fit,
                alpha_yaw=alpha_yaw,
                alpha_scale=alpha_scale,
                quality_term=prepared.quality_term,
            )

        scale_out = self._persistent.scale
        yaw_out = self._persistent.yaw_rad
        c, s = math.cos(yaw_out), math.sin(yaw_out)
        r2 = np.array([[c, -s], [s, c]], dtype=np.float64)
        t2_out = prepared.mean_v - scale_out * (r2 @ prepared.mean_u)

        residual_gate = 1.0 - min(
            fit.resid_rms,
            self._config.ALIGN_RESID_REF_M,
        ) / self._config.ALIGN_RESID_REF_M
        confidence = _clamp(
            min(self._persistent.scale_confidence, self._persistent.yaw_confidence)
            * prepared.quality_term
            * residual_gate,
            0.0,
            1.0,
        )
        scale_held = alpha_scale < 0.5
        yaw_held = alpha_yaw < 0.5

        estimate = AlignmentEstimate(
            method="similarity",
            scale=scale_out,
            yaw_rad=yaw_out,
            translation_world=(
                float(t2_out[0]),
                prepared.mean_world_y - prepared.mean_odom_z,
                -float(t2_out[1]),
            ),
            confidence=confidence,
            yaw_observable=alpha_yaw >= 0.5,
            scale_observable=alpha_scale >= 0.5,
            residual_rms_m=fit.resid_rms,
            baseline_m=prepared.baseline_m,
            observation_count=prepared.observation_count,
            rejected_count=int(np.count_nonzero(rejected_mask)),
            alpha_yaw=alpha_yaw,
            alpha_scale=alpha_scale,
            quality_term=prepared.quality_term,
            mean_ambiguity_ratio=prepared.mean_ambiguity_ratio,
            max_pair_skew_s=prepared.max_pair_skew_s,
            approximate=not (alpha_yaw >= 0.5 and alpha_scale >= 0.5),
            rebase_detected=rebase_detected,
            scale_confidence=self._persistent.scale_confidence,
            yaw_confidence=self._persistent.yaw_confidence,
            scale_held=scale_held,
            yaw_held=yaw_held,
        )
        self._last_estimate = estimate
        return estimate

    def _learn_persistent(
        self,
        fit: SimilaritySolve,
        *,
        alpha_yaw: float,
        alpha_scale: float,
        quality_term: float,
    ) -> None:
        self._learn_yaw(fit.yaw, alpha_yaw, quality_term)
        self._learn_scale(fit.scale, alpha_scale, quality_term)

    def _learn_yaw(self, yaw_fit: float, alpha: float, quality_term: float) -> None:
        if alpha < 0.5:
            self._persistent.yaw_confidence = max(
                0.0,
                self._persistent.yaw_confidence - self._config.ALIGN_CONF_DECAY,
            )
            return
        step_lr = _clamp(
            self._config.ALIGN_LEARN_LR * alpha * quality_term,
            0.0,
            self._config.ALIGN_LEARN_LR_MAX,
        )
        delta = normalize_angle(yaw_fit - self._persistent.yaw_rad)
        self._persistent.yaw_rad = normalize_angle(
            self._persistent.yaw_rad + step_lr * delta
        )
        c = self._persistent.yaw_confidence
        self._persistent.yaw_confidence = c + (1.0 - c) * step_lr

    def _learn_scale(self, scale_fit: float, alpha: float, quality_term: float) -> None:
        if alpha < 0.5:
            self._persistent.scale_confidence = max(
                0.0,
                self._persistent.scale_confidence - self._config.ALIGN_CONF_DECAY,
            )
            return
        step_lr = _clamp(
            self._config.ALIGN_LEARN_LR * alpha * quality_term,
            0.0,
            self._config.ALIGN_LEARN_LR_MAX,
        )
        scale = self._persistent.scale
        rel = abs(scale_fit - scale) / max(scale, 1e-6)
        if (
            rel > self._config.ALIGN_SCALE_JUMP_FRAC
            and self._persistent.scale_confidence >= self._config.ALIGN_SCALE_LOCK_CONF
        ):
            direction = 1 if scale_fit > scale else -1
            if self._persistent.scale_jump_direction == direction:
                self._persistent.scale_regime_agree += 1
            else:
                self._persistent.scale_regime_agree = 1
                self._persistent.scale_jump_direction = direction
            if self._persistent.scale_regime_agree < self._config.ALIGN_SCALE_REGIME_N:
                step_lr *= self._config.ALIGN_SCALE_JUMP_DAMP
        else:
            self._persistent.scale_regime_agree = 0
            self._persistent.scale_jump_direction = None

        self._persistent.scale = scale + step_lr * (scale_fit - scale)
        c = self._persistent.scale_confidence
        self._persistent.scale_confidence = c + (1.0 - c) * step_lr

    def _prepare_window(
        self,
        *,
        now_mono: float,
        max_age_s: float | None = None,
    ) -> _PreparedWindow | None:
        window_age_s = (
            self._config.ALIGN_WINDOW_MAX_AGE_S if max_age_s is None else float(max_age_s)
        )
        observations = self._tag_tracker.recent_observations(
            max_age_s=window_age_s,
        )
        if not observations:
            return None
        observations = observations[-self._config.ALIGN_WINDOW_MAX_OBS :]
        kept_observations: list[TagObservation] = []
        weights: list[float] = []
        u_rows: list[tuple[float, float]] = []
        v_rows: list[tuple[float, float]] = []
        world_y: list[float] = []
        odom_z: list[float] = []
        ambiguity: list[float] = []
        skew: list[float] = []
        qualities: list[float] = []
        for obs in observations:
            age_s = max(0.0, now_mono - obs.mono_ts)
            w_recency = math.exp(-age_s / max(self._config.ALIGN_RECENCY_TAU_S, 1e-6))
            d0 = 1.0
            d1 = max(self._config.ALIGN_MAX_DIST_CAM_M, d0 + 1e-6)
            w_distance = _clamp(1.0 - (obs.dist_cam_m - d0) / (d1 - d0), 0.2, 1.0)
            w_ambiguity = (
                1.0
                if obs.ambiguity_ratio >= self._config.ALIGN_AMBIGUITY_MIN
                else self._config.ALIGN_AMBIGUITY_PENALTY
            )
            weight = max(obs.quality, 1e-6) * w_recency * w_distance * w_ambiguity
            if weight <= 0.0 or not math.isfinite(weight):
                continue
            kept_observations.append(obs)
            weights.append(weight)
            u_rows.append((obs.p_odom_tag[0], obs.p_odom_tag[1]))
            v_rows.append((obs.p_world_tag[0], -obs.p_world_tag[2]))
            world_y.append(obs.p_world_tag[1])
            odom_z.append(obs.p_odom_tag[2])
            ambiguity.append(obs.ambiguity_ratio)
            skew.append(abs(obs.pair_skew_s))
            qualities.append(obs.quality)
        if len(weights) < 2:
            return None
        u = np.asarray(u_rows, dtype=np.float64)
        v = np.asarray(v_rows, dtype=np.float64)
        w = np.asarray(weights, dtype=np.float64)
        total_weight = float(np.sum(w))
        ground_baseline = _ground_baseline_m(kept_observations)
        mount_sep = _per_frame_mount_separation(kept_observations)
        return _PreparedWindow(
            observations=kept_observations,
            u=u,
            v=v,
            weights=w,
            mean_u=np.sum(u * w[:, np.newaxis], axis=0) / total_weight,
            mean_v=np.sum(v * w[:, np.newaxis], axis=0) / total_weight,
            quality_term=float(np.mean(qualities)),
            mean_world_y=float(np.mean(world_y)),
            mean_odom_z=float(np.mean(odom_z)),
            mean_ambiguity_ratio=float(np.mean(ambiguity)),
            max_pair_skew_s=float(max(skew)),
            baseline_m=ground_baseline,
            view_baseline_m=_view_baseline_m(kept_observations),
            yaw_baseline_m=max(ground_baseline, mount_sep),
        )

    def _robust_fit(
        self,
        prepared: _PreparedWindow,
    ) -> tuple[SimilaritySolve | None, NDArray[np.bool_]]:
        base_weights = np.asarray(prepared.weights, dtype=np.float64)
        weights = np.asarray(base_weights, dtype=np.float64, copy=True)
        fit: SimilaritySolve | None = None
        rejected_mask = np.zeros(prepared.observation_count, dtype=bool)
        for _ in range(3):
            fit = solve_similarity_2d(prepared.u, prepared.v, weights)
            residuals = self._residuals(prepared.u, prepared.v, fit)
            sigma = self._mad_sigma(residuals)
            if sigma <= 1e-6:
                rejected_mask = np.zeros_like(residuals, dtype=bool)
                break
            huber = np.minimum(
                1.0,
                (self._config.ALIGN_HUBER_K * sigma) / np.maximum(residuals, 1e-9),
            )
            weights = base_weights * huber
            rejected_mask = residuals > (self._config.ALIGN_OUTLIER_K * sigma)
        return fit, rejected_mask

    def _residuals(
        self,
        u: NDArray[np.float64],
        v: NDArray[np.float64],
        fit: SimilaritySolve,
    ) -> NDArray[np.float64]:
        c, s = math.cos(fit.yaw), math.sin(fit.yaw)
        r2 = np.array([[c, -s], [s, c]], dtype=np.float64)
        predicted = (fit.scale * (r2 @ u.T)).T + fit.t2
        return np.asarray(np.linalg.norm(v - predicted, axis=1), dtype=np.float64)

    def _should_rebase(self, prepared: _PreparedWindow, fit: SimilaritySolve) -> bool:
        residuals = self._residuals(prepared.u, prepared.v, fit)
        over = residuals > self._config.ALIGN_REBASE_RESID_M
        if float(np.mean(over.astype(np.float64))) < self._config.ALIGN_REBASE_FRAC:
            return False
        directions: list[float] = []
        c, s = math.cos(fit.yaw), math.sin(fit.yaw)
        r2 = np.array([[c, -s], [s, c]], dtype=np.float64)
        predicted = (fit.scale * (r2 @ prepared.u.T)).T + fit.t2
        for residual in (prepared.v - predicted)[over]:
            if float(np.linalg.norm(residual)) <= 1e-9:
                continue
            directions.append(math.atan2(float(residual[1]), float(residual[0])))
        if len(directions) < 2:
            return False
        mean_sin = float(np.mean(np.sin(directions)))
        mean_cos = float(np.mean(np.cos(directions)))
        r = math.hypot(mean_sin, mean_cos)
        direction_std = math.sqrt(max(0.0, -2.0 * math.log(max(r, 1e-9))))
        return direction_std < self._config.ALIGN_REBASE_DIR_STD_RAD

    def _keep_newest(self, prepared: _PreparedWindow, keep: int) -> _PreparedWindow:
        start = max(prepared.observation_count - keep, 0)
        kept = prepared.observations[start:]
        ground_baseline = _ground_baseline_m(kept)
        mount_sep = _per_frame_mount_separation(kept)
        return _PreparedWindow(
            observations=kept,
            u=prepared.u[start:],
            v=prepared.v[start:],
            weights=prepared.weights[start:],
            mean_u=prepared.mean_u if len(kept) == prepared.observation_count else np.sum(
                prepared.u[start:] * prepared.weights[start:, np.newaxis],
                axis=0,
            )
            / float(np.sum(prepared.weights[start:])),
            mean_v=prepared.mean_v if len(kept) == prepared.observation_count else np.sum(
                prepared.v[start:] * prepared.weights[start:, np.newaxis],
                axis=0,
            )
            / float(np.sum(prepared.weights[start:])),
            quality_term=float(np.mean([obs.quality for obs in kept])),
            mean_world_y=float(np.mean([obs.p_world_tag[1] for obs in kept])),
            mean_odom_z=float(np.mean([obs.p_odom_tag[2] for obs in kept])),
            mean_ambiguity_ratio=float(np.mean([obs.ambiguity_ratio for obs in kept])),
            max_pair_skew_s=float(max(abs(obs.pair_skew_s) for obs in kept)),
            baseline_m=ground_baseline,
            view_baseline_m=_view_baseline_m(kept),
            yaw_baseline_m=max(ground_baseline, mount_sep),
        )

    def _mad_sigma(self, residuals: NDArray[np.float64]) -> float:
        median = float(np.median(residuals))
        mad = float(np.median(np.abs(residuals - median)))
        return 1.4826 * mad

    def _emit_skip_log(self, *, skip_reason: str, observation_count: int) -> None:
        if self._skip_log_reason == skip_reason:
            return
        self._skip_log_reason = skip_reason
        logger.info(
            "alignment_update",
            method="similarity",
            skip_reason=skip_reason,
            n_obs=observation_count,
            min_obs=self._config.ALIGN_MIN_OBS,
        )

    def _emit_alignment_update(self, estimate: AlignmentEstimate) -> None:
        self._skip_log_reason = None
        logger.info(
            "alignment_update",
            method=estimate.method,
            s=round(estimate.scale, 4),
            yaw_deg=round(math.degrees(estimate.yaw_rad), 2),
            confidence=round(estimate.confidence, 4),
            yaw_observable=estimate.yaw_observable,
            scale_observable=estimate.scale_observable,
            scale_held=estimate.scale_held,
            yaw_held=estimate.yaw_held,
            baseline_m=round(estimate.baseline_m, 4),
            alpha_yaw=round(estimate.alpha_yaw, 4),
            alpha_scale=round(estimate.alpha_scale, 4),
            resid_rms_m=round(estimate.residual_rms_m, 4),
            n_obs=estimate.observation_count,
            n_rejected=estimate.rejected_count,
            mean_ambiguity_ratio=round(estimate.mean_ambiguity_ratio, 4),
            max_pair_skew_s=round(estimate.max_pair_skew_s, 4),
        )

    def _handle_scale_band(self, scale: float) -> None:
        if (
            self._config.ALIGN_SCALE_PLAUSIBLE_MIN
            <= scale
            <= self._config.ALIGN_SCALE_PLAUSIBLE_MAX
        ):
            self._out_of_band_consecutive = 0
            return
        self._out_of_band_consecutive += 1
        if self._out_of_band_consecutive >= 5:
            logger.warning(
                "odom_scale_out_of_band",
                requested=round(scale, 4),
                plausible_min=self._config.ALIGN_SCALE_PLAUSIBLE_MIN,
                plausible_max=self._config.ALIGN_SCALE_PLAUSIBLE_MAX,
                consecutive=self._out_of_band_consecutive,
            )

    def _robot_base_world_position(self, odom: OdomSample | None) -> NDArray[np.float64] | None:
        if odom is None:
            return None
        position, _orientation = self._state.transform_pose(
            odom.position,
            odom.orientation,
        )
        base_world = np.asarray(position, dtype=np.float64)
        if base_world.shape != (3,) or not np.all(np.isfinite(base_world)):
            return None
        return base_world

    def _publish_pose_snapshot(self, resolved_odom: OdomSample | None) -> None:
        sample = resolved_odom if resolved_odom is not None else self._odom.latest()
        if sample is None:
            return
        snapshot_ts = sample.source_ts if sample.source_ts is not None else time.time()
        self._telemetry.publish_pose_snapshot(
            ts=snapshot_ts,
            sample=sample,
            force=True,
        )
