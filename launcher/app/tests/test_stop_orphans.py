"""Idle Stop frees foreign processes holding the ARModule port."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from armodule import ARMODULE_PORT, Phase, ProcessManager


@pytest.mark.asyncio
async def test_stop_idle_kills_port_listeners(tmp_path: Path) -> None:
    mgr = ProcessManager(root=tmp_path)
    mgr.status.phase = Phase.READY
    mgr.status.check_ok = True

    with (
        patch.object(mgr, "_pids_listening", new_callable=AsyncMock) as pids,
        patch.object(mgr, "_signal_pid") as signal_pid,
    ):
        pids.side_effect = [[4242], [], []]
        await mgr.stop_armodule()

    signal_pid.assert_called()
    assert mgr.status.phase == Phase.READY
    assert any(f"port {ARMODULE_PORT}" in line for line in mgr._log)


@pytest.mark.asyncio
async def test_stop_idle_noop_when_port_free(tmp_path: Path) -> None:
    mgr = ProcessManager(root=tmp_path)
    mgr.status.phase = Phase.READY
    mgr.status.check_ok = True

    with patch.object(mgr, "_pids_listening", new_callable=AsyncMock, return_value=[]):
        await mgr.stop_armodule()

    assert mgr.status.phase == Phase.READY
    assert any(f"No ARModule process on port {ARMODULE_PORT}" in line for line in mgr._log)
