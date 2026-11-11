"""Bounded launcher logs and status subscriptions."""

from __future__ import annotations

import asyncio
import re
import time
from collections import deque
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field
from typing import Any

LOG_BUFFER_SIZE = 500
SUBSCRIBER_QUEUE_SIZE = 2000
_ANSI = re.compile(r"\x1b\[[0-9;]*m")


def _strip_ansi(text: str) -> str:
    return _ANSI.sub("", text)


@dataclass
class _Subscriber:
    queue: asyncio.Queue[dict[str, Any]] = field(
        default_factory=lambda: asyncio.Queue(maxsize=SUBSCRIBER_QUEUE_SIZE)
    )


class LauncherEvents:
    def __init__(self, snapshot: Callable[[], dict[str, Any]]) -> None:
        self.snapshot = snapshot
        self._log: deque[str] = deque(maxlen=LOG_BUFFER_SIZE)
        self._last_log_key = ""
        self._repeated_logs = 0
        self._last_log_at = 0.0
        self._subs: list[_Subscriber] = []

    async def subscribe(self) -> AsyncIterator[dict[str, Any]]:
        sub = _Subscriber()
        self._subs.append(sub)
        try:
            for line in list(self._log):
                yield {"type": "log", "line": line}
            yield {"type": "status", **self.snapshot()}
            while True:
                event = await sub.queue.get()
                yield event
        finally:
            if sub in self._subs:
                self._subs.remove(sub)

    def emit(self, event: dict[str, Any]) -> None:
        for sub in list(self._subs):
            try:
                sub.queue.put_nowait(event)
            except asyncio.QueueFull:
                dropped = 0
                while sub.queue.qsize() > max(0, SUBSCRIBER_QUEUE_SIZE - 3):
                    try:
                        old = sub.queue.get_nowait()
                    except asyncio.QueueEmpty:
                        break
                    if old.get("type") == "log":
                        dropped += 1
                try:
                    sub.queue.put_nowait(event)
                    if dropped:
                        sub.queue.put_nowait(
                            {
                                "type": "log",
                                "line": f"… {dropped} log lines dropped",
                            }
                        )
                    sub.queue.put_nowait({"type": "status", **self.snapshot()})
                except asyncio.QueueFull:
                    pass

    def append_log(self, line: str) -> None:
        key = re.sub(r"\d{4}-\d{2}-\d{2}[T ][0-9:.]+Z?", "", _strip_ansi(line))
        now = time.monotonic()
        if key == self._last_log_key and now - self._last_log_at < 1:
            self._repeated_logs += 1
            return
        if self._repeated_logs:
            summary = f"… previous message repeated {self._repeated_logs} times"
            self._log.append(summary)
            self.emit({"type": "log", "line": summary})
        self._last_log_key, self._last_log_at, self._repeated_logs = key, now, 0
        self._log.append(line)
        self.emit({"type": "log", "line": line})
