"""Shutdown grace uses fake processes and never signals real servers."""

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
