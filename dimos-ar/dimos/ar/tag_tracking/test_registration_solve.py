"""Tests for static-registration pose aggregation helpers."""

from __future__ import annotations

import math
import time

import numpy as np
import pytest

from dimos.ar.tag_tracking.solve import (
    TagObservation,
    _view_baseline_m,
    aggregate_registration_pose,
    build_T_world_odom,
)


def _observations_with_cam(
    cam_positions: list[tuple[float, float, float]],
    *,
    yaw_rad: float,
    translation_world: tuple[float, float, float],
) -> list[TagObservation]:
    T_world_odom = build_T_world_odom(yaw_rad, translation_world)
    T_odom_tag = np.eye(4, dtype=np.float64)
    T_world_tag = T_world_odom @ T_odom_tag
    now = time.monotonic()
    p_world = tuple(float(v) for v in T_world_tag[:3, 3])
    return [
        TagObservation(
            mono_ts=now - 0.1 * idx,
            tag_id=0,
            p_world_tag=p_world,
            p_odom_tag=(0.0, 0.0, 0.0),
            T_world_tag=np.array(T_world_tag, dtype=np.float64, copy=True),
            T_odom_tag=np.array(T_odom_tag, dtype=np.float64, copy=True),
            T_odom_base=np.eye(4, dtype=np.float64),
            quality=0.9,
            reprojection_error_px=0.4,
            cam_pos=cam_pos,
        )
        for idx, cam_pos in enumerate(cam_positions)
    ]


def test_view_baseline_uses_camera_positions() -> None:
    observations = _observations_with_cam(
        [(0.0, 0.0, 0.0), (0.6, 0.0, 0.0)],
        yaw_rad=0.0,
        translation_world=(0.0, 0.0, 0.0),
    )
    assert _view_baseline_m(observations) == pytest.approx(0.6, abs=1e-6)


def test_aggregate_registration_pose_recovers_yaw() -> None:
    observations = _observations_with_cam(
        [(0.0, 0.0, 1.0), (0.5, 0.0, 1.0), (0.0, 0.5, 1.0), (0.4, 0.3, 1.1)],
        yaw_rad=math.radians(30.0),
        translation_world=(2.0, 0.0, -1.0),
    )
    aggregate = aggregate_registration_pose(
        observations,
        np.ones(len(observations), dtype=np.float64),
    )
    assert aggregate.yaw_rad == pytest.approx(math.radians(30.0), abs=0.02)
    assert aggregate.translation_world[0] == pytest.approx(2.0, abs=0.02)
    assert aggregate.resid_rms_m == pytest.approx(0.0, abs=1e-3)
