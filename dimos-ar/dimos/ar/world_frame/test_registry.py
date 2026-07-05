"""Regression tests for WorldRegistry commit/clear lifecycle."""

from __future__ import annotations

import math
from unittest.mock import MagicMock

import numpy as np
import pytest

from dimos.ar.registration.types import RegistrationCandidate, RegistrationMode
from dimos.ar.world_frame.refinement import WorldFrameRefiner
from dimos.ar.world_frame.registry import WorldRegistry
from dimos.ar.world_frame.state import WorldFrameState
from dimos.msgs.geometry_msgs.Quaternion import Quaternion


def _tilted_transform() -> np.ndarray:
    pitch = math.radians(15)
    roll = math.radians(10)
    yaw = math.radians(60)
    c_pitch, s_pitch = math.cos(pitch), math.sin(pitch)
    c_roll, s_roll = math.cos(roll), math.sin(roll)
    c_yaw, s_yaw = math.cos(yaw), math.sin(yaw)
    R_pitch = np.array([[1, 0, 0], [0, c_pitch, -s_pitch], [0, s_pitch, c_pitch]])
    R_roll = np.array([[c_roll, -s_roll, 0], [s_roll, c_roll, 0], [0, 0, 1]])
    R_yaw = np.array([[c_yaw, -s_yaw, 0], [s_yaw, c_yaw, 0], [0, 0, 1]])
    R = R_yaw @ R_roll @ R_pitch
    T = np.eye(4, dtype=np.float64)
    T[:3, :3] = R
    T[:3, 3] = [1.0, 0.5, 2.0]
    return T


def test_commit_publishes_tf_from_leveled_state_not_raw_candidate() -> None:
    state = WorldFrameState()
    published_tf: list[object] = []

    def record_tf(tf) -> None:
        published_tf.append(tf)

    registry = WorldRegistry(state, record_tf)
    raw = _tilted_transform()
    candidate = RegistrationCandidate(
        T_world_odom=raw,
        quality=0.9,
        mode=RegistrationMode.APRIL_TAG,
        approximate=False,
    )
    registry.commit(candidate)

    assert len(published_tf) == 1
    leveled = state.current_transform()
    assert leveled is not None
    pub = published_tf[0]
    expected_quat = Quaternion.from_rotation_matrix(leveled[:3, :3])
    assert np.allclose(
        [pub.translation.x, pub.translation.y, pub.translation.z],
        leveled[:3, 3],
        atol=1e-6,
    )
    assert np.allclose(
        [pub.rotation.x, pub.rotation.y, pub.rotation.z, pub.rotation.w],
        [expected_quat.x, expected_quat.y, expected_quat.z, expected_quat.w],
        atol=1e-6,
    )
    assert not np.allclose(leveled[:3, :3], raw[:3, :3], atol=1e-3)


def test_commit_syncs_refiner_baseline() -> None:
    state = WorldFrameState()
    registry = WorldRegistry(state, lambda _tf: None)
    refiner = WorldFrameRefiner(
        registry=registry,
        telemetry=MagicMock(),
        robot_id="test",
        sender=MagicMock(),
        odom=MagicMock(),
        tag_tracker=MagicMock(),
        runtime_profile=MagicMock(),
        runtime_correction_enabled=False,
    )
    registry.attach_refiner(refiner)
    raw = _tilted_transform()
    candidate = RegistrationCandidate(
        T_world_odom=raw,
        quality=0.9,
        mode=RegistrationMode.MANUAL_POSE,
        approximate=False,
    )
    registry.commit(candidate)

    leveled = state.current_transform()
    assert leveled is not None
    assert refiner.refinement_baseline is not None
    assert np.allclose(refiner.refinement_baseline, leveled, atol=1e-6)


def test_clear_resets_state_and_refiner_baseline() -> None:
    state = WorldFrameState()
    registry = WorldRegistry(state, lambda _tf: None)
    refiner = WorldFrameRefiner(
        registry=registry,
        telemetry=MagicMock(),
        robot_id="test",
        sender=MagicMock(),
        odom=MagicMock(),
        tag_tracker=MagicMock(),
        runtime_profile=MagicMock(),
        runtime_correction_enabled=False,
    )
    registry.attach_refiner(refiner)
    T = np.eye(4, dtype=np.float64)
    T[0, 3] = 3.0
    registry.commit(
        RegistrationCandidate(
            T_world_odom=T,
            quality=0.8,
            mode=RegistrationMode.MANUAL_POSE,
            approximate=False,
        )
    )
    assert state.is_committed
    assert refiner.refinement_baseline is not None

    registry.clear()

    assert not state.is_committed
    assert refiner.refinement_baseline is None


def test_apply_runtime_transform_updates_state_and_baseline() -> None:
    state = WorldFrameState()
    published_tf: list[object] = []
    registry = WorldRegistry(state, published_tf.append)
    refiner = WorldFrameRefiner(
        registry=registry,
        telemetry=MagicMock(),
        robot_id="test",
        sender=MagicMock(),
        odom=MagicMock(),
        tag_tracker=MagicMock(),
        runtime_profile=MagicMock(),
        runtime_correction_enabled=False,
    )
    registry.attach_refiner(refiner)
    T = np.eye(4, dtype=np.float64)
    T[0, 3] = 2.0
    registry.commit(
        RegistrationCandidate(
            T_world_odom=T,
            quality=0.9,
            mode=RegistrationMode.MANUAL_POSE,
            approximate=False,
        )
    )
    published_tf.clear()

    T_update = np.eye(4, dtype=np.float64)
    T_update[0, 3] = 5.0
    registry.apply_runtime_transform(T_update)

    leveled = state.current_transform()
    assert leveled is not None
    assert leveled[0, 3] == pytest.approx(5.0, abs=1e-6)
    assert refiner.refinement_baseline is not None
    assert np.allclose(refiner.refinement_baseline, leveled, atol=1e-6)
    assert len(published_tf) == 1


def test_apply_runtime_transform_publishes_on_every_call() -> None:
    state = WorldFrameState()
    published_tf: list[object] = []
    registry = WorldRegistry(state, published_tf.append)
    T = np.eye(4, dtype=np.float64)
    registry.commit(
        RegistrationCandidate(
            T_world_odom=T,
            quality=0.9,
            mode=RegistrationMode.MANUAL_POSE,
            approximate=False,
        )
    )
    published_tf.clear()

    T1 = np.eye(4, dtype=np.float64)
    T1[0, 3] = 1.0
    T2 = np.eye(4, dtype=np.float64)
    T2[0, 3] = 2.0
    registry.apply_runtime_transform(T1)
    registry.apply_runtime_transform(T2)
    assert len(published_tf) == 2


def test_apply_runtime_transform_raises_when_uncommitted() -> None:
    state = WorldFrameState()
    registry = WorldRegistry(state, lambda _tf: None)
    with pytest.raises(RuntimeError, match="committed"):
        registry.apply_runtime_transform(np.eye(4, dtype=np.float64))
