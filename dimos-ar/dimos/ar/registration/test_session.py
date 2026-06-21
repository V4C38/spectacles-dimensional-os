"""Smoke tests for RegistrationSession — full integration tests live in hardware runs."""

from __future__ import annotations

from unittest.mock import MagicMock

import numpy as np

from dimos.ar.registration.registry import WorldRegistry
from dimos.ar.registration.session import RegistrationSession
from dimos.ar.registration.transforms import Calibration
from dimos.ar.registration.wire import RegistrationCommandMessage


def _make_session(
    *,
    registry: WorldRegistry | None = None,
) -> tuple[RegistrationSession, list[str], WorldRegistry]:
    sent: list[str] = []
    sender = MagicMock()
    sender.send.side_effect = sent.append
    calibration = Calibration()
    if registry is None:
        registry = WorldRegistry(calibration, tf_publish_static=lambda _tf: None)
    odom = MagicMock()
    odom.latest.return_value = None
    status = MagicMock()
    tag_tracker = MagicMock()
    tag_tracker.active = False
    tag_tracker.has_camera_info.return_value = True
    tag_tracker.last_tag_detected = False
    tag_tracker.robot_world_pose_estimate.return_value = None
    pose_refiner = MagicMock()
    adapter = MagicMock()
    adapter.baseline_motion_available.return_value = True
    session = RegistrationSession(
        robot_id="test_robot",
        sender=sender,
        registry=registry,
        odom=odom,
        status=status,
        tag_tracker=tag_tracker,
        frame_max_age_s=4.0,
        manual_registration_quality=0.7,
        pose_refiner=pose_refiner,
        adapter=adapter,
    )
    return session, sent, registry


def test_registration_command_start_april_odom_broadcasts_scanning() -> None:
    session, sent, _registry = _make_session()
    session.on_registration_command(
        RegistrationCommandMessage(ts=1.0, robot_id="test_robot", command="start", mode="april_odom_baseline"),
        MagicMock(),
    )
    assert sent
    assert '"type":"registration_status"' in sent[-1]
    assert '"phase":"scanning"' in sent[-1] or '"phase":"failed"' in sent[-1]


def test_registration_command_start_manual_enters_editing() -> None:
    session, sent, _registry = _make_session()
    session.on_registration_command(
        RegistrationCommandMessage(ts=1.0, robot_id="test_robot", command="start", mode="manual_pose"),
        MagicMock(),
    )
    assert sent
    assert '"phase":"editing"' in sent[-1]


def test_registration_command_stop_clears_committed_registration_when_idle() -> None:
    session, _sent, registry = _make_session()
    registry.calibration.register_world_odom(np.eye(4, dtype=np.float64))
    assert registry.calibration.is_registered

    session.on_registration_command(
        RegistrationCommandMessage(ts=1.0, robot_id="test_robot", command="stop"),
        MagicMock(),
    )

    assert not registry.calibration.is_registered
    session._status.set_registered.assert_called_with(False)
    session._status.broadcast.assert_called()
