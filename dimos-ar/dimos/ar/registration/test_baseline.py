"""Tests for BaselineCollector state machine (dimos.ar.registration.baseline) — 3-leg stop-and-sample flow."""

from __future__ import annotations

import threading
import time
from unittest.mock import MagicMock, patch

from dimos.ar.adapters.base import BaselineMotionRecipe, DEFAULT_BASELINE_MOTION_RECIPE
from dimos.ar.bridge.adapter_motion_router import AdapterMotionRouter
from dimos.ar.bridge.test_rpc_bindings import bind_mock_adapter_rpc
from dimos.ar.registration.baseline import (
    SAMPLE_MIN_OBS,
    SAMPLE_SETTLE_S,
    BaselineCollector,
    BaselineStatus,
    _BaselineState,
    _MovePhase,
)
from dimos.ar.registration.types import CaptureHint, RegistrationPhase

# ── fixtures ──────────────────────────────────────────────────────────────────

_LEG_DURATIONS = DEFAULT_BASELINE_MOTION_RECIPE.leg_duration_s


def _make_adapter(*, available: bool = True) -> MagicMock:
    adapter = MagicMock(
        baseline_motion_available=MagicMock(return_value=available),
        send_joystick_command=MagicMock(return_value=True),
    )
    bind_mock_adapter_rpc(adapter)
    return adapter


def _make_driver(
    *,
    available: bool = True,
    motion_recipe: BaselineMotionRecipe = DEFAULT_BASELINE_MOTION_RECIPE,
) -> tuple[BaselineCollector, MagicMock, AdapterMotionRouter]:
    adapter = _make_adapter(available=available)
    router = AdapterMotionRouter(adapter)
    driver = BaselineCollector(
        motion_router=router,
        motion_available=available,
        motion_recipe=motion_recipe,
    )
    return driver, adapter, router


def _wait_for_leg_timer(driver: BaselineCollector) -> float:
    for _ in range(100):
        if driver._move_start_mono is not None:
            return driver._move_start_mono
        time.sleep(0.01)
    raise AssertionError("leg timer never started after velocity submit")


def _wait_for_velocity(adapter: MagicMock, expected: float) -> None:
    expected_args = (0.0, expected, 0.0)
    for _ in range(100):
        if adapter.send_joystick_command.call_args is not None:
            if adapter.send_joystick_command.call_args.args == expected_args:
                return
        time.sleep(0.01)
    adapter.send_joystick_command.assert_called_with(*expected_args)


# ── safety: no confirm → no velocity ─────────────────────────────────────────


def test_no_velocity_without_confirm() -> None:
    driver, adapter, _gate = _make_driver()
    driver.start()
    assert driver.state == _BaselineState.ESTIMATING
    for _ in range(10):
        driver.tick(obs_count=0, latest_obs_pos_world=None)
    adapter.send_joystick_command.assert_not_called()


# ── ESTIMATING → AWAITING_CONFIRM ────────────────────────────────────────────


def _advance_to_awaiting_confirm(driver: BaselineCollector) -> None:
    pos = (1.0, 0.0, -2.0)
    for i in range(3):
        driver.tick(obs_count=i, latest_obs_pos_world=pos)
    assert driver.state == _BaselineState.AWAITING_CONFIRM


# ── confirm goes directly to MOVE (no countdown) ─────────────────────────────


def test_confirm_enters_move_directly() -> None:
    """A1: authorize_motion must go AWAITING_CONFIRM→MOVE with no intermediate state."""
    driver, adapter, _gate = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.authorize_motion()
    assert driver.state == _BaselineState.MOVE
    _wait_for_velocity(adapter, 0.2)


def test_leg_timer_starts_on_velocity_submit() -> None:
    """Leg timer must arm on submit, not after slow adapter RPC ack."""
    driver, _adapter, _gate = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.authorize_motion()
    assert driver._move_start_mono is not None


# ── happy path: full 3-leg stop-and-sample sequence ──────────────────────────


def _stable_pos(base: float = 1.0) -> list[tuple[float, float, float]]:
    """Return SAMPLE_MIN_OBS observations tight enough to pass spread check."""
    return [(base + i * 0.001, 0.0, -2.0) for i in range(SAMPLE_MIN_OBS)]


def _drive_through_sample(
    driver: BaselineCollector,
    expected_leg_after: int | None,
) -> None:
    """Deliver stable tag observations until the driver leaves the SAMPLE phase."""
    settle_mono = driver._sample_settle_mono
    assert settle_mono is not None
    with patch("dimos.ar.registration.baseline.time") as mt:
        mt.monotonic.return_value = settle_mono + SAMPLE_SETTLE_S + 0.01
        for pos in _stable_pos():
            driver.tick(obs_count=SAMPLE_MIN_OBS, latest_obs_pos_world=pos)
    if expected_leg_after is None:
        assert driver.state == _BaselineState.DONE
    else:
        assert driver._move_leg_index == expected_leg_after
        assert driver._move_phase == _MovePhase.LEG


def test_happy_path_full_3_leg_sequence() -> None:
    driver, adapter, _gate = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.authorize_motion()
    assert driver.state == _BaselineState.MOVE
    assert driver._move_leg_index == 0

    # --- Leg 0 completes (time-based) ---
    t0 = _wait_for_leg_timer(driver)
    with patch("dimos.ar.registration.baseline.time") as mt:
        mt.monotonic.return_value = t0 + _LEG_DURATIONS[0] + 0.1
        driver.tick(obs_count=0, latest_obs_pos_world=None)
    assert driver._move_phase == _MovePhase.SAMPLE, "leg 0 must enter sample phase"

    # --- Sample 0: deliver stable observations ---
    _drive_through_sample(driver, expected_leg_after=1)
    assert driver.state == _BaselineState.MOVE
    _wait_for_velocity(adapter, -0.2)

    # --- Leg 1 completes (2× duration) ---
    t1 = _wait_for_leg_timer(driver)
    with patch("dimos.ar.registration.baseline.time") as mt:
        mt.monotonic.return_value = t1 + _LEG_DURATIONS[1] + 0.1
        driver.tick(obs_count=0, latest_obs_pos_world=None)
    assert driver._move_phase == _MovePhase.SAMPLE, "leg 1 must enter sample phase"

    # --- Sample 1 ---
    _drive_through_sample(driver, expected_leg_after=2)
    assert driver.state == _BaselineState.MOVE
    _wait_for_velocity(adapter, 0.2)

    # --- Leg 2 completes (1× duration) ---
    t2 = _wait_for_leg_timer(driver)
    with patch("dimos.ar.registration.baseline.time") as mt:
        mt.monotonic.return_value = t2 + _LEG_DURATIONS[2] + 0.1
        driver.tick(obs_count=0, latest_obs_pos_world=None)
    assert driver._move_phase == _MovePhase.SAMPLE, "leg 2 must enter sample phase"

    # --- Sample 2 → DONE ---
    _drive_through_sample(driver, expected_leg_after=None)
    assert driver.state == _BaselineState.DONE
    _wait_for_velocity(adapter, 0.0)


def test_leg_phase_emits_steady_capture_not_hold() -> None:
    """LEG motion must request steady capture so Lens keeps tracking during strafe."""
    statuses: list[BaselineStatus] = []
    adapter = _make_adapter()
    gate = AdapterMotionRouter(adapter)
    driver = BaselineCollector(
        motion_router=gate,
        motion_available=True,
        on_status=statuses.append,
    )
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.authorize_motion()

    moving_statuses = [s for s in statuses if s.phase == RegistrationPhase.MOVING]
    assert moving_statuses, "authorize_motion must emit MOVING status"
    assert moving_statuses[-1].capture == CaptureHint.STEADY
    assert moving_statuses[-1].capture != CaptureHint.HOLD


def test_odom_present_does_not_shorten_leg() -> None:
    """Regression: bad/jumpy odom must not end a leg before the timer fires."""
    from dimos.ar.world_frame.transforms import OdomSample

    driver, _adapter, _gate = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.authorize_motion()

    t0 = _wait_for_leg_timer(driver)
    odom_still = OdomSample(position=(0.0, 0.0, 0.0), orientation=(0.0, 0.0, 0.0, 1.0))
    with patch("dimos.ar.registration.baseline.time") as mt:
        mt.monotonic.return_value = t0 + 0.1
        driver.tick(obs_count=0, latest_obs_pos_world=None, latest_odom=odom_still)
    assert driver._move_phase == _MovePhase.LEG

    with patch("dimos.ar.registration.baseline.time") as mt:
        mt.monotonic.return_value = t0 + _LEG_DURATIONS[0] + 0.1
        driver.tick(obs_count=0, latest_obs_pos_world=None, latest_odom=odom_still)
    assert driver.state == _BaselineState.FAILED


def test_leg_passes_displacement_gate_when_odom_moves() -> None:
    from dimos.ar.world_frame.transforms import OdomSample

    driver, _adapter, _gate = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.authorize_motion()

    t0 = _wait_for_leg_timer(driver)
    odom_start = OdomSample(position=(0.0, 0.0, 0.0), orientation=(0.0, 0.0, 0.0, 1.0))
    odom_end = OdomSample(position=(0.15, 0.0, 0.0), orientation=(0.0, 0.0, 0.0, 1.0))
    with patch("dimos.ar.registration.baseline.time") as mt:
        mt.monotonic.return_value = t0 + 0.5
        driver.tick(obs_count=0, latest_obs_pos_world=None, latest_odom=odom_start)
        mt.monotonic.return_value = t0 + _LEG_DURATIONS[0] + 0.1
        driver.tick(obs_count=0, latest_obs_pos_world=None, latest_odom=odom_end)
    assert driver._move_phase == _MovePhase.SAMPLE


def test_time_based_leg_completion_when_odom_absent() -> None:
    driver, _adapter, _gate = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.authorize_motion()

    t0 = _wait_for_leg_timer(driver)
    with patch("dimos.ar.registration.baseline.time") as mt:
        mt.monotonic.return_value = t0 + _LEG_DURATIONS[0] - 0.1
        driver.tick(obs_count=0, latest_obs_pos_world=None, latest_odom=None)
    assert driver._move_phase == _MovePhase.LEG

    with patch("dimos.ar.registration.baseline.time") as mt:
        mt.monotonic.return_value = t0 + _LEG_DURATIONS[0] + 0.1
        driver.tick(obs_count=0, latest_obs_pos_world=None, latest_odom=None)
    assert driver._move_phase == _MovePhase.SAMPLE


# ── tag loss during motion leg: robot keeps moving ───────────────────────────


def test_tag_loss_during_leg_does_not_abort() -> None:
    driver, _, _gate = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.authorize_motion()
    assert driver.state == _BaselineState.MOVE
    t0 = _wait_for_leg_timer(driver)
    for i in range(10):
        with patch("dimos.ar.registration.baseline.time") as mt:
            mt.monotonic.return_value = t0 + 0.1 * i
            driver.tick(obs_count=0, latest_obs_pos_world=None)
        assert driver.state == _BaselineState.MOVE, "Tag loss must not abort MOVE"


# ── sample: tag loss makes the robot hold (no timeout) ───────────────────────


def test_sample_holds_on_tag_loss() -> None:
    """During a SAMPLE pause with no tag, the robot holds indefinitely."""
    driver, adapter, _gate = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.authorize_motion()

    # Fast-forward leg 0 to settle
    t0 = _wait_for_leg_timer(driver)
    with patch("dimos.ar.registration.baseline.time") as mt:
        mt.monotonic.return_value = t0 + _LEG_DURATIONS[0] + 0.1
        driver.tick(obs_count=0, latest_obs_pos_world=None)
    assert driver._move_phase == _MovePhase.SAMPLE

    # No tag — tick many times; must remain in SAMPLE
    for _ in range(20):
        driver.tick(obs_count=0, latest_obs_pos_world=None)
    assert driver._move_phase == _MovePhase.SAMPLE
    assert driver._move_leg_index == 0


# ── sample: unstable observations do not advance ─────────────────────────────


def test_sample_unstable_obs_do_not_advance() -> None:
    driver, _, _gate = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.authorize_motion()

    t0 = _wait_for_leg_timer(driver)
    with patch("dimos.ar.registration.baseline.time") as mt:
        mt.monotonic.return_value = t0 + _LEG_DURATIONS[0] + 0.1
        driver.tick(obs_count=0, latest_obs_pos_world=None)
    assert driver._move_phase == _MovePhase.SAMPLE

    # Deliver spread-out (unstable) positions after settle
    settle_mono = driver._sample_settle_mono
    assert settle_mono is not None
    with patch("dimos.ar.registration.baseline.time") as mt:
        mt.monotonic.return_value = settle_mono + SAMPLE_SETTLE_S + 0.01
        for i in range(SAMPLE_MIN_OBS + 2):
            driver.tick(obs_count=i, latest_obs_pos_world=(float(i) * 0.1, 0.0, -2.0))
    assert driver._move_phase == _MovePhase.SAMPLE, "Unstable obs must not advance the driver"


# ── external abort events ─────────────────────────────────────────────────────


def test_stop_aborts_and_stops_motion() -> None:
    driver, adapter, _gate = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.authorize_motion()
    driver.stop()
    assert driver.state == _BaselineState.IDLE


def test_emergency_stop_fails() -> None:
    driver, _, _gate = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.authorize_motion()
    driver.fail("Emergency stop received")
    assert driver.state == _BaselineState.FAILED


def test_abort_during_move_publishes_zero_velocity() -> None:
    driver, adapter, _gate = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.authorize_motion()
    assert driver.state == _BaselineState.MOVE

    driver.stop()
    assert driver.state == _BaselineState.IDLE
    _wait_for_velocity(adapter, 0.0)


def test_restart_after_stop() -> None:
    """After stop(), start() must begin a fresh estimating session."""
    driver, _, _gate = _make_driver()
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
    gate = AdapterMotionRouter(adapter)
    driver = BaselineCollector(
        motion_router=gate,
        motion_available=True,
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
    driver, adapter, _gate = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.authorize_motion()
    assert driver.state == _BaselineState.MOVE

    driver.reset_to_idle()
    assert driver.state == _BaselineState.IDLE
    _wait_for_velocity(adapter, 0.0)


# ── concurrency ───────────────────────────────────────────────────────────────


def test_concurrent_ticks_do_not_corrupt_state() -> None:
    driver, _, _gate = _make_driver()
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
    driver, _, _gate = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.authorize_motion()
    assert driver.state == _BaselineState.MOVE
    assert driver.is_sampling is False


def test_is_estimating_true_during_estimating() -> None:
    driver, _, _gate = _make_driver()
    driver.start()
    assert driver.is_estimating is True
    assert driver.is_sampling is False


def test_is_sampling_true_during_sample() -> None:
    driver, _, _gate = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.authorize_motion()
    t0 = _wait_for_leg_timer(driver)
    with patch("dimos.ar.registration.baseline.time") as mt:
        mt.monotonic.return_value = t0 + _LEG_DURATIONS[0] + 0.1
        driver.tick(obs_count=0, latest_obs_pos_world=None)
    assert driver._move_phase == _MovePhase.SAMPLE
    assert driver.is_sampling is True


def test_injected_motion_recipe_drives_velocity() -> None:
    recipe = BaselineMotionRecipe(
        strafe_speed=0.2,
        leg_duration_s=(2.0, 4.0, 2.0),
        leg_directions=(1.0, -1.0, 1.0),
        leg_distance_multipliers=(1.0, 2.0, 1.0),
    )
    adapter = _make_adapter()
    router = AdapterMotionRouter(adapter)
    driver = BaselineCollector(
        motion_router=router,
        motion_available=True,
        motion_recipe=recipe,
    )
    driver.start()
    _advance_to_awaiting_confirm(driver)
    driver.authorize_motion()
    _wait_for_velocity(adapter, 0.2)


def test_tick_not_starved_during_authorize_motion() -> None:
    """Broadcast-style tick must complete while authorize_motion runs."""
    driver, _, _gate = _make_driver()
    driver.start()
    _advance_to_awaiting_confirm(driver)

    authorize_done = threading.Event()
    tick_done = threading.Event()
    errors: list[Exception] = []

    def authorize() -> None:
        try:
            driver.authorize_motion()
            authorize_done.set()
        except Exception as exc:
            errors.append(exc)

    def tick_loop() -> None:
        try:
            for _ in range(5):
                driver.tick(obs_count=0, latest_obs_pos_world=None)
            tick_done.set()
        except Exception as exc:
            errors.append(exc)

    ta = threading.Thread(target=authorize)
    tt = threading.Thread(target=tick_loop)
    ta.start()
    tt.start()
    ta.join(timeout=2.0)
    tt.join(timeout=2.0)

    assert not errors
    assert authorize_done.is_set()
    assert tick_done.is_set()
    assert driver.state == _BaselineState.MOVE

