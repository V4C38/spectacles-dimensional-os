"""Constant-space, low-frequency telemetry summaries; no per-message logging."""

from __future__ import annotations

import time

from dimos.utils.logging_config import setup_logger

logger = setup_logger()
SUMMARY_INTERVAL_S = 30.0


class TimingSummary:
    """Aggregate fixed caller-defined counters and maxima over active windows.

    Callers use a fixed set of field names. No samples or payloads are retained.
    Idle windows produce no logs; emission is driven by the next observation.
    """

    def __init__(self, event: str, **context: str) -> None:
        self._event = event
        self._context = context
        self._started = time.monotonic()
        self._counts: dict[str, int] = {}
        self._maxima: dict[str, float] = {}

    def record(self, *, counts: dict[str, int], maxima: dict[str, float]) -> None:
        for key, count in counts.items():
            self._counts[key] = self._counts.get(key, 0) + count
        for key, value in maxima.items():
            self._maxima[key] = max(self._maxima.get(key, value), value)
        now = time.monotonic()
        elapsed = now - self._started
        if elapsed < SUMMARY_INTERVAL_S:
            return
        logger.info(
            self._event,
            **self._context,
            window_s=round(elapsed, 2),
            **self._counts,
            **{key: round(value, 2) for key, value in self._maxima.items()},
        )
        self._started = now
        self._counts.clear()
        self._maxima.clear()
