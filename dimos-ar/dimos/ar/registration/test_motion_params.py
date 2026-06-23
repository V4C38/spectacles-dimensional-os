from __future__ import annotations

import time
from unittest.mock import MagicMock

from dimos.ar.registration.motion_params import (
    DEFAULT_BASELINE_STRAFE_SPEED,
    BaselineMotionParams,
    resolve_baseline_motion_params,
)


def test_resolve_baseline_motion_params_uses_adapter_values() -> None:
    class Adapter:
        def baseline_strafe_speed(self) -> float:
            return 0.25

    params = resolve_baseline_motion_params(Adapter(), timeout_s=0.5)

    assert params == BaselineMotionParams(strafe_speed=0.25)


def test_resolve_baseline_motion_params_defaults_when_speed_times_out() -> None:
    adapter = MagicMock()

    def slow_speed() -> float:
        time.sleep(0.2)
        return 0.25

    adapter.baseline_strafe_speed.side_effect = slow_speed

    params = resolve_baseline_motion_params(adapter, timeout_s=0.02)

    assert params.strafe_speed == DEFAULT_BASELINE_STRAFE_SPEED


def test_resolve_baseline_motion_params_never_raises_on_adapter_error() -> None:
    adapter = MagicMock()
    adapter.baseline_strafe_speed.side_effect = RuntimeError("rpc down")

    params = resolve_baseline_motion_params(adapter, timeout_s=0.5)

    assert params.strafe_speed == DEFAULT_BASELINE_STRAFE_SPEED
