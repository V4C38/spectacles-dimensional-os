"""Unmanaged listeners survive normal launcher start and stop."""

import signal
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from armodule import ARMODULE_PORT, Phase, ProcessManager


@pytest.mark.asyncio
async def test_stop_idle_leaves_foreign_port_listeners_alone(tmp_path: Path) -> None:
    mgr = ProcessManager(root=tmp_path)
    mgr.status.phase = Phase.READY
    mgr.status.check_ok = True
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
    assert not mgr._stopping_pids


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
