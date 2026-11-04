"""Constant-space latency percentiles for control and event-loop diagnostics."""

from __future__ import annotations

import math


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
