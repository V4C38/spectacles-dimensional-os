"""RegistrationSessionFrames capture policy and frame ack tests."""

from __future__ import annotations

import json
from unittest.mock import MagicMock

import pytest

from dimos.ar.network.protocol import CameraInfoMessage
from dimos.ar.registration.session import RegistrationSession
from dimos.ar.tag_tracking.solve import CAPTURE_MAX_DISTANCE_MARGIN


def _make_session() -> tuple[RegistrationSession, list[str], MagicMock]:
    sent: list[str] = []
    sender = MagicMock()
    sender.send.side_effect = sent.append
    tag_tracker = MagicMock()
    tag_tracker.primary_tag_size_m = 0.056
    session = RegistrationSession(
        robot_id="test_robot",
        sender=sender,
        registry=MagicMock(),
        odom=MagicMock(),
        status=MagicMock(),
        tag_tracker=tag_tracker,
        loop=MagicMock(),
        frame_max_age_s=4.0,
        manual_registration_quality=0.7,
        world_frame_refiner=MagicMock(),
        capture_min_tag_px=24.0,
        capture_max_distance_margin=CAPTURE_MAX_DISTANCE_MARGIN,
        capture_max_speed_mps=0.45,
        capture_min_distance_m=0.35,
        align_min_obs=3,
    )
    return session, sent, tag_tracker


def test_on_camera_info_sends_capture_policy() -> None:
    session, sent, _tag_tracker = _make_session()
    msg = CameraInfoMessage(
        ts=1.0,
        robot_id="test_robot",
        width=1280,
        height=720,
        fx=560.0,
        fy=560.0,
        cx=640.0,
        cy=360.0,
        distortion=(),
        camera_model="pinhole",
        device_model="spectacles",
    )

    session.on_camera_info(msg, MagicMock())

    assert len(sent) == 1
    payload = json.loads(sent[0])
    assert payload["type"] == "capture_policy"
    assert payload["max_stream_distance_m"] == pytest.approx(1.6333, abs=1e-4)
    assert payload["min_stream_distance_m"] == 0.35
    assert payload["max_capture_speed_mps"] == 0.45
    assert payload["static_speed_mps"] == 0.05
    assert payload["min_observations"] == 3


def test_on_camera_info_stores_shared_max_distance_for_frames() -> None:
    session, _sent, _tag_tracker = _make_session()
    msg = CameraInfoMessage(
        ts=1.0,
        robot_id="test_robot",
        width=1280,
        height=720,
        fx=560.0,
        fy=560.0,
        cx=640.0,
        cy=360.0,
        distortion=(),
        camera_model="pinhole",
        device_model="spectacles",
    )

    assert session.capture_max_stream_distance_m is None
    session.on_camera_info(msg, MagicMock())

    expected = 560.0 * 0.056 / 24.0 * CAPTURE_MAX_DISTANCE_MARGIN
    assert session.capture_max_stream_distance_m == pytest.approx(expected, abs=1e-4)


def test_send_frame_ack_carries_obs_added() -> None:
    session, sent, _tag_tracker = _make_session()

    session._send_frame_ack({"seq": 7}, obs_added=True)

    payload = json.loads(sent[0])
    assert payload["type"] == "camera_frame_ack"
    assert payload["seq"] == 7
    assert payload["obs_added"] is True
