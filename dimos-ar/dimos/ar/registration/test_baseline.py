"""Tests for BaselineCollector state machine (dimos.ar.registration.baseline) — 3-leg stop-and-sample flow."""

from __future__ import annotations

import math
import threading
from unittest.mock import MagicMock, patch

from dimos.ar.registration.baseline import (
    MOVE_LEG_MAX_S,
    MOVE_LEG_S,
    MOVE_LEG_TARGET_M,
    SAMPLE_MIN_OBS,
    BaselineCollector,
    _BaselineState,
    _MovePhase,
)
from dimos.ar.registration.transforms import OdomSample

# ── fixtures ──────────────────────────────────────────────────────────────────


def _make_adapter(*, available: bool = True) -> MagicMock:
    adapter = MagicMock()
    adapter.baseline_motion_available.return_value = available
    adapter.baseline_strafe_speed.return_value = 0.5
    adapter.baseline_set_lateral_velocity.return_value = True
    return adapter


def _make_driver(*, available: bool = True) -> tuple[BaselineCollector, MagicMock]:
    adapter = _make_adapter(available=available)
    driver = BaselineCollector(adapter=adapter)
    return driver, adapter


# ── safety: no confirm → no velocity ─────────────────────────────────────────


def test_no_velocity_without_confirm() -> None:
    driver, adapter = _make_driver()
    driver.start()
    assert driver.state == _BaselineState.ESTIMATING
    for _ in range(10):
        driver.tick(obs_count=0, latest_obs_pos_world=None)
    adapter.baseline_set_lateral_velocity.assert_not_called()


# ── ESTIMATING → AWAITING_CONFIRM ────────────────────────────────────────────


def _advance_to_awaiting_confirm(driver: BaselineCollector) -> None:
    pos = (1.0, 0.0, -2.0)
    for i in range(3):
        driver.tick(obs_count=i, latest_obs_pos_world=pos)
    assert driver.state == _BaselineState.AWAITING_CONFIRM


# ── confirm goes directly to MOVE (no countdown) ─────────────────────────────


def test_confirm_enters_move_directly() -> None:
    """A1: authorize_motion must go AWAITING_CONFIRM→MOVE with no intermediate state."""
    driver, adapter = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.authorize_motion()
    assert driver.state == _BaselineState.MOVE
    adapter.baseline_set_lateral_velocity.assert_called_with(0.5)


# ── happy path: full 3-leg stop-and-sample sequence ──────────────────────────


def _stable_pos(base: float = 1.0) -> list[tuple[float, float, float]]:
    """Return SAMPLE_MIN_OBS observations tight enough to pass spread check."""
    return [(base + i * 0.001, 0.0, -2.0) for i in range(SAMPLE_MIN_OBS)]


def _odom(x: float, y: float, yaw_rad: float = 0.0) -> OdomSample:
    half_yaw = yaw_rad * 0.5
    return OdomSample(
        position=(x, y, 0.0),
        orientation=(0.0, 0.0, math.sin(half_yaw), math.cos(half_yaw)),
    )


def _drive_through_sample(
    driver: BaselineCollector,
    expected_leg_after: int | None,
) -> None:
    """Deliver stable tag observations until the driver leaves the SAMPLE phase."""
    for pos in _stable_pos():
        driver.tick(obs_count=SAMPLE_MIN_OBS, latest_obs_pos_world=pos)
    if expected_leg_after is None:
        assert driver.state == _BaselineState.DONE
    else:
        assert driver._move_leg_index == expected_leg_after
        assert driver._move_phase == _MovePhase.LEG


def test_happy_path_full_3_leg_sequence() -> None:
    driver, adapter = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.authorize_motion()
    assert driver.state == _BaselineState.MOVE
    assert driver._move_leg_index == 0

    # --- Leg 0 completes (time-based) ---
    t0 = driver._move_start_mono
    assert t0 is not None
    with patch("dimos.ar.registration.baseline.time") as mt:
        mt.monotonic.return_value = t0 + MOVE_LEG_S + 0.1
        driver.tick(obs_count=0, latest_obs_pos_world=None)
    assert driver._move_phase == _MovePhase.SAMPLE, "leg 0 must enter sample phase"

    # --- Sample 0: deliver stable observations ---
    _drive_through_sample(driver, expected_leg_after=1)
    assert driver.state == _BaselineState.MOVE
    adapter.baseline_set_lateral_velocity.assert_called_with(-0.5)

    # --- Leg 1 completes (2× duration) ---
    t1 = driver._move_start_mono
    assert t1 is not None
    with patch("dimos.ar.registration.baseline.time") as mt:
        mt.monotonic.return_value = t1 + 2 * MOVE_LEG_S + 0.1
        driver.tick(obs_count=0, latest_obs_pos_world=None)
    assert driver._move_phase == _MovePhase.SAMPLE, "leg 1 must enter sample phase"

    # --- Sample 1 ---
    _drive_through_sample(driver, expected_leg_after=2)
    assert driver.state == _BaselineState.MOVE
    adapter.baseline_set_lateral_velocity.assert_called_with(0.5)

    # --- Leg 2 completes (1× duration) ---
    t2 = driver._move_start_mono
    assert t2 is not None
    with patch("dimos.ar.registration.baseline.time") as mt:
        mt.monotonic.return_value = t2 + MOVE_LEG_S + 0.1
        driver.tick(obs_count=0, latest_obs_pos_world=None)
    assert driver._move_phase == _MovePhase.SAMPLE, "leg 2 must enter sample phase"

    # --- Sample 2 → DONE ---
    _drive_through_sample(driver, expected_leg_after=None)
    assert driver.state == _BaselineState.DONE
    adapter.baseline_set_lateral_velocity.assert_called_with(0.0)


def test_leg_completion_uses_odom_lateral_displacement_when_available() -> None:
    driver, _adapter = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.authorize_motion()
    assert driver.state == _BaselineState.MOVE

    # First odom sample establishes the start pose; second reaches the lateral target.
    driver.tick(obs_count=0, latest_obs_pos_world=None, latest_odom=_odom(0.0, 0.0))
    driver.tick(
        obs_count=0,
        latest_obs_pos_world=None,
        latest_odom=_odom(0.0, MOVE_LEG_TARGET_M + 0.01),
    )
    assert driver._move_phase == _MovePhase.SAMPLE


def test_leg_completion_uses_ground_displacement_with_large_yaw_change() -> None:
    driver, _adapter = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.authorize_motion()

    driver.tick(obs_count=0, latest_obs_pos_world=None, latest_odom=_odom(0.0, 0.0, 0.0))
    driver.tick(
        obs_count=0,
        latest_obs_pos_world=None,
        latest_odom=_odom(0.05, MOVE_LEG_TARGET_M + 0.02, math.radians(35.0)),
    )

    assert driver.state == _BaselineState.MOVE
    assert driver._move_phase == _MovePhase.SAMPLE


def test_leg_watchdog_advances_without_abort_when_odom_target_not_reached() -> None:
    driver, _adapter = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.authorize_motion()

    driver.tick(obs_count=0, latest_obs_pos_world=None, latest_odom=_odom(0.0, 0.0))
    t0 = driver._move_start_mono
    assert t0 is not None
    with patch("dimos.ar.registration.baseline.time") as mt:
        mt.monotonic.return_value = t0 + MOVE_LEG_MAX_S + 0.1
        driver.tick(obs_count=0, latest_obs_pos_world=None, latest_odom=_odom(0.0, 0.0))

    assert driver.state == _BaselineState.MOVE
    assert driver._move_phase == _MovePhase.SAMPLE


def test_long_middle_leg_uses_doubled_ground_displacement_target() -> None:
    driver, _adapter = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.authorize_motion()

    # Finish leg 1 and sample so leg 2 starts.
    t0 = driver._move_start_mono
    assert t0 is not None
    with patch("dimos.ar.registration.baseline.time") as mt:
        mt.monotonic.return_value = t0 + MOVE_LEG_S + 0.1
        driver.tick(obs_count=0, latest_obs_pos_world=None)
    _drive_through_sample(driver, expected_leg_after=1)
    assert driver._move_leg_index == 1

    driver.tick(obs_count=0, latest_obs_pos_world=None, latest_odom=_odom(0.0, 0.0))
    driver.tick(
        obs_count=0,
        latest_obs_pos_world=None,
        latest_odom=_odom(0.0, MOVE_LEG_TARGET_M * 1.8),
    )
    assert driver._move_phase == _MovePhase.LEG

    driver.tick(
        obs_count=0,
        latest_obs_pos_world=None,
        latest_odom=_odom(0.0, MOVE_LEG_TARGET_M * 2.0 + 0.02),
    )
    assert driver._move_phase == _MovePhase.SAMPLE


# ── tag loss during motion leg: robot keeps moving ───────────────────────────


def test_tag_loss_during_leg_does_not_abort() -> None:
    driver, _ = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.authorize_motion()
    assert driver.state == _BaselineState.MOVE
    t0 = driver._move_start_mono
    assert t0 is not None
    for i in range(10):
        with patch("dimos.ar.registration.baseline.time") as mt:
            mt.monotonic.return_value = t0 + 0.1 * i
            driver.tick(obs_count=0, latest_obs_pos_world=None)
        assert driver.state == _BaselineState.MOVE, "Tag loss must not abort MOVE"


# ── sample: tag loss makes the robot hold (no timeout) ───────────────────────


def test_sample_holds_on_tag_loss() -> None:
    """During a SAMPLE pause with no tag, the robot holds indefinitely."""
    driver, adapter = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.authorize_motion()

    # Fast-forward leg 0 to settle
    t0 = driver._move_start_mono
    assert t0 is not None
    with patch("dimos.ar.registration.baseline.time") as mt:
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
    driver.authorize_motion()

    t0 = driver._move_start_mono
    assert t0 is not None
    with patch("dimos.ar.registration.baseline.time") as mt:
        mt.monotonic.return_value = t0 + MOVE_LEG_S + 0.1
        driver.tick(obs_count=0, latest_obs_pos_world=None)
    assert driver._move_phase == _MovePhase.SAMPLE

    # Deliver spread-out (unstable) positions
    for i in range(SAMPLE_MIN_OBS + 2):
        driver.tick(obs_count=i, latest_obs_pos_world=(float(i) * 0.1, 0.0, -2.0))
    assert driver._move_phase == _MovePhase.SAMPLE, "Unstable obs must not advance the driver"


# ── external abort events ─────────────────────────────────────────────────────


def test_stop_aborts_and_stops_motion() -> None:
    driver, adapter = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.authorize_motion()
    driver.stop()
    assert driver.state == _BaselineState.IDLE


def test_emergency_stop_fails() -> None:
    driver, _ = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.authorize_motion()
    driver.fail("Emergency stop received")
    assert driver.state == _BaselineState.FAILED


def test_abort_during_move_publishes_zero_velocity() -> None:
    driver, adapter = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.authorize_motion()
    assert driver.state == _BaselineState.MOVE

    driver.stop()
    assert driver.state == _BaselineState.IDLE
    adapter.baseline_set_lateral_velocity.assert_called_with(0.0)


def test_restart_after_stop() -> None:
    """After stop(), start() must begin a fresh estimating session."""
    driver, _ = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.stop()
    assert driver.state == _BaselineState.IDLE
    driver.start()
    assert driver.state == _BaselineState.ESTIMATING


# ── reset_to_idle: silent teardown ────────────────────────────────────────────


def test_reset_to_idle_goes_to_idle_silently() -> None:
    """reset_to_idle must transition to IDLE without firing on_status."""
    status_changes: list[str] = []
    adapter = _make_adapter()
    driver = BaselineCollector(
        adapter=adapter,
        on_status=lambda s: status_changes.append(s.phase.value),
    )
    driver.start()
    _advance_to_awaiting_confirm(driver)
    status_changes.clear()

    driver.reset_to_idle()

    assert driver.state == _BaselineState.IDLE
    assert status_changes == [], "reset_to_idle must not fire on_status"


def test_reset_to_idle_stops_motion() -> None:
    """reset_to_idle must zero the robot velocity when motion was active."""
    driver, adapter = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.authorize_motion()
    assert driver.state == _BaselineState.MOVE

    driver.reset_to_idle()
    assert driver.state == _BaselineState.IDLE
    adapter.baseline_set_lateral_velocity.assert_called_with(0.0)


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


# ── sampling phase detection ───────────────────────────────────────────────────


def test_is_sampling_false_during_leg() -> None:
    driver, _ = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.authorize_motion()
    assert driver.state == _BaselineState.MOVE
    assert driver.is_sampling is False


def test_is_sampling_true_during_sample() -> None:
    driver, _ = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.authorize_motion()
    t0 = driver._move_start_mono
    assert t0 is not None
    with patch("dimos.ar.registration.baseline.time") as mt:
        mt.monotonic.return_value = t0 + MOVE_LEG_S + 0.1
        driver.tick(obs_count=0, latest_obs_pos_world=None)
    assert driver._move_phase == _MovePhase.SAMPLE
    assert driver.is_sampling is True
