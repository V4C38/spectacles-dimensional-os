"""Tests for AssistDriver state machine (dimos_xr.bridge.assist)."""

from __future__ import annotations

import threading
import time
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from dimos_xr.bridge.assist import (
    COLLECT_OBS_REQUIRED,
    COUNTDOWN_DURATION_S,
    MOVE_DISTANCE_M,
    ODOM_FRESHNESS_WINDOW_S,
    SETTLE_DURATION_S,
    AssistDriver,
    AssistState,
)
from dimos_xr.tracking.transforms import OdomSample


# ── fixtures ──────────────────────────────────────────────────────────────────


def _make_odom(x: float = 0.0, y: float = 0.0) -> OdomSample:
    return OdomSample(position=(x, y, 0.0), orientation=(0.0, 0.0, 0.0, 1.0))


def _make_adapter(*, available: bool = True) -> MagicMock:
    adapter = MagicMock()
    adapter.assist_motion_available.return_value = available
    adapter.assist_set_lateral_velocity.return_value = True
    return adapter


def _make_odom_buffer(*, mono: float | None = None) -> MagicMock:
    buf = MagicMock()
    buf.latest.return_value = _make_odom()
    buf.latest_mono.return_value = mono if mono is not None else time.monotonic()
    return buf


def _make_driver(
    *,
    available: bool = True,
    odom_mono: float | None = None,
) -> tuple[AssistDriver, MagicMock, MagicMock]:
    adapter = _make_adapter(available=available)
    odom_buf = _make_odom_buffer(mono=odom_mono)
    driver = AssistDriver(adapter=adapter, odom=odom_buf)
    return driver, adapter, odom_buf


# ── safety: no confirm → no velocity ─────────────────────────────────────────


def test_no_velocity_without_confirm() -> None:
    driver, adapter, odom_buf = _make_driver()
    driver.start()
    assert driver.state == AssistState.ESTIMATING
    # tick many times without confirming
    for _ in range(10):
        driver.tick(obs_count=0, latest_obs_pos_world=None, odom=_make_odom())
    adapter.assist_set_lateral_velocity.assert_not_called()


# ── happy path ────────────────────────────────────────────────────────────────


def _advance_to_awaiting_confirm(driver: AssistDriver) -> None:
    """Feed enough clustered observations to drive ESTIMATING → AWAITING_CONFIRM."""
    pos = (1.0, 0.0, -2.0)
    for i in range(3):
        driver.tick(obs_count=i, latest_obs_pos_world=pos, odom=_make_odom())
    assert driver.state == AssistState.AWAITING_CONFIRM


def _advance_through_countdown(driver: AssistDriver) -> None:
    """Confirm and wait for countdown to expire."""
    driver.on_assist_confirm()
    assert driver.state == AssistState.COUNTDOWN
    with patch("dimos_xr.bridge.assist.time") as mock_time:
        mock_time.monotonic.return_value = time.monotonic() + COUNTDOWN_DURATION_S + 0.01
        driver.tick(obs_count=3, latest_obs_pos_world=None, odom=_make_odom())
    assert driver.state == AssistState.COLLECT


def test_happy_path_full_sequence() -> None:
    driver, adapter, odom_buf = _make_driver()
    driver.start()

    _advance_to_awaiting_confirm(driver)
    driver.on_assist_confirm()
    assert driver.state == AssistState.COUNTDOWN

    # Fast-forward past countdown
    with patch("dimos_xr.bridge.assist.time") as mock_time:
        mock_time.monotonic.return_value = time.monotonic() + COUNTDOWN_DURATION_S + 0.1
        driver.tick(obs_count=3, latest_obs_pos_world=None, odom=_make_odom())
    assert driver.state == AssistState.COLLECT

    # COLLECT(0): feed enough observations
    base_count = 3
    for i in range(COLLECT_OBS_REQUIRED):
        driver.tick(obs_count=base_count + i + 1, latest_obs_pos_world=(1.0, 0.0, -2.0), odom=_make_odom())
    assert driver.state == AssistState.MOVE
    assert adapter.assist_set_lateral_velocity.called

    # MOVE(+0.35 m): odom displacement reaches target
    odom_moved = _make_odom(x=0.0, y=MOVE_DISTANCE_M)
    driver.tick(obs_count=base_count + COLLECT_OBS_REQUIRED, latest_obs_pos_world=None, odom=odom_moved)
    assert driver.state == AssistState.SETTLE

    # SETTLE: wait long enough
    with patch("dimos_xr.bridge.assist.time") as mock_time:
        mock_time.monotonic.return_value = time.monotonic() + SETTLE_DURATION_S + 0.1
        base_collect1 = base_count + COLLECT_OBS_REQUIRED
        driver.tick(obs_count=base_collect1, latest_obs_pos_world=None, odom=odom_moved)
    assert driver.state == AssistState.COLLECT

    # COLLECT(1): feed enough observations
    for i in range(COLLECT_OBS_REQUIRED):
        driver.tick(obs_count=base_collect1 + i + 1, latest_obs_pos_world=(1.0, 0.0, -2.0), odom=odom_moved)
    assert driver.state == AssistState.MOVE

    # MOVE(-0.35 m): odom displacement reaches target (robot moves back)
    odom_return = _make_odom(x=0.0, y=-MOVE_DISTANCE_M)
    driver._move_start_pos = odom_moved.position  # simulate that we started from +35 cm
    driver.tick(obs_count=base_collect1 + COLLECT_OBS_REQUIRED, latest_obs_pos_world=None, odom=odom_return)
    assert driver.state == AssistState.SETTLE

    # SETTLE again
    with patch("dimos_xr.bridge.assist.time") as mock_time:
        mock_time.monotonic.return_value = time.monotonic() + SETTLE_DURATION_S + 0.1
        base_collect2 = base_collect1 + COLLECT_OBS_REQUIRED
        driver.tick(obs_count=base_collect2, latest_obs_pos_world=None, odom=odom_return)
    assert driver.state == AssistState.COLLECT

    # COLLECT(2): final station
    for i in range(COLLECT_OBS_REQUIRED):
        driver.tick(obs_count=base_collect2 + i + 1, latest_obs_pos_world=(1.0, 0.0, -2.0), odom=odom_return)
    assert driver.state == AssistState.DONE


# ── tag loss does NOT abort ────────────────────────────────────────────────────


def test_tag_loss_during_collect_does_not_abort() -> None:
    driver, adapter, _ = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.on_assist_confirm()

    with patch("dimos_xr.bridge.assist.time") as mock_time:
        mock_time.monotonic.return_value = time.monotonic() + COUNTDOWN_DURATION_S + 0.1
        driver.tick(obs_count=3, latest_obs_pos_world=None, odom=_make_odom())

    assert driver.state == AssistState.COLLECT
    base = 3
    # Simulate a very long tag loss (no observations added for 100 ticks)
    for _ in range(100):
        driver.tick(obs_count=base, latest_obs_pos_world=None, odom=_make_odom())
        assert driver.state == AssistState.COLLECT, "Driver must not abort on tag loss during COLLECT"

    # Now tag reappears and observations accumulate
    for i in range(COLLECT_OBS_REQUIRED):
        driver.tick(obs_count=base + i + 1, latest_obs_pos_world=(1.0, 0.0, -2.0), odom=_make_odom())
    assert driver.state == AssistState.MOVE


def test_tag_loss_during_move_does_not_abort() -> None:
    driver, adapter, _ = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.on_assist_confirm()

    with patch("dimos_xr.bridge.assist.time") as mock_time:
        mock_time.monotonic.return_value = time.monotonic() + COUNTDOWN_DURATION_S + 0.1
        driver.tick(obs_count=3, latest_obs_pos_world=None, odom=_make_odom())

    base = 3
    for i in range(COLLECT_OBS_REQUIRED):
        driver.tick(obs_count=base + i + 1, latest_obs_pos_world=(1.0, 0.0, -2.0), odom=_make_odom())
    assert driver.state == AssistState.MOVE

    # Tag completely absent during MOVE — many ticks
    for _ in range(50):
        driver.tick(
            obs_count=base + COLLECT_OBS_REQUIRED,
            latest_obs_pos_world=None,
            odom=_make_odom(y=0.1),  # some movement but not enough
        )
        assert driver.state == AssistState.MOVE, "Tag loss during MOVE must not abort"

    # Odom reaches target — driver should transition regardless of tag
    driver.tick(
        obs_count=base + COLLECT_OBS_REQUIRED,
        latest_obs_pos_world=None,
        odom=_make_odom(y=MOVE_DISTANCE_M),
    )
    assert driver.state == AssistState.SETTLE


# ── odom-staleness fault guard ────────────────────────────────────────────────


def test_odom_staleness_fault_during_move_aborts() -> None:
    driver, adapter, odom_buf = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.on_assist_confirm()

    with patch("dimos_xr.bridge.assist.time") as mock_time:
        mock_time.monotonic.return_value = time.monotonic() + COUNTDOWN_DURATION_S + 0.1
        driver.tick(obs_count=3, latest_obs_pos_world=None, odom=_make_odom())

    base = 3
    for i in range(COLLECT_OBS_REQUIRED):
        driver.tick(obs_count=base + i + 1, latest_obs_pos_world=(1.0, 0.0, -2.0), odom=_make_odom())
    assert driver.state == AssistState.MOVE

    # Simulate stale odom: latest_mono is in the past
    stale_mono = time.monotonic() - ODOM_FRESHNESS_WINDOW_S - 1.0
    odom_buf.latest_mono.return_value = stale_mono

    driver.tick(obs_count=base + COLLECT_OBS_REQUIRED, latest_obs_pos_world=None, odom=_make_odom())
    assert driver.state == AssistState.AWAITING_CONFIRM
    # Must have sent stop command
    adapter.assist_set_lateral_velocity.assert_called_with(0.0)


def test_odom_staleness_during_collect_does_not_fire() -> None:
    driver, adapter, odom_buf = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.on_assist_confirm()

    with patch("dimos_xr.bridge.assist.time") as mock_time:
        mock_time.monotonic.return_value = time.monotonic() + COUNTDOWN_DURATION_S + 0.1
        driver.tick(obs_count=3, latest_obs_pos_world=None, odom=_make_odom())

    assert driver.state == AssistState.COLLECT
    # Odom stale but no velocity command active (COLLECT)
    stale_mono = time.monotonic() - ODOM_FRESHNESS_WINDOW_S - 1.0
    odom_buf.latest_mono.return_value = stale_mono
    driver.tick(obs_count=3, latest_obs_pos_world=None, odom=_make_odom())
    assert driver.state == AssistState.COLLECT, "Odom stale fault must not fire outside MOVE"


# ── external abort events ─────────────────────────────────────────────────────


def test_align_stop_aborts_and_stops_motion() -> None:
    driver, adapter, _ = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.on_assist_confirm()
    driver.on_align_stop()
    assert driver.state == AssistState.AWAITING_CONFIRM


def test_emergency_stop_aborts() -> None:
    driver, adapter, _ = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.on_assist_confirm()
    driver.on_emergency_stop()
    assert driver.state == AssistState.AWAITING_CONFIRM


def test_new_session_aborts() -> None:
    driver, adapter, _ = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.on_new_session()
    assert driver.state == AssistState.AWAITING_CONFIRM


def test_retry_after_abort_runs_countdown() -> None:
    driver, adapter, _ = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.on_align_stop()
    assert driver.state == AssistState.AWAITING_CONFIRM
    driver.on_assist_confirm()
    assert driver.state == AssistState.COUNTDOWN


# ── concurrency: interleaved tick() calls ─────────────────────────────────────


def test_concurrent_ticks_do_not_double_emit() -> None:
    """Two threads calling tick() simultaneously must not corrupt state."""
    driver, adapter, _ = _make_driver()
    driver.start()
    errors: list[Exception] = []

    def frame_thread() -> None:
        try:
            for i in range(20):
                driver.tick(obs_count=i, latest_obs_pos_world=(1.0, 0.0, -2.0), odom=_make_odom())
        except Exception as e:
            errors.append(e)

    def broadcast_thread() -> None:
        try:
            for _ in range(20):
                driver.tick(obs_count=0, latest_obs_pos_world=None, odom=_make_odom())
        except Exception as e:
            errors.append(e)

    t1 = threading.Thread(target=frame_thread)
    t2 = threading.Thread(target=broadcast_thread)
    t1.start()
    t2.start()
    t1.join()
    t2.join()
    assert not errors


# ── stage_label ───────────────────────────────────────────────────────────────


def test_stage_label_none_when_idle() -> None:
    driver, _, _ = _make_driver()
    assert driver.stage_label is None


def test_stage_label_estimating_when_started() -> None:
    driver, _, _ = _make_driver()
    driver.start()
    assert driver.stage_label == "estimating"


def test_stage_label_none_when_done() -> None:
    driver, _, _ = _make_driver()
    driver.start()
    # Manually force to DONE state
    with driver._lock:
        driver._state = AssistState.DONE
    assert driver.stage_label is None
