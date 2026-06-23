from __future__ import annotations

import time
from unittest.mock import MagicMock

from dimos.ar.bridge.baseline_motion import BaselineMotionExecutor


def _wait_for_calls(adapter: MagicMock, count: int) -> None:
    for _ in range(100):
        if adapter.baseline_set_lateral_velocity.call_count >= count:
            return
        time.sleep(0.01)


def test_executor_preserves_velocity_order_under_slow_adapter() -> None:
    adapter = MagicMock()
    calls: list[float] = []

    def record(vy: float) -> bool:
        calls.append(vy)
        time.sleep(0.05)
        return True

    adapter.baseline_set_lateral_velocity.side_effect = record
    executor = BaselineMotionExecutor(adapter)

    executor.submit_lateral_velocity(0.3)
    executor.submit_lateral_velocity(0.0)
    executor.submit_lateral_velocity(-0.3)
    executor.stop_motion()

    _wait_for_calls(adapter, 4)
    assert calls == [0.3, 0.0, -0.3, 0.0]


def test_stop_motion_enqueues_zero() -> None:
    adapter = MagicMock()
    adapter.baseline_set_lateral_velocity.return_value = True
    executor = BaselineMotionExecutor(adapter)

    executor.submit_lateral_velocity(0.3)
    executor.stop_motion()

    _wait_for_calls(adapter, 2)
    assert adapter.baseline_set_lateral_velocity.call_args_list[0].args == (0.3,)
    assert adapter.baseline_set_lateral_velocity.call_args_list[1].args == (0.0,)
