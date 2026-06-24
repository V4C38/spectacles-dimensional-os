from __future__ import annotations

from unittest.mock import MagicMock

from dimos.ar.bridge.module import _resolve_baseline_strafe_speed
from dimos.ar.registration.baseline import DEFAULT_BASELINE_STRAFE_SPEED


def test_resolve_baseline_strafe_speed_uses_adapter_value() -> None:
    adapter = MagicMock()
    adapter.baseline_strafe_speed.return_value = 0.25
    assert _resolve_baseline_strafe_speed(adapter) == 0.25


def test_resolve_baseline_strafe_speed_defaults_on_failure() -> None:
    adapter = MagicMock()
    adapter.baseline_strafe_speed.side_effect = RuntimeError("rpc failed")
    assert _resolve_baseline_strafe_speed(adapter) == DEFAULT_BASELINE_STRAFE_SPEED
