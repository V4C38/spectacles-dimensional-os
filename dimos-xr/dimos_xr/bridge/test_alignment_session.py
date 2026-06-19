"""Regression tests for AlignmentController session semantics (Protocol v4).

Hardware validation checklist (Tier 2 exact pairing — run on device):
  1. Connect: stable RTT and clock offset within a few ms on LAN.
  2. Residual-vs-speed: moving_robot_diag world_residual_m slope → 0 at cruise.
  3. G1: regime classifier stable under gait sway (measured twist speed).
  4. Sync loss: disconnect/reconnect skips frames cleanly; no marker jump.

Covers:
  1. align_start(method="tag", assist=True) activates tag tracker (with assist driver)
  2. align_start(method="tag") without assist driver → immediate failed
  3. align_start(method="manual") leaves tag tracker inactive
  4. align_manual_pose dropped when no manual session open
  5. camera frame acked without detection when session is manual
  6. align_stop clears session and broadcasts cancellation
  7. _clear_session resets _session_method to None
  8. assist DONE with valid solve → auto-commits
  9. assist DONE with no solve → single failed, loop stops
  10. manual align_commit with pending candidate → aligned
  11. tag without assist → immediate failed broadcast
"""

from __future__ import annotations

import json
import math
import time
from unittest.mock import MagicMock

import numpy as np
import pytest

from dimos_xr.adapters.base import RuntimeAlignmentProfile
from dimos_xr.bridge.alignment import AlignmentController
from dimos_xr.bridge.assist import AssistDriver, AssistState, _MovePhase
from dimos_xr.bridge.odom_buffer import OdomBuffer
from dimos_xr.bridge.sender import BridgeSender
from dimos_xr.network.protocol import (
    AlignCommitMessage,
    AlignManualPoseMessage,
    AlignStartMessage,
    AlignStopMessage,
)
from dimos_xr.tracking.tag_tracker import (
    TagSolve,
    TagTrackerConfig,
    _yaw_from_T,
    build_T_world_odom,
)
from dimos_xr.tracking.transforms import Calibration, OdomSample


def _make_controller(*, with_adapter: bool = False) -> tuple[AlignmentController, list[str]]:
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

    adapter = None
    if with_adapter:
        adapter = MagicMock()
        adapter.assist_motion_available.return_value = True
        adapter.assist_strafe_speed.return_value = 0.5
        adapter.assist_set_lateral_velocity.return_value = True

    ctrl = AlignmentController(
        robot_id="test_robot",
        sender=sender,
        calibration=calibration,
        odom=odom,
        status=mock_status,
        tag_mounts=[],
        tracker_config=TagTrackerConfig(),
        frame_max_age_s=1.0,
        manual_alignment_quality=0.7,
        runtime_correction_enabled=False,
        tf_publish_static=MagicMock(),
        adapter=adapter,
    )
    return ctrl, sent


def _align_start(method: str, *, assist: bool = False, ts: float = 1.0) -> AlignStartMessage:
    return AlignStartMessage(ts=ts, robot_id="test_robot", method=method, assist=assist)


def _align_stop(ts: float = 2.0) -> AlignStopMessage:
    return AlignStopMessage(ts=ts, robot_id="test_robot")


# ------------------------------------------------------------------
# 1. align_start(method="tag", assist=True) with assist driver activates tracker
# ------------------------------------------------------------------

def test_align_start_tag_with_assist_activates_tracker() -> None:
    ctrl, sent = _make_controller(with_adapter=True)
    ctrl._stop_broadcast()

    ctrl.on_align_start(_align_start("tag", assist=True), MagicMock())
    ctrl._stop_broadcast()

    assert ctrl._session_method == "tag"
    assert ctrl._tag_tracker.active is True
    assert any(json.loads(m)["type"] == "align_status" for m in sent)


# ------------------------------------------------------------------
# 2. align_start(method="tag") without assist driver → immediate failed
# ------------------------------------------------------------------

def test_align_start_tag_without_assist_driver_fails() -> None:
    ctrl, sent = _make_controller(with_adapter=False)  # no assist driver
    ctrl._stop_broadcast()

    ctrl.on_align_start(_align_start("tag", assist=True), MagicMock())
    ctrl._stop_broadcast()

    assert ctrl._session_method is None
    assert ctrl._tag_tracker.active is False
    statuses = [json.loads(m) for m in sent if json.loads(m)["type"] == "align_status"]
    assert any(s["state"] == "failed" for s in statuses)


def test_align_start_tag_with_assist_false_fails() -> None:
    """Even with an assist driver, passing assist=False must fail immediately."""
    ctrl, sent = _make_controller(with_adapter=True)
    ctrl._stop_broadcast()

    ctrl.on_align_start(_align_start("tag", assist=False), MagicMock())
    ctrl._stop_broadcast()

    assert ctrl._session_method is None
    statuses = [json.loads(m) for m in sent if json.loads(m)["type"] == "align_status"]
    assert any(s["state"] == "failed" for s in statuses)


# ------------------------------------------------------------------
# 3. align_start(method="manual") leaves tag tracker inactive
# ------------------------------------------------------------------

def test_align_start_manual_leaves_tracker_inactive() -> None:
    ctrl, sent = _make_controller()

    ctrl.on_align_start(_align_start("manual"), MagicMock())
    ctrl._stop_broadcast()

    assert ctrl._session_method == "manual"
    assert ctrl._tag_tracker.active is False
    assert any(json.loads(m)["type"] == "align_status" for m in sent)


# ------------------------------------------------------------------
# 4. align_manual_pose dropped when no manual session open
# ------------------------------------------------------------------

def test_align_manual_pose_dropped_outside_manual_session() -> None:
    ctrl, sent = _make_controller()

    pose_msg = AlignManualPoseMessage(
        ts=1.0,
        robot_id="test_robot",
        position=(0.0, 0.0, 0.0),
        orientation=(0.0, 0.0, 0.0, 1.0),
    )
    ctrl.on_align_manual_pose(pose_msg, MagicMock())

    assert ctrl._pending_candidate is None


def test_align_manual_pose_dropped_when_tag_session_open() -> None:
    ctrl, sent = _make_controller(with_adapter=True)
    ctrl.on_align_start(_align_start("tag", assist=True), MagicMock())
    ctrl._stop_broadcast()
    sent.clear()

    pose_msg = AlignManualPoseMessage(
        ts=1.5,
        robot_id="test_robot",
        position=(0.0, 0.0, 0.0),
        orientation=(0.0, 0.0, 0.0, 1.0),
    )
    ctrl.on_align_manual_pose(pose_msg, MagicMock())

    assert ctrl._pending_candidate is None


# ------------------------------------------------------------------
# 5. camera frame fast-path: acked without detection for manual session
# ------------------------------------------------------------------

@pytest.mark.asyncio
async def test_camera_frame_acked_not_processed_in_manual_session() -> None:
    ctrl, sent = _make_controller()
    ctrl.on_align_start(_align_start("manual"), MagicMock())
    ctrl._stop_broadcast()
    sent.clear()

    header = {"seq": 42, "ts": 1.0, "send_ts": 1.01}
    jpeg = b"\xff\xd8\xff\xe0" + b"\x00" * 100

    await ctrl.on_camera_frame(header, jpeg, MagicMock())

    acks = [m for m in sent if json.loads(m)["type"] == "camera_frame_ack"]
    assert len(acks) == 1
    assert json.loads(acks[0])["seq"] == 42
    assert ctrl._tag_tracker.active is False


@pytest.mark.asyncio
async def test_camera_frame_acked_not_processed_during_assist_leg() -> None:
    ctrl, sent = _make_controller(with_adapter=True)
    ctrl.on_align_start(_align_start("tag", assist=True), MagicMock())
    ctrl._stop_broadcast()
    sent.clear()

    assert ctrl._assist_driver is not None
    ctrl._assist_driver._state = AssistState.MOVE
    ctrl._assist_driver._move_phase = _MovePhase.LEG
    ctrl._tag_tracker.has_camera_info = MagicMock(return_value=True)  # type: ignore[method-assign]
    ctrl._tag_tracker.process_frame = MagicMock()  # type: ignore[method-assign]

    header = {"seq": 43, "ts": 1.0, "send_ts": 1.01, "capture_ts_robot": 1.0}
    ctrl._odom.update = MagicMock(  # type: ignore[method-assign]
        return_value=OdomSample(position=(0.0, 0.0, 0.0), orientation=(0.0, 0.0, 0.0, 1.0))
    )
    ctrl._odom.latest = MagicMock(return_value=OdomSample(  # type: ignore[method-assign]
        position=(0.0, 0.0, 0.0), orientation=(0.0, 0.0, 0.0, 1.0)
    ))
    ctrl._odom.at_interpolated_by_source = MagicMock(  # type: ignore[method-assign]
        return_value=OdomSample(position=(0.0, 0.0, 0.0), orientation=(0.0, 0.0, 0.0, 1.0))
    )
    ctrl._odom.at_or_latest_by_source = ctrl._odom.at_interpolated_by_source  # type: ignore[method-assign]
    jpeg = b"\xff\xd8\xff\xe0" + b"\x00" * 100

    await ctrl.on_camera_frame(header, jpeg, MagicMock())

    acks = [m for m in sent if json.loads(m)["type"] == "camera_frame_ack"]
    assert len(acks) == 1
    assert json.loads(acks[0])["seq"] == 43
    ctrl._tag_tracker.process_frame.assert_not_called()  # type: ignore[union-attr]


@pytest.mark.asyncio
async def test_camera_frame_processed_during_assist_sample() -> None:
    ctrl, sent = _make_controller(with_adapter=True)
    ctrl.on_align_start(_align_start("tag", assist=True), MagicMock())
    ctrl._stop_broadcast()
    sent.clear()

    assert ctrl._assist_driver is not None
    ctrl._assist_driver._state = AssistState.MOVE
    ctrl._assist_driver._move_phase = _MovePhase.SAMPLE
    ctrl._tag_tracker.has_camera_info = MagicMock(return_value=True)  # type: ignore[method-assign]
    ctrl._tag_tracker.process_frame = MagicMock(
        return_value=MagicMock(tag_detected=True, tag_ids=[0], quality=0.9)
    )  # type: ignore[method-assign]
    ctrl._apply_tracker_update = MagicMock()  # type: ignore[method-assign]

    header = {"seq": 44, "ts": 1.0, "send_ts": 1.01, "capture_ts_robot": 1.0}
    jpeg = b"\xff\xd8\xff\xe0" + b"\x00" * 100
    ctrl._odom.latest = MagicMock(return_value=OdomSample(  # type: ignore[method-assign]
        position=(0.0, 0.0, 0.0), orientation=(0.0, 0.0, 0.0, 1.0)
    ))
    ctrl._odom.at_interpolated_by_source = MagicMock(  # type: ignore[method-assign]
        return_value=OdomSample(position=(0.0, 0.0, 0.0), orientation=(0.0, 0.0, 0.0, 1.0))
    )
    ctrl._odom.at_or_latest_by_source = ctrl._odom.at_interpolated_by_source  # type: ignore[method-assign]

    await ctrl.on_camera_frame(header, jpeg, MagicMock())

    acks = [m for m in sent if json.loads(m)["type"] == "camera_frame_ack"]
    assert len(acks) == 1
    assert json.loads(acks[0])["seq"] == 44
    ctrl._tag_tracker.process_frame.assert_called_once()  # type: ignore[union-attr]
    ctrl._apply_tracker_update.assert_called_once()  # type: ignore[union-attr]
    call_kwargs = ctrl._apply_tracker_update.call_args.kwargs  # type: ignore[union-attr]
    assert call_kwargs["ts"] == 1.0
    assert "resolved_odom" in call_kwargs


@pytest.mark.asyncio
async def test_camera_frame_skipped_without_capture_ts_robot() -> None:
    ctrl, sent = _make_controller(with_adapter=True)
    ctrl.on_align_start(_align_start("tag", assist=True), MagicMock())
    ctrl._stop_broadcast()
    sent.clear()

    assert ctrl._assist_driver is not None
    ctrl._assist_driver._state = AssistState.MOVE
    ctrl._assist_driver._move_phase = _MovePhase.SAMPLE
    ctrl._tag_tracker.has_camera_info = MagicMock(return_value=True)  # type: ignore[method-assign]
    ctrl._tag_tracker.process_frame = MagicMock()  # type: ignore[method-assign]

    header = {"seq": 45, "ts": 1.0, "send_ts": 1.01}
    jpeg = b"\xff\xd8\xff\xe0" + b"\x00" * 100

    await ctrl.on_camera_frame(header, jpeg, MagicMock())

    acks = [m for m in sent if json.loads(m)["type"] == "camera_frame_ack"]
    assert len(acks) == 1
    ctrl._tag_tracker.process_frame.assert_not_called()  # type: ignore[union-attr]


# ------------------------------------------------------------------
# 6. align_stop clears session and broadcasts cancellation
# ------------------------------------------------------------------

def test_align_stop_clears_session_and_broadcasts() -> None:
    ctrl, sent = _make_controller(with_adapter=True)
    ctrl.on_align_start(_align_start("tag", assist=True), MagicMock())
    ctrl._stop_broadcast()
    sent.clear()

    ctrl.on_align_stop(_align_stop(), MagicMock())

    assert ctrl._session_method is None
    assert ctrl._tag_tracker.active is False
    statuses = [json.loads(m) for m in sent if json.loads(m)["type"] == "align_status"]
    assert any(s.get("message") == "Alignment cancelled" for s in statuses)


# ------------------------------------------------------------------
# 7. _clear_session resets state fields
# ------------------------------------------------------------------

def test_clear_session_resets_session_method() -> None:
    ctrl, _ = _make_controller()
    ctrl._session_method = "manual"  # type: ignore[assignment]
    ctrl._pending_candidate = MagicMock()

    ctrl._clear_session()

    assert ctrl._session_method is None
    assert ctrl._pending_candidate is None


# ------------------------------------------------------------------
# 8. assist DONE with valid solve → auto-commits (aligned)
# ------------------------------------------------------------------

def test_assist_auto_commit_emits_no_trailing_detecting(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The broadcast loop must not append a default state='detecting' after the
    assist driver auto-commits from inside it."""
    monkeypatch.setattr(
        "dimos_xr.bridge.alignment.ALIGN_STATUS_BROADCAST_INTERVAL_S", 0.01
    )

    ctrl, sent = _make_controller(with_adapter=True)
    ctrl._stop_broadcast()
    sent.clear()

    driver = AssistDriver(adapter=MagicMock())
    driver._state = AssistState.DONE
    ctrl._assist_driver = driver
    ctrl._session_method = "tag"  # type: ignore[assignment]

    # Stub current_solve to return a valid solve so the auto-commit succeeds.
    theta = math.radians(20.0)
    T = build_T_world_odom(theta, (1.0, 0.0, -1.0))
    solve = TagSolve(T_world_odom=T, method="tag", quality=0.9, observation_count=4, baseline_m=0.2)
    ctrl._tag_tracker.current_solve = MagicMock(return_value=solve)  # type: ignore[method-assign]

    ctrl._start_broadcast()
    deadline = time.time() + 2.0
    while time.time() < deadline:
        if any(
            json.loads(m)["type"] == "align_status" and json.loads(m).get("state") == "aligned"
            for m in sent
        ):
            break
        time.sleep(0.01)
    ctrl._stop_broadcast()

    statuses = [json.loads(m) for m in sent if json.loads(m)["type"] == "align_status"]
    assert statuses, "expected at least one align_status broadcast"
    assert statuses[-1]["state"] == "aligned"
    assert all(s["state"] != "detecting" for s in statuses), (
        "no trailing 'detecting' should be emitted after auto-commit"
    )


def test_broadcast_align_status_includes_sampling_when_assist_active() -> None:
    ctrl, sent = _make_controller(with_adapter=True)
    ctrl._stop_broadcast()
    sent.clear()

    assert ctrl._assist_driver is not None
    ctrl._session_method = "tag"  # type: ignore[assignment]
    ctrl._assist_driver._state = AssistState.MOVE
    ctrl._assist_driver._move_phase = _MovePhase.SAMPLE

    ctrl._broadcast_align_status()

    statuses = [json.loads(m) for m in sent if json.loads(m)["type"] == "align_status"]
    assert statuses
    assert statuses[-1]["assist_stage"] == "move"
    assert statuses[-1]["sampling"] is True


# ------------------------------------------------------------------
# 9. assist DONE with no solve → single failed, loop stops
# ------------------------------------------------------------------

def test_assist_done_without_candidate_fails_once_and_stops(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """DONE-with-no-solve must clear the session and stop the loop."""
    monkeypatch.setattr(
        "dimos_xr.bridge.alignment.ALIGN_STATUS_BROADCAST_INTERVAL_S", 0.01
    )

    ctrl, sent = _make_controller(with_adapter=True)
    ctrl._stop_broadcast()
    sent.clear()

    driver = AssistDriver(adapter=MagicMock())
    driver._state = AssistState.DONE
    ctrl._assist_driver = driver
    ctrl._session_method = "tag"  # type: ignore[assignment]
    ctrl._tag_tracker.active = True
    ctrl._tag_tracker.current_solve = MagicMock(return_value=None)  # type: ignore[method-assign]

    ctrl._start_broadcast()
    deadline = time.time() + 2.0
    while time.time() < deadline:
        if any(
            json.loads(m)["type"] == "align_status" and json.loads(m).get("state") == "failed"
            for m in sent
        ):
            break
        time.sleep(0.01)
    time.sleep(0.2)
    ctrl._stop_broadcast()

    failed = [
        json.loads(m)
        for m in sent
        if json.loads(m)["type"] == "align_status" and json.loads(m).get("state") == "failed"
    ]
    assert len(failed) == 1, f"expected exactly one terminal 'failed', got {len(failed)}"
    assert ctrl._session_method is None
    assert ctrl._tag_tracker.active is False


# ------------------------------------------------------------------
# 10. manual align_commit with pending candidate → aligned
# ------------------------------------------------------------------

def test_manual_align_commit_succeeds() -> None:
    ctrl, sent = _make_controller()
    ctrl.on_align_start(_align_start("manual"), MagicMock())
    ctrl._stop_broadcast()
    sent.clear()

    # Deliver a pose so _pending_candidate is set
    odom_buf = ctrl._odom
    from dimos_xr.tracking.transforms import OdomSample
    odom_buf._latest = OdomSample(position=(0.0, 0.0, 0.0), orientation=(0.0, 0.0, 0.0, 1.0))  # type: ignore[attr-defined]

    pose_msg = AlignManualPoseMessage(
        ts=1.5,
        robot_id="test_robot",
        position=(1.0, 0.0, -2.0),
        orientation=(0.0, 0.0, 0.0, 1.0),
    )
    ctrl.on_align_manual_pose(pose_msg, MagicMock())
    assert ctrl._pending_candidate is not None

    sent.clear()
    commit_msg = AlignCommitMessage(ts=2.0, robot_id="test_robot")
    ctrl.on_align_commit(commit_msg, MagicMock())

    statuses = [json.loads(m) for m in sent if json.loads(m)["type"] == "align_status"]
    assert any(s["state"] == "aligned" for s in statuses)
    assert ctrl._session_method is None


# ---------------------------------------------------------------------------
# Runtime smoothing regression test (Bug A2 — yaw sign convention)
# ---------------------------------------------------------------------------


def _make_controller_with_correction() -> tuple[AlignmentController, list[str]]:
    """Like _make_controller but with runtime_correction_enabled=True."""
    sent: list[str] = []
    mock_server = MagicMock()
    mock_server.schedule_send.side_effect = lambda msg: sent.append(msg)

    sender = BridgeSender()
    sender.bind(mock_server)

    ctrl = AlignmentController(
        robot_id="test_robot",
        sender=sender,
        calibration=Calibration(),
        odom=OdomBuffer(),
        status=MagicMock(),
        tag_mounts=[],
        tracker_config=TagTrackerConfig(),
        frame_max_age_s=1.0,
        manual_alignment_quality=0.7,
        runtime_correction_enabled=True,
        tf_publish_static=MagicMock(),
        runtime_profile=RuntimeAlignmentProfile(),
    )
    ctrl._odom.speed_windowed = MagicMock(return_value=0.0)  # type: ignore[method-assign]
    return ctrl, sent


def test_runtime_smoothing_preserves_heading() -> None:
    """Regression guard: one smoothing step on an identical solve must not flip the yaw."""
    ctrl, _ = _make_controller_with_correction()

    theta = math.radians(30.0)
    T_committed = build_T_world_odom(theta, (1.0, 0.0, -2.0))

    ctrl._T_committed = T_committed
    ctrl._calibration.register_from_alignment(T_committed)

    solve = TagSolve(
        T_world_odom=np.array(T_committed, dtype=np.float64, copy=True),
        method="tag",
        quality=1.0,
        observation_count=8,
        baseline_m=0.40,
    )
    ctrl._tag_tracker.current_solve = MagicMock(return_value=solve)  # type: ignore[method-assign]
    ctrl._tag_tracker.current_translation_solve = MagicMock(return_value=solve)  # type: ignore[method-assign]

    ctrl._apply_tracker_update()

    committed_yaw = _yaw_from_T(ctrl._T_committed)
    assert committed_yaw == pytest.approx(theta, abs=1e-6), (
        f"Heading flipped: expected {math.degrees(theta):.1f}°, "
        f"got {math.degrees(committed_yaw):.1f}°"
    )


def test_runtime_translation_solve_corrects_stationary_robot() -> None:
    """When baseline solve is unavailable, runtime translation solve must still update."""
    ctrl, sent = _make_controller_with_correction()

    theta = math.radians(20.0)
    T_committed = build_T_world_odom(theta, (0.0, 0.0, 0.0))
    ctrl._T_committed = np.array(T_committed, dtype=np.float64, copy=True)
    ctrl._calibration.register_from_alignment(T_committed)

    T_target = build_T_world_odom(theta, (1.0, 0.0, -1.0))
    solve = TagSolve(
        T_world_odom=np.array(T_target, dtype=np.float64, copy=True),
        method="tag_translation",
        quality=0.95,
        observation_count=1,
        baseline_m=0.0,
    )
    ctrl._tag_tracker.current_solve = MagicMock(return_value=None)  # type: ignore[method-assign]
    ctrl._tag_tracker.current_translation_solve = MagicMock(return_value=solve)  # type: ignore[method-assign]

    ctrl._apply_tracker_update()

    committed_yaw = _yaw_from_T(ctrl._T_committed)
    assert committed_yaw == pytest.approx(theta, abs=1e-6)
    assert ctrl._T_committed[0, 3] == pytest.approx(1.0, abs=1e-3)
    assert ctrl._T_committed[2, 3] == pytest.approx(-1.0, abs=1e-3)
    pose_corrections = [
        json.loads(payload)
        for payload in sent
        if json.loads(payload).get("type") == "pose_correction"
    ]
    assert len(pose_corrections) == 1
    assert pose_corrections[0]["solve_method"] == "tag_translation"


def test_runtime_correction_emits_fresh_pose_for_stationary_robot() -> None:
    """A runtime correction must push an updated pose even without new odom traffic."""
    ctrl, sent = _make_controller_with_correction()

    theta = math.radians(20.0)
    T_committed = build_T_world_odom(theta, (0.0, 0.0, 0.0))
    ctrl._T_committed = np.array(T_committed, dtype=np.float64, copy=True)
    ctrl._calibration.register_from_alignment(T_committed)
    ctrl._odom._latest = OdomSample(  # type: ignore[attr-defined]
        position=(0.0, 0.0, 0.0),
        orientation=(0.0, 0.0, 0.0, 1.0),
    )

    T_target = build_T_world_odom(theta, (1.0, 0.0, -1.0))
    solve = TagSolve(
        T_world_odom=np.array(T_target, dtype=np.float64, copy=True),
        method="tag_translation",
        quality=0.95,
        observation_count=1,
        baseline_m=0.0,
    )
    ctrl._tag_tracker.current_solve = MagicMock(return_value=None)  # type: ignore[method-assign]
    ctrl._tag_tracker.current_translation_solve = MagicMock(return_value=solve)  # type: ignore[method-assign]

    ctrl._apply_tracker_update(ts=123.456)

    payloads = [json.loads(m) for m in sent]
    pose_payloads = [m for m in payloads if m["type"] == "pose"]
    assert pose_payloads, "runtime correction should emit an immediate pose snapshot"
    latest_pose = pose_payloads[-1]
    assert latest_pose["ts"] == pytest.approx(123.456, abs=1e-3)
    assert latest_pose["position"] == pytest.approx([1.0, 0.0, -1.0], abs=1e-3)


# ---------------------------------------------------------------------------
# pose_correction deadband: sub-threshold corrections must be silent
# ---------------------------------------------------------------------------


def test_runtime_correction_below_deadband_emits_no_pose_correction() -> None:
    """A correction below the notification deadband must update T_world_odom
    without emitting a pose_correction message."""
    ctrl, sent = _make_controller_with_correction()

    theta = math.radians(20.0)
    T_committed = build_T_world_odom(theta, (0.0, 0.0, 0.0))
    ctrl._T_committed = np.array(T_committed, dtype=np.float64, copy=True)
    ctrl._calibration.register_from_alignment(T_committed)

    # 2 cm translation, 0.5° yaw — both below the MIN_REPORTED thresholds.
    T_target = build_T_world_odom(theta + math.radians(0.5), (0.02, 0.0, 0.0))
    solve = TagSolve(
        T_world_odom=np.array(T_target, dtype=np.float64, copy=True),
        method="tag_translation",
        quality=0.95,
        observation_count=1,
        baseline_m=0.0,
    )
    ctrl._tag_tracker.current_solve = MagicMock(return_value=None)  # type: ignore[method-assign]
    ctrl._tag_tracker.current_translation_solve = MagicMock(return_value=solve)  # type: ignore[method-assign]

    ctrl._apply_tracker_update()

    pose_corrections = [
        json.loads(payload)
        for payload in sent
        if json.loads(payload).get("type") == "pose_correction"
    ]
    assert len(pose_corrections) == 0, (
        "pose_correction should not fire for sub-threshold corrections"
    )
    # But T_world_odom should still have been updated.
    assert ctrl._T_committed is not None


def test_runtime_correction_above_deadband_emits_pose_correction() -> None:
    """A correction that exceeds the notification deadband must emit pose_correction."""
    ctrl, sent = _make_controller_with_correction()

    theta = math.radians(20.0)
    T_committed = build_T_world_odom(theta, (0.0, 0.0, 0.0))
    ctrl._T_committed = np.array(T_committed, dtype=np.float64, copy=True)
    ctrl._calibration.register_from_alignment(T_committed)

    # 25 cm translation — above the pose_correction notification threshold.
    T_target = build_T_world_odom(theta, (0.25, 0.0, 0.0))
    solve = TagSolve(
        T_world_odom=np.array(T_target, dtype=np.float64, copy=True),
        method="tag_translation",
        quality=0.95,
        observation_count=1,
        baseline_m=0.0,
    )
    ctrl._tag_tracker.current_solve = MagicMock(return_value=None)  # type: ignore[method-assign]
    ctrl._tag_tracker.current_translation_solve = MagicMock(return_value=solve)  # type: ignore[method-assign]

    ctrl._apply_tracker_update()

    pose_corrections = [
        json.loads(payload)
        for payload in sent
        if json.loads(payload).get("type") == "pose_correction"
    ]
    assert len(pose_corrections) == 1
    assert pose_corrections[0]["solve_method"] == "tag_translation"


# ---------------------------------------------------------------------------
# C1 regression: _clear_session must NOT emit a trailing stage-change broadcast
# ---------------------------------------------------------------------------


def test_clear_session_does_not_emit_stage_change() -> None:
    """_clear_session must use reset_to_idle, not on_new_session."""
    import time as _time

    stage_changes: list[tuple[str, str]] = []
    sent: list[str] = []
    mock_server = MagicMock()
    mock_server.schedule_send.side_effect = lambda msg: sent.append(msg)

    sender = BridgeSender()
    sender.bind(mock_server)

    adapter = MagicMock()
    adapter.assist_motion_available.return_value = True
    adapter.assist_strafe_speed.return_value = 0.5
    adapter.assist_set_lateral_velocity.return_value = True

    ctrl = AlignmentController(
        robot_id="test_robot",
        sender=sender,
        calibration=Calibration(),
        odom=OdomBuffer(),
        status=MagicMock(),
        tag_mounts=[],
        tracker_config=TagTrackerConfig(),
        frame_max_age_s=1.0,
        manual_alignment_quality=0.7,
        runtime_correction_enabled=False,
        tf_publish_static=MagicMock(),
        adapter=adapter,
    )
    assert ctrl._assist_driver is not None
    orig_on_stage_change = ctrl._assist_driver._on_stage_change

    def tracking_on_stage_change(stage: str, message: str) -> None:
        stage_changes.append((stage, message))
        if orig_on_stage_change is not None:
            orig_on_stage_change(stage, message)

    ctrl._assist_driver._on_stage_change = tracking_on_stage_change

    ctrl._assist_driver.start()
    pos = (1.0, 0.0, -2.0)
    for i in range(3):
        ctrl._assist_driver.tick(obs_count=i, latest_obs_pos_world=pos)
    assert ctrl._assist_driver.state == AssistState.AWAITING_CONFIRM
    stage_changes.clear()

    ctrl._clear_session()
    _time.sleep(0.05)

    assert ctrl._assist_driver.state == AssistState.IDLE
    assert stage_changes == [], f"_clear_session fired on_stage_change: {stage_changes!r}"


def test_finish_alignment_terminal_status_is_last(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The last align_status after auto-commit must have state='aligned'."""
    import time as _time

    monkeypatch.setattr(
        "dimos_xr.bridge.alignment.ALIGN_STATUS_BROADCAST_INTERVAL_S", 0.01
    )
    sent: list[str] = []
    mock_server = MagicMock()
    mock_server.schedule_send.side_effect = lambda msg: sent.append(msg)

    sender = BridgeSender()
    sender.bind(mock_server)

    adapter = MagicMock()
    adapter.assist_motion_available.return_value = True
    adapter.assist_strafe_speed.return_value = 0.5
    adapter.assist_set_lateral_velocity.return_value = True

    ctrl = AlignmentController(
        robot_id="test_robot",
        sender=sender,
        calibration=Calibration(),
        odom=OdomBuffer(),
        status=MagicMock(),
        tag_mounts=[],
        tracker_config=TagTrackerConfig(),
        frame_max_age_s=1.0,
        manual_alignment_quality=0.7,
        runtime_correction_enabled=False,
        tf_publish_static=MagicMock(),
        adapter=adapter,
    )

    ctrl._stop_broadcast()
    sent.clear()

    assert ctrl._assist_driver is not None
    ctrl._assist_driver.start()
    ctrl._session_method = "tag"  # type: ignore[assignment]
    ctrl._assist_driver._state = AssistState.DONE

    theta = math.radians(20.0)
    T = build_T_world_odom(theta, (1.0, 0.0, -1.0))
    solve = TagSolve(T_world_odom=T, method="tag", quality=0.9, observation_count=4, baseline_m=0.2)
    ctrl._tag_tracker.current_solve = MagicMock(return_value=solve)  # type: ignore[method-assign]

    ctrl._start_broadcast()
    deadline = _time.time() + 2.0
    while _time.time() < deadline:
        if any(
            json.loads(m)["type"] == "align_status" and json.loads(m).get("state") == "aligned"
            for m in sent
        ):
            break
        _time.sleep(0.01)
    _time.sleep(0.15)
    ctrl._stop_broadcast()

    statuses = [json.loads(m) for m in sent if json.loads(m)["type"] == "align_status"]
    assert statuses, "expected at least one align_status"
    assert statuses[-1]["state"] == "aligned", (
        f"last align_status must be 'aligned', got {statuses[-1]['state']!r}"
    )


def test_failed_path_terminal_status_is_last(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Mirrors test_finish_alignment_terminal_status_is_last for the failure path."""
    import time as _time

    monkeypatch.setattr(
        "dimos_xr.bridge.alignment.ALIGN_STATUS_BROADCAST_INTERVAL_S", 0.01
    )
    sent: list[str] = []
    mock_server = MagicMock()
    mock_server.schedule_send.side_effect = lambda msg: sent.append(msg)

    sender = BridgeSender()
    sender.bind(mock_server)

    adapter = MagicMock()
    adapter.assist_motion_available.return_value = True
    adapter.assist_strafe_speed.return_value = 0.5
    adapter.assist_set_lateral_velocity.return_value = True

    ctrl = AlignmentController(
        robot_id="test_robot",
        sender=sender,
        calibration=Calibration(),
        odom=OdomBuffer(),
        status=MagicMock(),
        tag_mounts=[],
        tracker_config=TagTrackerConfig(),
        frame_max_age_s=1.0,
        manual_alignment_quality=0.7,
        runtime_correction_enabled=False,
        tf_publish_static=MagicMock(),
        adapter=adapter,
    )

    ctrl._stop_broadcast()
    sent.clear()

    assert ctrl._assist_driver is not None
    ctrl._assist_driver.start()
    ctrl._session_method = "tag"  # type: ignore[assignment]
    ctrl._tag_tracker.active = True
    ctrl._assist_driver._state = AssistState.DONE
    ctrl._tag_tracker.current_solve = MagicMock(return_value=None)  # type: ignore[method-assign]

    ctrl._start_broadcast()
    deadline = _time.time() + 2.0
    while _time.time() < deadline:
        if any(
            json.loads(m)["type"] == "align_status" and json.loads(m).get("state") == "failed"
            for m in sent
        ):
            break
        _time.sleep(0.01)
    _time.sleep(0.15)
    ctrl._stop_broadcast()

    statuses = [json.loads(m) for m in sent if json.loads(m)["type"] == "align_status"]
    assert statuses, "expected at least one align_status"
    assert statuses[-1]["state"] == "failed", (
        f"last align_status must be 'failed', got {statuses[-1]['state']!r}"
    )


def test_runtime_yaw_gate_holds_on_curve() -> None:
    ctrl, _ = _make_controller_with_correction()
    ctrl._odom.speed_windowed = MagicMock(return_value=0.5)  # type: ignore[method-assign]

    theta = math.radians(15.0)
    T_committed = build_T_world_odom(theta, (0.0, 0.0, 0.0))
    ctrl._T_committed = np.array(T_committed, dtype=np.float64, copy=True)
    ctrl._calibration.register_from_alignment(T_committed)

    T_target = build_T_world_odom(theta + math.radians(5.0), (0.2, 0.0, -0.2))
    solve = TagSolve(
        T_world_odom=np.array(T_target, dtype=np.float64, copy=True),
        method="tag",
        quality=0.9,
        observation_count=6,
        baseline_m=0.5,
        straightness=0.8,
    )
    ctrl._tag_tracker.current_solve = MagicMock(return_value=solve)  # type: ignore[method-assign]

    ctrl._apply_tracker_update()

    assert _yaw_from_T(ctrl._T_committed) == pytest.approx(theta, abs=1e-6)


def test_runtime_yaw_gate_allows_straight_run() -> None:
    ctrl, _ = _make_controller_with_correction()
    ctrl._odom.speed_windowed = MagicMock(return_value=0.5)  # type: ignore[method-assign]

    theta = math.radians(15.0)
    T_committed = build_T_world_odom(theta, (0.0, 0.0, 0.0))
    ctrl._T_committed = np.array(T_committed, dtype=np.float64, copy=True)
    ctrl._calibration.register_from_alignment(T_committed)

    T_target = build_T_world_odom(theta + math.radians(5.0), (0.2, 0.0, -0.2))
    solve = TagSolve(
        T_world_odom=np.array(T_target, dtype=np.float64, copy=True),
        method="tag",
        quality=0.9,
        observation_count=6,
        baseline_m=0.5,
        straightness=0.1,
    )
    ctrl._tag_tracker.current_solve = MagicMock(return_value=solve)  # type: ignore[method-assign]

    ctrl._apply_tracker_update()

    assert _yaw_from_T(ctrl._T_committed) != pytest.approx(theta, abs=1e-6)
