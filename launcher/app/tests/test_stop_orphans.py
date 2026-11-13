"""Unmanaged listeners survive normal launcher start and stop."""

import signal
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from armodule import ARMODULE_PORT, Phase, ProcessManager


@pytest.mark.asyncio
async def test_stop_idle_leaves_foreign_port_listeners_alone(tmp_path: Path) -> None:
    mgr = ProcessManager(root=tmp_path)
    mgr.dependencies.update_status(phase=Phase.READY)
    mgr.dependencies.update_status(check_ok=True)
    with (
        patch.object(mgr, "_pids_listening", new=AsyncMock(return_value=[4242])) as pids,
        patch("armodule.os.kill") as kill,
        patch("armodule.os.killpg") as killpg,
    ):
        await mgr.stop_armodule()
        await mgr.stop_armodule(force=True)
    pids.assert_not_awaited()
    kill.assert_not_called()
    killpg.assert_not_called()
    assert mgr.status.phase == Phase.READY


@pytest.mark.real_clear
@pytest.mark.asyncio
async def test_start_reports_conflicting_listeners_without_signalling(tmp_path: Path) -> None:
    mgr = ProcessManager(root=tmp_path)
    with (
        patch.object(mgr, "_pids_listening", new=AsyncMock(side_effect=lambda port: [4242] if port == ARMODULE_PORT else [])),
        patch.object(mgr, "port_in_use", return_value=False),
        patch("armodule.os.kill") as kill,
        patch("armodule.os.killpg") as killpg,
        pytest.raises(RuntimeError, match=r"8787.*4242"),
    ):
        await mgr._clear_before_start()
    kill.assert_not_called()
    killpg.assert_not_called()


@pytest.mark.real_clear
@pytest.mark.asyncio
async def test_explicit_takeover_signals_only_selected_listener_pid(tmp_path: Path) -> None:
    mgr = ProcessManager(root=tmp_path)
    with (
        patch.object(mgr, "_pids_listening", new=AsyncMock(side_effect=[[4242], [], [], []])),
        patch.object(mgr, "port_in_use", return_value=False),
        patch("armodule.os.kill") as kill,
        patch("armodule.os.killpg") as killpg,
    ):
        await mgr._clear_before_start(takeover_pids=[4242])
    kill.assert_called_once_with(4242, signal.SIGINT)
    killpg.assert_not_called()
    assert not mgr.runtime.stopping_pids


@pytest.mark.real_clear
@pytest.mark.asyncio
async def test_takeover_refuses_partial_or_unrelated_pid_selection(tmp_path: Path) -> None:
    mgr = ProcessManager(root=tmp_path)
    with (
        patch.object(mgr, "_pids_listening", new=AsyncMock(side_effect=lambda port: [4242, 4343] if port == ARMODULE_PORT else [])),
        patch.object(mgr, "port_in_use", return_value=False),
        patch("armodule.os.kill") as kill,
    ):
        with pytest.raises(RuntimeError, match="Required ports"):
            await mgr._clear_before_start(takeover_pids=[4242])
        with pytest.raises(ValueError, match="no longer listening"):
            await mgr._clear_before_start(takeover_pids=[9999])
    kill.assert_not_called()


@pytest.mark.real_clear
@pytest.mark.asyncio
async def test_unidentified_port_conflict_cannot_be_taken_over(tmp_path: Path) -> None:
    mgr = ProcessManager(root=tmp_path)
    with (
        patch.object(mgr, "_pids_listening", new=AsyncMock(return_value=[])),
        patch.object(mgr, "port_in_use", side_effect=lambda port: port == ARMODULE_PORT),
        patch("armodule.os.kill") as kill,
        pytest.raises(RuntimeError, match="unknown"),
    ):
        await mgr._clear_before_start()
    kill.assert_not_called()


@pytest.mark.real_clear
@pytest.mark.asyncio
async def test_takeover_never_signals_replacement_listener(tmp_path: Path, monkeypatch) -> None:
    mgr = ProcessManager(root=tmp_path)
    monkeypatch.setattr("armodule.STOP_GRACE_SECONDS", 0)
    with (
        patch.object(mgr, "_pids_listening", new=AsyncMock(side_effect=[[4242], [], [], [4242, 4343]])),
        patch.object(mgr, "port_in_use", side_effect=lambda port: port == ARMODULE_PORT),
        patch("armodule.os.kill") as kill,
        patch("armodule.asyncio.sleep", new=AsyncMock()),
        pytest.raises(RuntimeError, match="remain in use"),
    ):
        await mgr._clear_before_start(takeover_pids=[4242])
    assert [call.args for call in kill.call_args_list] == [
        (4242, signal.SIGINT), (4242, signal.SIGKILL),
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize("exit_code", [0, 1])
@pytest.mark.parametrize("reader", ["backend", "webxr", "setup"])
async def test_exited_leader_with_inherited_stdout_retires_owned_worker(
    tmp_path: Path, exit_code: int, reader: str,
) -> None:
    import asyncio
    import os
    import sys
    from contextlib import AsyncExitStack

    script = (
        "import subprocess,sys; "
        "p=subprocess.Popen([sys.executable,'-c','import time; time.sleep(120)']); "
        f"print(p.pid,flush=True); sys.exit({exit_code})"
    )
    mgr = ProcessManager(root=tmp_path)
    unrelated = await asyncio.create_subprocess_exec(
        sys.executable, "-c", "import time; time.sleep(120)", start_new_session=True,
    )
    proc = None
    try:
        async with AsyncExitStack() as stack:
            if reader == "setup":
                proc = await stack.enter_async_context(mgr._logged_command(
                    [sys.executable, "-c", script], cwd=tmp_path, label="Setup",
                ))
            else:
                proc = await asyncio.create_subprocess_exec(
                    sys.executable, "-c", script, stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.DEVNULL, start_new_session=True,
                )
            assert proc.stdout is not None
            worker = int(await asyncio.wait_for(proc.stdout.readline(), 3))
            # The worker keeps the pipe open after its leader exits.
            if reader == "setup":
                assert await asyncio.wait_for(mgr._drain_output(proc), 3) == exit_code
            elif reader == "webxr":
                mgr.runtime.webxr.process = proc
                await asyncio.wait_for(mgr.runtime._read_webxr_stream(proc), 5)
                assert mgr.runtime.webxr.process is None
                assert mgr.status.webxr_phase == "error"
            else:
                mgr.runtime.backend.process = proc
                await asyncio.wait_for(mgr.runtime._read_stream(proc), 3)
                async with asyncio.timeout(5):
                    while mgr.runtime.backend.process is not None:
                        await asyncio.sleep(0.02)
                    # Finalization clears the handle before awaiting group cleanup.
                    async with mgr._lock:
                        assert mgr.status.phase == (Phase.ERROR if exit_code else Phase.IDLE)
        assert proc.returncode == exit_code
        assert unrelated.returncode is None
        # A group probe is more portable than Linux-only /proc inspection.
        if Path("/proc").is_dir():
            stat = Path(f"/proc/{worker}/stat")
            assert not stat.exists() or stat.read_text().rsplit(")", 1)[1].split()[0] == "Z"
        else:
            with pytest.raises(ProcessLookupError):
                os.killpg(proc.pid, 0)
    finally:
        if proc is not None:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            await asyncio.wait_for(proc.wait(), 3)
        if unrelated.returncode is None:
            unrelated.kill()
        await unrelated.wait()
