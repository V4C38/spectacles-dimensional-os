"""Tests for AssistDriver state machine (dimos_xr.bridge.assist) — 3-leg stop-and-sample flow."""

from __future__ import annotations

import threading
import time
from unittest.mock import MagicMock, patch

from dimos_xr.bridge.assist import (
    MOVE_LEG_S,
    MOVE_SPEED,
    SAMPLE_MIN_OBS,
    SAMPLE_SPREAD_M,
    AssistDriver,
    AssistState,
    _MovePhase,
)

# ── fixtures ──────────────────────────────────────────────────────────────────


def _make_adapter(*, available: bool = True) -> MagicMock:
    adapter = MagicMock()
    adapter.assist_motion_available.return_value = available
    adapter.assist_set_lateral_velocity.return_value = True
    return adapter


def _make_driver(*, available: bool = True) -> tuple[AssistDriver, MagicMock]:
    adapter = _make_adapter(available=available)
    driver = AssistDriver(adapter=adapter)
    return driver, adapter


# ── safety: no confirm → no velocity ─────────────────────────────────────────


def test_no_velocity_without_confirm() -> None:
    driver, adapter = _make_driver()
    driver.start()
    assert driver.state == AssistState.ESTIMATING
    for _ in range(10):
        driver.tick(obs_count=0, latest_obs_pos_world=None)
    adapter.assist_set_lateral_velocity.assert_not_called()


# ── ESTIMATING → AWAITING_CONFIRM ────────────────────────────────────────────


def _advance_to_awaiting_confirm(driver: AssistDriver) -> None:
    pos = (1.0, 0.0, -2.0)
    for i in range(3):
        driver.tick(obs_count=i, latest_obs_pos_world=pos)
    assert driver.state == AssistState.AWAITING_CONFIRM


# ── confirm goes directly to MOVE (no countdown) ─────────────────────────────


def test_confirm_enters_move_directly() -> None:
    """A1: on_assist_confirm must go AWAITING_CONFIRM→MOVE with no intermediate state."""
    driver, adapter = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.on_assist_confirm()
    assert driver.state == AssistState.MOVE
    adapter.assist_set_lateral_velocity.assert_called_with(MOVE_SPEED * 1.0)


# ── happy path: full 3-leg stop-and-sample sequence ──────────────────────────


def _stable_pos(base: float = 1.0) -> list[tuple[float, float, float]]:
    """Return SAMPLE_MIN_OBS observations tight enough to pass spread check."""
    return [(base + i * 0.001, 0.0, -2.0) for i in range(SAMPLE_MIN_OBS)]


def _drive_through_sample(
    driver: AssistDriver,
    expected_leg_after: int | None,
) -> None:
    """Deliver stable tag observations until the driver leaves the SAMPLE phase."""
    for pos in _stable_pos():
        driver.tick(obs_count=SAMPLE_MIN_OBS, latest_obs_pos_world=pos)
    if expected_leg_after is None:
        assert driver.state == AssistState.DONE
    else:
        assert driver._move_leg_index == expected_leg_after
        assert driver._move_phase == _MovePhase.LEG


def test_happy_path_full_3_leg_sequence() -> None:
    driver, adapter = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.on_assist_confirm()
    assert driver.state == AssistState.MOVE
    assert driver._move_leg_index == 0

    # --- Leg 0 completes (time-based) ---
    t0 = driver._move_start_mono
    assert t0 is not None
    with patch("dimos_xr.bridge.assist.time") as mt:
        mt.monotonic.return_value = t0 + MOVE_LEG_S + 0.1
        driver.tick(obs_count=0, latest_obs_pos_world=None)
    assert driver._move_phase == _MovePhase.SAMPLE, "leg 0 must enter sample phase"

    # --- Sample 0: deliver stable observations ---
    _drive_through_sample(driver, expected_leg_after=1)
    assert driver.state == AssistState.MOVE
    adapter.assist_set_lateral_velocity.assert_called_with(MOVE_SPEED * -1.0)

    # --- Leg 1 completes (2× duration) ---
    t1 = driver._move_start_mono
    assert t1 is not None
    with patch("dimos_xr.bridge.assist.time") as mt:
        mt.monotonic.return_value = t1 + 2 * MOVE_LEG_S + 0.1
        driver.tick(obs_count=0, latest_obs_pos_world=None)
    assert driver._move_phase == _MovePhase.SAMPLE, "leg 1 must enter sample phase"

    # --- Sample 1 ---
    _drive_through_sample(driver, expected_leg_after=2)
    assert driver.state == AssistState.MOVE
    adapter.assist_set_lateral_velocity.assert_called_with(MOVE_SPEED * 1.0)

    # --- Leg 2 completes (1× duration) ---
    t2 = driver._move_start_mono
    assert t2 is not None
    with patch("dimos_xr.bridge.assist.time") as mt:
        mt.monotonic.return_value = t2 + MOVE_LEG_S + 0.1
        driver.tick(obs_count=0, latest_obs_pos_world=None)
    assert driver._move_phase == _MovePhase.SAMPLE, "leg 2 must enter sample phase"

    # --- Sample 2 → DONE ---
    _drive_through_sample(driver, expected_leg_after=None)
    assert driver.state == AssistState.DONE
    adapter.assist_set_lateral_velocity.assert_called_with(0.0)


# ── tag loss during motion leg: robot keeps moving ───────────────────────────


def test_tag_loss_during_leg_does_not_abort() -> None:
    driver, _ = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.on_assist_confirm()
    assert driver.state == AssistState.MOVE
    t0 = driver._move_start_mono
    assert t0 is not None
    for i in range(10):
        with patch("dimos_xr.bridge.assist.time") as mt:
            mt.monotonic.return_value = t0 + 0.1 * i
            driver.tick(obs_count=0, latest_obs_pos_world=None)
        assert driver.state == AssistState.MOVE, "Tag loss must not abort MOVE"


# ── sample: tag loss makes the robot hold (no timeout) ───────────────────────


def test_sample_holds_on_tag_loss() -> None:
    """During a SAMPLE pause with no tag, the robot holds indefinitely."""
    driver, adapter = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.on_assist_confirm()

    # Fast-forward leg 0 to settle
    t0 = driver._move_start_mono
    assert t0 is not None
    with patch("dimos_xr.bridge.assist.time") as mt:
        mt.monotonic.return_value = t0 + MOVE_LEG_S + 0.1
        driver.tick(obs_count=0, latest_obs_pos_world=None)
    assert driver._move_phase == _MovePhase.SAMPLE

    # No tag — tick many times; must remain in SAMPLE
    for _ in range(20):
        driver.tick(obs_count=0, latest_obs_pos_world=None)
    assert driver._move_phase == _MovePhase.SAMPLE
    assert driver._move_leg_index == 0


# ── sample: unstable observations do not advance ─────────────────────────────


def test_sample_unstable_obs_do_not_advance() -> None:
    driver, _ = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.on_assist_confirm()

    t0 = driver._move_start_mono
    assert t0 is not None
    with patch("dimos_xr.bridge.assist.time") as mt:
        mt.monotonic.return_value = t0 + MOVE_LEG_S + 0.1
        driver.tick(obs_count=0, latest_obs_pos_world=None)
    assert driver._move_phase == _MovePhase.SAMPLE

    # Deliver spread-out (unstable) positions
    for i in range(SAMPLE_MIN_OBS + 2):
        driver.tick(obs_count=i, latest_obs_pos_world=(float(i) * 0.1, 0.0, -2.0))
    assert driver._move_phase == _MovePhase.SAMPLE, "Unstable obs must not advance the driver"


# ── external abort events ─────────────────────────────────────────────────────


def test_align_stop_aborts_and_stops_motion() -> None:
    driver, adapter = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.on_assist_confirm()
    driver.on_align_stop()
    assert driver.state == AssistState.AWAITING_CONFIRM


def test_emergency_stop_aborts() -> None:
    driver, _ = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.on_assist_confirm()
    driver.on_emergency_stop()
    assert driver.state == AssistState.AWAITING_CONFIRM


def test_new_session_aborts() -> None:
    driver, _ = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.on_new_session()
    assert driver.state == AssistState.AWAITING_CONFIRM


def test_abort_during_move_publishes_zero_velocity() -> None:
    driver, adapter = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.on_assist_confirm()
    assert driver.state == AssistState.MOVE

    driver.on_align_stop()
    assert driver.state == AssistState.AWAITING_CONFIRM
    adapter.assist_set_lateral_velocity.assert_called_with(0.0)


def test_retry_after_abort_restarts_from_move() -> None:
    """After an abort from AWAITING_CONFIRM, a new confirm must re-enter MOVE."""
    driver, _ = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.on_align_stop()
    assert driver.state == AssistState.AWAITING_CONFIRM
    driver.on_assist_confirm()
    assert driver.state == AssistState.MOVE


# ── reset_to_idle: silent teardown ────────────────────────────────────────────


def test_reset_to_idle_goes_to_idle_silently() -> None:
    """reset_to_idle must transition to IDLE without firing on_stage_change."""
    stage_changes: list[tuple[str, str]] = []
    adapter = _make_adapter()
    driver = AssistDriver(
        adapter=adapter,
        on_stage_change=lambda s, m: stage_changes.append((s, m)),
    )
    driver.start()
    _advance_to_awaiting_confirm(driver)
    stage_changes.clear()

    driver.reset_to_idle()

    assert driver.state == AssistState.IDLE
    assert stage_changes == [], "reset_to_idle must not fire on_stage_change"


def test_reset_to_idle_stops_motion() -> None:
    """reset_to_idle must zero the robot velocity when motion was active."""
    driver, adapter = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.on_assist_confirm()
    assert driver.state == AssistState.MOVE

    driver.reset_to_idle()
    assert driver.state == AssistState.IDLE
    adapter.assist_set_lateral_velocity.assert_called_with(0.0)


# ── concurrency ───────────────────────────────────────────────────────────────


def test_concurrent_ticks_do_not_corrupt_state() -> None:
    driver, _ = _make_driver()
    driver.start()
    errors: list[Exception] = []

    def frame_thread() -> None:
        try:
            for i in range(20):
                driver.tick(obs_count=i, latest_obs_pos_world=(1.0, 0.0, -2.0))
        except Exception as e:
            errors.append(e)

    def broadcast_thread() -> None:
        try:
            for _ in range(20):
                driver.tick(obs_count=0, latest_obs_pos_world=None)
        except Exception as e:
            errors.append(e)

    t1 = threading.Thread(target=frame_thread)
    t2 = threading.Thread(target=broadcast_thread)
    t1.start()
    t2.start()
    t1.join()
    t2.join()
    assert not errors


# ── stage_label / step_index / progress_percent ───────────────────────────────


def test_stage_label_none_when_idle() -> None:
    driver, _ = _make_driver()
    assert driver.stage_label is None


def test_stage_label_estimating_when_started() -> None:
    driver, _ = _make_driver()
    driver.start()
    assert driver.stage_label == "estimating"


def test_stage_label_none_when_done() -> None:
    driver, _ = _make_driver()
    driver.start()
    with driver._lock:
        driver._state = AssistState.DONE
    assert driver.stage_label is None


def test_step_index_1_during_estimating() -> None:
    driver, _ = _make_driver()
    driver.start()
    assert driver.step_index == 1
    assert driver.step_count == 2


def test_step_index_1_during_awaiting_confirm() -> None:
    driver, _ = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    assert driver.step_index == 1


def test_step_index_2_during_move() -> None:
    driver, _ = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.on_assist_confirm()
    assert driver.state == AssistState.MOVE
    assert driver.step_index == 2


def test_progress_percent_grows_during_estimating() -> None:
    driver, _ = _make_driver()
    driver.start()
    assert driver.progress_percent() == 0
    driver.tick(obs_count=0, latest_obs_pos_world=(1.0, 0.0, -2.0))
    assert 0 < driver.progress_percent() < 100


def test_progress_percent_100_at_awaiting_confirm() -> None:
    driver, _ = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    assert driver.progress_percent() == 100


def test_progress_percent_0_at_move_start() -> None:
    driver, _ = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.on_assist_confirm()
    assert driver.state == AssistState.MOVE
    assert driver.progress_percent() == 0


def test_progress_percent_100_at_done() -> None:
    driver, _ = _make_driver()
    driver.start()
    with driver._lock:
        driver._state = AssistState.DONE
    assert driver.progress_percent() == 100
