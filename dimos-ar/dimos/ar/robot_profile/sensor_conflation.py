"""Latest-wins gate for high-frequency sensor inbound handlers."""

from __future__ import annotations

import asyncio


class LatestWinsGate:
    """Drop superseded async handler invocations via a monotonic sequence counter."""

    __slots__ = ("_seq",)

    def __init__(self) -> None:
        self._seq = 0

    def enter(self) -> int:
        self._seq += 1
        return self._seq

    def still_latest(self, seq: int) -> bool:
        return seq == self._seq

    async def yield_for_coalesce(self) -> None:
        """Yield once so a burst of back-to-back messages can supersede this one."""
        await asyncio.sleep(0)
