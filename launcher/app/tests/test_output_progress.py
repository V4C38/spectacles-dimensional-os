"""Download progress reaches subscribers before the subprocess exits."""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from armodule import Phase, ProcessManager


@pytest.mark.asyncio
async def test_carriage_return_progress_is_streamed_before_exit(tmp_path: Path) -> None:
    manager = ProcessManager(root=tmp_path)
    process = await asyncio.create_subprocess_exec(
        sys.executable, "-c",
        "import sys; "
        "sys.stdout.buffer.write(b'Downloading: 25%\\r'); sys.stdout.flush(); "
        "sys.stdin.readline(); "
        "sys.stdout.buffer.write(b'Downloading: 100%\\r\\nReady \\xe2'); "
        "sys.stdout.flush(); sys.stdin.readline(); "
        "sys.stdout.buffer.write(b'\\x9c\\x93'); sys.stdout.flush()",
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
    )
    lines: list[str] = []
    progress = asyncio.Event()

    async def observe(line: str) -> None:
        lines.append(line)
        progress.set()

    reader = asyncio.create_task(manager._drain_output(process, observe))
    try:
        await asyncio.wait_for(progress.wait(), 3)
        assert lines == ["Downloading: 25%"]
        assert process.returncode is None
        progress.clear()
        assert process.stdin is not None
        process.stdin.write(b"\n")
        await process.stdin.drain()
        await asyncio.wait_for(progress.wait(), 3)
        assert lines == ["Downloading: 25%", "Downloading: 100%"]
        process.stdin.write(b"\n")
        await process.stdin.drain()
        assert await asyncio.wait_for(reader, 3) == 0
        assert lines == ["Downloading: 25%", "Downloading: 100%", "Ready ✓"]
    finally:
        if process.returncode is None:
            process.kill()
        await process.wait()
        reader.cancel()
        await asyncio.gather(reader, return_exceptions=True)


@pytest.mark.asyncio
async def test_quiet_startup_reports_wait_without_claiming_progress(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    manager = ProcessManager(root=tmp_path)
    manager.runtime.update_status(phase=Phase.STARTING)
    clock = [0.0]
    monkeypatch.setattr("armodule.time", SimpleNamespace(monotonic=lambda: clock[0]))
    lines: list[str] = []
    monkeypatch.setattr(manager, "_append_log", lines.append)

    async def read(_size: int) -> bytes:
        if clock[0] == 0:
            clock[0] = 16
            raise TimeoutError
        return b""

    process = SimpleNamespace(
        stdout=SimpleNamespace(read=read), returncode=None, wait=AsyncMock(return_value=0),
    )
    assert await manager._drain_output(process) == 0
    assert lines == [
        (
            "Still starting (16s elapsed); waiting for DimOS initialization. "
            "No new process output in 15s."
        )
    ]
