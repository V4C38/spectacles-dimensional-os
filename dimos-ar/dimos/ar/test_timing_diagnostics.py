from __future__ import annotations

from unittest.mock import Mock

import pytest

from dimos.ar import timing_diagnostics
from dimos.ar.timing_diagnostics import TimingSummary


def test_summary_is_quiet_until_due_and_resets_window(monkeypatch: pytest.MonkeyPatch) -> None:
    now = [100.0]
    monkeypatch.setattr(timing_diagnostics.time, "monotonic", lambda: now[0])
    logger = Mock()
    monkeypatch.setattr(timing_diagnostics, "logger", logger)
    summary = TimingSummary("timing", connection_id="test")
    for _ in range(1000):
        summary.record(counts={"received": 1}, maxima={"age_max_ms": 2500})
    logger.info.assert_not_called()
    now[0] += 30
    summary.record(counts={"received": 1}, maxima={"age_max_ms": 100})
    logger.info.assert_called_once_with(
        "timing", connection_id="test", window_s=30.0, received=1001, age_max_ms=2500
    )
    now[0] += 30
    summary.record(counts={"received": 1}, maxima={"age_max_ms": 50})
    assert logger.info.call_count == 2
    assert logger.info.call_args.kwargs["received"] == 1
    assert logger.info.call_args.kwargs["age_max_ms"] == 50
