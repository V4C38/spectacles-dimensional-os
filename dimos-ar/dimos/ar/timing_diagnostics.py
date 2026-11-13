"""Constant-space, low-frequency telemetry summaries; no per-message logging."""

from __future__ import annotations

import math
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


class LatencyHistogram:
    _bounds = (1.0, 2.0, 5.0, 10.0, 25.0, 50.0, 100.0, 250.0, 500.0, 1000.0, 2000.0)

    def __init__(self) -> None:
        self._counts = [0] * (len(self._bounds) + 1)
        self._total = 0
        self.maximum = 0.0

    def add(self, milliseconds: float) -> None:
        if not math.isfinite(milliseconds):
            return
        self._total += 1
        self.maximum = max(self.maximum, milliseconds)
        for index, bound in enumerate(self._bounds):
            if milliseconds <= bound:
                self._counts[index] += 1
                return
        self._counts[-1] += 1

    def percentile(self, proportion: float) -> float:
        if self._total == 0:
            return 0.0
        seen = 0
        for index, count in enumerate(self._counts):
            seen += count
            if seen >= self._total * proportion:
                return self._bounds[index] if index < len(self._bounds) else self.maximum
        return 0.0

    def clear(self) -> None:
        self._counts = [0] * len(self._counts)
        self._total = 0
        self.maximum = 0.0
