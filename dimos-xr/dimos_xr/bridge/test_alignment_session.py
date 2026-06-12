"""Regression tests for AlignmentController session semantics (Protocol v4).

Covers:
  1. align_start(method="tag") activates tag tracker
  2. align_start(method="manual") leaves tag tracker inactive
  3. align_manual_pose dropped when no manual session open
  4. camera frame acked without detection when session is manual
  5. align_stop clears session and broadcasts cancellation
  6. _clear_session resets _session_method to None
"""

from __future__ import annotations

import json
from unittest.mock import MagicMock

import pytest

from dimos_xr.bridge.alignment import AlignmentController
from dimos_xr.bridge.odom_buffer import OdomBuffer
from dimos_xr.bridge.sender import BridgeSender
from dimos_xr.network.protocol import (
    AlignManualPoseMessage,
    AlignStartMessage,
    AlignStopMessage,
)
from dimos_xr.tracking.tag_tracker import TagTrackerConfig
from dimos_xr.tracking.transforms import Calibration


def _make_controller() -> tuple[AlignmentController, list[str]]:
    """Build a minimal AlignmentController; return it plus a list that collects sent payloads."""
    sent: list[str] = []
    mock_server = MagicMock()
    mock_server.schedule_send.side_effect = lambda msg: sent.append(msg)

    sender = BridgeSender()
    sender.bind(mock_server)

    calibration = Calibration()
    odom = OdomBuffer()

    mock_status = MagicMock()
    mock_status.broadcast.return_value = None

    tag_mounts: list = []
    tracker_config = TagTrackerConfig()

    ctrl = AlignmentController(
        robot_id="test_robot",
        sender=sender,
        calibration=calibration,
        odom=odom,
        status=mock_status,
        tag_mounts=tag_mounts,
        tracker_config=tracker_config,
        frame_max_age_s=1.0,
        manual_alignment_quality=0.7,
        runtime_correction_enabled=False,
        tag_smoothing_tau_s=1.0,
        tf_publish_static=MagicMock(),
    )
    return ctrl, sent


def _align_start(method: str, ts: float = 1.0) -> AlignStartMessage:
    return AlignStartMessage(ts=ts, robot_id="test_robot", method=method)


def _align_stop(ts: float = 2.0) -> AlignStopMessage:
    return AlignStopMessage(ts=ts, robot_id="test_robot")


# ------------------------------------------------------------------
# 1. align_start(method="tag") activates tag tracker
# ------------------------------------------------------------------

def test_align_start_tag_activates_tracker() -> None:
    ctrl, sent = _make_controller()
    ctrl._stop_broadcast()  # prevent background thread from interfering

    ctrl.on_align_start(_align_start("tag"), MagicMock())
    ctrl._stop_broadcast()

    assert ctrl._session_method == "tag"
    assert ctrl._tag_tracker.active is True
    # an align_status broadcast must have been sent
    assert any(json.loads(m)["type"] == "align_status" for m in sent)


# ------------------------------------------------------------------
# 2. align_start(method="manual") leaves tag tracker inactive
# ------------------------------------------------------------------

def test_align_start_manual_leaves_tracker_inactive() -> None:
    ctrl, sent = _make_controller()

    ctrl.on_align_start(_align_start("manual"), MagicMock())
    ctrl._stop_broadcast()

    assert ctrl._session_method == "manual"
    assert ctrl._tag_tracker.active is False
    assert any(json.loads(m)["type"] == "align_status" for m in sent)


# ------------------------------------------------------------------
# 3. align_manual_pose dropped when no manual session open
# ------------------------------------------------------------------

def test_align_manual_pose_dropped_outside_manual_session() -> None:
    ctrl, sent = _make_controller()
    # No session started — _session_method is None

    pose_msg = AlignManualPoseMessage(
        ts=1.0,
        robot_id="test_robot",
        position=(0.0, 0.0, 0.0),
        orientation=(0.0, 0.0, 0.0, 1.0),
    )
    ctrl.on_align_manual_pose(pose_msg, MagicMock())

    # No candidate should have been registered
    assert ctrl._best_alignment is None
    assert ctrl._candidate_count == 0


def test_align_manual_pose_dropped_when_tag_session_open() -> None:
    ctrl, sent = _make_controller()
    ctrl.on_align_start(_align_start("tag"), MagicMock())
    ctrl._stop_broadcast()
    sent.clear()

    pose_msg = AlignManualPoseMessage(
        ts=1.5,
        robot_id="test_robot",
        position=(0.0, 0.0, 0.0),
        orientation=(0.0, 0.0, 0.0, 1.0),
    )
    ctrl.on_align_manual_pose(pose_msg, MagicMock())

    assert ctrl._best_alignment is None


# ------------------------------------------------------------------
# 4. camera frame fast-path: acked without detection for manual session
# ------------------------------------------------------------------

@pytest.mark.asyncio
async def test_camera_frame_acked_not_processed_in_manual_session() -> None:
    ctrl, sent = _make_controller()
    ctrl.on_align_start(_align_start("manual"), MagicMock())
    ctrl._stop_broadcast()
    sent.clear()

    header = {"seq": 42, "ts": 1.0, "send_ts": 1.01}
    jpeg = b"\xff\xd8\xff\xe0" + b"\x00" * 100  # minimal fake JPEG bytes

    await ctrl.on_camera_frame(header, jpeg, MagicMock())

    # Must have sent exactly one camera_frame_ack
    acks = [m for m in sent if json.loads(m)["type"] == "camera_frame_ack"]
    assert len(acks) == 1
    ack = json.loads(acks[0])
    assert ack["seq"] == 42
    # Tag tracker must remain inactive (no detection ran)
    assert ctrl._tag_tracker.active is False


# ------------------------------------------------------------------
# 5. align_stop clears session and broadcasts cancellation
# ------------------------------------------------------------------

def test_align_stop_clears_session_and_broadcasts() -> None:
    ctrl, sent = _make_controller()
    ctrl.on_align_start(_align_start("tag"), MagicMock())
    ctrl._stop_broadcast()
    sent.clear()

    ctrl.on_align_stop(_align_stop(), MagicMock())

    assert ctrl._session_method is None
    assert ctrl._tag_tracker.active is False
    statuses = [json.loads(m) for m in sent if json.loads(m)["type"] == "align_status"]
    assert any(s.get("message") == "Alignment cancelled" for s in statuses)


# ------------------------------------------------------------------
# 6. _clear_session resets _session_method to None
# ------------------------------------------------------------------

def test_clear_session_resets_session_method() -> None:
    ctrl, _ = _make_controller()
    ctrl._session_method = "manual"  # type: ignore[assignment]
    ctrl._candidate_count = 3
    ctrl._latest_cluster_size = 5

    ctrl._clear_session()

    assert ctrl._session_method is None
    assert ctrl._candidate_count == 0
    assert ctrl._latest_cluster_size == 0
    assert ctrl._best_alignment is None
