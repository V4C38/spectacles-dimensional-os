"""Loop-owned admission for every vendor camera-query POST, including retries."""

from __future__ import annotations

from collections import deque
from collections.abc import Callable
from contextvars import ContextVar
import time


class QueryDeferredError(Exception):
    def __init__(self, retry_after_s: float, reason: str = "rate_limited") -> None:
        super().__init__(reason)
        self.retry_after_s = retry_after_s
        self.reason = reason


class VpsAdmission:
    def __init__(self, *, clock: Callable[[], float] = time.monotonic,
                 wall_clock: Callable[[], float] = time.time) -> None:
        self._clock = clock
        self._wall_clock = wall_clock
        self._dispatches: deque[float] = deque()
        self.capture_ts: ContextVar[float | None] = ContextVar("vps_capture_ts", default=None)

    def delay(self) -> float:
        now = self._clock()
        while self._dispatches and now - self._dispatches[0] >= 30.0:
            self._dispatches.popleft()
        return max(0.0, self._dispatches[0] + 30.0 - now) if len(self._dispatches) >= 3 else 0.0

    def admit(self) -> None:
        timestamp = self.capture_ts.get()
        if timestamp is not None and not -0.25 <= self._wall_clock() - timestamp <= 2.0:
            raise QueryDeferredError(0.25, "fresh_capture_required")
        delay = self.delay()
        if delay > 0:
            raise QueryDeferredError(delay)
        self._dispatches.append(self._clock())
