"""Shutdown grace uses fake processes and never signals real servers."""

import asyncio
import signal
from pathlib import Path
from unittest.mock import AsyncMock, Mock, patch

import pytest

from armodule import ProcessManager


@pytest.mark.asyncio
@pytest.mark.parametrize("label, grace", [("ARModule", 60.0), ("WebXR", 8.0)])
async def test_shutdown_grace(tmp_path: Path, monkeypatch, label: str, grace: float) -> None:
    monkeypatch.delenv("DIMOS_STOP_GRACE_SECONDS", raising=False)
    mgr = ProcessManager(root=tmp_path)
    proc = Mock(pid=4242, returncode=None, wait=AsyncMock())

    async def wait_for(awaitable, *, timeout):
        assert timeout == grace
        await awaitable

    with patch("armodule.os.killpg") as killpg, patch("armodule.asyncio.wait_for", wait_for):
        assert await mgr._stop_one(proc, label)
    killpg.assert_called_once_with(4242, signal.SIGINT)


@pytest.mark.asyncio
async def test_configurable_grace_still_forces_exit(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("DIMOS_STOP_GRACE_SECONDS", "90")
    mgr = ProcessManager(root=tmp_path)
    proc = Mock(pid=4242, returncode=None, wait=AsyncMock())

    async def wait_for(awaitable, *, timeout):
        assert timeout == 90
        await awaitable
        raise TimeoutError

    with patch("armodule.os.killpg") as killpg, patch("armodule.asyncio.wait_for", wait_for):
        await mgr._stop_one(proc, "ARModule")
    assert [call.args[1] for call in killpg.call_args_list] == [signal.SIGINT, signal.SIGKILL]
    assert proc.wait.await_count == 2


@pytest.mark.parametrize("value", ["0", "-1", "nan", "inf", "invalid"])
def test_invalid_grace(tmp_path: Path, monkeypatch, value: str) -> None:
    monkeypatch.setenv("DIMOS_STOP_GRACE_SECONDS", value)
    with pytest.raises(ValueError):
        ProcessManager(root=tmp_path)


@pytest.mark.asyncio
async def test_force_stop_bypasses_pending_grace_lock(tmp_path: Path) -> None:
    mgr = ProcessManager(root=tmp_path)
    mgr._stopping_pids.add(42424242)
    await mgr._lock.acquire()
    try:
        process_list = Mock(communicate=AsyncMock(return_value=(b"", b"")))
        def kill_process(pid: int, sig: int) -> None:
            if sig == 0:
                raise ProcessLookupError(pid)

        with (
            patch("armodule.os.kill", side_effect=kill_process) as kill,
            patch("armodule.asyncio.create_subprocess_exec", AsyncMock(return_value=process_list)),
        ):
            await asyncio.wait_for(mgr.stop_armodule(force=True), timeout=0.5)
        assert [call.args for call in kill.call_args_list if call.args[1] != 0] == [
            (42424242, signal.SIGKILL)
        ]
    finally:
        mgr._lock.release()


@pytest.mark.asyncio
async def test_force_stop_reaches_child_in_a_separate_session(tmp_path: Path) -> None:
    import os
    import sys
    if not Path("/proc").is_dir():
        pytest.skip("Linux process-tree inspection")
    script = "import subprocess,sys,time; p=subprocess.Popen([sys.executable,'-c','import time; time.sleep(120)'],start_new_session=True); print(p.pid,flush=True); time.sleep(120)"
    process = await asyncio.create_subprocess_exec(sys.executable, "-c", script, stdout=asyncio.subprocess.PIPE, start_new_session=True)
    assert process.stdout is not None
    child = int(await asyncio.wait_for(process.stdout.readline(), 2))
    mgr = ProcessManager(root=tmp_path)
    mgr._proc = process
    await mgr._lock.acquire()
    try:
        await asyncio.wait_for(mgr.stop_armodule(force=True), 2.5)
        await asyncio.wait_for(process.wait(), 1)
        stat = Path(f"/proc/{child}/stat")
        assert not stat.exists() or stat.read_text().rsplit(")", 1)[1].split()[0] == "Z"
    finally:
        mgr._lock.release()
        for pid in (child, process.pid):
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        await process.wait()
