"""Owned in-memory processes and stream synchronization for launcher tests."""
import asyncio
from contextlib import aclosing

from armodule import ProcessManager


class Child:
    def __init__(self) -> None:
        self.pid = 42424243
        self.stdout = asyncio.StreamReader()
        self.returncode: int | None = None
        self.exited = asyncio.Event()

    def output(self, line: str) -> None:
        self.stdout.feed_data((line + "\n").encode())

    def finish(self, code: int = 0) -> None:
        if self.returncode is None:
            self.returncode = code
            self.stdout.feed_eof()
            self.exited.set()

    async def wait(self) -> int:
        await self.exited.wait()
        assert self.returncode is not None
        return self.returncode


async def parsed(mgr: ProcessManager, child: Child, line: str) -> None:
    """Wait until the real stream reader has parsed this line."""
    handled = asyncio.Event()
    original = mgr._parse_armodule_line

    def parse(value: str) -> None:
        original(value)
        if value == line:
            handled.set()

    mgr._parse_armodule_line = parse  # type: ignore[method-assign]
    try:
        child.output(line)
        await asyncio.wait_for(handled.wait(), timeout=1)
    finally:
        mgr._parse_armodule_line = original  # type: ignore[method-assign]


async def error_status(mgr: ProcessManager) -> None:
    async with aclosing(mgr.subscribe()) as events:
        async for event in events:
            if event.get("type") == "status" and event.get("phase") == "error":
                return
