from __future__ import annotations

import time
from unittest.mock import MagicMock

from dimos.ar.bridge import adapter_rpc


def test_call_with_timeout_returns_value() -> None:
    adapter = MagicMock()
    adapter.speed.return_value = 0.3

    value, error = adapter_rpc.call_with_timeout(adapter, "speed", timeout_s=0.5)

    assert value == 0.3
    assert error is None


def test_call_with_timeout_returns_exception() -> None:
    adapter = MagicMock()
    exc = RuntimeError("boom")
    adapter.fail.side_effect = exc

    value, error = adapter_rpc.call_with_timeout(adapter, "fail", timeout_s=0.5)

    assert value is None
    assert error is exc


def test_call_with_timeout_returns_none_on_timeout() -> None:
    adapter = MagicMock()

    def slow() -> bool:
        time.sleep(0.2)
        return True

    adapter.slow.side_effect = slow
    start = time.monotonic()
    value, error = adapter_rpc.call_with_timeout(adapter, "slow", timeout_s=0.02)

    assert time.monotonic() - start < 0.15
    assert value is None
    assert error is None


def test_run_in_thread_invokes_callback() -> None:
    called = MagicMock()

    adapter_rpc.run_in_thread(called, name="test-adapter-rpc")
    for _ in range(100):
        if called.called:
            break
        time.sleep(0.01)

    called.assert_called_once()
