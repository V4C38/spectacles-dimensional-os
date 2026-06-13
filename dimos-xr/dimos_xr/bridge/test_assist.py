"""Tests for AssistDriver state machine (dimos_xr.bridge.assist) — simplified open-loop flow."""

from __future__ import annotations

import threading
import time
from unittest.mock import MagicMock, patch

from dimos_xr.bridge.assist import (
    COUNTDOWN_DURATION_S,
    MOVE_LEG_S,
    MOVE_SPEED,
    AssistDriver,
    AssistState,
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


# ── countdown ─────────────────────────────────────────────────────────────────


def test_confirm_enters_countdown() -> None:
    driver, _ = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.on_assist_confirm()
    assert driver.state == AssistState.COUNTDOWN


def test_countdown_transitions_to_move() -> None:
    driver, adapter = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.on_assist_confirm()
    with patch("dimos_xr.bridge.assist.time") as mock_time:
        mock_time.monotonic.return_value = time.monotonic() + COUNTDOWN_DURATION_S + 0.1
        driver.tick(obs_count=3, latest_obs_pos_world=None)
    assert driver.state == AssistState.MOVE
    adapter.assist_set_lateral_velocity.assert_called_with(MOVE_SPEED)


# ── happy path: full timed move sequence ──────────────────────────────────────


def test_happy_path_full_move_sequence() -> None:
    driver, adapter = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.on_assist_confirm()

    base_time = time.monotonic()

    # Fast-forward past countdown → enters MOVE with left leg
    with patch("dimos_xr.bridge.assist.time") as mock_time:
        mock_time.monotonic.return_value = base_time + COUNTDOWN_DURATION_S + 0.1
        driver.tick(obs_count=3, latest_obs_pos_world=None)
    assert driver.state == AssistState.MOVE
    adapter.assist_set_lateral_velocity.assert_called_with(MOVE_SPEED)

    # At MOVE_LEG_S → switches to right leg (once)
    t0 = driver._move_start_mono
    assert t0 is not None
    with patch("dimos_xr.bridge.assist.time") as mock_time:
        mock_time.monotonic.return_value = t0 + MOVE_LEG_S + 0.1
        driver.tick(obs_count=3, latest_obs_pos_world=None)
    assert driver.state == AssistState.MOVE
    adapter.assist_set_lateral_velocity.assert_called_with(-MOVE_SPEED)

    # At 3 × MOVE_LEG_S → stops and transitions to DONE
    with patch("dimos_xr.bridge.assist.time") as mock_time:
        mock_time.monotonic.return_value = t0 + 3.0 * MOVE_LEG_S + 0.1
        driver.tick(obs_count=3, latest_obs_pos_world=None)
    assert driver.state == AssistState.DONE
    adapter.assist_set_lateral_velocity.assert_called_with(0.0)


def test_right_switch_happens_only_once() -> None:
    """Repeated ticks between LEG_S and 3xLEG_S must not re-issue the right command."""
    driver, adapter = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.on_assist_confirm()

    base_time = time.monotonic()
    with patch("dimos_xr.bridge.assist.time") as mock_time:
        mock_time.monotonic.return_value = base_time + COUNTDOWN_DURATION_S + 0.1
        driver.tick(obs_count=0, latest_obs_pos_world=None)

    t0 = driver._move_start_mono
    assert t0 is not None
    right_calls_before = sum(
        1 for c in adapter.assist_set_lateral_velocity.call_args_list if c.args[0] == -MOVE_SPEED
    )

    for _ in range(5):
        with patch("dimos_xr.bridge.assist.time") as mock_time:
            mock_time.monotonic.return_value = t0 + MOVE_LEG_S + 0.5
            driver.tick(obs_count=0, latest_obs_pos_world=None)

    right_calls_after = sum(
        1 for c in adapter.assist_set_lateral_velocity.call_args_list if c.args[0] == -MOVE_SPEED
    )
    assert right_calls_after - right_calls_before == 1


# ── tag loss does NOT abort ────────────────────────────────────────────────────


def test_tag_loss_during_move_does_not_abort() -> None:
    driver, _ = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.on_assist_confirm()

    base_time = time.monotonic()
    with patch("dimos_xr.bridge.assist.time") as mock_time:
        mock_time.monotonic.return_value = base_time + COUNTDOWN_DURATION_S + 0.1
        driver.tick(obs_count=0, latest_obs_pos_world=None)
    assert driver.state == AssistState.MOVE

    t0 = driver._move_start_mono
    assert t0 is not None
    for i in range(10):
        with patch("dimos_xr.bridge.assist.time") as mock_time:
            mock_time.monotonic.return_value = t0 + 0.1 * i
            driver.tick(obs_count=0, latest_obs_pos_world=None)
        assert driver.state == AssistState.MOVE, "Tag loss must not abort MOVE"


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

    base_time = time.monotonic()
    with patch("dimos_xr.bridge.assist.time") as mock_time:
        mock_time.monotonic.return_value = base_time + COUNTDOWN_DURATION_S + 0.1
        driver.tick(obs_count=0, latest_obs_pos_world=None)
    assert driver.state == AssistState.MOVE

    driver.on_align_stop()
    assert driver.state == AssistState.AWAITING_CONFIRM
    adapter.assist_set_lateral_velocity.assert_called_with(0.0)


def test_retry_after_abort_runs_countdown() -> None:
    driver, _ = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.on_align_stop()
    assert driver.state == AssistState.AWAITING_CONFIRM
    driver.on_assist_confirm()
    assert driver.state == AssistState.COUNTDOWN


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


def test_step_index_2_during_countdown() -> None:
    driver, _ = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.on_assist_confirm()
    assert driver.state == AssistState.COUNTDOWN
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


def test_progress_percent_0_at_countdown() -> None:
    driver, _ = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.on_assist_confirm()
    assert driver.state == AssistState.COUNTDOWN
    assert driver.progress_percent() == 0


def test_progress_percent_100_at_done() -> None:
    driver, _ = _make_driver()
    driver.start()
    with driver._lock:
        driver._state = AssistState.DONE
    assert driver.progress_percent() == 100


def test_progress_percent_ramps_during_move() -> None:
    driver, _ = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.on_assist_confirm()

    base_time = time.monotonic()
    with patch("dimos_xr.bridge.assist.time") as mock_time:
        mock_time.monotonic.return_value = base_time + COUNTDOWN_DURATION_S + 0.1
        driver.tick(obs_count=0, latest_obs_pos_world=None)
    assert driver.state == AssistState.MOVE

    t0 = driver._move_start_mono
    assert t0 is not None
    # Halfway through total move duration → progress should be around 50
    mid = t0 + 1.5 * MOVE_LEG_S
    with patch("dimos_xr.bridge.assist.time") as mock_time:
        mock_time.monotonic.return_value = mid
        pct = driver.progress_percent()
    assert 30 < pct < 70
